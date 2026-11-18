'use strict';
const assert = require('node:assert/strict');
const a = require('../public/game-access');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }

test('enabled (the default) lets everybody play', () => {
  for (const r of ['owner', 'admin', 'user', 'guest']) assert.equal(a.allows('on', r), true, r);
});

test('disabled for non-admins: only the owner and admins', () => {
  assert.equal(a.allows('admins', 'owner'), true);
  assert.equal(a.allows('admins', 'admin'), true);
  assert.equal(a.allows('admins', 'user'), false, 'a registered player is refused');
  assert.equal(a.allows('admins', 'guest'), false, 'a guest is refused');
});

test('disabled for guests only: registered players are still welcome, guests are not', () => {
  assert.equal(a.allows('guests', 'owner'), true);
  assert.equal(a.allows('guests', 'admin'), true);
  assert.equal(a.allows('guests', 'user'), true);
  assert.equal(a.allows('guests', 'guest'), false);
});

test('disabled for all (not owner): only the owner', () => {
  assert.equal(a.allows('owner', 'owner'), true);
  assert.equal(a.allows('owner', 'admin'), false, 'admins are refused too');
  assert.equal(a.allows('owner', 'user'), false);
  assert.equal(a.allows('owner', 'guest'), false);
});

test('an unknown mode or role is refused, never allowed by accident', () => {
  assert.equal(a.allows('whatever', 'owner'), false);
  assert.equal(a.allows(undefined, 'owner'), false);
  assert.equal(a.allows('on', 'superuser'), false);
  assert.equal(a.allows('on', undefined), false);
  assert.equal(a.allows('__proto__', 'owner'), false);
});

test('a session role: guests are guests; accounts keep their role; anything odd is a user', () => {
  assert.equal(a.roleOf({ isGuest: true, role: 'owner' }), 'guest', 'a guest is never staff');
  assert.equal(a.roleOf({ role: 'owner' }), 'owner');
  assert.equal(a.roleOf({ role: 'admin' }), 'admin');
  assert.equal(a.roleOf({ role: 'user' }), 'user');
  assert.equal(a.roleOf({}), 'user');
  assert.equal(a.roleOf({ role: 'guest' }), 'user', 'the word guest in the database is not a role');
  assert.equal(a.roleOf({ role: 'root' }), 'user');
});

test('each mode has a label for the admin console, and the four modes are exactly the four options', () => {
  assert.deepEqual(a.MODES, ['on', 'admins', 'guests', 'owner']);
  for (const m of a.MODES) assert.ok(a.LABELS[m] && a.LABELS[m].length > 5, m);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
