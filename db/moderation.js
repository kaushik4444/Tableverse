'use strict';
// Persistence for chat moderation: blocks and reports. Rules live in lib/moderation.js; this module stores them.
const db = require('./pool');
const { MAX_BLOCKS, MAX_REPORTS_PER_DAY, REPORT_REASONS } = require('../lib/moderation');

class ModerationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** The account ids this account has blocked. Loaded when a socket joins and kept in memory on that player. */
async function loadBlockedIds(blockerId) {
  const r = await db.query('SELECT blocked_id FROM player_blocks WHERE blocker_id = $1', [blockerId]);
  return new Set(r.rows.map((row) => row.blocked_id));
}

/** The accounts this one has blocked, with their display names, for the settings list. Newest first is not needed: sorted by name. */
async function listBlocked(blockerId) {
  const r = await db.query(
    `SELECT b.blocked_id AS id, COALESCE(p.display_name, 'Player') AS name
       FROM player_blocks b LEFT JOIN players p ON p.id = b.blocked_id
      WHERE b.blocker_id = $1
      ORDER BY COALESCE(p.display_name, 'Player'), b.blocked_id
      LIMIT $2`,
    [blockerId, MAX_BLOCKS]
  );
  return r.rows;
}

/** Blocks another account. Idempotent. Refuses when the list is full or the account does not exist. */
async function addBlock(blockerId, blockedId) {
  return db.withTransaction(async (client) => {
    // the same pair lock db/friends.js takes for requests and invitations, taken first (pair, then player rows, everywhere)
    const [x, y] = [blockerId, blockedId].sort();
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${x}:${y}`]);
    // lock the blocker's row so two concurrent blocks cannot both pass the size check
    await client.query('SELECT 1 FROM players WHERE id = $1 FOR NO KEY UPDATE', [blockerId]);
    const count = await client.query('SELECT COUNT(*)::int AS n FROM player_blocks WHERE blocker_id = $1', [blockerId]);
    const already = await client.query('SELECT 1 FROM player_blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
    if (!already.rows.length && count.rows[0].n >= MAX_BLOCKS) {
      throw new ModerationError(`You can block up to ${MAX_BLOCKS} accounts. Unblock someone before blocking more.`, 409);
    }
    try {
      await client.query(
        'INSERT INTO player_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [blockerId, blockedId]
      );
    } catch (err) {
      if (err && err.code === '23503') throw new ModerationError('That player could not be found.', 404);
      throw err;
    }
    return { blockedId, alreadyBlocked: already.rows.length > 0 };
  });
}

/** Removes a block. Idempotent. */
async function removeBlock(blockerId, blockedId) {
  await db.query('DELETE FROM player_blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
  return { blockedId };
}

/**
 * Stores a chat report. The caller supplies the reported text from the server's own copy of the message, never from
 * the client. Duplicate reports of the same message by the same reporter are ignored, and each reporter has a daily cap.
 * @returns {Promise<{ stored: boolean }>} stored false when this reporter already reported this message
 */
async function createChatReport({ reporterId, reportedId, roomCode, messageId, messageText, reason, details }) {
  if (!REPORT_REASONS.includes(reason)) throw new ModerationError('Choose a reason for the report.', 400);
  return db.withTransaction(async (client) => {
    await client.query('SELECT 1 FROM players WHERE id = $1 FOR NO KEY UPDATE', [reporterId]);
    // Capture the target's display name while holding a key-share lock, so deletion cannot race the report insert.
    const target = await client.query('SELECT display_name FROM players WHERE id = $1 FOR KEY SHARE', [reportedId]);
    if (!target.rows.length) throw new ModerationError('That player could not be found.', 404);
    const reportedDisplayName = target.rows[0].display_name || 'Player';
    const today = await client.query(
      "SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '1 day'",
      [reporterId]
    );
    if (today.rows[0].n >= MAX_REPORTS_PER_DAY) {
      throw new ModerationError('You have sent many reports today. Please try again tomorrow.', 429);
    }
    let r;
    try {
      r = await client.query(
        `INSERT INTO chat_reports (reporter_id, reported_id, reported_display_name, room_code, message_id, message_text, reason, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (reporter_id, message_id) DO NOTHING
         RETURNING id`,
        [reporterId, reportedId, reportedDisplayName, roomCode, messageId, String(messageText).slice(0, 200), reason, details || '']
      );
    } catch (err) {
      if (err && err.code === '23503') throw new ModerationError('That player could not be found.', 404);
      throw err;
    }
    return { stored: r.rows.length === 1 };
  });
}

module.exports = { ModerationError, loadBlockedIds, listBlocked, addBlock, removeBlock, createChatReport, MAX_REPORTS_PER_DAY, MAX_BLOCKS };
