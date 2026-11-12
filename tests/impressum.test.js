'use strict';
// The Impressum is a static page and the shell's footer links to it. Both must answer without any session, cookie or login.
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../server');
const { impressumPublished, renderImpressum } = require('../lib/legalPages');

const DETAILS = { IMPRESSUM_NAME: 'Test Person', IMPRESSUM_ADDRESS: 'Teststraße 1, 10115 Berlin', IMPRESSUM_EMAIL: 'test@example.invalid' };

const guard = setTimeout(() => { console.error('FAIL impressum test timed out'); process.exit(1); }, 60000);
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  // Publication is switched on here explicitly; the default (off) is covered below.
  const srv = await start({ port: 0, trustProxy: false, impressumPublished: true, env: { ...process.env, ...DETAILS }, matchLog: { log() {}, warn() {}, error() {} } });
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
      assert.match(app, /typeof out\.impressumPublished === 'boolean'\) S\.impressumPublished = out\.impressumPublished/, 'signed-out snapshot reads the flag');
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

    await test('publication off: encoded and dotted aliases of the page are not served either', async () => {
      const off = await start({ port: 0, trustProxy: false, impressumPublished: false, matchLog: { log() {}, warn() {}, error() {} } });
      try {
        for (const p of ['/%2fimpressum.html', '/%2Fimpressum.html', '/x%2f..%2fimpressum.html', '/./impressum.html', '/a/../impressum.html', '/%2e%2e/impressum.html']) {
          const res = await fetch(`http://127.0.0.1:${off.port}${p}`, { redirect: 'manual' });
          const body = await res.text();
          assert.notEqual(res.status, 200, p);
          assert.doesNotMatch(body, /<h1>Impressum<\/h1>/, p);
        }
      } finally {
        await off.close();
      }
    });

    await test('/api/games tells signed-out visitors the publication state (off)', async () => {
      const off = await start({ port: 0, trustProxy: false, impressumPublished: false, matchLog: { log() {}, warn() {}, error() {} } });
      try {
        const out = await (await fetch(`http://127.0.0.1:${off.port}/api/games`)).json();
        assert.equal(out.impressumPublished, false);
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

    await test('the published page shows the details from env, and no token is left', async () => {
      const body = await (await fetch(base + '/impressum.html')).text();
      assert.match(body, /<p>Test Person<\/p>/);
      assert.match(body, /<p>Teststraße 1, 10115 Berlin<\/p>/);
      assert.match(body, /E-Mail: test@example\.invalid/);
      assert.doesNotMatch(body, /\{\{IMPRESSUM_/);
    });

    await test('publication on but a detail missing: the page is not served (fail closed)', async () => {
      const partial = { ...process.env, ...DETAILS };
      delete partial.IMPRESSUM_EMAIL;
      const srvPartial = await start({ port: 0, trustProxy: false, impressumPublished: true, env: partial, matchLog: { log() {}, warn() {}, error() {} } });
      try {
        const res = await fetch(`http://127.0.0.1:${srvPartial.port}/impressum.html`, { redirect: 'manual' });
        assert.equal(res.status, 404);
        assert.doesNotMatch(await res.text(), /Test Person/);
      } finally {
        await srvPartial.close();
      }
    });

    await test('the published flag reported to clients is on only when the details are complete', async () => {
      const partial = { ...process.env, ...DETAILS };
      delete partial.IMPRESSUM_ADDRESS;
      const srvPartial = await start({ port: 0, trustProxy: false, impressumPublished: true, env: partial, matchLog: { log() {}, warn() {}, error() {} } });
      try {
        const out = await (await fetch(`http://127.0.0.1:${srvPartial.port}/api/games`)).json();
        assert.equal(out.impressumPublished, false, 'no link may point at a page that cannot be served');
      } finally {
        await srvPartial.close();
      }
    });

    await test('renderer escapes values and refuses a missing value', () => {
      const tpl = '<p>{{IMPRESSUM_NAME}}</p><p>{{IMPRESSUM_ADDRESS}}</p><p>{{IMPRESSUM_EMAIL}}</p>';
      const out = renderImpressum(tpl, { IMPRESSUM_NAME: 'A <script>x</script>', IMPRESSUM_ADDRESS: 'B & C', IMPRESSUM_EMAIL: 'e@example.invalid' });
      assert.doesNotMatch(out, /<script/);
      assert.match(out, /A &lt;script&gt;x&lt;\/script&gt;/);
      assert.match(out, /B &amp; C/);
      assert.equal(renderImpressum(tpl, { IMPRESSUM_NAME: 'A', IMPRESSUM_ADDRESS: 'B', IMPRESSUM_EMAIL: '   ' }), null, 'blank value');
      assert.equal(renderImpressum(tpl, { IMPRESSUM_NAME: 'A', IMPRESSUM_ADDRESS: 'B' }), null, 'missing value');
    });

    await test('guard: the repository holds no personal details, only the tokens', () => {
      const body = fs.readFileSync(path.join(__dirname, '..', 'public', 'impressum.html'), 'utf8');
      for (const token of ['{{IMPRESSUM_NAME}}', '{{IMPRESSUM_ADDRESS}}', '{{IMPRESSUM_EMAIL}}']) assert.ok(body.includes(token), token);
      assert.doesNotMatch(body, /chandapet|Chandapet|Bruno|Baum|12685|@gmail/i);
    });

    await test('guard: render.yaml does not switch publication on', () => {
      const yaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
      assert.doesNotMatch(yaml, /LEGAL_IMPRESSUM_PUBLISHED/);
    });
  } finally {
    clearTimeout(guard);
    await srv.close();
  }
  console.log(process.exitCode ? `\nImpressum tests: ${passed} passed, FAILED` : `\n${passed} Impressum tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
