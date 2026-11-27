'use strict';
// Falling Blocks: piece shapes, drops, clearing rows, garbage, topping out, bots, and what a seat can see. Pure, no sockets.
const assert = require('node:assert/strict');
const E = require('../games/fallingblocks/engine');
const game = require('../games/fallingblocks');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const rng = (seed = 3) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const cellsOf = (g, who, r, c) => g.boards[who][r * E.W + c];
/** A fixed first sequence, so a test knows which piece each player holds. */
const withPieces = (g, kinds) => { g.pieces = kinds.slice(); return g; };
/** Fills the bottom rows of a well, leaving the given columns empty in each row. */
const fillRows = (board, rows, emptyCols) => {
  for (const r of rows) for (let c = 0; c < E.W; c++) if (!emptyCols.includes(c)) board[r * E.W + c] = 'X';
};

test('2 to 4 players only', () => {
  assert.throws(() => E.createGame(P(1), {}));
  assert.throws(() => E.createGame(P(5), {}));
  assert.equal(E.createGame(P(2), {}).boards.length, 2);
  assert.equal(E.createGame(P(4), {}).boards.length, 4);
});

test('every piece has four cells, and four rotations that keep four cells', () => {
  for (const kind of E.KINDS) {
    const turns = E.ROTATIONS[kind];
    assert.equal(turns.length, 4);
    for (const cells of turns) {
      assert.equal(cells.length, 4, kind);
      assert.equal(Math.min(...cells.map(([r]) => r)), 0, 'normalised to the top');
      assert.equal(Math.min(...cells.map(([, c]) => c)), 0, 'normalised to the left');
    }
  }
  // the I piece is four in a row at rotation 0 and four in a column at rotation 1
  assert.deepEqual(E.ROTATIONS.I[0], [[0, 0], [0, 1], [0, 2], [0, 3]]);
  assert.deepEqual(E.ROTATIONS.I[1], [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('a drop falls as far as it can and locks in the well', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['O', 'O']);
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, true);
  assert.equal(cellsOf(g, 0, 19, 0), 'O');
  assert.equal(cellsOf(g, 0, 19, 1), 'O');
  assert.equal(cellsOf(g, 0, 18, 0), 'O');
  assert.equal(cellsOf(g, 0, 18, 1), 'O');
  assert.equal(g.count[0], 1);
});

test('invalid drops are refused: a bad column, a bad rotation, a piece that does not fit, an unknown action', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['I', 'I']);
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 9, rot: 0 }).ok, false, 'an I piece flat at column 9 runs off the well');
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 4 }).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0.5, rot: 0 }).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'spin' }).ok, false);
  assert.equal(E.applyAction(g, 'nobody', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, false);
  assert.equal(g.count[0], 0, 'refused moves place nothing');
});

test('there is no turn: both players can drop at once, in any order', () => {
  const g = withPieces(E.createGame(P(3), {}, rng()), ['T', 'T', 'T']);
  assert.deepEqual(E.awaiting(g), ['p0', 'p1', 'p2']);
  assert.equal(E.applyAction(g, 'p2', { type: 'drop', piece: 0, x: 3, rot: 0 }).ok, true);
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 3, rot: 0 }).ok, true);
});

test('a full row clears and counts for its player', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['O', 'I']);
  fillRows(g.boards[0], [19], [0, 1]);
  E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 });
  assert.equal(g.lines[0], 1);
  assert.equal(g.lines[1], 0);
  assert.equal(cellsOf(g, 0, 19, 0), 'O', 'the O piece that sat one row up has fallen into the cleared row');
  assert.equal(cellsOf(g, 0, 19, 2), null, 'the cleared row is gone');
});

test('clearing two rows sends one garbage row to each other player, with one gap', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['O', 'T']);
  fillRows(g.boards[0], [18, 19], [0, 1]);
  E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 });
  assert.equal(g.lines[0], 2);
  const bottom = g.boards[1].slice(19 * E.W);
  assert.equal(bottom.filter((v) => v === 'G').length, E.W - 1, 'one gap in the garbage row');
  assert.equal(bottom.filter((v) => v === null).length, 1);
});

test('clearing four rows at once sends four garbage rows', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['I', 'T']);
  fillRows(g.boards[0], [16, 17, 18, 19], [0]);
  E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 1 });
  assert.equal(g.lines[0], 4);
  const garbageRows = [...Array(E.H).keys()].filter((r) => g.boards[1].slice(r * E.W, r * E.W + E.W).filter((v) => v === 'G').length === E.W - 1);
  assert.equal(garbageRows.length, 4);
});

test('a block pushed past the top by garbage tops that player out, and the game ends with the other as winner', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['O', 'T']);
  fillRows(g.boards[0], [18, 19], [0, 1]);
  g.boards[1][0] = 'X'; // a block at the very top of player 1's well
  E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 });
  assert.equal(g.out[1], true);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0);
  assert.deepEqual(E.results(g).map((r) => r.winner), [true, false]);
});

test('a piece that cannot appear at the top tops the player out; with three players the game goes on', () => {
  const g = withPieces(E.createGame(P(3), {}, rng()), ['O', 'T', 'O']);
  // the spawn area of player 0's well is blocked (not full rows, which would clear)
  for (const r of [0, 1]) for (let c = 3; c <= 6; c++) g.boards[0][r * E.W + c] = 'X';
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, true);
  // the next piece cannot fit at the spawn point, so player 0 is out
  assert.equal(g.out[0], true);
  assert.equal(g.phase, 'playing', 'two players are still building');
  assert.deepEqual(E.awaiting(g), ['p1', 'p2']);
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, false, 'an out player cannot play');
});

test('the last player still building wins; once the game is over nothing else can be played', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['O', 'O']);
  for (const r of [0, 1]) for (let c = 3; c <= 6; c++) g.boards[0][r * E.W + c] = 'X';
  E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 });
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 1);
  assert.deepEqual(E.awaiting(g), []);
  assert.equal(E.applyAction(g, 'p1', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, false);
});

test('the pieces are the same sequence for everybody (a shared seven-bag)', () => {
  const g = E.createGame(P(3), {}, rng(11));
  const first = [0, 1, 2].map((i) => E.viewFor(g, 'p' + i).current);
  assert.equal(new Set(first).size, 1, 'the first piece is the same for each seat');
  E.ensurePieces(g, 13);
  const sequence = g.pieces.slice(0, 14);
  for (let b = 0; b < 2; b++) assert.equal(new Set(sequence.slice(b * 7, b * 7 + 7)).size, 7, 'each bag holds all seven kinds once');
});

test('bots play every game to a winner, and each bot move is one the engine accepts', () => {
  for (const n of [2, 3, 4]) {
    const g = game.create(P(n), { pace: 'quick' }, rng(n * 17));
    let steps = 0;
    while (!g.isOver() && steps < 100000) {
      for (const id of g.awaiting()) {
        if (g.isOver()) break; // one move can end the game while others are still waiting
        const action = g.botAction(id);
        assert.ok(action, 'a bot always has a move while it is building');
        assert.equal(g.act(id, action).ok, true, 'the bot move is accepted');
      }
      steps++;
    }
    assert.equal(g.isOver(), true, `${n} bots finish`);
    assert.equal(g.results().filter((r) => r.winner).length, 1, 'one winner');
  }
});

test('bot pace is set by the option, and a bot waits for its own next move', () => {
  const g = E.createGame(P(2), { pace: 'slow' }, rng(5), () => 0);
  assert.ok(E.botDelayMs(g, 'p0') > 0);
  assert.ok(E.botDelayMs(g, 'p0') <= E.PACE_MS.slow * 1.15 * 1.25 + 1, 'at most a little over the slow pace');
  assert.equal(E.botDelayMs(g, 'nobody'), 0);
});

test('a seat sees every well, its own piece and the next two; a watcher sees no piece in hand', () => {
  const g = withPieces(E.createGame(P(2), {}, rng()), ['L', 'J', 'S', 'Z']);
  g.boards[0][E.W * 19] = 'X';
  const mine = E.viewFor(g, 'p0');
  assert.equal(mine.current, 'L');
  assert.deepEqual(mine.next, ['J', 'S']);
  assert.equal(mine.boards[1].length, E.W * E.H, 'the other well is shown');
  assert.equal(mine.boards[0][E.W * 19], 'X');
  const watching = E.viewFor(g, 'watcher');
  assert.equal(watching.current, null);
  assert.equal(watching.myTurn, false);
  assert.equal(watching.me, -1);
});

test('the scrub keeps the phase, so a name cannot change the state of the game', () => {
  const players = [{ id: 'p0', name: 'playing' }, { id: 'p1', name: 'Bo' }];
  const instance = game.create(players, {}, rng());
  instance.scrub(['playing'], 'Former player');
  assert.equal(instance.view('p1').phase, 'playing');
  assert.equal(instance.view('p1').players[0].name, 'Former player');
});

test('a name that is also a piece letter changes only the name, not the shared pieces or the boards', () => {
  const players = [{ id: 'p0', name: 'I' }, { id: 'p1', name: 'Bo' }];
  const instance = game.create(players, {}, rng());
  for (let i = 0; i < 6; i++) instance.act('p0', { type: 'drop', piece: instance.view('p0').players[0].pieces, x: 3, rot: 0 });
  const before = JSON.stringify(instance.view('p1'));
  instance.scrub(['I'], 'Former player');
  const after = JSON.stringify(instance.view('p1'));
  assert.equal(after, before.replace('"name":"I"', '"name":"Former player"'));
});

test('looking at the table does not change what happens: views never draw from the shared random source', () => {
  const quiet = E.createGame(P(2), {}, rng(21));
  const looked = E.createGame(P(2), {}, rng(21));
  for (let k = 0; k < 8; k++) { E.viewFor(looked, 'p0'); E.viewFor(looked, 'p1'); }
  for (let k = 0; k < 6; k++) {
    for (const g of [quiet, looked]) {
      E.applyAction(g, 'p0', { type: 'drop', piece: g.count[0], x: k % 2 === 0 ? 0 : 5, rot: 0 });
      E.applyAction(g, 'p1', { type: 'drop', piece: g.count[1], x: 3, rot: 0 });
    }
  }
  assert.deepEqual(looked.boards, quiet.boards, 'the same drops give the same wells, however often the table was viewed');
  assert.deepEqual(looked.pieces, quiet.pieces);
});

test('a drop that names an earlier piece is refused and places nothing', () => {
  const g = withPieces(E.createGame(P(2), {}, rng(22)), ['O', 'T', 'L']);
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, true);
  const before = g.boards[0].slice();
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 0, x: 0, rot: 0 }).ok, false, 'the same block cannot be placed twice');
  assert.deepEqual(g.boards[0], before, 'nothing is placed');
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', x: 0, rot: 0 }).ok, false, 'a drop without a piece is refused');
  assert.equal(E.applyAction(g, 'p0', { type: 'drop', piece: 1, x: 0, rot: 0 }).ok, true, 'the block in hand can be dropped');
});

console.log(`\n${passed} Falling Blocks tests passed`);

test('the profile best is the most rows cleared in a game you won, and nothing for a game you lost', () => {
  const { bestOf, bestLabel } = game.stats;
  assert.equal(bestLabel, 'Most rows cleared in a win');
  assert.equal(bestOf({ isWinner: true, score: 7 }), 7);
  assert.equal(bestOf({ isWinner: false, score: 9 }), null);
  assert.equal(bestOf({ isWinner: true, score: undefined }), null);
});
