'use strict';
const assert = require('node:assert/strict');
const p = require('../lib/guestPolicy');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }

test('guest play is off unless GUEST_PLAY_ENABLED is exactly "true" (fails closed)', () => {
  assert.equal(p.guestPlayEnabled({}), false, 'unset');
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: '' }), false);
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: 'false' }), false);
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: '1' }), false, '1 is not accepted');
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: 'yes' }), false);
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: ' TRUE ' }), true, 'case and spaces are forgiven');
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: 'true' }), true);
});

test('there is no per-game environment switch: which games guests may play is the owner\'s access mode (lib/gameFlags.js)', () => {
  assert.equal(p.lockVarFor, undefined);
  assert.equal(p.gameAllowed, undefined);
  assert.equal(p.lockMap, undefined);
  // turning guest play on does not touch any game, whatever the environment says
  assert.equal(p.guestPlayEnabled({ GUEST_PLAY_ENABLED: 'true', WIZARD_GUESTSONLY: 'true' }), true);
});

test('guest session lifetime: default 72 hours, clamped to 1-168, bad values use the default', () => {
  assert.equal(p.guestTtlHours({}), 72);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '24' }), 24);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '0' }), 1);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '9999' }), 168);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: 'soon' }), 72);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '' }), 72);
});

test('TTL rounding preserves the exact lower and upper boundaries', () => {
  for (const [value, expected] of [
    ['1', 1], ['168', 168], ['1.49', 1], ['1.5', 2],
    ['167.49', 167], ['167.5', 168], ['-100', 1],
    ['   ', 72], ['Infinity', 72], ['-Infinity', 72], ['NaN', 72],
  ]) assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: value }), expected, value);
});

// Feature switches share the guest policy suite so npm test runs these checks too.
function featureTest(name, fn) {
  const modulePath = require.resolve('../lib/guestFeatures');
  delete require.cache[modulePath];
  const features = require(modulePath);
  try { test(name, () => fn(features)); }
  finally { delete require.cache[modulePath]; }
}

featureTest('features fail closed before the first read, including unknown keys', (f) => {
  assert.equal(f.isReady(), false);
  for (const key of ['private_tables', 'rejoin', 'unknown', 'toString', '__proto__']) assert.equal(f.allowed(key), false);
  assert.deepEqual(f.list().map(({ key, enabled }) => [key, enabled]), [['private_tables', false], ['rejoin', false]]);
});

featureTest('a complete read only opens recognized features with a boolean true', (f) => {
  assert.equal(f.apply([
    { feature: 'private_tables', enabled: true },
    { feature: 'rejoin', enabled: 'true' },
    { feature: 'unknown', enabled: true },
  ]), true);
  assert.equal(f.isReady(), true);
  assert.equal(f.allowed('private_tables'), true);
  assert.equal(f.allowed('rejoin'), false);
  assert.equal(f.allowed('unknown'), false);
  assert.equal(f.apply([{ feature: 'rejoin', enabled: true }]), true);
  assert.equal(f.allowed('private_tables'), false, 'a full read replaces the previous snapshot');
  assert.equal(f.allowed('rejoin'), true);
});

featureTest('missing or malformed snapshot rows close all features', (f) => {
  for (const rows of [[], null, undefined, {}]) {
    f.apply([{ feature: 'rejoin', enabled: true }]);
    assert.equal(f.apply(rows), true);
    assert.equal(f.allowed('rejoin'), false);
    assert.equal(f.isReady(), true);
  }
});

featureTest('a late older read cannot reopen a feature closed by a newer read', (f) => {
  const older = f.begin();
  const newer = f.begin();
  f.apply([], newer);
  assert.equal(f.apply([{ feature: 'rejoin', enabled: true }], older), false);
  assert.equal(f.allowed('rejoin'), false);
  const latest = f.begin();
  assert.equal(f.apply([{ feature: 'rejoin', enabled: true }], latest), true);
  assert.equal(f.allowed('rejoin'), true);
});

featureTest('single-feature writes preserve other features and reject unknown keys', (f) => {
  assert.equal(f.setOne('unknown', true), false);
  assert.equal(f.isReady(), false, 'an unknown write cannot initialize the snapshot');
  f.apply([]);
  assert.equal(f.setOne('private_tables', true), true);
  assert.equal(f.setOne('rejoin', true), true);
  assert.equal(f.setOne('rejoin', true), false);
  assert.equal(f.setOne('rejoin', false), true);
  assert.equal(f.allowed('private_tables'), true);
  assert.equal(f.allowed('rejoin'), false);
});

featureTest('listeners observe committed state, ignore identical snapshots, and can unsubscribe', (f) => {
  const snapshots = [];
  const off = f.onChange(() => snapshots.push([f.isReady(), f.allowed('rejoin')]));
  f.apply([]);
  f.apply([]);
  f.setOne('rejoin', true);
  f.apply([{ feature: 'rejoin', enabled: true }, { feature: 'unknown', enabled: true }]);
  f.setOne('rejoin', false);
  off();
  f.setOne('rejoin', true);
  assert.deepEqual(snapshots, [[true, false], [true, true], [true, false]]);
});

featureTest('a failing listener does not prevent other subscribers or the state change', (f) => {
  const errors = [];
  const original = console.error;
  let calls = 0;
  const off = f.onChange(() => { throw new Error('subscriber failed'); });
  f.onChange(() => { calls++; });
  console.error = (message) => errors.push(message);
  try {
    assert.equal(f.apply([{ feature: 'rejoin', enabled: true }]), true);
    assert.equal(f.allowed('rejoin'), true);
    assert.equal(calls, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /subscriber failed/);
    off();
    f.setOne('rejoin', false);
    assert.equal(calls, 2);
    assert.equal(errors.length, 1);
  } finally { console.error = original; }
});

featureTest('admin list entries cannot mutate the policy or later list results', (f) => {
  f.apply([{ feature: 'rejoin', enabled: true }]);
  const list = f.list();
  const entry = list.find(({ key }) => key === 'rejoin');
  entry.enabled = false;
  entry.label = 'changed';
  list.pop();
  assert.equal(f.allowed('rejoin'), true);
  assert.equal(f.list().length, 2);
  assert.notEqual(f.list().find(({ key }) => key === 'rejoin').label, 'changed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
