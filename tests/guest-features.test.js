'use strict';
// What guests may do (lib/guestFeatures.js): every switch is locked until the owner opens it, reads apply in the order they
// started, unknown keys are ignored, and listeners hear about changes only.
const assert = require('node:assert/strict');
const gf = require('../lib/guestFeatures');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

test('every switch is locked before the first complete read (fail closed)', () => {
  for (const f of gf.FEATURES) assert.equal(gf.allowed(f.key), false, f.key);
  assert.equal(gf.isReady(), false);
});

test('the switchable list has the agreed areas and nothing else', () => {
  assert.deepEqual(gf.FEATURES.map((f) => f.key), ['private_tables', 'rejoin', 'profiles', 'blocking', 'reports']);
});

test('applying rows opens exactly the features marked enabled', () => {
  gf.apply([{ feature: 'private_tables', enabled: true }, { feature: 'rejoin', enabled: false }]);
  assert.equal(gf.allowed('private_tables'), true);
  assert.equal(gf.allowed('rejoin'), false, 'enabled false stays locked');
  assert.equal(gf.allowed('profiles'), false, 'a missing row stays locked');
  assert.equal(gf.isReady(), true);
});

test('unknown feature keys are ignored, and unknown names are never allowed', () => {
  gf.apply([{ feature: 'friends', enabled: true }, { feature: 'nope', enabled: true }]);
  assert.equal(gf.allowed('friends'), false, 'friends are account-only and not a switch');
  assert.equal(gf.allowed('nope'), false);
});

test('reads are applied in the order they started: an older read that finishes late is dropped', () => {
  const first = gf.begin();
  const second = gf.begin();
  gf.apply([{ feature: 'profiles', enabled: true }], second);
  const changed = gf.apply([{ feature: 'profiles', enabled: false }], first);
  assert.equal(changed, false, 'the older read is ignored');
  assert.equal(gf.allowed('profiles'), true, 'the newer read stands');
});

test('setOne changes this process at once and listeners hear about real changes only', () => {
  gf.apply([]);
  let calls = 0;
  const stop = gf.onChange(() => { calls++; });
  assert.equal(gf.setOne('reports', true), true);
  assert.equal(gf.allowed('reports'), true);
  assert.equal(gf.setOne('reports', true), false, 'same value: no change');
  assert.equal(gf.setOne('reports', false), true);
  assert.equal(gf.allowed('reports'), false);
  assert.equal(gf.setOne('nope', true), false, 'unknown key refused');
  assert.equal(calls, 2);
  stop();
});

test('list() gives every switch with its current state', () => {
  gf.apply([{ feature: 'blocking', enabled: true }]);
  const list = gf.list();
  assert.equal(list.length, gf.FEATURES.length);
  assert.equal(list.find((f) => f.key === 'blocking').enabled, true);
  assert.equal(list.find((f) => f.key === 'profiles').enabled, false);
});

console.log(`\n${passed} guest feature checks passed`);
