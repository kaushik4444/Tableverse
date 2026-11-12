'use strict';
// Seat-order check for the Insights tab. Counts only; no player is named.
const db = require('./pool');
const { clampDays } = require('./insights');
const { computeSeatBalance, MIN_GAMES, SINGLE_WINNER_GAMES } = require('../lib/seatBalance');

async function seatBalance({ days = 30 } = {}) {
  const n = clampDays(days);
  // only finished, decisive, single-winner games with a recorded result: a player who left early is left out (a seat abandoned
  // mid-game says nothing about seat order), and so are legacy matches with no match key (their winners are not known)
  const rows = (await db.query(
    `SELECT m.game_id, m.seats, p.seat, COUNT(*)::int AS games, COUNT(*) FILTER (WHERE p.is_winner)::int AS wins
       FROM matches m JOIN match_participants p ON p.match_id = m.id
      WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day') AND m.seats > 1
        AND m.match_key IS NOT NULL AND m.game_id = ANY($2::text[])
        AND NOT p.left_early AND NOT p.is_draw
        AND (SELECT COUNT(*) FROM match_participants w WHERE w.match_id = m.id AND w.is_winner) = 1
      GROUP BY m.game_id, m.seats, p.seat
      ORDER BY m.game_id, m.seats, p.seat`,
    [n, SINGLE_WINNER_GAMES]
  )).rows;
  return { days: n, minGames: MIN_GAMES, rows: computeSeatBalance(rows) };
}

module.exports = { seatBalance };
