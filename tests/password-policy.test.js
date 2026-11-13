'use strict';
// The new-password rule (public/password-policy.js), shared by the browser and the server.
const assert = require('node:assert/strict');
const P = require('../public/password-policy');
let passed = 0;
const test = (name, fn) => { try { fn(); passed += 1; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n' + (e && e.stack)); process.exitCode = 1; } };

test('a strong password is accepted', () => {
  for (const ok of ['TestPass123!', 'NewPass123!', 'Correct-Horse-9', 'mAn y wor d5 s', 'Ünïcode9Wörds!']) assert.equal(P.check(ok), null, ok);
});
test('too short is refused with the length first', () => assert.match(P.check('Ab1!xyz'), /at least 10 characters/));
test('each missing kind is named', () => {
  assert.match(P.check('alllowercase1!'), /an uppercase letter/);
  assert.match(P.check('ALLUPPERCASE1!'), /a lowercase letter/);
  assert.match(P.check('NoNumbersHere!'), /a number/);
  assert.match(P.check('NoSymbolsHere12'), /a symbol/);
  assert.deepEqual(P.missing('abc'), ['at least 10 characters', 'an uppercase letter', 'a number', 'a symbol such as ! ? # or a space']);
});
test('a space counts as the symbol, so a passphrase works', () => assert.equal(P.check('Blue Tractor 42'), null));
test('obvious words are refused whatever the case', () => {
  assert.match(P.check('MyPassword123!'), /obvious/); assert.match(P.check('Qwerty!Qwerty1'), /obvious/); assert.match(P.check('Tableverse#2026'), /obvious/);
});
test('it may not contain the username or the first part of the e-mail', () => {
  assert.match(P.check('Sunshine99!ok', { username: 'sunshine99' }), /username/);
  assert.match(P.check('Zx-annabel-7A', { email: 'Annabel@example.com' }), /e-mail/);
  assert.equal(P.check('Zx-ann-7Aqrtv', { email: 'ann@example.com' }), null, 'a short name part (under four letters) is not matched');
});
test('too long and not-a-string are refused', () => {
  assert.match(P.check('Aa1!' + 'x'.repeat(200)), /at most 200/);
  assert.equal(P.check(undefined), 'Enter a password.'); assert.equal(P.check(12345678901), 'Enter a password.');
});
test('the identity parts the server checks are the normalised ones (what is stored)', () => {
  // the server trims and lowercases before it calls check(); the rule itself compares case-insensitively
  assert.match(P.check('Sunshine99!ok', { username: 'sunshine99' }), /username/);
  assert.match(P.check('Zx-ANNABEL-7a', { email: 'annabel@example.com' }), /e-mail/);
});

// The sign-up hint: it must never say "Looks good." for a password the server would refuse.
test('the hint asks for what is missing, then explains a refusal, and says "Looks good." only for an accepted password', () => {
  assert.deepEqual(P.hint(''), { text: 'Use an uppercase letter, a lowercase letter, a number and a symbol.', bad: false });
  assert.match(P.hint('alllowercase1!').text, /Still needed: an uppercase letter/);
  assert.deepEqual(P.hint('TestPass123!', { username: 'ann', email: 'ann@x.test' }), { text: 'Looks good.', bad: false });
  // every character kind is present, but the password is refused: the hint must say so
  const obvious = P.hint('MyPassword123!', { username: 'ann', email: 'ann@x.test' });
  assert.equal(obvious.bad, true, 'a refused password is marked bad, not "Looks good."');
  assert.match(obvious.text, /obvious/);
  const named = P.hint('Zx-annabel-7A', { username: 'carol', email: 'annabel@x.test' });
  assert.equal(named.bad, true);
  assert.match(named.text, /e-mail/);
  assert.notEqual(P.hint('Sunshine99!ok', { username: 'sunshine99' }).text, 'Looks good.');
});
console.log(`${passed} password policy tests passed`);
