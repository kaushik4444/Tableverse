'use strict';
/**
 * How players who chose a country play, per country (read-only, Insights tab).
 *
 * Only players who set a country on their profile are counted, so this is an opt-in sample and says nothing about everyone.
 * A country with fewer than MIN_PLAYERS players is never shown on its own (small counts could point at one person): those
 * countries are folded into one "Other" line, and that line is dropped too if it still has fewer than MIN_PLAYERS players.
 * Bots, guests and anonymous accounts never count. No e-mail, address or token is read.
 */
const db = require('./pool');

const MIN_PLAYERS = 10;
const WINDOWS = [7, 30, 90];
const clampDays = (d) => { const n = Math.floor(Number(d)); return WINDOWS.includes(n) ? n : 30; };
const num = (v) => Number(v) || 0;
const round1 = (v) => Math.round(num(v) * 10) / 10;

/** Pure: apply the minimum-sample rule to per-country rows. Exported so it can be tested without a database. */
function applyMinimum(rows, min = MIN_PLAYERS) {
  const shown = rows.filter((r) => r.players >= min);
  const small = rows.filter((r) => r.players < min);
  if (small.length) {
    const other = small.reduce((a, r) => ({ players: a.players + r.players, games: a.games + r.games, minutes: a.minutes + r.minutes, leftEarly: a.leftEarly + r.leftEarly, activeDays: a.activeDays + r.activeDays }),
      { players: 0, games: 0, minutes: 0, leftEarly: 0, activeDays: 0 });
    if (other.players >= min) shown.push({ country: null, ...other });
  }
  return shown.map((r) => ({ country: r.country, players: r.players, gamesPerPlayer: round1(r.games / r.players), minutesPerPlayer: round1(r.minutes / r.players),
    leftEarlyPct: r.games ? Math.round((r.leftEarly / r.games) * 100) : null, daysPerPlayer: round1(r.activeDays / r.players) }))
    .sort((a, b) => (b.players - a.players) || String(a.country).localeCompare(String(b.country)));
}

async function countryEngagement({ days = 30 } = {}) {
  const n = clampDays(days);
  const r = await db.query(
    `WITH h AS (
       SELECT pl.country, mp.player_id, mp.left_early, (m.started_at AT TIME ZONE 'UTC')::date AS day,
              CASE WHEN mp.left_early THEN 0 ELSE EXTRACT(EPOCH FROM (m.finished_at - m.started_at)) / 60.0 END AS minutes
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id JOIN players pl ON pl.id = mp.player_id
        WHERE NOT mp.is_bot AND NOT pl.is_anonymous AND pl.country IS NOT NULL AND m.finished_at > NOW() - ($1::int * INTERVAL '1 day')
     ), per AS (SELECT country, player_id, COUNT(*) AS games, SUM(minutes) AS minutes, COUNT(*) FILTER (WHERE left_early) AS left_early, COUNT(DISTINCT day) AS days
                  FROM h GROUP BY country, player_id)
     SELECT country, COUNT(*)::int AS players, SUM(games)::int AS games, COALESCE(SUM(minutes), 0)::float AS minutes,
            SUM(left_early)::int AS left_early, SUM(days)::int AS active_days
       FROM per GROUP BY country`, [n]);
  return { minPlayers: MIN_PLAYERS, rows: applyMinimum(r.rows.map((x) => ({ country: x.country, players: x.players, games: x.games, minutes: x.minutes, leftEarly: x.left_early, activeDays: x.active_days }))) };
}

module.exports = { countryEngagement, applyMinimum, MIN_PLAYERS };
