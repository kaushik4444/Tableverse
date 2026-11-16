'use strict';
// Publication of /privacy and /terms (pure helpers and shipped text; no server needed).
// Each page has its own switch (LEGAL_PRIVACY_PUBLISHED, LEGAL_TERMS_PUBLISHED). A page is live only when its switch is
// exactly "true", the Impressum details are set, and no owner or legal placeholder remains after filling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const legal = require('../lib/legalPages');
const { cspFor } = require('../lib/googleAuth');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const DETAILS = { IMPRESSUM_NAME: 'Test Person', IMPRESSUM_ADDRESS: 'Teststraße 1, 10115 Berlin', IMPRESSUM_EMAIL: 'test@example.invalid' };
const shipped = (name) => fs.readFileSync(path.join(__dirname, '..', 'lib', 'legal', name + '.md'), 'utf8');
const COMPLETE = '# Notice\n\nRun by {{IMPRESSUM_NAME}}, {{IMPRESSUM_ADDRESS}}. Contact {{IMPRESSUM_EMAIL}}.\n\n- one\n- two';

console.log('legal pages (publication)');

test('each switch is on only for exactly "true", and they are independent', () => {
  assert.equal(legal.privacyPublished({}), false);
  assert.equal(legal.privacyPublished({ LEGAL_PRIVACY_PUBLISHED: 'yes' }), false);
  assert.equal(legal.privacyPublished({ LEGAL_PRIVACY_PUBLISHED: 'true' }), true);
  assert.equal(legal.termsPublished({ LEGAL_PRIVACY_PUBLISHED: 'true' }), false, 'privacy switch does not publish terms');
  assert.equal(legal.termsPublished({ LEGAL_TERMS_PUBLISHED: 'true' }), true);
  assert.equal(legal.privacyPublished({ LEGAL_TERMS_PUBLISHED: 'true' }), false, 'terms switch does not publish privacy');
});

test('the retired LEGAL_PAGES_PUBLISHED flag does nothing', () => {
  assert.equal(legal.privacyPublished({ LEGAL_PAGES_PUBLISHED: 'true' }), false);
  assert.equal(legal.termsPublished({ LEGAL_PAGES_PUBLISHED: 'true' }), false);
});

test('a page is live only when its switch is on, the details are set and no placeholder remains', () => {
  assert.equal(legal.legalPageLive(COMPLETE, { ...DETAILS }, false), false, 'switch off');
  assert.equal(legal.legalPageLive(COMPLETE, { IMPRESSUM_NAME: 'A' }, true), false, 'details missing');
  assert.equal(legal.legalPageLive(COMPLETE, { ...DETAILS, IMPRESSUM_EMAIL: '  ' }, true), false, 'blank detail');
  assert.equal(legal.legalPageLive(COMPLETE + '\nOpen: [OWNER: x]', { ...DETAILS }, true), false, 'placeholder');
  assert.equal(legal.legalPageLive(COMPLETE, { ...DETAILS }, true), true);
});

test('the shipped privacy notice is not live until its owner and legal items are resolved', () => {
  // Fail closed: the shipped text still carries owner/legal items, so the page stays hidden even with everything switched on.
  assert.equal(legal.legalPageLive(shipped('privacy'), { ...DETAILS }, true), false);
  assert.equal(legal.legalPageLive(shipped('terms'), { ...DETAILS }, true), false);
});

test('the controller details come from env at render time and are escaped; no detail is committed to the text', () => {
  const html = legal.renderLegal(COMPLETE, { IMPRESSUM_NAME: '<b>X</b> & Co', IMPRESSUM_ADDRESS: 'Street 1', IMPRESSUM_EMAIL: 'e@example.invalid' });
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt; &amp; Co/);
  assert.doesNotMatch(html, /<b>X/);
  assert.doesNotMatch(html, /\{\{IMPRESSUM_/);
  assert.equal(legal.renderLegal(COMPLETE, { IMPRESSUM_NAME: 'A' }), null, 'missing details fail closed');
  for (const name of ['privacy', 'terms']) {
    assert.doesNotMatch(shipped(name), /Test Person|test@example|Teststraße/, `${name} must not contain personal details`);
  }
});

test('the text is escaped and only https links become links', () => {
  const html = legal.renderLegal('# Hi\n\nSee **this** [site](https://playtableverse.com) and [bad](javascript:alert(1)) <script>x()</script>\n\n- one & two\n- three', DETAILS);
  assert.match(html, /<h1>Hi<\/h1>/);
  assert.match(html, /<strong>this<\/strong>/);
  assert.match(html, /<a href="https:\/\/playtableverse\.com" rel="noopener">site<\/a>/);
  assert.doesNotMatch(html, /href="javascript/i);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<li>one &amp; two<\/li>/);
});

test('the page is a noindex document with no script', () => {
  const page = legal.legalPage('Privacy notice', '<p>x</p>');
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(page, /<script/i);
  assert.match(page, /<title>Privacy notice — Tableverse<\/title>/);
});

console.log('legal pages (shipped text must cover what the code does)');

test('privacy notice describes Google sign-in, deletion, 18+, voice and what is not stored', () => {
  const t = shipped('privacy');
  for (const heading of ['## Who we are', '## What we collect', '## Who receives your data', '## How long we keep data', '## Your choices and rights', '## Children', '## Security']) {
    assert.ok(t.includes(heading), heading);
  }
  assert.match(t, /If you sign in with Google/);
  assert.match(t, /do not store your Google password/i);
  assert.match(t, /Google profile picture/);
  assert.match(t, /signing in with Google again/);
  assert.match(t, /"Deleted player"/);
  assert.match(t, /18 or over/);
  assert.match(t, /Voice chat\*\* is switched off/);
  assert.match(t, /does not record or store voice audio/i);
  assert.match(t, /\{\{IMPRESSUM_EMAIL\}\}/);
});

test('terms cover the sections the product relies on, and contact is taken from the same variable', () => {
  const t = shipped('terms');
  for (const heading of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 8.']) assert.ok(t.includes(heading), heading);
  assert.match(t, /\{\{IMPRESSUM_EMAIL\}\}/);
});


test('CSP opens Google only when the client ID is set AND the privacy notice is live', () => {
  const env = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' };
  assert.doesNotMatch(cspFor(env, false), /accounts\.google\.com/);
  assert.match(cspFor(env, true), /accounts\.google\.com\/gsi\/client/);
  assert.doesNotMatch(cspFor({}, true), /accounts\.google\.com/);
});

console.log(`\n${passed} legal publication tests passed`);
if (process.exitCode) process.exit(process.exitCode);
