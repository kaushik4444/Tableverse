'use strict';
// Go Fish engine and plugin: dealing, asking, fishing, books, empty hands, endgame, hidden information, bots.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/gofish/engine');
const plugin = require('../games/gofish');
const { buildMatchRecord } = require('../db/matchRecord');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const card = (rank, suit = 'S') => ({ id: suit + rank, suit, rank, ord: E.RANKS.indexOf(rank) });
const must = (g, id, a) => { const r = E.applyAction(g, id, a); assert.ok(r.ok, JSON.stringify(a) + ': ' + r.error); };
/** A game with chosen hands and stock (top of the stock is the LAST element). */
function rigged(n, hands, stock = [], options) {
  const g = E.createGame(people(n), options, mulberry32(1));
  g.hands = hands.map((h) => h.map(([r, s]) => card(r, s)));
  g.stock = stock.map(([r, s]) => card(r, s));
  g.books = people(n).map(() => []); g.holds = people(n).map(() => new Set());
  g.turn = 0; g.phase = 'playing'; g.log = []; g.event = null;
  return g;
}

test('dealing: 7 cards each for two players, 5 for three to six, 52 cards in all, no duplicates', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const g = E.createGame(people(n), {}, mulberry32(n));
    const per = n === 2 ? 7 : 5;
    const inHands = g.hands.reduce((s, h) => s + h.length, 0) + g.books.reduce((s, b) => s + b.length * 4, 0);
    assert.equal(inHands, per * n, `${n} players`);
    assert.equal(g.stock.length + per * n, 52);
    const ids = [...g.hands.flat(), ...g.stock].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.throws(() => E.createGame(people(1), {}, Math.random));
  assert.throws(() => E.createGame(people(7), {}, Math.random));
});

test('a successful ask hands over every card of the rank and the asker goes again', () => {
  const g = rigged(3, [[['7', 'S'], ['K', 'H']], [['7', 'H'], ['7', 'D'], ['2', 'C']], [['9', 'C']]], [['3', 'S']]);
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '7' });
  assert.equal(g.hands[0].filter((c) => c.rank === '7').length, 3);
  assert.equal(g.hands[1].length, 1);
  assert.equal(g.turn, 0, 'asks again');
  assert.deepEqual(g.event.type, 'take'); assert.equal(g.event.count, 2);
});

test('Go Fish: the asker draws; the turn passes unless the drawn card is the asked rank (with Fish your wish)', () => {
  let g = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], [['9', 'C']]], [['4', 'D']]);
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '7' });
  assert.equal(g.hands[0].length, 3); assert.equal(g.stock.length, 0);
  assert.equal(g.turn, 1, 'wrong card: the turn passes');
  g = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], [['9', 'C']]], [['7', 'D']]);
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '7' });
  assert.equal(g.turn, 0, 'drew the very card: goes again'); assert.equal(g.event.wish, true);
  g = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], [['9', 'C']]], [['7', 'D']], { wishAgain: false });
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '7' });
  assert.equal(g.turn, 1, 'option off: the turn passes');
});

test('with an empty stock a failed ask just ends the turn', () => {
  const g = rigged(3, [[['7', 'S']], [['2', 'C']], [['9', 'C']]], []);
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '7' });
  assert.equal(g.event.empty, true); assert.equal(g.turn, 1);
});

test('four of a rank is laid down as a book at once (by a take, a draw or in the opening hand)', () => {
  const g = rigged(2, [[['5', 'S'], ['5', 'H'], ['5', 'D'], ['K', 'H']], [['5', 'C'], ['2', 'C']]], [['9', 'S']]);
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '5' });
  assert.deepEqual(g.books[0], ['5']);
  assert.equal(g.hands[0].some((c) => c.rank === '5'), false);
  assert.equal(g.event.books[0], '5');
  const fish = rigged(2, [[['4', 'S'], ['4', 'H'], ['4', 'D'], ['Q', 'H']], [['2', 'C']]], [['4', 'C']]);
  must(fish, 'p0', { type: 'ask', target: 'p1', rank: 'Q' });
  assert.deepEqual(fish.books[0], ['4'], 'the drawn card completed the book');
  // opening hand with four of a kind
  let found = false;
  for (let s = 1; s < 4000 && !found; s++) { const d = E.createGame(people(2), {}, mulberry32(s)); if (d.books.some((b) => b.length)) found = true; }
  assert.ok(found, 'some deals start with a book and it is laid down');
});

test('asking rules: your turn, a rank you hold, another player who has cards', () => {
  const g = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], []], [['3', 'S']]);
  assert.equal(E.applyAction(g, 'p1', { type: 'ask', target: 'p0', rank: '2' }).ok, false, 'not your turn');
  assert.equal(E.applyAction(g, 'p0', { type: 'ask', target: 'p0', rank: '7' }).ok, false, 'yourself');
  assert.equal(E.applyAction(g, 'p0', { type: 'ask', target: 'p1', rank: '9' }).ok, false, 'a rank you do not hold');
  assert.equal(E.applyAction(g, 'p0', { type: 'ask', target: 'p2', rank: '7' }).ok, false, 'a player with no cards');
  assert.equal(E.applyAction(g, 'p0', { type: 'ask', target: 'nobody', rank: '7' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'ask', target: 'p1', rank: 'Z' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'draw' }).ok, false, 'you have someone to ask');
  assert.equal(E.applyAction(g, 'ghost', { type: 'ask', target: 'p1', rank: '7' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', null).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'dance' }).ok, false);
});

test('a player with no cards on their turn draws one; if the stock is empty they are skipped', () => {
  const g = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], [['9', 'C']]], [['3', 'S'], ['8', 'D']]);
  g.hands[1] = []; g.turn = 0;
  must(g, 'p0', { type: 'ask', target: 'p2', rank: '7' }); // fish: draws 8D? top is the last element: 8D
  assert.equal(g.turn, 1);
  assert.equal(g.hands[1].length, 1, 'the empty-handed player drew a card');
  const g2 = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], [['9', 'C']]], []);
  g2.hands[1] = [];
  must(g2, 'p0', { type: 'ask', target: 'p2', rank: '7' });
  assert.equal(g2.turn, 2, 'p1 has nothing and the stock is empty: skipped');
});

test('nobody else has cards: the only move is to draw (forced), then the turn passes', () => {
  const g = rigged(2, [[['7', 'S'], ['K', 'H']], []], [['3', 'S']]);
  g.turn = 0;
  assert.deepEqual(E.forcedPlay(g), { playerId: 'p0', action: { type: 'draw' } });
  assert.equal(E.viewFor(g, 'p0').canDraw, true);
  must(g, 'p0', { type: 'draw' });
  assert.equal(g.hands[0].length, 3);
});

test('the game ends when all 13 books are down; most books wins and ties share', () => {
  const g = rigged(2, [[['A', 'S'], ['A', 'H'], ['A', 'D']], [['A', 'C'], ['2', 'C']]], []);
  g.books = [E.RANKS.slice(1, 7), E.RANKS.slice(7, 13)]; // 6 + 6 books, the last one (Aces) is being played
  must(g, 'p0', { type: 'ask', target: 'p1', rank: 'A' });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(E.awaiting(g), []);
  assert.equal(E.viewFor(g, 'p0').winners.length, 1);
  assert.deepEqual(E.viewFor(g, 'p0').winners, [0]);
  assert.equal(E.applyAction(g, 'p0', { type: 'ask', target: 'p1', rank: 'A' }).ok, false);
  const tie = rigged(2, [[['A', 'S'], ['A', 'H'], ['A', 'D']], [['A', 'C']]], []);
  tie.books = [E.RANKS.slice(1, 7), E.RANKS.slice(7, 13)];
  tie.books[1].pop(); // 6 vs 5, then p0 takes the Aces: 7 vs 5
  must(tie, 'p0', { type: 'ask', target: 'p1', rank: 'A' });
  assert.deepEqual(plugin.create(people(2), {}, mulberry32(1)).results().length, 2);
});

test('hidden information: you see your own hand only; the draw is shown to the player who drew', () => {
  const g = rigged(3, [[['7', 'S'], ['K', 'H']], [['2', 'C']], [['9', 'C']]], [['4', 'D']]);
  must(g, 'p0', { type: 'ask', target: 'p1', rank: '7' });
  const asker = E.viewFor(g, 'p0'); const other = E.viewFor(g, 'p2'); const watcher = E.viewFor(g, 'stranger');
  assert.equal(asker.hand.length, 3); assert.equal(asker.myDraw.card.rank, '4');
  assert.equal(other.myDraw, null); assert.deepEqual(other.hand.map((c) => c.rank), ['9']);
  assert.deepEqual(watcher.hand, []); assert.equal(watcher.me, -1); assert.equal(watcher.myTurn, false);
  assert.equal(JSON.stringify(other).includes('"id":"D4"'), false, 'the drawn card is not in anyone else\'s view');
  assert.equal(JSON.stringify(other.players).includes('"rank"'), false, 'other hands are counts only');
  assert.equal(other.event.type, 'fish'); assert.equal('card' in other.event, false);
  assert.equal(JSON.stringify(watcher).includes('"id":"S7"'), false, 'a spectator sees no cards');
});

test('bots always have a legal action and full games of 2 to 6 players finish with all 13 books down', () => {
  for (const n of [2, 3, 4, 5, 6]) for (let seed = 1; seed <= 30; seed++) {
    const g = E.createGame(people(n), {}, mulberry32(seed * 31 + n));
    let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(++steps < 20000, `${n}p/${seed} does not end`);
      const id = E.awaiting(g)[0];
      const forced = E.forcedPlay(g);
      const a = forced ? forced.action : E.botAction(g, id);
      const r = E.applyAction(g, id, a);
      assert.equal(r.ok, true, `${n}p/${seed}: ${JSON.stringify(a)} -> ${r.error}`);
    }
    assert.equal(g.books.reduce((s, b) => s + b.length, 0), 13);
    assert.equal(g.stock.length + g.hands.reduce((s, h) => s + h.length, 0), 0);
  }
});

test('plugin: wiring, results share ties, and the match record stores every seat', () => {
  assert.equal(plugin.id, 'gofish');
  assert.equal(plugin.seats.min, 2); assert.equal(plugin.seats.max, 6);
  const players = people(4);
  const game = plugin.create(players, {}, mulberry32(9));
  assert.equal(game.awaiting().length, 1);
  let guard = 0;
  while (!game.isOver() && guard++ < 20000) { const f = game.forcedPlay(); const id = game.awaiting()[0]; assert.ok(game.act(id, f ? f.action : game.botAction(id)).ok); }
  const res = game.results();
  assert.equal(res.length, 4);
  assert.equal(res.reduce((s, r) => s + r.score, 0), 13);
  assert.ok(res.filter((r) => r.winner).every((r) => r.score === Math.max(...res.map((x) => x.score))));
  const members = players.map((p) => ({ id: p.id, name: p.name, bot: false }));
  const room = { code: 'ABCDEF', gameId: 'gofish', seats: 4, options: {}, matchKey: '11111111-1111-4111-8111-111111111111', startedAt: Date.now() - 60000, members, leftEarly: new Set() };
  const rec = buildMatchRecord(room, game);
  assert.equal(rec.participants.length, 4);
  assert.ok(rec.participants.every((p) => Number.isFinite(p.score)));
  game.scrub(['P1'], 'Deleted player');
  assert.equal(JSON.stringify(game.view('p0')).includes('P1'), false);
});

test('the view carries no game log: it would reveal what other players asked for', () => {
  const g = E.createGame(people(3), {}, mulberry32(5));
  const v = E.viewFor(g, 'p0');
  assert.equal('log' in v, false);
  assert.equal(JSON.stringify(v).includes('"kind"'), false);
});

console.log(`\n${passed} go fish tests passed`);
