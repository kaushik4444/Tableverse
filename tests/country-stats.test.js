'use strict';
// The minimum-sample rule for per-country figures (db/countryStats.js applyMinimum). The SQL runs in tests/admin.pg.test.js.
const assert = require('node:assert/strict');
const { applyMinimum, MIN_PLAYERS } = require('../db/countryStats');
const row = (country, players, games = players * 4, minutes = players * 30, leftEarly = 0, activeDays = players * 2) => ({ country, players, games, minutes, leftEarly, activeDays });
let passed = 0;
const test = (name, fn) => { try { fn(); passed += 1; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n' + (e && e.stack)); process.exitCode = 1; } };

test('the minimum is ten players', () => assert.equal(MIN_PLAYERS, 10));
test('a country with enough players is shown with per-player figures', () => {
  const out = applyMinimum([row('DE', 12, 48, 360, 4, 24)]);
  assert.deepEqual(out, [{ country: 'DE', players: 12, gamesPerPlayer: 4, minutesPerPlayer: 30, leftEarlyPct: 8, daysPerPlayer: 2 }]);
});
test('a small country is never shown on its own', () => {
  const out = applyMinimum([row('DE', 12), row('IN', 9), row('FR', 3)]);
  assert.deepEqual(out.map((r) => r.country), ['DE', null], 'IN and FR are folded into one "other" line (12 players together)');
  assert.equal(out[1].players, 12);
});
test('small countries that still add up to fewer than ten are dropped completely', () => {
  const out = applyMinimum([row('DE', 12), row('IN', 4), row('FR', 3)]);
  assert.deepEqual(out.map((r) => r.country), ['DE'], 'no line shows 7 players');
});
test('exactly ten is enough; nine is not', () => {
  assert.equal(applyMinimum([row('DE', 10)]).length, 1);
  assert.equal(applyMinimum([row('DE', 9)]).length, 0);
});
test('no rows is an empty list, and a country with no games has no left-early percentage', () => {
  assert.deepEqual(applyMinimum([]), []);
  assert.equal(applyMinimum([row('DE', 10, 0, 0, 0, 0)])[0].leftEarlyPct, null);
});
test('ordered by players, biggest first', () => {
  assert.deepEqual(applyMinimum([row('IN', 11), row('DE', 15)]).map((r) => r.country), ['DE', 'IN']);
});
console.log(`${passed} country statistics tests passed`);
