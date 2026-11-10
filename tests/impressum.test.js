'use strict';
// The Impressum is a static page and the shell's footer links to it. Both must answer without any session, cookie or login.
require('./helpers/env');
const assert = require('node:assert/strict');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL impressum test timed out'); process.exit(1); }, 60000);
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, matchLog: { log() {}, warn() {}, error() {} } });
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
      assert.match(app, /<footer class="home-foot">[\s\S]*<a href="\/impressum\.html">Impressum<\/a><\/footer>/, 'home footer link');
    });
  } finally {
    clearTimeout(guard);
    await srv.close();
  }
  console.log(`\n${passed} Impressum tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
