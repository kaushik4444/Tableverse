'use strict';
// The public contact address on the legal pages (Impressum, privacy notice, terms). PUBLIC_CONTACT_EMAIL is the official
// address; IMPRESSUM_EMAIL is the fallback. Pure helpers: no server, no database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const legal = require('../lib/legalPages');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const BASE = { IMPRESSUM_NAME: 'Test Person', IMPRESSUM_ADDRESS: 'Teststraße 1, 10115 Berlin' };
const OLD = 'old-impressum@example.invalid';
const PUBLIC = 'public-contact@example.invalid';
const TEMPLATE = '<p>{{IMPRESSUM_NAME}}</p><p>{{IMPRESSUM_ADDRESS}}</p><p>{{IMPRESSUM_EMAIL}}</p>';
const NOTICE = '# Notice\n\nRun by {{IMPRESSUM_NAME}}, {{IMPRESSUM_ADDRESS}}. Contact {{IMPRESSUM_EMAIL}}.\n\n- one\n- two';

console.log('public contact email');

test('PUBLIC_CONTACT_EMAIL is the public address when it is set', () => {
  assert.equal(legal.publicContactEmail({ ...BASE, PUBLIC_CONTACT_EMAIL: PUBLIC, IMPRESSUM_EMAIL: OLD }), PUBLIC);
});

test('surrounding spaces are trimmed from PUBLIC_CONTACT_EMAIL', () => {
  assert.equal(legal.publicContactEmail({ PUBLIC_CONTACT_EMAIL: `  ${PUBLIC}  `, IMPRESSUM_EMAIL: OLD }), PUBLIC);
});

test('IMPRESSUM_EMAIL is the fallback when PUBLIC_CONTACT_EMAIL is missing or blank', () => {
  assert.equal(legal.publicContactEmail({ IMPRESSUM_EMAIL: OLD }), OLD);
  assert.equal(legal.publicContactEmail({ PUBLIC_CONTACT_EMAIL: '   ', IMPRESSUM_EMAIL: OLD }), OLD);
});

test('the Impressum shows the public address, not IMPRESSUM_EMAIL, when both are set', () => {
  const out = legal.renderImpressum(TEMPLATE, { ...BASE, PUBLIC_CONTACT_EMAIL: PUBLIC, IMPRESSUM_EMAIL: OLD });
  assert.ok(out.includes(PUBLIC), 'public address shown');
  assert.ok(!out.includes(OLD), 'old address not shown');
});

test('the privacy notice and terms use the public address too', () => {
  const env = { ...BASE, PUBLIC_CONTACT_EMAIL: PUBLIC, IMPRESSUM_EMAIL: OLD };
  const html = legal.renderLegal(NOTICE, env);
  assert.ok(html && html.includes(PUBLIC), 'public address in the rendered notice');
  assert.ok(!html.includes(OLD), 'old address not in the rendered notice');
});

test('the Impressum still works with only IMPRESSUM_EMAIL (existing setups)', () => {
  const out = legal.renderImpressum(TEMPLATE, { ...BASE, IMPRESSUM_EMAIL: OLD });
  assert.ok(out && out.includes(OLD));
});

test('PUBLIC_CONTACT_EMAIL alone is enough: IMPRESSUM_EMAIL can stay unset', () => {
  assert.equal(legal.detailsComplete({ ...BASE, PUBLIC_CONTACT_EMAIL: PUBLIC }), true);
  assert.ok(legal.renderImpressum(TEMPLATE, { ...BASE, PUBLIC_CONTACT_EMAIL: PUBLIC }).includes(PUBLIC));
});

test('no contact address set at all keeps the pages unpublished (fail closed)', () => {
  assert.equal(legal.detailsComplete({ ...BASE }), false);
  assert.equal(legal.renderImpressum(TEMPLATE, { ...BASE }), null);
  assert.equal(legal.renderImpressum(TEMPLATE, { ...BASE, PUBLIC_CONTACT_EMAIL: '  ' }), null);
});

test('the public address is escaped like the other values (no markup from the environment)', () => {
  const out = legal.renderImpressum(TEMPLATE, { ...BASE, PUBLIC_CONTACT_EMAIL: '<img src=x onerror=alert(1)>@example.invalid' });
  assert.ok(!out.includes('<img'), 'markup is escaped');
  assert.ok(out.includes('&lt;img'));
});

test('the environment object passed in is not changed', () => {
  const env = { ...BASE, PUBLIC_CONTACT_EMAIL: PUBLIC, IMPRESSUM_EMAIL: OLD };
  legal.renderImpressum(TEMPLATE, env);
  assert.equal(env.IMPRESSUM_EMAIL, OLD);
});

test('no e-mail address is written into the shipped legal texts or the Impressum template', () => {
  const files = [
    path.join(__dirname, '..', 'lib', 'legal', 'privacy.md'),
    path.join(__dirname, '..', 'lib', 'legal', 'terms.md'),
    path.join(__dirname, '..', 'public', 'impressum.html'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const literal = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    assert.deepEqual(literal, [], path.basename(file) + ' has a literal address; use {{IMPRESSUM_EMAIL}}');
  }
});

console.log(`\n${passed} passed`);
