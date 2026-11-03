'use strict';
// Tic-Tac-Toe, Four in a Row and Five in a Row: placement, gravity, win lines in every direction, draws, turn order, bots, plugins.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/linegames/engine');
const plugins = require('../games/linegames');
const games = require('../games');
const { buildMatchRecord } = require('../db/matchRecord');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const two = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }];
const mk = (id, o = { starter: 'host' }, seed = 1) => E.createGame(id, two, o, mulberry32(seed));
const place = (g, who, cell) => E.applyAction(g, who === 0 ? 'a' : 'b', { type: 'place', cell });
const drop = (g, who, col) => E.applyAction(g, who === 0 ? 'a' : 'b', { type: 'drop', col });
const okPlace = (g, who, cell) => { const r = place(g, who, cell); assert.ok(r.ok, r.error); };
const okDrop = (g, who, col) => { const r = drop(g, who, col); assert.ok(r.ok, r.error); };

test('three games share the engine, and are registered with 2 seats', () => {
  for (const [id, rows, cols, win, gravity] of [['tictactoe', 3, 3, 3, false], ['fourinarow', 6, 7, 4, true], ['fiveinarow', 15, 15, 5, false]]) {
    const g = mk(id);
    assert.equal(g.board.length, rows * cols); assert.equal(g.v.win, win); assert.equal(g.v.gravity, gravity);
    const def = games.get(id); assert.ok(def, id); assert.deepEqual([def.seats.min, def.seats.max], [2, 2]);
  }
  assert.equal(plugins.length, 3);
  assert.throws(() => E.createGame('tictactoe', [two[0]], {}), /exactly 2/);
  assert.throws(() => E.createGame('chess', two, {}), /Unknown/);
});

test('the starter option decides who moves first; random is repeatable from the seed', () => {
  assert.equal(mk('tictactoe', { starter: 'host' }).turn, 0);
  assert.equal(mk('tictactoe', { starter: 'guest' }).turn, 1);
  assert.equal(mk('tictactoe', { starter: 'nonsense' }, 5).turn, mk('tictactoe', {}, 5).turn);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((s) => mk('tictactoe', {}, s).turn).filter((t) => t === 0).length > 0, true);
});

test('placing: only on your turn, only on a free square, only inside the board', () => {
  const g = mk('tictactoe');
  assert.equal(place(g, 1, 0).ok, false, 'not your turn');
  okPlace(g, 0, 4);
  assert.equal(place(g, 1, 4).ok, false, 'taken');
  assert.equal(place(g, 1, 9).ok, false); assert.equal(place(g, 1, -1).ok, false); assert.equal(place(g, 1, 1.5).ok, false); assert.equal(place(g, 1, '2').ok, false);
  assert.equal(E.applyAction(g, 'b', { type: 'drop', col: 1 }).ok, false, 'wrong action type');
  assert.equal(E.applyAction(g, 'b', null).ok, false); assert.equal(E.applyAction(g, 'ghost', { type: 'place', cell: 1 }).ok, false);
  okPlace(g, 1, 0); assert.equal(g.turn, 0);
});

test('tic-tac-toe: every row, column and diagonal wins; a full grid with no line is a draw', () => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const line of lines) {
    const g = mk('tictactoe'); const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((k) => !line.includes(k));
    okPlace(g, 0, line[0]); okPlace(g, 1, others[0]); okPlace(g, 0, line[1]); okPlace(g, 1, others[1]);
    assert.equal(g.phase, 'playing'); okPlace(g, 0, line[2]);
    assert.equal(g.phase, 'gameOver'); assert.equal(g.winner, 0); assert.deepEqual(g.line, line.slice().sort((a, b) => a - b));
    assert.equal(place(g, 1, others[2]).ok, false, 'the game is over'); assert.deepEqual(E.awaiting(g), []);
  }
  const d = mk('tictactoe'); // X O X / X O O / O X X
  [0, 1, 2, 4, 3, 5, 7, 6, 8].forEach((c, i) => okPlace(d, i % 2, c));
  assert.equal(d.phase, 'gameOver'); assert.equal(d.winner, null); assert.equal(E.viewFor(d, 'a').draw, true); assert.deepEqual(d.line, []);
});

test('four in a row: discs fall to the lowest free space, a full column is refused, and a column outside the grid is refused', () => {
  const g = mk('fourinarow');
  okDrop(g, 0, 3); okDrop(g, 1, 3); okDrop(g, 0, 3);
  assert.deepEqual([g.board[5 * 7 + 3], g.board[4 * 7 + 3], g.board[3 * 7 + 3]], [0, 1, 0]);
  okDrop(g, 1, 3); okDrop(g, 0, 3); okDrop(g, 1, 3);
  assert.equal(g.board[3], 1, 'the column is full to the top');
  assert.equal(drop(g, 0, 3).ok, false); assert.equal(drop(g, 0, 7).ok, false); assert.equal(drop(g, 0, -1).ok, false); assert.equal(drop(g, 0, 1.2).ok, false);
  assert.equal(place(g, 0, 0).ok, false, 'place is not an action here');
});

test('four in a row: wins across, down, and on both diagonals; a drop that stays unconnected carries on', () => {
  const across = mk('fourinarow'); [0, 0, 1, 1, 2, 2, 3].forEach((c, i) => okDrop(across, i % 2, c));
  assert.equal(across.winner, 0); assert.deepEqual(across.line, [35, 36, 37, 38]);
  const down = mk('fourinarow'); [0, 1, 0, 1, 0, 1, 0].forEach((c, i) => okDrop(down, i % 2, c));
  assert.equal(down.winner, 0); assert.deepEqual(down.line, [0 + 7 * 2, 7 * 3, 7 * 4, 7 * 5]);
  const up = mk('fourinarow'); // rising diagonal for seat 0: columns 0..3 with heights 1,2,3,4
  [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3].forEach((c, i) => okDrop(up, i % 2, c));
  assert.equal(up.winner, 0, 'rising diagonal');
  const fall = mk('fourinarow'); // the mirror image of the rising diagonal
  [3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0].forEach((c, i) => okDrop(fall, i % 2, c));
  assert.equal(fall.winner, 0, 'falling diagonal'); assert.equal(fall.line.length, 4);
});

test('four in a row: a full grid with no four is a draw', () => {
  // colour of (row from the bottom r, column c) = (floor(c/2) + r) % 2: no four in any direction, 21 discs each
  const g = mk('fourinarow');
  for (let c = 0; c < 7; c++) for (let r = 0; r < 6; r++) g.board[(5 - r) * 7 + c] = (Math.floor(c / 2) + r) % 2;
  assert.equal(g.board.filter((x) => x === 0).length, 21);
  for (let k = 0; k < 42; k++) assert.equal(E.lineThrough(g.board, g.v, k).length, 0, `no four through ${k}`);
  g.board[0] = null; g.moves = 41; g.turn = 1; // the top of column 0 is the last free space and belongs to seat 1's colour
  okDrop(g, 1, 0);
  assert.equal(g.phase, 'gameOver'); assert.equal(g.winner, null); assert.equal(E.viewFor(g, 'a').draw, true);
});

test('five in a row: five wins in all directions, four does not, six also wins', () => {
  const g = mk('fiveinarow'); const row = 7 * 15;
  for (let i = 0; i < 4; i++) { okPlace(g, 0, row + i); okPlace(g, 1, i); }
  assert.equal(g.phase, 'playing', 'four is not enough'); okPlace(g, 0, row + 4);
  assert.equal(g.winner, 0); assert.deepEqual(g.line, [0, 1, 2, 3, 4].map((i) => row + i));
  for (const [dr, dc] of [[1, 0], [1, 1], [1, -1]]) {
    const h = mk('fiveinarow'); const cells = [0, 1, 2, 3, 4].map((i) => (3 + dr * i) * 15 + 6 + dc * i);
    const spare = [0, 1, 2, 3].map((i) => i * 15 + 14);
    cells.slice(0, 4).forEach((c, i) => { okPlace(h, 0, c); okPlace(h, 1, spare[i]); }); okPlace(h, 0, cells[4]);
    assert.equal(h.winner, 0, `direction ${dr},${dc}`);
  }
  const six = mk('fiveinarow'); const r6 = 7 * 15; // 5 + 6 with a gap filled last: makes six at once
  [0, 1, 2, 4, 5].forEach((c, i) => { okPlace(six, 0, r6 + c); okPlace(six, 1, [0, 2, 4, 9, 11][i] * 15 + 14); });
  assert.equal(six.phase, 'playing'); okPlace(six, 0, r6 + 3); assert.equal(six.winner, 0); assert.equal(six.line.length, 6);
});

test('the view: spectators have no moves, legal cells match the game, nothing hidden', () => {
  const g = mk('fourinarow'); okDrop(g, 0, 2);
  const mine = E.viewFor(g, 'b'); const other = E.viewFor(g, 'a'); const spec = E.viewFor(g, 'zz');
  assert.equal(mine.myTurn, true); assert.equal(mine.legal.length, 7); assert.ok(mine.legal.includes(4 * 7 + 2), 'the column with a disc offers the next cell up');
  assert.equal(other.myTurn, false); assert.deepEqual(other.legal, []);
  assert.equal(spec.me, -1); assert.equal(spec.myTurn, false); assert.deepEqual(spec.legal, []);
  const t = mk('tictactoe'); okPlace(t, 0, 4); assert.equal(E.viewFor(t, 'b').legal.length, 8);
});

test('bots win in one, block in one, and never make an illegal move', () => {
  const g = mk('tictactoe'); [0, 3, 1].forEach((c, i) => okPlace(g, i % 2 === 0 ? 0 : 1, c));
  assert.equal(E.botAction(g, 'b').cell, 2, 'blocks the line 0-1-2');
  const w = mk('tictactoe'); [0, 3, 1, 4].forEach((c, i) => okPlace(w, i % 2, c));
  assert.equal(E.botAction(w, 'a').cell, 2, 'takes the win at 2 (or blocks 5): winning comes first');
  assert.equal(E.botAction(w, 'b'), null, 'not its turn');
  const f = mk('fourinarow'); [0, 6, 1, 6, 2].forEach((c, i) => okDrop(f, i % 2, c));
  assert.deepEqual(E.botAction(f, 'b'), { type: 'drop', col: 3 }, 'blocks the horizontal three in the bottom row');
  assert.equal(E.botAction(E.createGame('tictactoe', two, { starter: 'host' }, mulberry32(1)), 'a').type, 'place');
});

test('bot against bot: tic-tac-toe is always a draw, and all three games finish with consistent results', () => {
  for (const id of ['tictactoe', 'fourinarow', 'fiveinarow']) for (let seed = 1; seed <= 6; seed++) {
    const g = E.createGame(id, two, {}, mulberry32(seed * 7)); let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(++steps <= g.board.length, `${id}/${seed} too long`);
      const who = g.players[g.turn].id; const a = E.botAction(g, who); const r = E.applyAction(g, who, a);
      assert.ok(r.ok, `${id}/${seed}: ${JSON.stringify(a)} ${r.error}`);
    }
    const filled = g.board.filter((x) => x !== null).length; assert.equal(filled, g.moves);
    if (g.winner !== null) assert.ok(g.line.length >= g.v.win && g.line.every((k) => g.board[k] === g.winner));
    if (id === 'tictactoe') assert.equal(g.winner, null, 'two perfect players draw');
  }
});

test('plugins: wiring, results (win 1, draw 0.5 each, loss 0), match record, name scrub, bad input', () => {
  for (const p of plugins) {
    const game = p.create(two, { starter: 'host' }, mulberry32(3));
    assert.deepEqual(game.awaiting(), ['a']); assert.equal(game.isOver(), false);
    assert.equal(game.act('a', 'garbage').ok, false); assert.equal(game.act('a', { type: 'place', cell: 'x' }).ok, false);
    assert.ok(p.options.some((o) => o.key === 'starter')); assert.ok(p.rules.length >= 3);
    let guard = 0; while (!game.isOver() && guard++ < 300) { const id = game.awaiting()[0]; assert.ok(game.act(id, game.botAction(id)).ok); }
    const res = game.results(); assert.equal(res.length, 2);
    if (res[0].winner || res[1].winner) assert.deepEqual(res.map((r) => r.score).sort(), [0, 1]); else assert.deepEqual(res.map((r) => r.score), [0.5, 0.5]);
    const room = { code: 'ABCDEF', gameId: p.id, seats: 2, options: {}, matchKey: '11111111-1111-4111-8111-111111111111', startedAt: Date.now() - 60000, members: two.map((x) => ({ id: x.id, name: x.name, bot: false })), leftEarly: new Set() };
    assert.equal(buildMatchRecord(room, game).participants.length, 2);
    game.scrub(['Ann'], 'Deleted player'); assert.equal(JSON.stringify(game.view('b')).includes('Ann'), false);
  }
});

console.log(`\n${passed} line game tests passed`);
