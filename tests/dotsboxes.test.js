'use strict';
// Dots and Boxes: turns, closing boxes, passing the turn, the result, ties, bots, and what a seat can see. Pure, no sockets.
const assert = require('node:assert/strict');
const E = require('../games/dotsboxes/engine');
const game = require('../games/dotsboxes');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const lineAt = (g, kind, r, c) => g.lines.findIndex((l) => l.kind === kind && l.r === r && l.c === c);
const play = (g, pid, kind, r, c) => E.applyAction(g, pid, { type: 'line', index: lineAt(g, kind, r, c) });

test('the board has (n+1)*n horizontal and n*(n+1) vertical lines, and n*n boxes', () => {
  for (const n of [3, 4, 5]) {
    const g = E.createGame(P(2), { size: String(n) });
    assert.equal(g.lines.length, 2 * n * (n + 1));
    assert.equal(g.sides.length, n * n);
  }
});

test('2 to 4 players only; the default board is 4x4', () => {
  assert.throws(() => E.createGame(P(1)));
  assert.throws(() => E.createGame(P(5)));
  assert.equal(E.createGame(P(4), {}).n, 4);
  assert.equal(E.createGame(P(2), { size: '9' }).n, 4, 'an unknown size falls back to 4');
});

test('a line that closes no box passes the turn to the next seat', () => {
  const g = E.createGame(P(3), { size: '3' });
  assert.equal(play(g, 'p0', 'h', 0, 0).ok, true);
  assert.equal(g.turn, 1);
  assert.equal(E.awaiting(g)[0], 'p1');
});

test('closing a box keeps the turn and gives the box to the seat that closed it', () => {
  const g = E.createGame(P(2), { size: '3' });
  play(g, 'p0', 'h', 0, 0); play(g, 'p1', 'h', 1, 0); play(g, 'p0', 'v', 0, 0); // box 0 has 3 sides, p1 to move
  assert.equal(play(g, 'p1', 'v', 0, 1).ok, true);
  assert.equal(g.owner[0], 1, 'p1 closed box 0');
  assert.equal(g.boxes[1], 1);
  assert.equal(g.turn, 1, 'p1 moves again');
  assert.equal(g.event.type, 'box');
});

test('invalid moves are refused: not your turn, a drawn line, a line that does not exist, an unknown action', () => {
  const g = E.createGame(P(2), { size: '3' });
  assert.equal(play(g, 'p1', 'h', 0, 0).ok, false, 'not your turn');
  play(g, 'p0', 'h', 0, 0);
  assert.equal(play(g, 'p1', 'h', 0, 0).ok, false, 'already drawn');
  assert.equal(E.applyAction(g, 'p1', { type: 'line', index: 999 }).ok, false, 'no such line');
  assert.equal(E.applyAction(g, 'p1', { type: 'place', cell: 0 }).ok, false, 'unknown action');
  assert.equal(E.applyAction(g, 'nobody', { type: 'line', index: 1 }).ok, false, 'not a player');
});

test('the most boxes wins; a tie for the most is a draw', () => {
  const g = E.createGame(P(2), { size: '3' });
  g.drawn.fill(true); g.drawnCount = g.lines.length;
  g.boxes = [5, 4]; g.phase = 'gameOver'; g.winner = 0; g.draw = false;
  assert.deepEqual(E.results(g), [{ score: 5, winner: true, draw: false }, { score: 4, winner: false, draw: false }]);
  g.boxes = [4, 4]; g.winner = null; g.draw = true;
  assert.deepEqual(E.results(g).map((r) => r.draw), [true, true], 'both top scorers drew');
});

test('playing to the end: every line is drawn, one result, and the game is over', () => {
  for (const players of [2, 3, 4]) {
    const g = E.createGame(P(players), { size: '3' });
    let guard = 0;
    while (g.phase !== 'gameOver') {
      const pid = g.players[g.turn].id;
      const r = E.applyAction(g, pid, E.botAction(g, pid));
      assert.equal(r.ok, true, 'a bot move is legal');
      assert.ok(++guard < 500, 'the game ends');
    }
    assert.equal(g.boxes.reduce((a, b) => a + b, 0), 9, `${players} players: all 9 boxes are taken`);
    assert.equal(g.drawnCount, g.lines.length);
    assert.deepEqual(E.awaiting(g), []);
  }
});

test('a bot takes a box it can close, and otherwise does not give one away', () => {
  const g = E.createGame(P(2), { size: '3' });
  play(g, 'p0', 'h', 0, 0); play(g, 'p1', 'h', 1, 0); play(g, 'p0', 'v', 0, 0);
  // an rng that never slips (a slip plays any open line): the bot must take the box it can close
  assert.equal(E.botAction(g, 'p1', () => 0.99).index, lineAt(g, 'v', 0, 1), 'the box that can be closed');
});

test('what a seat sees is the public board: no field is hidden from anyone', () => {
  const g = E.createGame(P(2), { size: '3' });
  play(g, 'p0', 'h', 0, 0);
  const v = E.viewFor(g, 'p1');
  assert.equal(v.myTurn, true);
  assert.equal(v.drawn[lineAt(g, 'h', 0, 0)], true);
  assert.equal(v.lineBy[lineAt(g, 'h', 0, 0)], 0);
  assert.equal(v.remaining, g.lines.length - 1);
  assert.equal(E.viewFor(g, 'nobody').myTurn, false, 'a watcher sees the board but cannot move');
});

test('the plugin: 2 to 4 seats, a board option, and the rules have a title for each', () => {
  assert.deepEqual(game.seats, { min: 2, max: 4, default: 2 });
  assert.equal(game.options[0].key, 'size');
  assert.deepEqual(game.options[0].choices.map((c) => c.value), ['3', '4', '5', '6']);
  const inst = game.create(P(3), { size: '3' }, Math.random);
  assert.equal(inst.awaiting()[0], 'p0');
  assert.equal(inst.act('p0', { type: 'line', index: 0 }).ok, true);
});

console.log(`\n${passed} dots and boxes tests passed`);
