'use strict';
// Seat-order check: in a game where seats are dealt in turn, does one seat win more often than its share?
// Each seat's wins are compared with the share expected by chance (1 in the number of seats) using a binomial z-score.
// A seat is only shown as flagged with enough games, and only when the z-score is large, so random noise is not reported.
const MIN_GAMES = 30;
const Z_FLAG = 3;
// The chance share (1 in the seat count) only holds for a game with one winner. These games have one; the cooperative
// games (The Mind), the shared-result games (Twenty-Nine, line games, Poker) and any game not listed are left out.
const SINGLE_WINNER_GAMES = ['ludo', 'snakesladders', 'propertyrivals', 'gofish'];

const num = (v) => Number(v) || 0;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function computeSeatBalance(rows) {
  return rows.map((r) => {
    const games = num(r.games);
    const wins = num(r.wins);
    const seats = num(r.seats);
    const expected = seats > 0 ? 1 / seats : 0;
    const sd = Math.sqrt(games * expected * (1 - expected));
    const z = sd > 0 ? (wins - games * expected) / sd : 0;
    const enoughGames = games >= MIN_GAMES;
    return {
      gameId: r.game_id || r.gameId,
      seats,
      seat: num(r.seat),
      games,
      wins,
      winRate: games ? round((wins / games) * 100, 1) : 0,
      expectedRate: round(expected * 100, 1),
      z: round(z, 2),
      enoughGames,
      // only over-winning is flagged: a seat that wins far less than its share is not a sign of an advantage
      flagged: enoughGames && z >= Z_FLAG,
    };
  });
}

module.exports = { computeSeatBalance, MIN_GAMES, Z_FLAG, SINGLE_WINNER_GAMES };
