'use strict';
const assert = require('node:assert/strict');
const { seatPlayers } = require('../lib/seatOrder');

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

console.log(`\n${passed} seat order tests passed`);
