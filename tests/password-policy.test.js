'use strict';
// The new-password rule (public/password-policy.js), shared by the browser and the server.
const assert = require('node:assert/strict');
const P = require('../public/password-policy');
let passed = 0;
const test = (name, fn) => { try { fn(); passed += 1; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n' + (e && e.stack)); process.exitCode = 1; } };

test('the minimum is 8 characters', () => assert.equal(P.MIN, 8));
test('a password of 8 or more characters is accepted, with no required mix of kinds', () => {
  for (const ok of ['87654321', 'abcdefgh', 'TestPass123!', 'correcthorse', 'Blue Tractor 42', 'Ünïcode9', '\u{1F600}'.repeat(8)]) assert.equal(P.check(ok), null, ok);
});
test('too short is refused with the length first', () => {
  assert.match(P.check('Ab1!xyz'), /at least 8 characters/);
  assert.deepEqual(P.missing('abc'), ['at least 8 characters']);
  assert.deepEqual(P.missing('abcdefgh'), []);
});
test('emoji count once towards the minimum', () => assert.match(P.check('\u{1F600}'.repeat(7)), /at least 8 characters/));
test('obvious words are refused whatever the case', () => {
  assert.match(P.check('MyPassword123'), /obvious/); assert.match(P.check('qwerty-long-one'), /obvious/); assert.match(P.check('Tableverse2026'), /obvious/);
});
test('it may not contain the username or the first part of the e-mail', () => {
  assert.match(P.check('sunshine99ok', { username: 'sunshine99' }), /username/);
  assert.match(P.check('zx-annabel-7', { email: 'Annabel@example.com' }), /e-mail/);
  assert.equal(P.check('zx-ann-7aqrtv', { email: 'ann@example.com' }), null, 'a short name part (under four letters) is not matched');
  assert.equal(P.check('zx-an-7aqrtv', { username: 'an' }), null, 'a short username (under three characters) is not matched');
  assert.match(P.check('zx-ann-7aqrtv', { username: 'ann' }), /username/, 'a three-character username is matched');
});
test('the length limit counts characters, not UTF-16 units: 200 emoji fit, 201 do not', () => {
  assert.equal(P.check('\u{1F600}'.repeat(200)), null, '200 characters is accepted');
  assert.match(P.check('\u{1F600}'.repeat(201)), /at most 200/, '201 characters is refused');
});
test('too long and not-a-string are refused', () => {
  assert.match(P.check('x'.repeat(201)), /at most 200/);
  assert.equal(P.check(undefined), 'Enter a password.'); assert.equal(P.check(12345678901), 'Enter a password.');
});
test('the identity parts are compared case-insensitively', () => {
  assert.match(P.check('SUNSHINE99ok', { username: 'sunshine99' }), /username/);
  assert.match(P.check('ZX-ANNABEL-7a', { email: 'annabel@example.com' }), /e-mail/);
});

// The sign-up hint: it must never say "Looks good." for a password the server would refuse.
test('the hint asks for the length, then explains a refusal, and says "Looks good." only for an accepted password', () => {
  assert.deepEqual(P.hint(''), { text: 'Use at least 8 characters. Avoid obvious words such as "password".', bad: false });
  assert.match(P.hint('abc').text, /Still needed: at least 8 characters/);
  assert.deepEqual(P.hint('correct-horse', { username: 'ann', email: 'ann@x.test' }), { text: 'Looks good.', bad: false });
  const obvious = P.hint('MyPassword123', { username: 'ann', email: 'ann@x.test' });
  assert.equal(obvious.bad, true, 'a refused password is marked bad, not "Looks good."');
  assert.match(obvious.text, /obvious/);
  const named = P.hint('zx-annabel-7', { username: 'carol', email: 'annabel@x.test' });
  assert.equal(named.bad, true);
  assert.match(named.text, /e-mail/);
});
console.log(`${passed} password policy tests passed`);
