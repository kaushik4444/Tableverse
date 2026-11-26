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
      assert.equal(puzzle.filter((v) => v).length, clues, 'the returned count is the number of givens');
      assert.equal(clues, P.CLUES[difficulty], 'exactly the target clues, never more');
      for (let k = 0; k < 81; k++) if (puzzle[k]) assert.equal(puzzle[k], solution[k], 'a clue matches the solution');
    }
  }
});

test('hard puzzles have exactly 26 givens for every seed, not just the first few', () => {
  // a single removal pass ends at 27 for some grids: the generator must keep going until it reaches 26
  for (let seed = 1; seed <= 60; seed++) {
    const { puzzle, clues } = P.makePuzzle(mulberry32(seed), 'hard');
    assert.equal(puzzle.filter((v) => v).length, 26, 'seed ' + seed);
    assert.equal(clues, 26, 'seed ' + seed);
  }
});

test('a game needs 1 to 8 players and falls back to the defaults', () => {
  assert.throws(() => E.createGame([], {}, mulberry32(1)));
  assert.equal(E.createGame(people(1), {}, mulberry32(1)).solo, true);
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
  const allowed = new Set(['id', 'name', 'bot', 'right', 'total', 'done', 'out', 'lives']);
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
  assert.equal(plugin.seats.min, 1);
  assert.equal(plugin.seats.max, 8);
  assert.deepEqual(plugin.options.map((o) => o.key), ['difficulty', 'pace']);
  assert.equal(plugin.stats.bestOf({ isWinner: true, score: 90 }), -90);
  assert.equal(plugin.stats.bestOf({ isWinner: false, score: 0 }), null);
  const game = plugin.create(people(2, [1]), {}, mulberry32(9));
  assert.deepEqual(game.awaiting(), ['p0', 'p1']);
  assert.equal(game.isOver(), false);
  assert.equal(game.results().length, 2);
});

/** The first empty square and a wrong number for it. */
const wrongMove = (g) => { const k = g.puzzle.findIndex((v) => !v); return { k, action: { type: 'place', ...sq(k), v: g.solution[k] === 9 ? 8 : g.solution[k] + 1 } }; };

test('a wrong number costs a life; the third takes you out, and the others still race on', () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(10), clock().now);
  const empties = g.puzzle.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
  for (let t = 0; t < 2; t++) must(g, 'p0', wrongMove(g).action);
  assert.equal(E.viewFor(g, 'p0').lives, 1);
  assert.equal(E.viewFor(g, 'p0').out, false);
  must(g, 'p0', wrongMove(g).action);
  assert.equal(E.viewFor(g, 'p0').out, true);
  assert.equal(g.phase, 'playing', 'the race goes on for the others');
  assert.match(fails(g, 'p0', { type: 'place', ...sq(empties[5]), v: g.solution[empties[5]] }), /out of lives/);
  assert.deepEqual(E.awaiting(g), ['p1']);
  for (const k of empties) must(g, 'p1', { type: 'place', ...sq(k), v: g.solution[k] });
  assert.equal(g.winner, 1);
});

test('alone, the third mistake is game over, with no winner', () => {
  const g = E.createGame(people(1), { difficulty: 'easy' }, mulberry32(11), clock().now);
  for (let t = 0; t < 3; t++) must(g, 'p0', wrongMove(g).action);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, -1);
  assert.equal(g.event.lost, true);
  assert.deepEqual(E.results(g), [{ score: 0, winner: false }]);
});

test('alone, filling the grid wins, and the time is the score', () => {
  const c = clock(1000);
  const g = E.createGame(people(1), { difficulty: 'easy' }, mulberry32(12), c.now);
  c.t += 75000;
  for (const k of g.puzzle.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0)) must(g, 'p0', { type: 'place', ...sq(k), v: g.solution[k] });
  assert.equal(g.winner, 0);
  assert.deepEqual(E.results(g), [{ score: 75, winner: true }]);
});

test('undo takes back only your last move, three times in a game, and never gives a life back', () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(13), clock().now);
  const k = g.puzzle.findIndex((v) => !v);
  assert.equal(E.viewFor(g, 'p0').canUndo, false, 'nothing to undo at the start');
  assert.match(fails(g, 'p0', { type: 'undo' }), /last move/);
  must(g, 'p0', wrongMove(g).action);
  assert.equal(E.viewFor(g, 'p0').canUndo, true);
  must(g, 'p0', { type: 'undo' });
  assert.equal(E.viewFor(g, 'p0').board[k], 0, 'the wrong number is gone');
  assert.equal(E.viewFor(g, 'p0').lives, 2, 'the life stays used');
  assert.equal(E.viewFor(g, 'p0').undos, 2);
  assert.match(fails(g, 'p0', { type: 'undo' }), /last move/, 'only one step back');
  // two more undos, each after a correct move (a wrong one would cost lives)
  const empties = g.puzzle.map((v, x) => (v ? -1 : x)).filter((x) => x >= 0);
  for (const x of empties.slice(1, 3)) { must(g, 'p0', { type: 'place', ...sq(x), v: g.solution[x] }); must(g, 'p0', { type: 'undo' }); }
  assert.equal(E.viewFor(g, 'p0').undos, 0);
  must(g, 'p0', { type: 'place', ...sq(empties[3]), v: g.solution[empties[3]] });
  assert.match(fails(g, 'p0', { type: 'undo' }), /No undos left/);
});

test('an undo can take back a correct number too, and a player out cannot undo', () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(14), clock().now);
  const k = g.puzzle.findIndex((v) => !v);
  must(g, 'p0', { type: 'place', ...sq(k), v: g.solution[k] });
  must(g, 'p0', { type: 'undo' });
  assert.equal(E.viewFor(g, 'p0').board[k], 0);
  for (let t = 0; t < 3; t++) must(g, 'p1', wrongMove(g).action);
  assert.equal(E.viewFor(g, 'p1').canUndo, false);
  assert.match(fails(g, 'p1', { type: 'undo' }), /out of lives/);
});

test('when everybody is out, the game ends with no winner', () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(15), clock().now);
  for (let t = 0; t < 3; t++) must(g, 'p0', wrongMove(g).action);
  assert.equal(g.phase, 'playing');
  for (let t = 0; t < 3; t++) must(g, 'p1', wrongMove(g).action);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, -1);
});

test("everybody sees the others' lives but never their numbers", () => {
  const g = E.createGame(people(2), { difficulty: 'easy' }, mulberry32(16), clock().now);
  must(g, 'p1', wrongMove(g).action);
  const v = E.viewFor(g, 'p0');
  assert.equal(v.players[1].lives, 2);
  assert.equal(v.players[0].lives, 3);
  assert.equal(v.maxLives, 3);
  assert.ok(!JSON.stringify(v.players).includes('"board"'));
});

test('a solo game moves no skill either way, win or lose', () => {
  const { RULES } = require('../lib/gameSkill');
  assert.deepEqual(RULES.sudoku([{ playerId: 'a', isWinner: true, isDraw: false }]), { a: 0 });
  assert.deepEqual(RULES.sudoku([{ playerId: 'a', isWinner: false, isDraw: false }]), { a: 0 });
});

console.log(`\n${passed} sudoku tests passed`);
