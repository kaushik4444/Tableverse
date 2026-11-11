'use strict';
// The Impressum is a static page and the shell's footer links to it. Both must answer without any session, cookie or login.
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../server');
const { impressumPublished } = require('../lib/legalPages');

const guard = setTimeout(() => { console.error('FAIL impressum test timed out'); process.exit(1); }, 60000);
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  // Publication is switched on here explicitly; the default (off) is covered below.
  const srv = await start({ port: 0, trustProxy: false, impressumPublished: true, matchLog: { log() {}, warn() {}, error() {} } });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    await test('the Impressum page answers 200 as HTML to a visitor with no session', async () => {
      const res = await fetch(base + '/impressum.html', { redirect: 'manual' });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /^text\/html/);
      const body = await res.text();
      assert.match(body, /<h1>Impressum<\/h1>/);
    });

    await test('the Impressum page works with an invalid session cookie too, and is not redirected to sign-in', async () => {
      const res = await fetch(base + '/impressum.html', { redirect: 'manual', headers: { Cookie: 'ct_session=not-a-real-token' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('location'), null);
    });

    await test('the Impressum page carries no script, so it cannot depend on the app or a session', async () => {
      const body = await (await fetch(base + '/impressum.html')).text();
      assert.doesNotMatch(body, /<script/i);
    });

    await test('the Impressum page is served with the site security headers', async () => {
      const res = await fetch(base + '/impressum.html');
      assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });

    await test('the shell page has no fixed legal footer; the links live in the app (sign-in sheet and home footer)', async () => {
      const res = await fetch(base + '/', { redirect: 'manual' });
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.doesNotMatch(body, /legal-foot/);
      const app = await (await fetch(base + '/app.js')).text();
      assert.match(app, /class="hint auth-legal"><a href="\/impressum\.html">Impressum<\/a>/, 'sign-in sheet link');
      assert.match(app, /S\.impressumPublished = m\.impressumPublished === true/, 'client reads the server flag');
      assert.match(app, /<footer class="home-foot">[\s\S]*S\.impressumPublished \? '<a href="\/impressum\.html">Impressum<\/a>' : ''[\s\S]*<\/footer>/, 'home footer link, only when published');
    });

    await test('publication flag is fail-closed: only the exact string "true" switches it on', () => {
      assert.equal(impressumPublished({ LEGAL_IMPRESSUM_PUBLISHED: 'true' }), true);
      for (const v of [undefined, '', '1', 'TRUE', 'yes', ' true']) {
        assert.equal(impressumPublished({ LEGAL_IMPRESSUM_PUBLISHED: v }), false, `value ${JSON.stringify(v)}`);
      }
      assert.equal(impressumPublished({}), false);
    });

    await test('the Impressum page is not served (404) while publication is off, even without a session', async () => {
      const off = await start({ port: 0, trustProxy: false, impressumPublished: false, matchLog: { log() {}, warn() {}, error() {} } });
      try {
        const res = await fetch(`http://127.0.0.1:${off.port}/impressum.html`, { redirect: 'manual' });
        assert.equal(res.status, 404);
        const body = await res.text();
        assert.doesNotMatch(body, /Impressum<\/h1>/);
      } finally {
        await off.close();
      }
    });

    await test('the shell and app still load while publication is off (only the page is gated)', async () => {
      const off = await start({ port: 0, trustProxy: false, impressumPublished: false, matchLog: { log() {}, warn() {}, error() {} } });
      try {
        assert.equal((await fetch(`http://127.0.0.1:${off.port}/`, { redirect: 'manual' })).status, 200);
        assert.equal((await fetch(`http://127.0.0.1:${off.port}/app.js`)).status, 200);
      } finally {
        await off.close();
      }
    });

    await test('guard: the Impressum page has no unfilled placeholders left', () => {
      const body = fs.readFileSync(path.join(__dirname, '..', 'public', 'impressum.html'), 'utf8');
      assert.doesNotMatch(body, /\[(OWNER|LEGAL|TODO|PLATZHALTER)[^\]]*\]/i);
    });

    await test('guard: render.yaml does not switch publication on', () => {
      const yaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
      assert.doesNotMatch(yaml, /LEGAL_IMPRESSUM_PUBLISHED/);
    });
  } finally {
    clearTimeout(guard);
    await srv.close();
  }
  console.log(`\n${passed} Impressum tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
