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
 *     friendships, invitations, reports, blocks). Match history keeps its rows and results; the name and the link are cleared.
 *  - Only counts are logged. No e-mail address, name or id is written anywhere.
 *  - A signed-in socket of a deleted account ends at its next session check (see docs/SESSION_POLICY.md).
 */
const db = require('./pool');
const { DELETED_NAME } = require('./matches');

const DEFAULT_DAYS = 30;
const DEFAULT_BATCH = 200;
const DEFAULT_MAX_TOTAL = 20000;

// Candidate rule, written once and used by the count, the batch select and the re-checks inside the batch. It needs an
// unverified e-mail login, and any verified login of any provider protects the account. So an account whose only login
// is, say, a local one is outside this cleanup's scope.
// Administrators and owners are never candidates, whatever their login state (roles: db/migrations/013).
const CANDIDATE = `
  p.created_at < $1
  AND p.role NOT IN ('admin', 'owner')
  AND EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.provider = 'email' AND i.email_verified_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NOT NULL)`;

function cutoffFor(now, days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('days must be a whole number from 1 to 365');
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

const COUNT_SQL = `SELECT COUNT(*)::int AS n FROM players p WHERE ${CANDIDATE}`;

// Privileges that could change data. A role with any of them on any table in the public schema is refused by the dry run:
// the dry run is meant to run with the SELECT-only role (CLEANUP_DRYRUN_DATABASE_URL), and a superuser bypasses grants.
const WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];

/**
 * Throws (code READONLY_ROLE_REQUIRED, no connection details in the message) unless the connected role cannot write:
 * not a superuser, and no write privilege on any public table. Run it inside the dry run's READ ONLY transaction.
 */
async function assertCannotWrite(client) {
  const su = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
  if (su.rows[0] && su.rows[0].rolsuper) throw readOnlyRefusal('the database role is a superuser');
  // Include partitioned parents as well as ordinary tables. Column-level INSERT/UPDATE grants do not
  // appear in has_table_privilege(), so check those separately.
  const tablePrivs = WRITE_PRIVILEGES.map((p) => `has_table_privilege(current_user, c.oid, '${p}')`);
  const columnPrivs = ['INSERT', 'UPDATE'].map((p) => `has_any_column_privilege(current_user, c.oid, '${p}')`);
  const writable = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND (${[...tablePrivs, ...columnPrivs].join(' OR ')}) LIMIT 5`,
  );
  if (writable.rows.length) throw readOnlyRefusal(`the database role can change data (for example ${writable.rows.map((r) => r.relname).join(', ')})`);
}

function readOnlyRefusal(reason) {
  return Object.assign(new Error(`The dry run needs a SELECT-only database role: ${reason}. Nothing was run.`), { code: 'READONLY_ROLE_REQUIRED' });
}

/** The candidate count on an open client. Read-only statement. */
async function countCandidates(client, cutoff) {
  return (await client.query(COUNT_SQL, [cutoff])).rows[0].n;
}

/** How many accounts would be removed now. Read-only. Used before --execute, which has its own role. */
async function countUnverified({ days = DEFAULT_DAYS, now = new Date() } = {}) {
  return db.withTransaction(async (client) => countCandidates(client, cutoffFor(now, days)));
}

/**
 * Deletes candidates in batches. Returns { dryRun, candidates, deleted, batches }. With execute false it only counts.
 */
async function cleanUnverified({ days = DEFAULT_DAYS, execute = false, now = new Date(), batch = DEFAULT_BATCH, maxTotal = DEFAULT_MAX_TOTAL, log = null, database = db } = {}) {
  const cutoff = cutoffFor(now, days);
  if (!execute) {
    // The dry run: a READ ONLY transaction (the server refuses any write in it) and a role check before the count.
    const candidates = await database.withTransaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      await assertCannotWrite(client);
      return countCandidates(client, cutoff);
    });
    return { dryRun: true, candidates, deleted: 0, batches: 0 };
  }
  let deleted = 0;
  let batches = 0;
  while (deleted < maxTotal) {
    const n = await database.withTransaction(async (client) => {
      const ids = await client.query(
        `SELECT p.id FROM players p WHERE ${CANDIDATE} ORDER BY p.created_at LIMIT $2 FOR UPDATE OF p SKIP LOCKED`,
        [cutoff, Math.min(batch, maxTotal - deleted)],
      );
      if (!ids.rows.length) return 0;
      const idList = ids.rows.map((r) => r.id);
      // Same treatment as a self-service delete (db/account.js): match history keeps its rows and results, but the name goes.
      // Only accounts that still qualify are touched: this is a new statement, so it sees anything verified before the
      // locks were taken, and the rows are locked, so nothing can change between this and the delete below.
      await client.query(
        `UPDATE match_participants mp SET player_name = $3, player_id = NULL
          WHERE mp.player_id IN (SELECT p.id FROM players p WHERE p.id = ANY($2::uuid[]) AND ${CANDIDATE})`,
        [cutoff, idList, DELETED_NAME],
      );
      const gone = await client.query(
        `DELETE FROM players p WHERE p.id = ANY($2::uuid[]) AND ${CANDIDATE} RETURNING p.id`,
        [cutoff, idList],
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

module.exports = {
  cleanUnverified, countUnverified, countCandidates, assertCannotWrite, cutoffFor, CANDIDATE,
  DEFAULT_DAYS, DEFAULT_BATCH, DEFAULT_MAX_TOTAL,
};
