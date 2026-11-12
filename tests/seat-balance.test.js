'use strict';
// The seat-order statistics: expected share by seat count, binomial z-score, sample floor and flag threshold.
const assert = require('node:assert/strict');
const { computeSeatBalance, MIN_GAMES, Z_FLAG } = require('../lib/seatBalance');

assert.equal(MIN_GAMES, 30);
assert.equal(Z_FLAG, 3);
const [fair, lucky, small] = computeSeatBalance([
  { game_id: 'ludo', seats: 2, seat: 0, games: 100, wins: 52 },   // 52 of 100 against 50 expected: z 0.4, not flagged
  { game_id: 'ludo', seats: 2, seat: 1, games: 100, wins: 70 },   // 70 of 100: z 4, flagged
  { game_id: 'snakes', seats: 4, seat: 0, games: 20, wins: 15 },  // too few games to judge, however lopsided
]);
assert.equal(fair.expectedRate, 50);
assert.equal(fair.winRate, 52);
assert.equal(fair.flagged, false);
assert.equal(lucky.z, 4);
assert.equal(lucky.flagged, true, 'a large z-score over enough games is flagged');
assert.equal(small.enoughGames, false);
assert.equal(small.flagged, false, 'a small sample is never flagged');
assert.equal(small.expectedRate, 25, 'a four-seat game expects a quarter each');
assert.deepEqual(computeSeatBalance([{ game_id: 'x', seats: 2, seat: 0, games: 0, wins: 0 }])[0].winRate, 0, 'no games gives no rate');
console.log('  ok  seat-order check: expected share, z-score, sample floor and flag');
console.log('seat-balance: 1 passed');
