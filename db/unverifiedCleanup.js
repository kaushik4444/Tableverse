'use strict';
/**
 * Removes accounts that were registered, never verified their e-mail, and are older than the retention period (30 days).
 *
 * Registration stays open: this only deletes what registration created and nobody verified. Guests (no login row) and
 * any account with a verified login are never candidates.
 *
 * Safety:
 *  - Nothing runs by itself. scripts/cleanup-unverified.js is a dry run unless --execute is given.
 *  - Each batch locks the account rows it deletes (FOR UPDATE, SKIP LOCKED) and re-checks the rule in a new statement under
 *    that lock. verifyEmailToken takes the same row lock before it changes a token or identity, so an account being verified
 *    is skipped here, and one verified a moment earlier is not removed.
 *  - Deletes are per batch, bounded by maxTotal, and cascade to the account's own rows (logins, tokens, sessions,
 *    friendships, invitations, reports, blocks). Match history keeps its rows; the link to the player is cleared.
 *  - Only counts are logged. No e-mail address, name or id is written anywhere.
 *  - A signed-in socket of a deleted account ends at its next session check (see docs/SESSION_POLICY.md).
 */
const db = require('./pool');

const DEFAULT_DAYS = 30;
const DEFAULT_BATCH = 200;
const DEFAULT_MAX_TOTAL = 20000;

// Candidate rule, written once and used by the count, the batch select and the re-check inside the delete.
const CANDIDATE = `
  p.created_at < $1
  AND EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NOT NULL)`;

function cutoffFor(now, days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('days must be a whole number from 1 to 365');
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** How many accounts would be removed now. Read-only. */
async function countUnverified({ days = DEFAULT_DAYS, now = new Date() } = {}) {
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM players p WHERE ${CANDIDATE}`, [cutoffFor(now, days)]);
  return r.rows[0].n;
}

/**
 * Deletes candidates in batches. Returns { dryRun, candidates, deleted, batches }. With execute false it only counts.
 */
async function cleanUnverified({ days = DEFAULT_DAYS, execute = false, now = new Date(), batch = DEFAULT_BATCH, maxTotal = DEFAULT_MAX_TOTAL, log = null } = {}) {
  const cutoff = cutoffFor(now, days);
  if (!execute) {
    const candidates = await countUnverified({ days, now });
    return { dryRun: true, candidates, deleted: 0, batches: 0 };
  }
  let deleted = 0;
  let batches = 0;
  while (deleted < maxTotal) {
    const n = await db.withTransaction(async (client) => {
      const ids = await client.query(
        `SELECT p.id FROM players p WHERE ${CANDIDATE} ORDER BY p.created_at LIMIT $2 FOR UPDATE OF p SKIP LOCKED`,
        [cutoff, Math.min(batch, maxTotal - deleted)],
      );
      if (!ids.rows.length) return 0;
      const gone = await client.query(
        `DELETE FROM players p WHERE p.id = ANY($2::uuid[]) AND ${CANDIDATE} RETURNING p.id`,
        [cutoff, ids.rows.map((r) => r.id)],
      );
      return gone.rowCount;
    });
    if (!n) break; // nothing left that qualifies, or every remaining row is locked by someone else
    deleted += n;
    batches++;
  }
  if (log) log.info('cleanup.unverified_accounts', { days, deleted, batches, capped: deleted >= maxTotal });
  return { dryRun: false, candidates: null, deleted, batches };
}

module.exports = { cleanUnverified, countUnverified, cutoffFor, DEFAULT_DAYS, DEFAULT_BATCH, DEFAULT_MAX_TOTAL };
