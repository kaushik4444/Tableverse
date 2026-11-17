'use strict';
// Server wiring for the legal pages and Google gating (needs the server, so it runs in CI with the ws package).
require('./helpers/env');
const assert = require('node:assert/strict');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL legal routes test timed out'); process.exit(1); }, 90000);
const quiet = { log() {}, warn() {}, error() {} };
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const DETAILS = { IMPRESSUM_NAME: 'Test Person', IMPRESSUM_ADDRESS: 'Teststraße 1, 10115 Berlin', IMPRESSUM_EMAIL: 'test@example.invalid' };
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const base = (srv) => `http://127.0.0.1:${srv.port}`;

(async () => {
  console.log('legal pages (routes and Google gating)');
  const env = { ...process.env, ...DETAILS, GOOGLE_CLIENT_ID: CLIENT_ID };
  // Privacy switch on, but the shipped text still has owner items: the page and Google sign-in must stay off.
  const switchOn = await start({ port: 0, trustProxy: false, legalPrivacyPublished: true, legalTermsPublished: true, env, matchLog: quiet });
  // Switches off: nothing is published, regardless of the text.
  const switchOff = await start({ port: 0, trustProxy: false, env, matchLog: quiet });
  try {
    await test('with a switch off, its page answers 404', async () => {
      for (const srv of [switchOff, switchOn]) {
        const res = await fetch(base(srv) + '/privacy', { redirect: 'manual' });
        assert.equal(res.status, 404);
      }
    });

    await test('while the shipped text has owner items, /privacy and /terms stay 404 even with the switches on', async () => {
      for (const p of ['/privacy', '/terms']) {
        const res = await fetch(base(switchOn) + p, { redirect: 'manual' });
        assert.equal(res.status, 404, p);
      }
    });

    await test('/api/games reports the legal links as not live, and Impressum separately', async () => {
      const body = await (await fetch(base(switchOn) + '/api/games')).json();
      assert.equal(body.privacyPublished, false);
      assert.equal(body.termsPublished, false);
      assert.equal(body.impressumPublished, false, 'Impressum is its own switch and stays off');
    });

    await test('Google sign-in is not offered while the privacy notice is not live; deletion confirmation still is', async () => {
      const body = await (await fetch(base(switchOn) + '/api/auth/google/config')).json();
      assert.equal(body.enabled, false, 'sign-in offer');
      assert.equal(body.deleteConfirm, true, 'deletion confirmation for existing Google accounts');
      assert.equal(body.clientId, CLIENT_ID);
    });

    await test('Google sign-in routes answer 404 while the privacy notice is not live', async () => {
      // Fetch a real CSRF token first, so the request reaches the sign-in gate rather than the CSRF guard.
      const csrfRes = await fetch(base(switchOn) + '/api/auth/csrf');
      const csrf = await csrfRes.json();
      const ctCsrf = /ct_csrf=([^;]+)/.exec(csrfRes.headers.get('set-cookie') || '');
      assert.ok(ctCsrf, 'csrf cookie');
      const res = await fetch(base(switchOn) + '/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'ct_csrf=' + ctCsrf[1], 'X-CSRF-Token': csrf.csrfToken }, body: '{}' });
      assert.equal(res.status, 404, 'the publication gate answers 404');
    });

    await test('the page policy allows Google\'s script when a client ID is set, so deletion confirmation works', async () => {
      const res = await fetch(base(switchOn) + '/api/games');
      assert.match(res.headers.get('content-security-policy') || '', /accounts\.google\.com\/gsi\/client/);
    });

    await test('the raw drafts are never served from public/', async () => {
      const res = await fetch(base(switchOn) + '/legal/privacy.md', { redirect: 'manual' });
      assert.equal(res.status, 404);
    });
  } finally {
    await switchOn.close();
    await switchOff.close();
    clearTimeout(guard);
  }
  console.log(`\n${passed} legal route tests passed`);
  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
})();
