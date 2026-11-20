'use strict';
// Carrom rules: opening layout, turn order, validation, pockets, extra shots, fouls, the queen, winning, the bot and invariants.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/carrom/engine');
const P = require('../games/carrom/physics');
const games = require('../games');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 14; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const two = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }];
const fresh = () => E.createGame(two);
const coin = (id, colour, x, y) => ({ id, kind: 'coin', colour, x, y, r: P.RADIUS.coin });
const queen = (x, y) => ({ id: 'q', kind: 'queen', colour: null, x, y, r: P.RADIUS.queen });
const flick = (x, power = 0.05, angle = 0) => ({ type: 'flick', x, angle, power });
const whiteOnBoard = (g) => g.coins.filter((c) => c.colour === 'w').length;
const blackOnBoard = (g) => g.coins.filter((c) => c.colour === 'b').length;

/** The first angle (searched in steps) whose shot from x pockets something of the wanted kind, found by the engine itself. */
function findShot(g, seat, x, want) {
  for (let deg = -70; deg <= 70; deg += 2) {
    const a = flick(x, 1, (deg * Math.PI) / 180);
    const p = E.plan(g, seat, a);
    if (!p.error && want(p.shot)) return a;
  }
  throw new Error('no shot found');
}

test('opening: 19 pieces, nine of each colour and the queen in the centre', () => {
  const g = fresh();
  assert.equal(g.coins.length, 19);
  assert.equal(whiteOnBoard(g), 9);
  assert.equal(blackOnBoard(g), 9);
  const q = g.coins.find((c) => c.kind === 'queen');
  assert.ok(Math.abs(q.x - 0.5) < 1e-9 && Math.abs(q.y - 0.5) < 1e-9);
  for (let i = 0; i < g.coins.length; i++) for (let j = i + 1; j < g.coins.length; j++) {
    const a = g.coins[i], b = g.coins[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-9, 'the opening does not overlap');
  }
});

test('turns: the first seat starts; after a miss the turn passes', () => {
  const g = fresh();
  assert.deepEqual(E.applyAction(g, 'b', flick(0.5)), { ok: false, error: 'Not your turn' });
  // A gentle flick from the middle of the baseline touches nothing and pockets nothing.
  assert.deepEqual(E.applyAction(g, 'a', flick(0.5, 0.05)), { ok: true });
  assert.equal(g.turn, 1);
  assert.equal(g.log.at(-1), 'Ann missed');
});

test('validation: bad x, angle, power, overlapping striker and invalid action are rejected without change', () => {
  const g = fresh();
  const before = JSON.stringify(g.coins);
  assert.equal(E.applyAction(g, 'a', flick(0.1)).ok, false, 'x too far to the side');
  assert.equal(E.applyAction(g, 'a', flick(0.5, 0.5, 1.4)).ok, false, 'angle past the limit');
  assert.equal(E.applyAction(g, 'a', flick(0.5, 0)).ok, false, 'no power');
  assert.equal(E.applyAction(g, 'a', flick(0.5, 1.5)).ok, false, 'power above full');
  assert.equal(E.applyAction(g, 'a', { type: 'flick', x: NaN, angle: 0, power: 0.5 }).ok, false, 'not a number');
  assert.equal(E.applyAction(g, 'a', null).ok, false);
  assert.equal(E.applyAction(g, 'a', { type: 'dance' }).ok, false);
  assert.equal(JSON.stringify(g.coins), before);
  assert.equal(g.turn, 0);
});

test('the far player places the striker on their own side and their right is the board’s left', () => {
  const g = fresh();
  g.turn = 1;
  const r = E.applyAction(g, 'b', flick(0.3, 0.05));
  assert.equal(r.ok, true);
  const striker = g.shot.keyframes[0].d.find((d) => d[0] === 'striker');
  assert.ok(Math.abs(striker[1] - 0.7) < 1e-3, 'x is mirrored for the far player');
  assert.ok(Math.abs(striker[2] - 0.88) < 1e-3, 'the striker starts on the top baseline');
});

test('pocketing your own coin gives an extra shot and the coin counts for you', () => {
  const g = fresh();
  g.coins = [coin('w1', 'w', 0.035, 0.035), coin('b1', 'b', 0.6, 0.6), coin('b2', 'b', 0.9, 0.9)];
  const r = E.applyAction(g, 'a', flick(0.2, 0.05));
  assert.equal(r.ok, true);
  assert.equal(g.score[0], 1);
  assert.equal(g.turn, 0, 'the same player shoots again');
  assert.equal(whiteOnBoard(g), 0);
  assert.equal(g.coins.filter((c) => c.colour === 'b').length, 2, 'the black coins stay on the board');
});

test('pocketing the other colour sends it back to the board and passes the turn', () => {
  const g = fresh();
  g.coins = [coin('b1', 'b', 0.035, 0.035)];
  E.applyAction(g, 'a', flick(0.2, 0.05));
  assert.equal(g.score[0], 0);
  assert.equal(g.turn, 1);
  assert.equal(blackOnBoard(g), 1, 'the black coin is back on the board');
});

test('a foul when the striker is pocketed: the coins of that shot go back, and one held coin goes back too', () => {
  const g = fresh();
  g.coins = [coin('w1', 'w', 0.6, 0.6)];
  g.score = [2, 0];
  const a = findShot(g, 0, 0.3, (s) => s.foul);
  E.applyAction(g, 'a', a);
  assert.equal(g.score[0], 1, 'one held coin went back');
  assert.equal(whiteOnBoard(g), 2, 'the coin on the board plus the returned one');
  assert.equal(g.turn, 1);
  assert.match(g.log.at(-1), /foul/);
});

test('the queen alone goes back to the centre when it is not covered', () => {
  const g = fresh();
  g.coins = [queen(0.035, 0.035)];
  E.applyAction(g, 'a', flick(0.2, 0.05));
  assert.equal(g.queenHeld, null);
  assert.ok(g.coins.some((c) => c.kind === 'queen'), 'the queen is back on the board');
});

test('winning: all nine of your coins with the queen held', () => {
  const g = fresh();
  g.coins = [queen(0.035, 0.035)];
  g.score = [9, 0];
  E.applyAction(g, 'a', flick(0.2, 0.05));
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0);
  assert.equal(g.reason, 'all nine coins');
  assert.deepEqual(E.viewFor(g, 'a').winner, 0);
});

test('a player with all nine coins is not stuck: the queen still covers when it goes in alone', () => {
  const g = fresh();
  g.coins = [queen(0.035, 0.035)];
  g.score = [9, 0];
  E.applyAction(g, 'a', flick(0.2, 0.05));
  assert.equal(g.winner, 0, 'the queen covered at nine coins wins the game');
});

test('resign ends the game in favour of the other player', () => {
  const g = fresh();
  assert.equal(E.applyAction(g, 'a', { type: 'resign' }).ok, true);
  assert.equal(g.winner, 1);
  assert.equal(g.reason, 'resignation');
  assert.equal(E.applyAction(g, 'b', flick(0.5)).error, 'The game is over');
});

test('view: only the player to move has myTurn; the board, score and last shot are shown', () => {
  const g = fresh();
  E.applyAction(g, 'a', flick(0.5, 0.05));
  const b = E.viewFor(g, 'b');
  assert.equal(b.myTurn, true);
  assert.equal(E.viewFor(g, 'a').myTurn, false);
  assert.equal(b.board.length, g.coins.length);
  assert.equal(b.shot.seat, 0);
  assert.ok(b.shot.keyframes.length > 1);
  assert.equal(E.viewFor(g, 'nobody').myTurn, false);
});

test('the bot always returns a flick that the rules accept', () => {
  const rng = mulberry32(5);
  const g = fresh();
  for (let i = 0; i < 4; i++) {
    const seat = g.turn;
    const a = E.botAction(g, seat, rng);
    assert.equal(a.type, 'flick');
    const r = E.applyAction(g, two[seat].id, a);
    assert.equal(r.ok, true, JSON.stringify(a));
  }
});

test('a bot game keeps the pieces consistent: each side has nine coins between board and hand', () => {
  const rng = mulberry32(11);
  const g = fresh();
  for (let turn = 0; turn < 40 && g.phase === 'playing'; turn++) {
    const seat = g.turn;
    const r = E.applyAction(g, two[seat].id, E.botAction(g, seat, rng));
    assert.equal(r.ok, true);
    assert.equal(whiteOnBoard(g) + g.score[0], 9, 'white coins: board plus held');
    assert.equal(blackOnBoard(g) + g.score[1], 9, 'black coins: board plus held');
    const queens = g.coins.filter((c) => c.kind === 'queen').length;
    assert.equal(queens + (g.queenHeld === null ? 0 : 1), 1, 'the queen is on the board or held, never both');
  }
});

test('registry: carrom is a two-seat game and its plugin never throws on bad input', () => {
  const plugin = require('../games/carrom');
  const inst = plugin.create(two, {}, mulberry32(2));
  assert.deepEqual(inst.awaiting(), ['a']);
  assert.equal(inst.act('a', { type: 'flick', x: 'nope' }).ok, false);
  assert.equal(inst.act('a', undefined).ok, false);
});

console.log(`\n${passed} carrom engine tests passed`);
