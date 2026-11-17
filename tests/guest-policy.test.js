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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
