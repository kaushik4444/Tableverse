'use strict';
require('./helpers/env');
const assert = require('node:assert/strict');
const P = require('../games/sudoku/puzzle');
const E = require('../games/sudoku/engine');
const plugin = require('../games/sudoku');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const people = (n, bots = []) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, bot: bots.includes(i) }));
const must = (g, id, a) => { const r = E.applyAction(g, id, a); assert.ok(r.ok, JSON.stringify(a) + ': ' + (r.error || '')); return r; };
const fails = (g, id, a) => { const r = E.applyAction(g, id, a); assert.equal(r.ok, false, 'should refuse ' + JSON.stringify(a)); return r.error; };
/** A fake clock, so the finishing time is exact in tests. */
const clock = (start = 1000) => { const c = { t: start, now: () => c.t }; return c; };
const sq = (k) => ({ r: Math.floor(k / 9), c: k % 9 });
const validGrid = (grid) => {
  for (let i = 0; i < 9; i++) {
    const row = new Set(), col = new Set(), box = new Set();
    for (let j = 0; j < 9; j++) {
      row.add(grid[i * 9 + j]);
      col.add(grid[j * 9 + i]);
      box.add(grid[(Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 + (i % 3) * 3 + (j % 3)]);
    }
    for (const s of [row, col, box]) if (s.size !== 9 || [...s].some((v) => v < 1 || v > 9)) return false;
  }
  return true;
};

console.log('Sudoku puzzle and rules');

test('every difficulty makes a valid grid with exactly one solution, and the clues match it', () => {
  for (const [difficulty, clues] of Object.entries(P.CLUES)) {
    for (const seed of [1, 2, 3]) {
      const { puzzle, solution } = P.makePuzzle(mulberry32(seed), difficulty);
      assert.ok(validGrid(solution), 'solution is a valid grid');
      assert.equal(P.countSolutions(puzzle, 2), 1, 'exactly one solution');
      assert.ok(puzzle.filter((v) => v).length >= clues, 'at least the target clues');
      for (let k = 0; k < 81; k++) if (puzzle[k]) assert.equal(puzzle[k], solution[k], 'a clue matches the solution');
    }
  }
});

test('a game needs 2 to 8 players and falls back to the defaults', () => {
  assert.throws(() => E.createGame(people(1), {}, mulberry32(1)));
  assert.throws(() => E.createGame(people(9), {}, mulberry32(1)));
  const g = E.createGame(people(2), { difficulty: 'bogus', pace: 'bogus' }, mulberry32(1));
  assert.equal(g.options.difficulty, 'medium');
  assert.equal(g.options.pace, 'normal');
});

test('a right number counts, a wrong number is shown and counted, and erase clears it', () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(4), clock().now);
  const k = g.puzzle.findIndex((v) => !v);
  const right = g.solution[k];
  const wrong = right === 9 ? 8 : right + 1;
  must(g, 'p0', { type: 'place', ...sq(k), v: wrong });
  let v = E.viewFor(g, 'p0');
  assert.deepEqual(v.wrong, [k]);
  assert.equal(v.mistakes, 1);
  assert.equal(v.players[0].right, 0);
  must(g, 'p0', { type: 'place', ...sq(k), v: right });
  v = E.viewFor(g, 'p0');
  assert.deepEqual(v.wrong, []);
  assert.equal(v.players[0].right, 1);
  fails(g, 'p0', { type: 'erase', ...sq(k) }); // already right: stays
});

test('clues, filled squares and bad numbers are refused', () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(5), clock().now);
  const clue = g.puzzle.findIndex((v) => v);
  assert.match(fails(g, 'p0', { type: 'place', ...sq(clue), v: g.solution[clue] }), /part of the puzzle/);
  const k = g.puzzle.findIndex((v) => !v);
  assert.match(fails(g, 'p0', { type: 'place', ...sq(k), v: 0 }), /1 to 9/);
  assert.match(fails(g, 'p0', { type: 'place', r: 9, c: 0, v: 1 }), /not on the grid/);
  assert.match(fails(g, 'p0', { type: 'nope', ...sq(k) }), /Invalid/);
  assert.match(fails(g, 'stranger', { type: 'place', ...sq(k), v: 1 }), /not playing/);
  must(g, 'p0', { type: 'place', ...sq(k), v: g.solution[k] });
  assert.match(fails(g, 'p0', { type: 'place', ...sq(k), v: 1 }), /already filled/);
});

test('the first complete grid wins, with its time in seconds, and then nothing more can be played', () => {
  const c = clock(1000);
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(6), c.now);
  const empties = g.puzzle.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
  c.t += 42000;
  for (const k of empties) must(g, 'p1', { type: 'place', ...sq(k), v: g.solution[k] });
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 1);
  assert.equal(g.event.seconds, 42);
  assert.deepEqual(E.results(g), [{ score: 0, winner: false }, { score: 42, winner: true }]);
  assert.match(fails(g, 'p0', { type: 'place', ...sq(empties[0]), v: 1 }), /over/);
});

test('a running game keeps the answer and other grids to itself; the finished game shows the answer', () => {
  const g = E.createGame(people(3), { difficulty: 'easy' }, mulberry32(7));
  must(g, 'p1', { type: 'place', ...sq(g.puzzle.findIndex((v) => !v)), v: 1 });
  const v = E.viewFor(g, 'p0');
  assert.equal(v.solution, null, 'no answer while playing');
  assert.equal(v.board.length, 81);
  assert.equal(E.viewFor(g, 'stranger').board, null, 'a non-player sees no board');
  const allowed = new Set(['id', 'name', 'bot', 'right', 'total', 'done']);
  for (const p of v.players) for (const key of Object.keys(p)) assert.ok(allowed.has(key), 'unexpected field ' + key + ' in another player');
  assert.ok(!JSON.stringify(v.players).includes('"board"'), 'no other board is sent');
  g.phase = 'gameOver';
  assert.deepEqual(E.viewFor(g, 'p0').solution, g.solution);
});

test('bots fill squares with the right numbers, and a bot can win', () => {
  const g = E.createGame([{ id: 'h', name: 'Human' }, { id: 'b', name: 'Bot', bot: true }], { difficulty: 'easy', pace: 'quick' }, mulberry32(8), clock().now);
  assert.deepEqual(E.awaiting(g), ['h', 'b'], 'everybody still filling in is awaited');
  assert.ok(E.botDelayMs(g, 'b') >= 0);
  let steps = 0;
  while (g.phase === 'playing' && steps < 200) {
    const a = E.botAction(g, 'b');
    assert.equal(a.v, g.solution[a.r * 9 + a.c], 'a bot places the right number');
    must(g, 'b', a);
    steps++;
  }
  assert.equal(g.winner, 1);
  assert.deepEqual(E.awaiting(g), [], 'nobody is awaited after the game');
  assert.equal(E.botAction(g, 'b'), null);
});

test('plugin: two to eight seats, the options, the fastest-grid stat, and a game that the server can run', () => {
  assert.equal(plugin.id, 'sudoku');
  assert.equal(plugin.seats.min, 2);
  assert.equal(plugin.seats.max, 8);
  assert.deepEqual(plugin.options.map((o) => o.key), ['difficulty', 'pace']);
  assert.equal(plugin.stats.bestOf({ isWinner: true, score: 90 }), -90);
  assert.equal(plugin.stats.bestOf({ isWinner: false, score: 0 }), null);
  const game = plugin.create(people(2, [1]), {}, mulberry32(9));
  assert.deepEqual(game.awaiting(), ['p0', 'p1']);
  assert.equal(game.isOver(), false);
  assert.equal(game.results().length, 2);
});

console.log(`\n${passed} sudoku tests passed`);
