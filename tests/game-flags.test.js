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

console.log('access modes (who may play)');

test('each mode decides which roles may play, and a game with no row is on', () => {
  flags.reset();
  flags.apply([{ game_id: 'wizard', access: 'on' }, { game_id: 'ludo', access: 'admins' }, { game_id: 'poker', access: 'guests' }, { game_id: 'gofish', access: 'owner' }]);
  assert.equal(flags.modeOf('wizard'), 'on');
  assert.equal(flags.modeOf('ludo'), 'admins');
  assert.equal(flags.modeOf('themind'), 'on', 'no row = on');
  for (const role of ['owner', 'admin', 'user', 'guest']) assert.equal(flags.isEnabled('wizard', role), true, 'on: ' + role);
  assert.deepEqual(['owner', 'admin', 'user', 'guest'].map((r) => flags.isEnabled('ludo', r)), [true, true, false, false]);
  assert.deepEqual(['owner', 'admin', 'user', 'guest'].map((r) => flags.isEnabled('poker', r)), [true, true, true, false]);
  assert.deepEqual(['owner', 'admin', 'user', 'guest'].map((r) => flags.isEnabled('gofish', r)), [true, false, false, false]);
  flags.reset();
});

test('without a role only "on" counts as enabled (the older call)', () => {
  flags.reset();
  flags.apply([{ game_id: 'ludo', access: 'guests' }]);
  assert.equal(flags.isEnabled('ludo'), false);
  flags.apply([{ game_id: 'ludo', access: 'on' }]);
  assert.equal(flags.isEnabled('ludo'), true);
  flags.reset();
});

test('an unknown or unread game is never enabled, for any role or mode', () => {
  flags.reset();
  assert.equal(flags.isEnabled('ghost', 'owner'), false);
  flags.apply([{ game_id: 'ghost', access: 'on' }]);
  assert.equal(flags.modeOf('ghost'), null);
  flags.reset();
  assert.equal(flags.isEnabled('ludo', 'owner'), false, 'before the first read nothing is enabled');
});

test('rows written before the access column: enabled false = owner only, true = on', () => {
  flags.reset();
  flags.apply([{ game_id: 'ludo', enabled: false }, { game_id: 'wizard', enabled: true }, { game_id: 'poker', access: 'bogus', enabled: false }]);
  assert.equal(flags.modeOf('ludo'), 'owner');
  assert.equal(flags.modeOf('wizard'), 'on');
  assert.equal(flags.modeOf('poker'), 'owner', 'an unknown stored mode falls back to the stored boolean');
  flags.reset();
});

test('setOne accepts a mode, and a boolean from older callers (true = on, false = owner only)', () => {
  flags.reset();
  flags.apply([]);
  assert.equal(flags.setOne('ludo', 'guests'), true);
  assert.equal(flags.modeOf('ludo'), 'guests');
  assert.equal(flags.setOne('ludo', true), true);
  assert.equal(flags.modeOf('ludo'), 'on');
  assert.equal(flags.setOne('ludo', false), true);
  assert.equal(flags.modeOf('ludo'), 'owner');
  assert.equal(flags.setOne('ludo', 'nonsense'), false, 'already owner only, so no change');
  assert.equal(flags.modeOf('ludo'), 'owner', 'an unknown mode is treated as the most restrictive');
  flags.reset();
});

test('withFlags gives each viewer their own enabled flag and the mode', () => {
  flags.reset();
  flags.apply([{ game_id: 'ludo', access: 'guests' }]);
  const list = [{ id: 'ludo' }, { id: 'wizard' }];
  const guest = flags.withFlags(list, 'guest');
  const user = flags.withFlags(list, 'user');
  assert.deepEqual(guest.map((g) => [g.id, g.access, g.enabled]), [['ludo', 'guests', false], ['wizard', 'on', true]]);
  assert.deepEqual(user.map((g) => [g.id, g.enabled]), [['ludo', true], ['wizard', true]]);
  flags.reset();
});

test('explicit access modes take precedence over contradictory legacy booleans', () => {
  flags.reset();
  flags.apply([{ game_id: 'ludo', access: 'guests', enabled: false }, { game_id: 'wizard', access: 'owner', enabled: true }]);
  assert.equal(flags.isEnabled('ludo', 'user'), true);
  assert.equal(flags.isEnabled('ludo', 'guest'), false);
  assert.equal(flags.isEnabled('wizard', 'admin'), false);
  assert.equal(flags.isEnabled('wizard', 'owner'), true);
  flags.reset();
});

test('role-specific lists do not mutate input entries or leak one viewer permission to another', () => {
  flags.reset();
  const input = Object.freeze([Object.freeze({ id: 'ludo', name: 'Ludo', enabled: true }), Object.freeze({ id: 'unknown' })]);
  const unread = flags.withFlags(input, 'owner');
  assert.deepEqual(unread.map(({ access, enabled }) => [access, enabled]), [['owner', false], ['owner', false]]);
  flags.apply([{ game_id: 'ludo', access: 'admins' }]);
  const admin = flags.withFlags(input, 'admin');
  const guest = flags.withFlags(input, 'guest');
  assert.equal(admin[0].enabled, true);
  assert.equal(guest[0].enabled, false);
  assert.equal(admin[0].enabled, true, 'rendering a guest list leaves the admin result intact');
  assert.equal(admin[0].name, 'Ludo');
  assert.notEqual(admin[0], input[0]);
  for (const role of ['guest', 'user', 'admin', 'owner', 'toString']) assert.equal(flags.isEnabled('unknown', role), false);
  flags.reset();
});

test('a read that started before a reset cannot apply after it', () => {
  const flags = require('../lib/gameFlags');
  flags.reset();
  const stale = flags.begin();
  flags.reset();
  assert.equal(flags.apply([{ game_id: 'wizard', access: 'owner', enabled: false }], stale), false, 'stale read refused');
  assert.equal(flags.isReady(), false, 'still no snapshot');
  assert.equal(flags.apply([], flags.begin()), true, 'a newer read applies');
});

test('the home order follows saved positions; unplaced games keep their registered order after them', () => {
  flags.apply([]);
  const base = games.list();
  const last = base[base.length - 1].id;
  const first = base[0].id;
  flags.apply([{ game_id: last, access: 'on', enabled: true, sort_order: 0 }, { game_id: first, access: 'on', enabled: true, sort_order: 1 }]);
  const listed = flags.withFlags(games.list()).map((g) => g.id);
  assert.equal(listed[0], last, 'the placed game comes first');
  assert.equal(listed[1], first, 'then the next placed game');
  assert.deepEqual(listed.slice(2), base.map((g) => g.id).filter((id) => id !== last && id !== first), 'the rest keep registered order');
  flags.apply([]);
  assert.deepEqual(flags.withFlags(games.list()).map((g) => g.id), base.map((g) => g.id), 'no positions: registered order');
});

test('sortByPosition is pure and ignores positions for unknown games', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = flags.sortByPosition(list, new Map([['c', 0], ['a', 1]]));
  assert.deepEqual(out.map((g) => g.id), ['c', 'a', 'b']);
  assert.deepEqual(list.map((g) => g.id), ['a', 'b', 'c'], 'input not reordered');
  assert.deepEqual([...flags.positionsOf(['x', 'y'])], [['x', 0], ['y', 1]]);
});

test('setOrder applies at once and reports a real change only', () => {
  flags.apply([]);
  const ids2 = games.list().map((g) => g.id);
  const reversed = ids2.slice().reverse();
  assert.equal(flags.setOrder(reversed), true);
  assert.equal(flags.withFlags(games.list())[0].id, reversed[0]);
  assert.equal(flags.setOrder(reversed), false, 'same order is not a change');
  flags.apply([]);
});


test('equal positions retain input order, including zero and unplaced games', () => {
  const list = Object.freeze([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  const map = new Map([['b', 0], ['c', 0], ['ghost', -1]]);
  assert.deepEqual(flags.sortByPosition(list, map).map((g) => g.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual([...map], [['b', 0], ['c', 0], ['ghost', -1]]);
  assert.deepEqual(flags.sortByPosition([], map), []);
});

test('only integer database positions affect order', () => {
  flags.reset();
  const reversed = ids.slice().reverse();
  flags.apply(reversed.map((game_id, i) => ({ game_id, access: 'on', sort_order: [null, undefined, '0', 0.5, NaN, Infinity][i % 6] })));
  assert.deepEqual(flags.withFlags(games.list()).map((g) => g.id), ids);
  flags.apply([{ game_id: ids.at(-1), sort_order: 0 }, { game_id: 'ghost', sort_order: -1 }]);
  assert.deepEqual(flags.withFlags(games.list()).map((g) => g.id), [ids.at(-1), ...ids.slice(0, -1)]);
  flags.reset();
});

test('an order-only snapshot change notifies once; row order does not count as a change', () => {
  flags.reset();
  const rows = ids.map((game_id, sort_order) => ({ game_id, sort_order, access: 'on' }));
  flags.apply(rows);
  let calls = 0;
  const off = flags.onChange(() => { calls++; });
  try {
    assert.equal(flags.apply(rows.slice().reverse()), false);
    assert.equal(calls, 0);
    assert.equal(flags.apply(rows.map((r, i) => ({ ...r, sort_order: ids.length - i }))), true);
    assert.equal(calls, 1);
    assert.equal(flags.apply(rows.map((r, i) => ({ ...r, sort_order: ids.length - i }))), false);
    assert.equal(calls, 1);
  } finally { off(); flags.reset(); }
});

test('saving order fences stale reads even when the saved order is unchanged', () => {
  flags.reset(); flags.apply([]);
  const reversed = ids.slice().reverse();
  flags.setOrder(reversed);
  const stale = flags.begin();
  assert.equal(flags.setOrder(reversed), false);
  assert.equal(flags.apply(ids.map((game_id, sort_order) => ({ game_id, sort_order })), stale), false);
  assert.deepEqual(flags.withFlags(games.list()).map((g) => g.id), reversed);
  flags.reset();
});

test('reordering preserves role access and ignores unknown ids', () => {
  flags.reset(); flags.apply([{ game_id: ids[0], access: 'owner' }]);
  const reversed = ids.slice().reverse();
  flags.setOrder(['ghost', ...reversed]);
  for (const role of ['owner', 'admin', 'user', 'guest']) {
    const list = flags.withFlags(games.list(), role);
    assert.deepEqual(list.map((g) => g.id), reversed);
    const restricted = list.find((g) => g.id === ids[0]);
    assert.equal(restricted.access, 'owner');
    assert.equal(restricted.enabled, role === 'owner');
  }
  assert.equal(flags.setOrder(reversed), false, 'unknown ids consume no position');
  flags.reset();
});

test('setOrder before readiness stays fail closed and fences in-flight reads', () => {
  flags.reset();
  const stale = flags.begin();
  assert.equal(flags.setOrder(ids.slice().reverse()), false);
  assert.equal(flags.isReady(), false);
  assert.equal(flags.isEnabled(ids[0], 'owner'), false);
  assert.equal(flags.apply([], stale), false);
  flags.apply([]);
  assert.deepEqual(flags.withFlags(games.list()).map((g) => g.id), ids);
  flags.reset();
});

test('a guest play limit comes from the rows, is null for games without one, and can be set or removed at once', () => {
  const id = ids[0];
  flags.apply([{ game_id: id, access: 'on', guest_trial_limit: 4 }]);
  assert.equal(flags.trialLimitOf(id), 4);
  assert.equal(flags.trialLimitOf(ids[1]), null, 'no row, no limit');
  flags.setTrialLimit(id, 7);
  assert.equal(flags.trialLimitOf(id), 7, 'this process applies a change at once');
  flags.setTrialLimit(id, null);
  assert.equal(flags.trialLimitOf(id), null);
  flags.reset();
  assert.equal(flags.trialLimitOf(id), null, 'a reset forgets the limits');
});

test('no limit is reported before the first complete read', () => {
  flags.reset();
  assert.equal(flags.trialLimitOf(ids[0]), null);
});

console.log(`\n${passed} passed`);
