'use strict';
// The rating board ranking: at least 5 rated games in the scope, highest first, ties by name, limited, rounded for display.
const assert = require('node:assert/strict');
const { rankRows, MIN_RATED_GAMES, BOARD_LIMIT } = require('../lib/ratingBoard');

const row = (username, rating, ratedGames, displayName) => ({ username, displayName, rating, ratedGames });

// people with fewer than the minimum are left out, however high their rating
{
  const board = rankRows([row('lucky', 1400, 2), row('steady', 1100, MIN_RATED_GAMES), row('new', 1000, 4)]);
  assert.deepEqual(board.map((r) => r.username), ['steady']);
  assert.equal(MIN_RATED_GAMES, 5);
}

// order: highest rating first, equal ratings by username
{
  const board = rankRows([row('bo', 1050, 9), row('ann', 1050, 9), row('cy', 1200, 6)]);
  assert.deepEqual(board.map((r) => r.username), ['cy', 'ann', 'bo']);
}

// the limit keeps the top rows only
{
  const many = Array.from({ length: 15 }, (_, i) => row('p' + String(i).padStart(2, '0'), 1000 + i, 5));
  const board = rankRows(many);
  assert.equal(board.length, BOARD_LIMIT);
  assert.equal(board[0].username, 'p14');
}

// the display name falls back to the username, and ratings are rounded for display
{
  const [r] = rankRows([row('dee', 1049.6, 5, null)]);
  assert.equal(r.displayName, 'dee');
  assert.equal(r.rating, 1050);
}

// rows without a finite rating are dropped
assert.deepEqual(rankRows([row('nan', Number.NaN, 9)]), []);

console.log('rating board: all tests passed');
