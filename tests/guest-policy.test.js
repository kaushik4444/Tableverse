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

test('the lock variable is the game id in capitals with non-letters removed', () => {
  assert.equal(p.lockVarFor('wizard'), 'WIZARD_GUESTSONLY');
  assert.equal(p.lockVarFor('penaltyrows'), 'PENALTYROWS_GUESTSONLY');
  assert.equal(p.lockVarFor('fourinarow'), 'FOURINAROW_GUESTSONLY');
  assert.equal(p.lockVarFor('twenty-nine'), 'TWENTYNINE_GUESTSONLY');
});

test('a game locked by its variable is refused for guests only', () => {
  const env = { WIZARD_GUESTSONLY: 'true' };
  assert.deepEqual(p.gameAllowed({ isGuest: true, gameId: 'wizard', env }), { allowed: false, reason: 'guest_locked' });
  assert.deepEqual(p.gameAllowed({ isGuest: false, gameId: 'wizard', env }), { allowed: true }, 'registered players are not affected');
  assert.deepEqual(p.gameAllowed({ isGuest: true, gameId: 'ludo', env }), { allowed: true }, 'other games stay open');
});

test('false, unset and other values leave a game open to guests', () => {
  for (const v of [undefined, '', 'false', 'no', '0']) assert.deepEqual(p.gameAllowed({ isGuest: true, gameId: 'wizard', env: { WIZARD_GUESTSONLY: v } }), { allowed: true }, String(v));
});

test('lockMap: every game is locked while guest play is off, otherwise only the ones switched on', () => {
  const ids = ['wizard', 'ludo'];
  assert.deepEqual(p.lockMap(ids, {}), { wizard: true, ludo: true });
  assert.deepEqual(p.lockMap(ids, { GUEST_PLAY_ENABLED: 'true', WIZARD_GUESTSONLY: 'true' }), { wizard: true, ludo: false });
});

test('guest session lifetime: default 72 hours, clamped to 1-168, bad values use the default', () => {
  assert.equal(p.guestTtlHours({}), 72);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '24' }), 24);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '0' }), 1);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '9999' }), 168);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: 'soon' }), 72);
  assert.equal(p.guestTtlHours({ GUEST_SESSION_TTL_HOURS: '' }), 72);
});

test('the policy does not depend on the game list: an unknown game is open unless its variable is set', () => {
  assert.deepEqual(p.gameAllowed({ isGuest: true, gameId: 'future-game', env: {} }), { allowed: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
