'use strict';
const assert = require('node:assert/strict');
const { seatPlayers, arrangeMembers, shuffleMembers } = require('../lib/seatOrder');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const members = () => ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), bot: false, avatar: 'x', connected: true }));
const ids = (seats) => seats.map((s) => s.id);
// Deterministic stand-in for crypto.randomInt: picks the last value each time.
const lastRandom = (n) => n - 1;

console.log('seat order');

test('by default, seats follow the join order', () => {
  assert.deepEqual(ids(seatPlayers(members())), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(seatPlayers(members(), { shuffle: true, offered: false })), ['a', 'b', 'c', 'd'], 'a game that does not offer the option is never shuffled');
  assert.deepEqual(ids(seatPlayers(members(), { shuffle: false, offered: true })), ['a', 'b', 'c', 'd'], 'the option off keeps the join order');
});

test('with the option on, the seats are a permutation of the members', () => {
  const seats = seatPlayers(members(), { shuffle: true, offered: true });
  assert.deepEqual(ids(seats).slice().sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Object.keys(seats[0]).sort(), ['id', 'name']);
});

test('the shuffle uses the given random source (Fisher–Yates)', () => {
  // With randomInt always returning the last index, every step is a no-op, so the join order stays.
  assert.deepEqual(ids(seatPlayers(members(), { shuffle: true, offered: true, randomInt: lastRandom })), ['a', 'b', 'c', 'd']);
  // Always picking 0 moves the last player to the front each step.
  assert.deepEqual(ids(seatPlayers(members(), { shuffle: true, offered: true, randomInt: () => 0 })), ['b', 'c', 'd', 'a']);
});

test('the members array is not changed by shuffling', () => {
  const m = members();
  seatPlayers(m, { shuffle: true, offered: true, randomInt: () => 0 });
  assert.deepEqual(ids(m), ['a', 'b', 'c', 'd']);
});

test('the host can arrange the members: every id exactly once, or nothing', () => {
  assert.deepEqual(ids(arrangeMembers(members(), ['c', 'a', 'd', 'b'])), ['c', 'a', 'd', 'b']);
  assert.equal(arrangeMembers(members(), ['a', 'b', 'c']), null, 'a missing player');
  assert.equal(arrangeMembers(members(), ['a', 'a', 'c', 'd']), null, 'a repeated player');
  assert.equal(arrangeMembers(members(), ['a', 'b', 'c', 'x']), null, 'a stranger');
  assert.equal(arrangeMembers(members(), 'abcd'), null, 'not a list');
  assert.equal(ids(members()).join(), 'a,b,c,d', 'the input is not changed');
});

test('a shuffle is a permutation of the members, and the input is unchanged', () => {
  const out = shuffleMembers(members(), lastRandom);
  assert.deepEqual(ids(out).slice().sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(members()), ['a', 'b', 'c', 'd']);
});

test('an arranged order: a manual arrangement is kept and the start does not shuffle it again', () => {
  const arranged = arrangeMembers(members(), ['b', 'a', 'd', 'c']);
  assert.deepEqual(ids(seatPlayers(arranged, { shuffle: false, offered: true })), ['b', 'a', 'd', 'c']);
});

console.log(`\n${passed} seat order tests passed`);

// Results are indexed by seat. With shuffled seats the match record must still name the people who won, not the join-order slots.
const { buildMatchRecord } = require('../db/matchRecord');
test('a shuffled game records each result against the member who sat in that seat', () => {
  const [a, b, c, d] = members();
  const seated = [b, c, d, a]; // the game's seat order: B, C, D, A
  const room = { code: 'ROOM', gameId: 'twentynine', seats: 4, options: {}, members: [a, b, c, d], seated, leftEarly: new Set(), matchKey: 'k', startedAt: Date.now() };
  const game = { results: () => [{ score: 2, winner: true }, { score: 0, winner: false }, { score: 3, winner: true }, { score: 0, winner: false }] };
  const rec = buildMatchRecord(room, game);
  assert.ok(rec, 'a record is built');
  const won = Object.fromEntries(rec.participants.map((p) => [p.playerId, p.isWinner]));
  assert.deepEqual(won, { b: true, c: false, d: true, a: false }, 'B and D won, because they sat in the winning seats');
  assert.deepEqual(rec.participants.map((p) => p.playerId), ['b', 'c', 'd', 'a'], 'participants are listed in seat order');
});
