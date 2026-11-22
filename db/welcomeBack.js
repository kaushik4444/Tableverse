'use strict';
const db = require('./pool');
const { summarize, dayKey } = require('../lib/welcomeBack');

/**
 * The welcome-back summary for one player, or null. Only the day streak is read from games: "games since your last visit"
 * would also count games played in this session, so it is not shown. A database error gives null (no card).
 */
async function getWelcomeBack(playerId, now = new Date()) {
  try {
    const p = await db.query('SELECT previous_seen_at, visit_started_at FROM players WHERE id = $1', [playerId]);
    const previousSeenAt = p.rows[0] ? p.rows[0].previous_seen_at : null;
    const visitStartedAt = p.rows[0] ? p.rows[0].visit_started_at : null;
    if (!previousSeenAt) return null;
    const days = await db.query(
      `SELECT DISTINCT to_char(m.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
        WHERE mp.player_id = $1 AND m.completed AND m.finished_at > $2::timestamptz - INTERVAL '366 days' -- abandoned games do not count; a streak longer than a year shows as one year`,
      [playerId, now]
    );
    return summarize({ previousSeenAt, visitStartedAt, dayKeys: days.rows.map((r) => r.day), now });
  } catch {
    return null;
  }
}

module.exports = { getWelcomeBack, dayKey };
