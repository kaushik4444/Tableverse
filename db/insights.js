'use strict';
/**
 * Admin insights (read-only): how the games are used, when, how they end, who comes back and how long people play.
 *
 * Everything here is derived from rows the app already keeps (matches, match_participants, players and the aggregate
 * analytics counters). Nothing new is stored, and no e-mail address, network address or token is ever selected.
 * Bots and guests (including anonymous accounts) are left out of every player figure.
 * Times are UTC: the console converts them to the viewer's chosen zone.
 */
const db = require('./pool');

const WINDOWS = [7, 30, 90];
const clampDays = (d) => { const n = Math.floor(Number(d)); return WINDOWS.includes(n) ? n : 30; };
// The only zones the console can ask for. The database does the conversion, so daylight saving and India's half hour are exact.
const ZONES = ['UTC', 'Europe/Berlin', 'Asia/Kolkata'];
const clampZone = (z) => (ZONES.includes(z) ? z : 'UTC');

// anonymous (guest) accounts also have a player id, so a signed-in player is a participant whose account is not anonymous
const SIGNED_IN = 'EXISTS (SELECT 1 FROM players sp WHERE sp.id = p.player_id AND NOT sp.is_anonymous)';
const TODAY = "(NOW() AT TIME ZONE 'UTC')::date";
// one row per human, signed-in player in a finished match that ended inside the window
const HUMANS = `
  SELECT p.player_id, p.is_winner, p.is_draw, p.left_early, m.id AS match_id, m.game_id, m.started_at,
         EXTRACT(EPOCH FROM (m.finished_at - m.started_at)) AS secs
    FROM match_participants p
    JOIN matches m ON m.id = p.match_id
   WHERE p.player_id IS NOT NULL AND NOT p.is_bot AND ${SIGNED_IN}`;
const IN_WINDOW = "m.finished_at > NOW() - ($1::int * INTERVAL '1 day')";

const num = (v) => Number(v) || 0;
const round1 = (v) => Math.round(num(v) * 10) / 10;

async function insights({ days = 30, tz = 'UTC' } = {}) {
  const n = clampDays(days);
  const zone = clampZone(tz);
  const q = (sql, args = [n]) => db.query(sql, args);
  const [games, leavers, heat, playtime, daily, cohort, top, counters] = await Promise.all([
    // 1. what is played: finished matches per game, how long they last, how many seats, and how often a game ends with a leaver or a draw
    q(`SELECT m.game_id, COUNT(*)::int AS matches,
              COALESCE(AVG(EXTRACT(EPOCH FROM (m.finished_at - m.started_at))) / 60.0, 0)::float AS avg_minutes,
              COALESCE(AVG(m.seats), 0)::float AS avg_seats,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM match_participants x WHERE x.match_id = m.id AND x.left_early AND x.player_id IS NOT NULL AND NOT x.is_bot AND EXISTS (SELECT 1 FROM players xp WHERE xp.id = x.player_id AND NOT xp.is_anonymous)))::int AS with_leaver,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM match_participants x WHERE x.match_id = m.id AND x.is_draw))::int AS draws
         FROM matches m WHERE ${IN_WINDOW}
        GROUP BY m.game_id ORDER BY matches DESC, m.game_id`),
    // 2. leaving: human seats that were filled, and how many of those players left before the end
    q(`SELECT m.game_id, COUNT(*)::int AS humans, COUNT(*) FILTER (WHERE p.left_early)::int AS left_early
         FROM match_participants p JOIN matches m ON m.id = p.match_id
        WHERE NOT p.is_bot AND p.player_id IS NOT NULL AND ${SIGNED_IN} AND ${IN_WINDOW} GROUP BY m.game_id`),
    // 3. when: games started per weekday and hour in the chosen zone, and the players in them
    q(`SELECT EXTRACT(DOW FROM m.started_at AT TIME ZONE $2::text)::int AS dow,
              EXTRACT(HOUR FROM m.started_at AT TIME ZONE $2::text)::int AS hour,
              COUNT(DISTINCT m.id)::int AS matches,
              COUNT(p.id) FILTER (WHERE NOT p.is_bot AND p.player_id IS NOT NULL AND ${SIGNED_IN})::int AS player_games
         FROM matches m LEFT JOIN match_participants p ON p.match_id = m.id
        WHERE ${IN_WINDOW} GROUP BY 1, 2`, [n, zone]),
    // 4. time spent playing: per player, the length of the games they stayed to the end of
    q(`WITH h AS (${HUMANS} AND ${IN_WINDOW}),
            per AS (SELECT player_id, COUNT(*) AS games,
                           SUM(CASE WHEN left_early THEN 0 ELSE secs END) / 60.0 AS minutes,
                           COUNT(DISTINCT (started_at AT TIME ZONE 'UTC')::date) AS days
                      FROM h GROUP BY player_id)
       SELECT COUNT(*)::int AS players, COALESCE(SUM(minutes), 0)::float AS total_minutes,
              COALESCE(AVG(minutes), 0)::float AS avg_minutes,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes), 0)::float AS median_minutes,
              COUNT(*) FILTER (WHERE days >= 2)::int AS multi_day,
              COUNT(*) FILTER (WHERE minutes < 10)::int AS b_lt10,
              COUNT(*) FILTER (WHERE minutes >= 10 AND minutes < 30)::int AS b_10_30,
              COUNT(*) FILTER (WHERE minutes >= 30 AND minutes < 60)::int AS b_30_60,
              COUNT(*) FILTER (WHERE minutes >= 60 AND minutes < 180)::int AS b_60_180,
              COUNT(*) FILTER (WHERE minutes >= 180)::int AS b_180
         FROM per`),
    // 5. new and returning players per day (a player's first game anywhere decides "new")
    q(`WITH firsts AS (SELECT p.player_id, (MIN(m.started_at) AT TIME ZONE 'UTC')::date AS first_day
                         FROM match_participants p JOIN matches m ON m.id = p.match_id
                        WHERE p.player_id IS NOT NULL AND NOT p.is_bot AND ${SIGNED_IN} GROUP BY p.player_id),
            d AS (SELECT DISTINCT player_id, (started_at AT TIME ZONE 'UTC')::date AS day FROM (${HUMANS} AND m.started_at >= ${TODAY} - ($1::int - 1)) w)
       SELECT d.day::text AS day, COUNT(*) FILTER (WHERE f.first_day = d.day)::int AS new_players,
              COUNT(*) FILTER (WHERE f.first_day < d.day)::int AS returning_players
         FROM d JOIN firsts f ON f.player_id = d.player_id WHERE d.day > ${TODAY} - $1::int GROUP BY d.day ORDER BY d.day`),
    // 6. did they come back: players whose first game was at least a week ago, and whether they played again the next day / within a week
    q(`WITH firsts AS (SELECT p.player_id, (MIN(m.started_at) AT TIME ZONE 'UTC')::date AS first_day
                         FROM match_participants p JOIN matches m ON m.id = p.match_id
                        WHERE p.player_id IS NOT NULL AND NOT p.is_bot AND ${SIGNED_IN} GROUP BY p.player_id),
            d AS (SELECT DISTINCT p.player_id, (m.started_at AT TIME ZONE 'UTC')::date AS day
                    FROM match_participants p JOIN matches m ON m.id = p.match_id
                   WHERE p.player_id IS NOT NULL AND NOT p.is_bot AND ${SIGNED_IN})
       SELECT COUNT(*)::int AS size,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM d WHERE d.player_id = f.player_id AND d.day = f.first_day + 1))::int AS d1,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM d WHERE d.player_id = f.player_id AND d.day BETWEEN f.first_day + 1 AND f.first_day + 7))::int AS d7
         FROM firsts f WHERE f.first_day > ${TODAY} - ($1::int + 7) AND f.first_day <= ${TODAY} - 7`),
    // 7. the most active signed-in players in the window, with the hour (in the chosen zone) they most often start playing
    q(`WITH h AS (${HUMANS} AND ${IN_WINDOW})
       SELECT pl.username, pl.display_name, COUNT(*)::int AS games, COUNT(*) FILTER (WHERE h.is_winner)::int AS wins,
              (SUM(CASE WHEN h.left_early THEN 0 ELSE h.secs END) / 60.0)::float AS minutes,
              mode() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM h.started_at AT TIME ZONE $2::text)::int) AS peak_hour
         FROM h JOIN players pl ON pl.id = h.player_id
        WHERE pl.username IS NOT NULL
        GROUP BY pl.id, pl.username, pl.display_name ORDER BY games DESC, minutes DESC, pl.username LIMIT 10`, [n, zone]),
    // 8. how games end overall: started against finished (counters, so games nobody finished are included)
    q(`SELECT metric, dim, SUM(total)::int AS total FROM analytics_daily
        WHERE day > ${TODAY} - $1::int AND metric IN ('game_started', 'game_finished') GROUP BY metric, dim`),
  ]);

  const leaveBy = new Map(leavers.rows.map((r) => [r.game_id, r]));
  const started = new Map(); const finished = new Map();
  for (const r of counters.rows) (r.metric === 'game_started' ? started : finished).set(r.dim || '(none)', r.total);
  const gameIds = new Set([...games.rows.map((r) => r.game_id), ...started.keys(), ...finished.keys()]);
  const byGame = new Map(games.rows.map((r) => [r.game_id, r]));
  const gameRows = [...gameIds].map((id) => {
    const g = byGame.get(id) || {}; const l = leaveBy.get(id) || {};
    return { gameId: id, matches: num(g.matches), avgMinutes: round1(g.avg_minutes), avgSeats: round1(g.avg_seats), withLeaver: num(g.with_leaver), draws: num(g.draws),
      humans: num(l.humans), leftEarly: num(l.left_early), started: started.get(id) || 0, finished: finished.get(id) || 0 };
  }).sort((a, b) => (b.matches - a.matches) || (b.started - a.started) || a.gameId.localeCompare(b.gameId));

  const pt = playtime.rows[0] || {};
  const c = cohort.rows[0] || {};
  const newPlayers = daily.rows.reduce((a, r) => a + r.new_players, 0);
  return {
    days: n,
    zone,
    games: gameRows,
    heat: heat.rows.map((r) => ({ dow: r.dow, hour: r.hour, matches: r.matches, playerGames: r.player_games })),
    playtime: { players: num(pt.players), totalMinutes: round1(pt.total_minutes), avgMinutes: round1(pt.avg_minutes), medianMinutes: round1(pt.median_minutes),
      buckets: [num(pt.b_lt10), num(pt.b_10_30), num(pt.b_30_60), num(pt.b_60_180), num(pt.b_180)] },
    returning: { activePlayers: num(pt.players), newPlayers, returningPlayers: num(pt.multi_day), daily: daily.rows.map((r) => ({ day: r.day, newPlayers: r.new_players, returningPlayers: r.returning_players })),
      cohort: { size: num(c.size), d1: num(c.d1), d7: num(c.d7) } },
    top: top.rows.map((r) => ({ username: r.username, displayName: r.display_name, games: r.games, wins: r.wins, minutes: round1(r.minutes), peakHour: r.peak_hour })),
  };
}

module.exports = { insights, WINDOWS, ZONES, clampDays, clampZone };
