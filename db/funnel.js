'use strict';
// Signup funnel: of the accounts that signed up on each day, how many played a game and how many came back to play on a
// later day. Counts only; no account is named. Days are UTC dates, as in the other counts.
const db = require('./pool');
const { clampDays } = require('./insights');

const num = (v) => Number(v) || 0;

// actorId + exporting: a CSV download is written to the audit log (who took the figures out, and for which range)
async function funnel({ days = 30, actorId = null, exporting = false } = {}) {
  const n = clampDays(days);
  const rows = (await db.query(
    // whole UTC days: today and the n-1 days before it, so every bucket is a full day whatever the time of day
    `WITH s AS (SELECT id, (created_at AT TIME ZONE 'UTC')::date AS signup_day
                  FROM players WHERE NOT is_anonymous
                   AND (created_at AT TIME ZONE 'UTC')::date > (NOW() AT TIME ZONE 'UTC')::date - $1::int),
          g AS (SELECT s.id AS player_id, COUNT(DISTINCT (m.started_at AT TIME ZONE 'UTC')::date) AS days
                  FROM s JOIN match_participants p ON p.player_id = s.id AND NOT p.is_bot
                  JOIN matches m ON m.id = p.match_id
                 GROUP BY s.id)
     SELECT s.signup_day::text AS day, COUNT(*)::int AS signups,
            COUNT(g.player_id)::int AS played, COUNT(*) FILTER (WHERE g.days >= 2)::int AS returned
       FROM s LEFT JOIN g ON g.player_id = s.id
      GROUP BY s.signup_day ORDER BY s.signup_day`,
    [n]
  )).rows;
  const daily = rows.map((r) => ({ day: r.day, signups: num(r.signups), played: num(r.played), returned: num(r.returned) }));
  const totals = daily.reduce((t, r) => ({ signups: t.signups + r.signups, played: t.played + r.played, returned: t.returned + r.returned }),
    { signups: 0, played: 0, returned: 0 });
  if (exporting && actorId) {
    await db.query('INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [actorId, 'funnel.export', 'players', null, JSON.stringify({ days: n })]);
  }
  return { days: n, totals, daily };
}

module.exports = { funnel };
