'use strict';
// Bingo engine and plugin: card rules, calling, marking, claims, patterns, bots, hidden cards, results.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/bingo/engine');
const plugin = require('../games/bingo');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const people = (n, bots = []) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, bot: bots.includes(i) }));
const must = (g, id, a) => { const r = E.applyAction(g, id, a); assert.ok(r.ok, JSON.stringify(a) + ': ' + (r.error || '')); return r; };
const fails = (g, id, a) => { const r = E.applyAction(g, id, a); assert.equal(r.ok, false, 'should refuse ' + JSON.stringify(a)); return r.error; };
/** Call numbers in a fixed order (the deck is popped from the end, so reverse the list). */
function callInOrder(g, numbers) {
  g.deck = g.deck.filter((n) => !numbers.includes(n)).concat(numbers.slice().reverse()); // pop() takes the end: first in `numbers` is called first
  for (const n of numbers) { const r = E.applyAction(g, null, { type: 'call' }); assert.ok(r.ok); }
}
const rigCard = (g, i, cells) => { g.cards[i] = cells; g.marks[i] = new Set(); };
const TOP_ROW = [1, 16, 31, 46, 61]; // one column per letter: row 0 of a card

test('a card has 25 squares, the middle one free, and each column stays in its letter range', () => {
  const cells = E.makeCard(mulberry32(3));
  assert.equal(cells.length, 25);
  assert.equal(cells[E.FREE], 0);
  for (let c = 0; c < 5; c++) {
    const col = [0, 1, 2, 3, 4].map((r) => cells[r * 5 + c]).filter((n) => n !== 0);
    assert.equal(new Set(col).size, col.length, 'no repeats in a column');
    for (const n of col) assert.ok(n >= 15 * c + 1 && n <= 15 * c + 15, 'number ' + n + ' in column ' + c);
  }
});

test('cards at one table are all different', () => {
  const cards = E.dealCards(8, mulberry32(9)).map((c) => c.join(','));
  assert.equal(new Set(cards).size, 8);
});

test('two to eight players; anything else is refused', () => {
  assert.throws(() => E.createGame(people(1), {}, mulberry32(1)));
  assert.throws(() => E.createGame(people(9), {}, mulberry32(1)));
  assert.doesNotThrow(() => E.createGame(people(8), {}, mulberry32(1)));
});

test('a number can be marked only after it is called, and only once, and only if it is on the card', () => {
  const g = E.createGame(people(2), {}, mulberry32(4));
  const n = g.cards[0].find((x) => x !== 0);
  assert.match(fails(g, 'p0', { type: 'mark', n }), /not been called/);
  g.deck.push(n); // the next call will be this number
  must(g, null, { type: 'call' });
  must(g, 'p0', { type: 'mark', n });
  assert.match(fails(g, 'p0', { type: 'mark', n }), /already marked/);
  const off = Array.from({ length: 75 }, (_, i) => i + 1).find((x) => !g.cards[0].includes(x) && !g.called.includes(x));
  g.called.push(off);
  assert.match(fails(g, 'p0', { type: 'mark', n: off }), /not on your card/);
  assert.match(fails(g, 'p0', { type: 'mark', n: 999 }), /Pick a number/);
  assert.match(fails(g, 'p0', { type: 'mark', n: 'x' }), /Pick a number/);
});

test('a line claim needs a complete row, column or diagonal; a short line is refused', () => {
  const g = E.createGame(people(2), {}, mulberry32(5));
  // the top row is 1 16 31 46 61; only four of its squares get marked, so the row is not complete
  rigCard(g, 0, [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 0, 48, 63, 4, 19, 33, 49, 64, 5, 20, 34, 50, 65]);
  callInOrder(g, [1, 16, 31, 46]);
  for (const n of [1, 16, 31, 46]) must(g, 'p0', { type: 'mark', n });
  assert.match(fails(g, 'p0', { type: 'claim' }), /not a Bingo/);
  assert.equal(g.phase, 'playing');
  callInOrder(g, [61]); // the fifth square of the top row is called
  must(g, 'p0', { type: 'mark', n: 61 });
  must(g, 'p0', { type: 'claim' });
  assert.deepEqual(g.winners, [0]);
});

test('a full row is a Bingo and ends the game with that player as winner', () => {
  const g = E.createGame(people(2), {}, mulberry32(6));
  rigCard(g, 0, [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65]);
  callInOrder(g, [1, 2, 3, 4, 5]);
  for (const n of [1, 2, 3, 4, 5]) must(g, 'p0', { type: 'mark', n });
  must(g, 'p0', { type: 'claim' });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [0]);
  assert.equal(E.results(g)[0].winner, true);
  assert.equal(E.results(g)[1].winner, false);
  assert.match(fails(g, 'p1', { type: 'claim' }), /The game is over/);
});

test('a full diagonal counts under the line pattern (free middle square included)', () => {
  const g = E.createGame(people(2), {}, mulberry32(7));
  // diagonal 0,6,12,18,24 : squares 0 6 (free 12) 18 24
  rigCard(g, 0, [1, 0, 0, 0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 19, 0, 0, 0, 0, 0, 25]);
  // make the diagonal numbers the marks: squares 0,6,18,24 need 1,17,19,25 called
  g.cards[0][12] = 0;
  callInOrder(g, [1, 17, 19, 25]);
  for (const n of [1, 17, 19, 25]) must(g, 'p0', { type: 'mark', n });
  must(g, 'p0', { type: 'claim' });
  assert.deepEqual(g.winners, [0]);
});

test('the full-card pattern needs every square, not just a line', () => {
  const g = E.createGame(people(2), { pattern: 'full' }, mulberry32(8));
  rigCard(g, 0, [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65]);
  callInOrder(g, [1, 2, 3, 4, 5]);
  for (const n of [1, 2, 3, 4, 5]) must(g, 'p0', { type: 'mark', n });
  assert.match(fails(g, 'p0', { type: 'claim' }), /not a Bingo/);
  assert.equal(E.viewFor(g, 'p0').canClaim, false);
});

test('bots mark and call Bingo on their own as soon as their line is complete', () => {
  const g = E.createGame(people(3, [1, 2]), {}, mulberry32(10));
  rigCard(g, 1, [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65]);
  // the human p0 never marks anything; the bot p1 wins when its top row is called
  g.deck = g.deck.filter((n) => ![1, 2, 3, 4, 5].includes(n)).concat([1, 2, 3, 4, 5]);
  for (let k = 0; k < 5 && g.phase === 'playing'; k++) E.applyAction(g, null, { type: 'call' });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [1]);
});

test('a call when nothing is left is a draw: no winners', () => {
  const g = E.createGame(people(2), {}, mulberry32(11));
  g.deck = [7];
  E.applyAction(g, null, { type: 'call' });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, []);
});

test('Mark for me marks called numbers automatically, and then manual marks are refused', () => {
  const g = E.createGame(people(2), { autoMark: true }, mulberry32(12));
  const n = g.cards[0].find((x) => x !== 0);
  g.deck.push(n);
  E.applyAction(g, null, { type: 'call' });
  assert.equal(E.viewFor(g, 'p0').card.find((c) => c.n === n).marked, true);
  assert.match(fails(g, 'p0', { type: 'mark', n }), /mark themselves/);
});

test('the view shows only your own card; other players are not shown numbers', () => {
  const g = E.createGame(people(3), {}, mulberry32(13));
  const v = E.viewFor(g, 'p0');
  assert.equal(v.card.length, 25);
  assert.equal(JSON.stringify(v).includes(JSON.stringify(g.cards[1])), false);
  for (const c of g.cards[1]) if (c) assert.equal(v.card.some((x) => x.n === c && !g.cards[0].includes(c)), false);
  const spec = E.viewFor(g, 'nobody');
  assert.deepEqual(spec.card, []);
  assert.equal(spec.me, -1);
});

test('call order is shown and the count of numbers still to call goes down', () => {
  const g = E.createGame(people(2), {}, mulberry32(14));
  const before = E.viewFor(g, 'p0').toGo;
  E.applyAction(g, null, { type: 'call' });
  const v = E.viewFor(g, 'p0');
  assert.equal(v.toGo, before - 1);
  assert.equal(v.called.length, 1);
  assert.equal(v.lastCall, v.called[0]);
  assert.equal(v.lastLetter, E.letterOf(v.lastCall));
});

test('nothing is awaited (no turns); the timer calls numbers at the chosen pace', () => {
  const g = E.createGame(people(2), { speed: 'quick' }, mulberry32(15));
  assert.deepEqual(E.awaiting(g), []);
  assert.deepEqual(E.autoAction(g), { type: 'call' });
  assert.equal(E.autoDelayMs(g), E.SPEEDS.quick);
  g.phase = 'gameOver';
  assert.equal(E.autoAction(g), null);
});

test('actions from strangers and bad actions are refused', () => {
  const g = E.createGame(people(2), {}, mulberry32(16));
  assert.match(fails(g, 'ghost', { type: 'claim' }), /not playing/);
  assert.match(fails(g, 'p0', null), /Invalid/);
  assert.match(fails(g, 'p0', { type: 'dance' }), /Unknown/);
  assert.match(fails(g, null, { type: 'claim' }), /Invalid/);
});

test('plugin: definition, options and the server interface', () => {
  assert.equal(plugin.id, 'bingo');
  assert.equal(plugin.seats.min, 2);
  assert.equal(plugin.seats.max, 8);
  assert.deepEqual(plugin.options.map((o) => o.key), ['pattern', 'speed', 'autoMark']);
  const game = plugin.create(people(2), {}, mulberry32(17));
  assert.deepEqual(game.awaiting(), []);
  assert.ok(game.autoAction());
  assert.equal(game.isOver(), false);
  const res = game.results();
  assert.equal(res.length, 2);
});

test('another player\'s matrix shows positions only, never their numbers', () => {
  const g = E.createGame(people(3), {}, mulberry32(21));
  E.applyAction(g, null, { type: 'call' });
  const n = g.called[0];
  const i = g.cards[1].indexOf(n);
  if (i >= 0) must(g, 'p1', { type: 'mark', n });
  const v = E.viewFor(g, 'p0');
  for (const p of v.players) {
    assert.equal(p.squares.length, 25);
    assert.ok(p.squares.every((x) => typeof x === 'boolean'), 'squares are booleans');
  }
  const allowed = new Set(['id', 'name', 'bot', 'marked', 'squares', 'full', 'near']);
  for (const p of v.players) for (const k of Object.keys(p)) assert.ok(allowed.has(k), 'unexpected field ' + k + ' in another player\'s view');
  // the matrix also lights the free centre square, which the mark count does not include
  assert.equal(v.players[1].squares.filter(Boolean).length, v.players[1].marked + 1);
});

test('the matrix shows completed lines and lines one square from done (positions only)', () => {
  const g = E.createGame(people(2), {}, mulberry32(33));
  rigCard(g, 0, Array.from({ length: 25 }, (_, k) => k + 1));
  g.marks[0] = new Set([1, 2, 3, 4]); // the card holds 1..25 in order, so row 0 is 1..5
  const v = E.viewFor(g, 'p0').players[0];
  assert.deepEqual(v.full, []);
  assert.deepEqual(v.near, [4]);
  g.marks[0].add(5);
  const w = E.viewFor(g, 'p0').players[0];
  assert.deepEqual(w.full, [0, 1, 2, 3, 4]);
  assert.deepEqual(w.near, []);
});

test('when the last number is called, a person with a full card wins (an automatic table cannot claim later)', () => {
  const g = E.createGame(people(2), { pattern: 'full', autoMark: true }, mulberry32(9));
  const cells = E.makeCard(mulberry32(5));
  const nums = cells.filter((n) => n !== 0); // the card's 24 numbers; the centre is free
  const last = nums[nums.length - 1];
  g.cards[0] = cells;
  g.marks[0] = new Set(nums.slice(0, -1)); // everything but the last number is already marked
  g.called = nums.slice(0, -1);
  g.deck = [last];
  g.cards[1] = E.makeCard(mulberry32(6));
  g.marks[1] = new Set();
  const r = E.applyAction(g, null, { type: 'call' });
  assert.ok(r.ok);
  assert.equal(g.phase, 'gameOver');
  assert.ok(g.winners.includes(0), 'the person whose card completed wins');
});

test('a player mark does not restart the call clock', () => {
  const g = E.createGame(people(2), { pattern: 'line', autoMark: false }, mulberry32(4));
  assert.equal(E.keepsAutoClock(g), true, 'the clock runs while the game is playing');
  g.phase = 'gameOver';
  assert.equal(E.keepsAutoClock(g), false, 'it stops when the game is over');
});

test('on the last call, a human and a bot who complete their cards together both win (full card, mark for me)', () => {
  const g = E.createGame(people(2, [1]), { pattern: 'full', autoMark: true }, mulberry32(12));
  // both cards hold 65, the last number in the deck; everything else on each card has already been called and marked
  const human = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65];
  const bot = [6, 7, 8, 9, 10, 21, 22, 23, 24, 25, 36, 37, 0, 39, 40, 51, 52, 53, 54, 55, 66, 67, 68, 69, 65];
  rigCard(g, 0, human);
  rigCard(g, 1, bot);
  g.called = [...human, ...bot].filter((n) => n !== 0 && n !== 65);
  g.marks[0] = new Set(g.called);
  g.marks[1] = new Set(g.called);
  g.deck = [65];
  const r = E.applyAction(g, null, { type: 'call' });
  assert.ok(r.ok);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [0, 1], 'the human card completed on the final call wins alongside the bot');
});

test('a bot takeover makes the engine play that seat as a bot; a reclaim gives it back to the person', () => {
  const g = E.createGame(people(2), { pattern: 'line', autoMark: false }, mulberry32(13));
  assert.equal(g.players[0].bot, false);
  assert.equal(E.setSeatBot(g, 'p0', true), true, 'the seat is found');
  assert.equal(g.players[0].bot, true);
  assert.equal(E.viewFor(g, 'p1').players[0].bot, true, 'the public progress view shows the bot');
  assert.equal(E.setSeatBot(g, 'nobody', true), false, 'an unknown player is not changed');
  E.setSeatBot(g, 'p0', false);
  assert.equal(g.players[0].bot, false);
  assert.equal(E.viewFor(g, 'p1').players[0].bot, false);
});

test('a taken-over seat is marked and claims Bingo automatically', () => {
  const g = E.createGame(people(2), { pattern: 'line', autoMark: false }, mulberry32(14));
  rigCard(g, 0, [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65]);
  E.setSeatBot(g, 'p0', true); // p0 left: a bot plays the seat now
  g.deck = g.deck.filter((n) => ![1, 2, 3, 4, 5].includes(n)).concat([1, 2, 3, 4, 5]);
  for (let k = 0; k < 5 && g.phase === 'playing'; k++) E.applyAction(g, null, { type: 'call' });
  assert.equal(g.phase, 'gameOver', 'the taken-over seat claims its top row on its own');
  assert.deepEqual(g.winners, [0]);
});

test('a bot takeover marks the numbers already called on that card, and a reclaim keeps them', () => {
  const g = E.createGame(people(2), { pattern: 'line', autoMark: false }, mulberry32(17));
  rigCard(g, 0, [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65]);
  g.called = [1, 2, 3, 16];
  E.setSeatBot(g, 'p0', true); // p0 left after those calls
  assert.deepEqual([...g.marks[0]].sort((a, b) => a - b), [1, 2, 3, 16], 'the called numbers on the card are marked');
  assert.ok(!g.marks[0].has(4), 'a number not yet called is not marked');
  E.setSeatBot(g, 'p0', false);
  assert.deepEqual([...g.marks[0]].sort((a, b) => a - b), [1, 2, 3, 16], 'the reclaimed seat keeps its marks');
});

test('after a reclaim the person marks by hand again and the seat does not claim on its own', () => {
  const g = E.createGame(people(2), { pattern: 'line', autoMark: false }, mulberry32(15));
  rigCard(g, 0, [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 0, 34, 35, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65]);
  E.setSeatBot(g, 'p0', true);
  E.setSeatBot(g, 'p0', false); // the person took the seat back
  g.deck = g.deck.filter((n) => ![1, 2, 3, 4, 5].includes(n)).concat([1, 2, 3, 4, 5]);
  for (let k = 0; k < 5; k++) E.applyAction(g, null, { type: 'call' });
  assert.equal(g.phase, 'playing', 'no automatic Bingo for a human seat');
  assert.equal(g.marks[0].size, 0, 'no automatic marks for a human seat');
  assert.ok(E.applyAction(g, 'p0', { type: 'mark', n: 1 }).ok, 'the person can still mark by hand');
});

console.log(`\n${passed} bingo tests passed`);
