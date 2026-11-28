'use strict';
// Chess table game: seat colours, action validation, per-player views, resignation, results, the bot and a full bot game.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/chess/engine');
const plugin = require('../games/chess');
const games = require('../games');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 14; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const two = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }];
const sq = (n) => { const f = n.charCodeAt(0) - 97, r = Number(n[1]) - 1; return r * 8 + f; };
const mv = (from, to, promo) => ({ type: 'move', from: sq(from), to: sq(to), promo: promo || null });

test('registry includes chess as a two-seat game with the colour option', () => {
  assert.equal(games.get('chess'), plugin, 'chess is registered in games/index.js');
  assert.ok(games.list().some((g) => g.id === 'chess'), 'chess is listed for the lobby');
  assert.equal(plugin.id, 'chess');
  assert.deepEqual(plugin.seats, { min: 2, max: 2, default: 2 });
  assert.ok(plugin.options.some((o) => o.key === 'colour'));
});

test('colour option: first seat, second seat, and random (by rng) choose White', () => {
  assert.equal(E.createGame(two, { colour: 'host' }, mulberry32(1)).white, 0);
  assert.equal(E.createGame(two, { colour: 'guest' }, mulberry32(1)).white, 1);
  const seats = new Set([0, 1].map((s) => E.createGame(two, { colour: 'random' }, () => (s === 0 ? 0.1 : 0.9)).white));
  assert.equal(seats.size, 2, 'random follows the rng');
});

test('the seat playing White moves first; the other player is told it is not their turn', () => {
  const g = E.createGame(two, { colour: 'guest' }, mulberry32(1));
  assert.equal(E.turnSeat(g), 1);
  const bad = E.applyAction(g, 'a', mv('e2', 'e4'));
  assert.deepEqual(bad, { ok: false, error: 'Not your turn' });
  assert.deepEqual(E.applyAction(g, 'b', mv('e2', 'e4')), { ok: true });
  assert.equal(E.turnSeat(g), 0);
});

test('invalid actions are rejected without changing the game', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  const before = JSON.stringify(g.pos);
  assert.equal(E.applyAction(g, 'a', null).ok, false);
  assert.equal(E.applyAction(g, 'a', { type: 'dance' }).ok, false);
  assert.equal(E.applyAction(g, 'a', { type: 'move', from: 'x', to: 3 }).ok, false);
  assert.equal(E.applyAction(g, 'a', { type: 'move', from: 99, to: 3 }).ok, false);
  assert.deepEqual(E.applyAction(g, 'a', mv('e2', 'e5')), { ok: false, error: 'Illegal move' });
  assert.deepEqual(E.applyAction(g, 'a', mv('e4', 'e5')), { ok: false, error: 'Illegal move' }, 'no piece on e4');
  assert.deepEqual(E.applyAction(g, 'a', mv('e2', 'e4', 'Q')), { ok: false, error: 'Illegal move' }, 'promotion not allowed here');
  assert.equal(E.applyAction(g, 'a', { type: 'move', from: sq('e2'), to: sq('e4'), promo: 'K' }).ok, false, 'invalid promo piece');
  assert.equal(JSON.stringify(g.pos), before);
  assert.equal(g.log.length, 0);
});

test('a promotion needs a piece choice and applies the chosen one', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  g.pos = require('../games/chess/rules').fromFEN('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(E.applyAction(g, 'a', mv('e7', 'e8')).error, 'Choose a promotion piece');
  assert.deepEqual(E.applyAction(g, 'a', mv('e7', 'e8', 'N')), { ok: true });
  assert.equal(g.pos.board[sq('e8')], 'N', 'the chosen knight stands on e8');
});

test('view: only the player to move gets legal moves; check and last move are shown', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  const a = E.viewFor(g, 'a');
  const b = E.viewFor(g, 'b');
  assert.equal(a.myTurn, true);
  assert.equal(b.myTurn, false);
  assert.equal(a.legal.length, 20);
  assert.deepEqual(b.legal, []);
  assert.equal(a.board.length, 64);
  assert.equal(a.colours[0], 'w');
  E.applyAction(g, 'a', mv('e2', 'e4'));
  const v = E.viewFor(g, 'b');
  assert.deepEqual(v.last, { from: sq('e2'), to: sq('e4') });
  assert.deepEqual(v.log, ['e4']);
  assert.equal(v.myTurn, true);
});

test('view: spectators and strangers see the board but cannot move', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  const v = E.viewFor(g, 'nobody');
  assert.equal(v.me, -1);
  assert.equal(v.myTurn, false);
  assert.deepEqual(v.legal, []);
});

test('Fool’s mate ends the game with the winner recorded and no further moves', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  const seq = [['a', 'f2', 'f3'], ['b', 'e7', 'e5'], ['a', 'g2', 'g4'], ['b', 'd8', 'h4']];
  for (const [p, f, t] of seq) assert.equal(E.applyAction(g, p, mv(f, t)).ok, true);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 1, 'Black (second seat) wins');
  assert.equal(g.draw, false);
  assert.equal(g.reason, 'checkmate');
  assert.equal(g.log[3], 'Qh4#');
  assert.equal(E.applyAction(g, 'a', mv('a2', 'a3')).error, 'The game is over');
  const v = E.viewFor(g, 'b');
  assert.equal(v.winner, 1);
  assert.deepEqual(v.legal, []);
});

test('resignation ends the game in favour of the other player', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  assert.deepEqual(E.applyAction(g, 'a', { type: 'resign' }), { ok: true });
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 1);
  assert.equal(g.reason, 'resignation');
  assert.equal(g.event.type, 'resign');
});

test('either seated player may resign, even when it is not their turn; the other player wins', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  assert.equal(E.turnSeat(g), 0, 'White (first seat) is to move');
  assert.deepEqual(E.applyAction(g, 'b', { type: 'resign' }), { ok: true });
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0, 'Black resigned, so White (first seat) wins');
  assert.equal(g.reason, 'resignation');
});

test('the seat to move may resign; a stranger may not, and the game is unchanged', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  assert.deepEqual(E.applyAction(g, 'zz', { type: 'resign' }), { ok: false, error: 'Not a player in this game' });
  assert.equal(g.phase, 'playing');
  assert.deepEqual(E.applyAction(g, 'a', { type: 'resign' }), { ok: true });
  assert.equal(g.winner, 1);
});

test('out-of-turn moves are still rejected while the other player may resign', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(1));
  const before = JSON.stringify(g.pos);
  assert.deepEqual(E.applyAction(g, 'b', mv('e7', 'e5')), { ok: false, error: 'Not your turn' });
  assert.equal(JSON.stringify(g.pos), before);
  assert.equal(g.phase, 'playing');
});

test('the plugin reports awaiting, isOver and results from the game state', () => {
  const inst = plugin.create(two, { colour: 'host' }, mulberry32(3));
  assert.deepEqual(inst.awaiting(), ['a']);
  assert.equal(inst.isOver(), false);
  assert.equal(inst.act('zz', { type: 'resign' }).ok, false, 'a stranger cannot resign');
  assert.equal(inst.act('a', { type: 'resign' }).ok, true);
  assert.deepEqual(inst.awaiting(), []);
  assert.equal(inst.isOver(), true);
  // White ('a', the first seat) resigned, so Black (seat 1) wins.
  assert.deepEqual(inst.results(), [
    { score: 0, winner: false, draw: false },
    { score: 1, winner: true, draw: false },
  ]);
});

test('the plugin act() never throws on hostile input', () => {
  const inst = plugin.create(two, { colour: 'host' }, mulberry32(3));
  assert.equal(inst.act('a', { type: 'move', from: null, to: null }).ok, false);
  assert.equal(inst.act('a', undefined).ok, false);
});

test('bot: always returns a legal move for the side to move', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(9));
  const action = E.botAction(g);
  assert.deepEqual(E.applyAction(g, 'a', action), { ok: true });
});

test('bot: resigns only when it has no legal move', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(9));
  g.pos = require('../games/chess/rules').fromFEN('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
  // Stalemate: no legal moves, so the bot resigns and the game ends.
  assert.deepEqual(E.botAction(g), { type: 'resign' });
});

test('bot: prefers taking a queen over a pawn', () => {
  const g = E.createGame(two, { colour: 'host' }, mulberry32(9));
  // Black rook on g1 can take the white queen on d1 (or the pawn-free file); the queen is the far better capture.
  g.pos = require('../games/chess/rules').fromFEN('k7/8/8/8/8/3p4/8/K2Q2r1 b - - 0 1');
  g.rng = () => 0.99; // a rng that never slips: this checks the bot's choice, not its occasional mistake
  const a = E.botAction(g);
  assert.deepEqual(a, { type: 'move', from: sq('g1'), to: sq('d1'), promo: null });
});

test('a full bot-vs-bot game always reaches a result', () => {
  const rng = mulberry32(42);
  const g = E.createGame(two, { colour: 'host' }, rng);
  let plies = 0;
  while (g.phase === 'playing' && plies < 1000) {
    const seat = E.turnSeat(g);
    const action = E.botAction(g);
    const res = E.applyAction(g, two[seat].id, action);
    assert.equal(res.ok, true, 'bot move accepted: ' + JSON.stringify(action));
    plies++;
  }
  assert.equal(g.phase, 'gameOver', 'game ended within 1000 plies');
  assert.ok(g.reason, 'a reason is recorded');
});

test('scrubbing a deleted player keeps the phase (a player named like a field) and the board; only the name changes', () => {
  const plugin = require('../games/chess');
  const players = [{ id: 'p0', name: 'playing' }, { id: 'p1', name: 'Bo' }];
  const inst = plugin.create(players, {}, () => 0.1);
  inst.scrub(['playing'], 'Deleted player');
  const v = inst.view('p1');
  assert.equal(v.phase, 'playing');
  assert.equal(v.players[0].name, 'Deleted player');
  assert.equal(v.players[1].name, 'Bo');
  assert.equal(v.board.length, 64);
});

test('account deletion scrubs only the name: a seat id that contains a name keeps its value', () => {
  const players = [{ id: 'Ann-Bo', name: 'Ann' }, { id: 'Cy', name: 'Bo' }];
  plugin.create(players, {}, () => 0.5).scrub(['Bo'], 'Someone');
  assert.equal(players[0].id, 'Ann-Bo', 'the id is not a name field');
  assert.equal(players[1].name, 'Someone');
});

console.log(`\n${passed} chess engine tests passed`);
