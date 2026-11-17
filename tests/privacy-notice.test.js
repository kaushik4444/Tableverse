'use strict';
// Consistency between the published privacy notice (lib/legal/privacy.md) and the code and docs it describes.
// Pure checks: no server, no database. Each retention figure is read from the source constant, so a change on either side fails here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const legal = require('../lib/legalPages');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const notice = read('lib/legal/privacy.md');
const DETAILS = { IMPRESSUM_NAME: 'Test Person', IMPRESSUM_ADDRESS: 'Teststrasse 1, 10115 Berlin', IMPRESSUM_EMAIL: 'test@example.invalid' };

console.log('privacy notice (consistency with code and docs)');

test('the notice names no literal e-mail address; the contact is the {{IMPRESSUM_EMAIL}} token', () => {
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(notice), false);
  assert.ok(notice.includes('{{IMPRESSUM_EMAIL}}'));
});

test('the notice cannot be published while owner or legal markers remain', () => {
  assert.ok(/\[(OWNER|LEGAL)\b/.test(notice), 'the markers are the open items');
  assert.equal(legal.legalPageLive(notice, { ...DETAILS }, true), false, 'live with markers');
  assert.equal(legal.legalPageLive(notice, { ...DETAILS }, false), false, 'switch off');
});

test('generated prose provenance stays out of the rendered privacy notice', () => {
  const approved = notice.replace(/\[(?:OWNER|LEGAL)\b[^\]]*\]/g, 'Approved');
  const html = legal.renderLegal(approved, DETAILS);
  assert.ok(html);
  assert.equal(html.includes('coderabbit-ai-generated'), false);
  assert.ok(html.includes('purge-eligibility thresholds'));
});

test('the publication date is not filled in before approval', () => {
  assert.equal(/18 November 2026/.test(notice), false);
  assert.ok(notice.includes('Last updated: [OWNER:'));
});

test('retention: rate-limit records qualify for purge after one day, as the code does', () => {
  assert.ok(read('db/auth.js').includes("DELETE FROM auth_rate_limits WHERE window_start < NOW() - INTERVAL '1 day'"));
  assert.ok(/Network-address rate-limit records[^\n]*eligible for purge after one day/.test(notice));
});

test('retention: verification 24 hours and password reset 30 minutes match the code defaults', () => {
  const auth = read('db/auth.js');
  assert.ok(auth.includes('positive(process.env.AUTH_VERIFY_TTL_MIN, 60 * 24)'));
  assert.ok(auth.includes('positive(process.env.AUTH_RESET_TTL_MIN, 30)'));
  assert.ok(notice.includes('valid for 24 hours') && notice.includes('valid for 30 minutes'));
});

test('retention: login sessions default to 30 days, as the code documents', () => {
  assert.ok(read('db/players.js').includes('AUTH_SESSION_TTL_DAYS, default 30 days'));
  assert.ok(notice.includes('last 30 days from sign-in'));
});

test('retention: usage, feedback, audit and daily-total periods match the RETENTION constants', () => {
  const admin = read('db/admin.js');
  assert.ok(/activeDays: 35\b/.test(admin), 'active-player days');
  assert.ok(/dailyDays: 400\b/.test(admin), 'daily totals');
  assert.ok(/feedbackDays: 180\b/.test(admin), 'feedback');
  assert.ok(/auditDays: 365\b/.test(admin), 'audit');
  const retention = notice.split('## How long we keep data')[1].split('## Your choices and rights')[0];
  const usage = retention.split('\n').find((line) => line.startsWith('- **Aggregate usage statistics**:'));
  assert.ok(usage, 'usage statistics category');
  assert.match(usage, /hashes[^.]*\b35 days\b/i, 'active-player hashes');
  assert.match(usage, /daily totals[^.]*\b400 days\b/i, 'daily totals');
  for (const [category, days] of [['Feedback', 180], ['Staff audit log', 365]]) {
    const entry = retention.split('\n').find((line) => line.startsWith(`- **${category}**:`));
    assert.ok(entry, category + ' category');
    assert.match(entry, new RegExp(`\\b${days} days\\b`), category + ' duration');
  }
});

test('usage statistics: the notice describes the keyed hash as pseudonymous, which the code confirms', () => {
  assert.ok(read('db/admin.js').includes("crypto.createHmac('sha256', s)"), 'keyed hash in code');
  assert.ok(notice.includes('keyed hash') && notice.includes('pseudonymous'));
});

test('deleted accounts: the finished-match name is the one the code writes', () => {
  assert.ok(read('db/matches.js').includes("const DELETED_NAME = 'Deleted player';"));
  assert.ok(notice.includes('"Deleted player"'));
});

test('Google: the notice matches the gate in server.js (sign-in offered only while the notice is live)', () => {
  assert.ok(read('server.js').includes('googleAllowed: privacyLive'));
  const doc = read('docs/ACCOUNT_DELETION_AND_RETENTION.md');
  assert.ok(doc.includes('googleAllowed') && doc.includes('GOOGLE_CLIENT_ID'));
  assert.ok(doc.includes('Once the privacy notice is published and Google sign-in is enabled'));
});

test('providers and locations: each provider in the code is named with its location', () => {
  for (const name of ['Render', 'Neon', 'GitHub', 'Resend', 'Metered', 'Google', 'Cloudflare']) {
    assert.ok(notice.includes(name), name + ' is named');
  }
  for (const place of ['Oregon', 'Singapore', 'Canada', 'United States']) assert.ok(notice.includes(place), place);
  assert.ok(read('lib/email.js').includes("provider === 'resend'"), 'Resend is the e-mail provider');
  assert.ok(read('lib/voiceRelay.js').includes('stun.cloudflare.com'), 'Cloudflare STUN in code');
});

test('transfers: the notice does not claim that data is stored only in the primary location', () => {
  assert.ok(notice.includes('We do not claim that your data is stored only in the primary location'));
});

test('legal bases: the three Art. 6 bases from the owner decisions are present', () => {
  assert.ok(notice.includes('Art. 6(1)(b)'));
  assert.ok(notice.includes('Art. 6(1)(f)'));
  assert.ok(notice.includes('Art. 6(1)(c)'));
});

test('data requests: a one-month response period, identity check and the manual route are stated', () => {
  assert.ok(notice.includes('within one month'));
  assert.ok(notice.includes('one-time code'));
  assert.ok(notice.includes('There is no automatic export tool'));
});

test('staff access: the notice does not claim staff see an e-mail address, as the console does not', () => {
  assert.ok(notice.includes('does not show your e-mail address'));
  assert.ok(read('db/admin.js').includes("'user.verify_resend'"), 'the resend lookup is audited');
});

test('country: the field the code stores is described in the notice', () => {
  assert.ok(read('db/playerStats.js').includes('p.country'));
  assert.ok(notice.includes('Your country, only if you choose one'));
});

test('the superseded draft says it is superseded and points to the live notice', () => {
  const draft = read('docs/PRIVACY_NOTICE_DRAFT.md');
  assert.ok(draft.includes('Superseded (2026-11-17)'));
  assert.ok(draft.includes('lib/legal/privacy.md'));
});

console.log(`\n${passed} privacy notice checks passed`);
