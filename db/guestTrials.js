'use strict';
/**
 * Game trials for guests: how many games a guest device may start, per game, when the owner has set a limit (Games tab,
 * game_flags.guest_trial_limit). A play is a game that starts with a guest seated at the table.
 *
 * The count is kept per device, not per session: a guest who comes back in a new session keeps the count. The device is
 * identified by a hash of its trial cookie, stored on the guest's player row when the guest is made. Clearing the browser's
 * cookies starts a new count. This is a deterrent, not a lock.
 *
 * Starting a game reserves its plays in one transaction: either every guest seat gets its play, or none does. A device at
 * its limit refuses the start, and the transaction rolls back, so no count is left half-updated.
 */
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const db = require('./pool');

class TrialLimitReached extends Error {
  constructor(trialKey) { super('guest trial limit reached'); this.trialKey = trialKey; }
}

/** The stored form of a device's trial cookie: a SHA-256 hash, so the raw cookie value is never kept. */
function hashTrialKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** The trial keys of the given guest player ids (null for a player with no key). Registered players have no key. */
async function trialKeysFor(playerIds) {
  // only UUIDs can be player ids: bot seats have other ids and are never guests
  const ids = [...new Set(playerIds.filter((id) => typeof id === 'string' && UUID.test(id)))];
  if (!ids.length) return new Map();
  const r = await db.query('SELECT id, guest_trial_key FROM players WHERE id = ANY($1::uuid[]) AND guest_trial_key IS NOT NULL', [ids]);
  return new Map(r.rows.map((row) => [row.id, row.guest_trial_key]));
}

/**
 * Reserves one play of `gameId` for each device in `trialKeys` (hashes), if none of them is at `limit`.
 * Returns { ok: true } when every device got its play, or { ok: false, trialKey } naming the first device at its limit
 * (nothing is counted in that case). `limit` must be an integer from 1 to 9.
 */
async function reservePlays({ gameId, limit, trialKeys }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 9) throw new Error('trial limit must be 1 to 9');
  const keys = [...new Set(trialKeys)].sort(); // a fixed order, so two starts never lock the same rows in opposite orders
  if (!keys.length) return { ok: true };
  try {
    await db.withTransaction(async (c) => {
      for (const key of keys) {
        // A new device gets its first play. An existing one is raised only while it is below the limit; if the row is not
        // updated, the device is at its limit and nothing is returned.
        const r = await c.query(
          `INSERT INTO guest_game_trials (trial_key, game_id, plays) VALUES ($1, $2, 1)
           ON CONFLICT (trial_key, game_id) DO UPDATE SET plays = guest_game_trials.plays + 1, updated_at = NOW()
           WHERE guest_game_trials.plays < $3
           RETURNING plays`,
          [key, gameId, limit]
        );
        if (!r.rows.length) throw new TrialLimitReached(key);
      }
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof TrialLimitReached) return { ok: false, trialKey: e.trialKey };
    throw e;
  }
}

module.exports = { hashTrialKey, trialKeysFor, reservePlays, TrialLimitReached };
