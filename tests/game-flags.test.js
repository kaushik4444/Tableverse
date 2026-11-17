'use strict';
// Per-game switches (lib/gameFlags.js): every registered game is enabled unless a row turns it off, unknown games are never
// enabled, and the snapshot follows what the database says. Pure: no server, no database.
const assert = require('node:assert/strict');
const games = require('../games');
const flags = require('../lib/gameFlags');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const ids = games.list().map((g) => g.id);

console.log('game switches');

test('every registered game is enabled with no rows', () => {
  flags.apply([]);
  assert.ok(ids.length >= 9, 'the registry has games');
  for (const id of ids) assert.equal(flags.isEnabled(id), true, id);
});

test('an unknown or non-string game is never enabled', () => {
  flags.apply([]);
  assert.equal(flags.isEnabled('no-such-game'), false);
  assert.equal(flags.isEnabled(undefined), false);
  assert.equal(flags.isEnabled(null), false);
  assert.equal(flags.isEnabled({ id: 'wizard' }), false);
});

test('a row with enabled = false switches only that game off', () => {
  flags.apply([{ game_id: 'wizard', enabled: false }]);
  assert.equal(flags.isEnabled('wizard'), false);
  for (const id of ids.filter((x) => x !== 'wizard')) assert.equal(flags.isEnabled(id), true, id);
});

test('switching back on works (a later snapshot replaces the earlier one)', () => {
  flags.apply([{ game_id: 'wizard', enabled: false }]);
  flags.apply([{ game_id: 'wizard', enabled: true }]);
  assert.equal(flags.isEnabled('wizard'), true);
});

test('a row removed from the database puts the game back to enabled', () => {
  flags.apply([{ game_id: 'ludo', enabled: false }]);
  assert.equal(flags.isEnabled('ludo'), false);
  flags.apply([]);
  assert.equal(flags.isEnabled('ludo'), true);
});

test('rows for unknown games are ignored and never break the snapshot', () => {
  flags.apply([{ game_id: 'ghost', enabled: false }, { game_id: 'gofish', enabled: false }]);
  assert.equal(flags.isEnabled('gofish'), false);
  assert.equal(flags.isEnabled('ghost'), false); // unknown: not enabled either way
});

test('a bad rows value is treated as no rows', () => {
  flags.apply(null);
  for (const id of ids) assert.equal(flags.isEnabled(id), true, id);
});

test('withFlags adds the enabled state to each game and keeps the rest of the entry', () => {
  flags.apply([{ game_id: 'poker', enabled: false }]);
  const list = flags.withFlags(games.list());
  assert.equal(list.length, ids.length);
  const poker = list.find((g) => g.id === 'poker');
  assert.equal(poker.enabled, false);
  assert.equal(poker.name, games.get('poker').name);
  assert.equal(list.find((g) => g.id === 'wizard').enabled, true);
  flags.apply([]);
});

console.log('snapshot rules');

test('nothing is enabled before the first complete read (fail closed)', () => {
  flags.reset();
  assert.equal(flags.isReady(), false);
  assert.equal(flags.isEnabled('wizard'), false);
  flags.apply([]);
  assert.equal(flags.isEnabled('wizard'), true);
});

test('a read started earlier that finishes later does not overwrite a newer read', () => {
  flags.reset();
  const older = flags.begin();
  const newer = flags.begin();
  assert.equal(flags.apply([{ game_id: 'ludo', enabled: false }], newer), true);
  assert.equal(flags.apply([], older), false, 'the older read is dropped');
  assert.equal(flags.isEnabled('ludo'), false);
  flags.apply([]);
});

test('a single write applies at once and drops reads that started before it', () => {
  flags.reset();
  flags.apply([]);
  const before = flags.begin();
  assert.equal(flags.setOne('gofish', false), true);
  assert.equal(flags.isEnabled('gofish'), false);
  assert.equal(flags.apply([{ game_id: 'gofish', enabled: true }], before), false, 'a read from before the write is stale');
  assert.equal(flags.isEnabled('gofish'), false);
  flags.apply([]);
});

test('listeners are told only about real changes', () => {
  flags.reset();
  flags.apply([{ game_id: 'poker', enabled: false }]);
  let calls = 0;
  const off = flags.onChange(() => { calls++; });
  flags.apply([{ game_id: 'poker', enabled: false }]); // same as before
  assert.equal(calls, 0);
  flags.apply([{ game_id: 'poker', enabled: true }]);
  assert.equal(calls, 1);
  flags.setOne('poker', true); // already on
  assert.equal(calls, 1);
  off();
  flags.setOne('poker', false);
  assert.equal(calls, 1, 'a removed listener is not called');
  flags.apply([]);
});

test('a listener that throws does not stop the others', () => {
  flags.reset();
  let second = 0;
  flags.onChange(() => { throw new Error('boom'); });
  flags.onChange(() => { second++; });
  const quiet = console.error; console.error = () => {};
  try { flags.apply([{ game_id: 'ludo', enabled: false }]); } finally { console.error = quiet; }
  assert.equal(second, 1);
  flags.reset();
});

console.log(`\n${passed} passed`);
