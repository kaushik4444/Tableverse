'use strict';
// Snakes and Ladders engine and plugin: board layout, rolling, ladders, snakes, exact finish, sixes, turns, views, bots.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/snakesladders/engine');
const plugin = require('../games/snakesladders');
const games = require('../games');
const { buildMatchRecord } = require('../db/matchRecord');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
/** rng that makes Math.floor(rng()*6)+1 equal `d` */
const rollOf = (d) => () => (d - 1) / 6 + 0.01;
function game(n, options, dice) { const g = E.createGame(people(n), options, rollOf(1)); g.rng = rollOf(dice); return g; }
const roll = (g, d) => { g.rng = rollOf(d); const id = g.players[g.turn].id; const r = E.applyAction(g, id, { type: 'roll' }); assert.ok(r.ok, r.error); return r; };

test('the board: 100 squares, every jump starts and ends on the board, no square is used twice, no chains', () => {
  const starts = Object.keys(E.JUMPS).map(Number);
  assert.equal(new Set(starts).size, starts.length);
  for (const [a, b] of Object.entries(E.JUMPS)) {
    assert.ok(a >= 2 && a <= 99 && b >= 1 && b <= 99, `${a}->${b}`);
    assert.ok(!E.JUMPS[b], `${a}->${b} must not land on another jump`);
  }
  for (const [a, b] of Object.entries(E.LADDERS)) assert.ok(b > a, `ladder ${a}->${b} goes up`);
  for (const [a, b] of Object.entries(E.SNAKES)) assert.ok(b < a, `snake ${a}->${b} goes down`);
  assert.equal(E.SIZE, 100);
  assert.ok(!E.JUMPS[100] && !E.JUMPS[1]);
});

test('createGame: 2-4 players start off the board; other counts are refused', () => {
  for (const n of [2, 3, 4]) { const g = E.createGame(people(n), {}, mulberry32(1)); assert.deepEqual(g.pos, Array(n).fill(0)); assert.equal(g.phase, 'playing'); assert.equal(g.turn, 0); }
  assert.throws(() => E.createGame(people(1), {}, Math.random));
  assert.throws(() => E.createGame(people(5), {}, Math.random));
});

test('a roll moves the player and passes the turn', () => {
  const g = game(3, {}, 3);
  roll(g, 3);
  assert.equal(g.pos[0], 3);
  assert.equal(g.turn, 1);
  assert.equal(g.event.type, 'turn');
  assert.deepEqual(E.awaiting(g), ['p1']);
});

test('only the player to move can roll; strangers and bad actions are refused', () => {
  const g = game(2, {}, 2);
  assert.equal(E.applyAction(g, 'p1', { type: 'roll' }).ok, false);
  assert.equal(E.applyAction(g, 'nobody', { type: 'roll' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'move' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', null).ok, false);
  assert.equal(g.pos[0], 0);
});

test('a ladder lifts the player to its top', () => {
  const g = game(2, {}, 4);
  roll(g, 4); // 0 -> 4, ladder to 25
  assert.equal(g.pos[0], 25);
  assert.equal(g.event.seq > 0, true);
  const e = g.log[g.log.length - 1];
  assert.equal(e.kind, 'ladder');
});

test('a snake drops the player to its tail', () => {
  const g = game(2, {}, 3);
  g.pos[0] = 14;
  roll(g, 3); // 14 -> 17, snake to 7
  assert.equal(g.pos[0], 7);
  assert.equal(g.log[g.log.length - 1].kind, 'snake');
});

test('lastRoll stays in the view after the turn has passed', () => {
  const g = game(2, {}, 3);
  g.pos[0] = 14;
  roll(g, 3);
  const v = E.viewFor(g, 'p0');
  assert.equal(v.lastRoll.dice, 3);
  assert.equal(v.lastRoll.by, 0);
  assert.deepEqual({ from: v.lastRoll.from, landed: v.lastRoll.landed, to: v.lastRoll.to, via: v.lastRoll.via, stuck: v.lastRoll.stuck },
    { from: 14, landed: 17, to: 7, via: 'snake', stuck: false });
  assert.equal(g.event.type, 'turn');
  assert.equal(g.turn, 1);
});

test('exact finish: an oversized roll keeps you where you are and passes the turn', () => {
  const g = game(2, { exactFinish: true }, 5);
  g.pos[0] = 97;
  roll(g, 5);
  assert.equal(g.pos[0], 97);
  assert.equal(g.turn, 1);
  assert.equal(g.phase, 'playing');
  assert.equal(g.log[g.log.length - 1].kind, 'miss');
});

test('exact finish: the exact number wins the game', () => {
  const g = game(2, {}, 3);
  g.pos[0] = 97;
  roll(g, 3);
  assert.equal(g.pos[0], 100);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0);
  assert.equal(E.applyAction(g, 'p1', { type: 'roll' }).ok, false);
  assert.deepEqual(E.awaiting(g), []);
});

test('without exact finish any roll that reaches 100 or more wins', () => {
  const g = game(2, { exactFinish: false }, 6);
  g.pos[0] = 97;
  roll(g, 6);
  assert.equal(g.pos[0], 100);
  assert.equal(g.winner, 0);
});

test('a six gives another roll to the same player; without the option it does not', () => {
  const g = game(2, {}, 6);
  roll(g, 6);
  assert.equal(g.turn, 0);
  assert.equal(g.pos[0], 6);
  const h = game(2, { sixAgain: false }, 6);
  roll(h, 6);
  assert.equal(h.turn, 1);
});

test('three sixes in a row end the turn and the third roll does not move', () => {
  const g = game(2, {}, 6);
  roll(g, 6); roll(g, 6);
  assert.equal(g.pos[0], 12);
  assert.equal(g.turn, 0);
  roll(g, 6);
  assert.equal(g.pos[0], 12, 'the third six forfeits');
  assert.equal(g.turn, 1);
  assert.equal(g.sixes, 0);
});

test('a six that lands on a snake still gives another roll; a six that wins ends the game', () => {
  const g = game(2, {}, 6);
  g.pos[0] = 11;
  roll(g, 6); // 11 -> 17 snake -> 7, then roll again
  assert.equal(g.pos[0], 7);
  assert.equal(g.turn, 0);
  const w = game(2, {}, 6);
  w.pos[0] = 94;
  roll(w, 6);
  assert.equal(w.phase, 'gameOver');
});

test('turns rotate through every player and wrap around', () => {
  const g = game(4, {}, 1);
  for (let i = 0; i < 4; i++) { assert.equal(g.turn, i); roll(g, 1); }
  assert.equal(g.turn, 0);
  assert.deepEqual(g.pos, [1, 1, 1, 1]);
});

test('view: shared board and positions, no hidden information, spectators see the same', () => {
  const g = game(3, {}, 2);
  roll(g, 2);
  const mine = E.viewFor(g, 'p0');
  const watcher = E.viewFor(g, 'stranger');
  assert.equal(mine.me, 0);
  assert.equal(watcher.me, -1);
  assert.equal(watcher.canRoll, false);
  assert.equal(watcher.myTurn, false);
  assert.deepEqual(mine.players.map((p) => p.pos), [2, 0, 0]);
  assert.deepEqual(watcher.players, mine.players);
  assert.equal(E.viewFor(g, 'p1').canRoll, true);
  assert.equal(E.viewFor(g, 'p0').canRoll, false);
  assert.deepEqual(mine.ladders, E.LADDERS);
  assert.deepEqual(mine.snakes, E.SNAKES);
  assert.doesNotThrow(() => JSON.stringify(mine));
});

test('placings: the winner first, then by distance, then seat order', () => {
  const g = game(4, {}, 4);
  g.pos = [10, 80, 100, 80];
  g.phase = 'gameOver'; g.winner = 2;
  assert.deepEqual(E.placings(g), [2, 1, 3, 0]);
});

test('bots: only the player to move has an action, and bots finish games for every player count', () => {
  const g = game(2, {}, 1);
  assert.deepEqual(E.botAction(g, 'p0'), { type: 'roll' });
  assert.equal(E.botAction(g, 'p1'), null);
  for (const n of [2, 3, 4]) {
    for (const seed of [1, 2, 3]) {
      const G = plugin.create(people(n), {}, mulberry32(seed * 31 + n));
      let steps = 0;
      while (!G.isOver() && steps++ < 3000) { const id = G.awaiting()[0]; const r = G.act(id, G.botAction(id)); assert.ok(r.ok, r.error); }
      assert.ok(G.isOver(), `${n} players seed ${seed} finished`);
      const res = G.results();
      assert.equal(res.length, n);
      assert.equal(res.filter((r) => r.winner).length, 1);
      assert.deepEqual(res.map((r) => r.score).sort(), Array.from({ length: n }, (_, i) => i + 1));
    }
  }
});

test('plugin: registered, 2-4 seats, time limit and both options, rules present', () => {
  assert.equal(games.get('snakesladders'), plugin);
  assert.deepEqual(plugin.seats, { min: 2, max: 4, default: 4 });
  assert.deepEqual(plugin.options.map((o) => o.key), ['exactFinish', 'sixAgain', 'timeLimit']);
  assert.ok(plugin.rules.length >= 4);
  assert.deepEqual([0, 1, 2, 3].map((i) => plugin.seatLabel(i)), ['Red', 'Blue', 'Green', 'Yellow']);
  const listed = games.list().find((x) => x.id === 'snakesladders');
  assert.ok(listed && listed.name === 'Snakes and Ladders');
});

test('plugin: bad input never throws out of act()', () => {
  const G = plugin.create(people(2), {}, mulberry32(1));
  for (const bad of [undefined, null, 5, 'roll', [], { type: 7 }, { type: 'roll', extra: 1 }]) { const r = G.act('p0', bad); assert.equal(typeof r.ok, 'boolean'); }
});

test('plugin: scrub renames a deleted player everywhere, including the log', () => {
  const G = plugin.create(people(2), {}, mulberry32(4));
  G.act('p0', { type: 'roll' });
  G.scrub(['P0'], 'Deleted player');
  assert.ok(!JSON.stringify(G.view('p1')).includes('"P0"'));
});

test('match record: a finished game records every seat with a placing', () => {
  const G = plugin.create(people(3), {}, mulberry32(9));
  let steps = 0;
  while (!G.isOver() && steps++ < 3000) { const id = G.awaiting()[0]; G.act(id, G.botAction(id)); }
  const members = people(3).map((p) => ({ id: p.id, name: p.name, bot: false }));
  const rec = buildMatchRecord({ code: 'ABCDEF', gameId: 'snakesladders', seats: 3, members, options: {}, leftEarly: new Set() }, G);
  assert.ok(rec);
  assert.equal(rec.gameId, 'snakesladders');
  assert.equal(rec.participants.filter((p) => p.isWinner).length, 1);
  assert.deepEqual(rec.participants.map((p) => p.score).sort(), [1, 2, 3]);
});

console.log(`\n${passed} passed`);
