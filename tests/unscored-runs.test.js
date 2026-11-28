'use strict';
// A solo Falling Blocks run is kept in the history but is neither a win nor a loss (lib/unscoredRuns.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { isUnscoredRun, UNSCORED_SQL } = require('../lib/unscoredRuns');
const { computeProfile } = require('../db/stats');

test('only a one-human Falling Blocks run is unscored', () => {
  assert.equal(isUnscoredRun('fallingblocks', 1), true);
  assert.equal(isUnscoredRun('fallingblocks', '1'), true);
  assert.equal(isUnscoredRun('fallingblocks', 2), false);
  assert.equal(isUnscoredRun('sudoku', 1), false);
  assert.equal(isUnscoredRun('memorymatch', 1), false);
});

test('one human at a table with bots is still a solo run (capacity is not used)', () => {
  // a 4-seat table where three seats were filled with bots: the record stores table_humans = 1
  assert.equal(isUnscoredRun('fallingblocks', 1), true);
  assert.match(UNSCORED_SQL, /m\.table_humans = 1/);
});

test('two humans are a real game, even at a 1-seat capacity record', () => {
  assert.equal(isUnscoredRun('fallingblocks', 2), false);
});

test('a record without a stored human count is scored (unknown, not assumed solo)', () => {
  assert.equal(isUnscoredRun('fallingblocks', null), false);
  assert.equal(isUnscoredRun('fallingblocks', undefined), false);
});

test('the SQL twin names the same rule', () => {
  assert.match(UNSCORED_SQL, /m\.game_id = 'fallingblocks'/);
  assert.match(UNSCORED_SQL, /m\.table_humans = 1/);
});

test('an unscored run is not a loss and does not dilute the win rate', () => {
  const rows = [
    { gameId: 'sudoku', isWinner: true, isDraw: false, unscored: false },
    { gameId: 'sudoku', isWinner: false, isDraw: false, unscored: false },
    { gameId: 'fallingblocks', isWinner: false, isDraw: false, unscored: true },
  ];
  const p = computeProfile(rows);
  assert.equal(p.played, 3);
  assert.equal(p.wins, 1);
  assert.equal(p.losses, 1);
  assert.equal(p.winRate, 50);
  const fb = p.perGame.find((g) => g.gameId === 'fallingblocks');
  assert.equal(fb.played, 1);
  assert.equal(fb.losses, 0);
  assert.equal(fb.winRate, null);
});

test('an unscored run neither breaks nor extends a win streak', () => {
  const rows = [
    { gameId: 'sudoku', isWinner: true, isDraw: false, unscored: false },
    { gameId: 'fallingblocks', isWinner: false, isDraw: false, unscored: true },
    { gameId: 'sudoku', isWinner: true, isDraw: false, unscored: false },
    { gameId: 'sudoku', isWinner: false, isDraw: false, unscored: false },
  ];
  const p = computeProfile(rows);
  assert.deepEqual(p.streak, { current: 2, best: 2 });
});

test('a solo-only player has no losses and no win rate', () => {
  const p = computeProfile([{ gameId: 'fallingblocks', isWinner: false, isDraw: false, unscored: true }]);
  assert.equal(p.played, 1);
  assert.equal(p.losses, 0);
  assert.equal(p.winRate, null);
});

test('a solo run is never a win or a draw, even when the stored flag says so', () => {
  const p = computeProfile([{ gameId: 'fallingblocks', isWinner: true, isDraw: true, unscored: true }, { gameId: 'sudoku', isWinner: true, isDraw: false, unscored: false }]);
  assert.equal(p.wins, 1);
  assert.equal(p.draws, 0);
  assert.equal(p.losses, 0);
  assert.equal(p.winRate, 100);
});

test('a NULL human count keeps the run scored (COALESCE in the SQL twin)', () => {
  assert.match(UNSCORED_SQL, /^COALESCE\(/);
});
