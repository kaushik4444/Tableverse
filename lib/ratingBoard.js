'use strict';
/**
 * The skill-rating board for one game and one scope (lifetime, or a UTC month): who is on it and in what order. Pure: the
 * database rows go in, the board comes out. A player appears only with at least `minRated` rated games in that scope, so a
 * couple of lucky matches cannot put someone at the top.
 */
const MIN_RATED_GAMES = 5;
const BOARD_LIMIT = 10;

/**
 * rows: [{ username, displayName, rating, ratedGames }] (only people who opted in, already filtered by the query).
 * Returns the top `limit` rows, highest rating first, ties broken by name, with the rating rounded for display.
 */
function rankRows(rows, { minRated = MIN_RATED_GAMES, limit = BOARD_LIMIT } = {}) {
  return rows
    .filter((r) => Number(r.ratedGames) >= minRated && Number.isFinite(Number(r.rating)))
    .sort((a, b) => Number(b.rating) - Number(a.rating) || String(a.username).localeCompare(String(b.username)))
    .slice(0, limit)
    .map((r) => ({
      username: r.username,
      displayName: r.displayName || r.username,
      rating: Math.round(Number(r.rating)), // rounded only after ordering, so 1050.4 ranks above 1049.6
      ratedGames: Number(r.ratedGames),
    }));
}

module.exports = { rankRows, MIN_RATED_GAMES, BOARD_LIMIT };
