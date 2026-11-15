'use strict';
// /privacy and /terms: shown only when LEGAL_PAGES_PUBLISHED=true AND the text has no owner placeholders left (fail closed).
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../server');
const legal = require('../lib/legalPages');

const guard = setTimeout(() => { console.error('FAIL legal pages test timed out'); process.exit(1); }, 60000);
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  console.log('legal pages');
  await test('the switch is on only for exactly "true"', async () => {
    assert.equal(legal.legalPagesPublished({}), false);
    assert.equal(legal.legalPagesPublished({ LEGAL_PAGES_PUBLISHED: 'yes' }), false);
    assert.equal(legal.legalPagesPublished({ LEGAL_PAGES_PUBLISHED: 'true' }), true);
  });

  await test('any owner or legal placeholder blocks the text, so an unapproved draft cannot render', async () => {
    assert.equal(legal.legalTextComplete('Contact: [OWNER: address not yet provided]'), false);
    assert.equal(legal.legalTextComplete('Basis: [LEGAL: confirm]'), false);
    assert.equal(legal.legalTextComplete('   '), false);
    assert.equal(legal.renderLegal('Contact: [OWNER: address]'), null);
    assert.equal(legal.legalTextComplete('Plain approved text with [brackets] of its own'), true);
  });

  await test('the text is escaped and only https links become links', async () => {
    const html = legal.renderLegal('# Hi\n\nSee **this** [site](https://playtableverse.com) and [bad](javascript:alert(1)) <script>x()</script>\n\n- one & two\n- three');
    assert.match(html, /<h1>Hi<\/h1>/);
    assert.match(html, /<strong>this<\/strong>/);
    assert.match(html, /<a href="https:\/\/playtableverse\.com" rel="noopener">site<\/a>/);
    assert.doesNotMatch(html, /href="javascript/i); // shown as plain text, never as a link
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<li>one &amp; two<\/li>/);
  });

  await test('the page is a noindex document with no script', async () => {
    const page = legal.legalPage('Privacy notice', '<p>x</p>');
    assert.match(page, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(page, /<script/i);
    assert.match(page, /<title>Privacy notice — Tableverse<\/title>/);
  });

  // Routes: off by default; on only when the text is complete.
  const srvOff = await start({ port: 0, trustProxy: false, env: { ...process.env }, matchLog: { log() {}, warn() {}, error() {} } });
  const srvOn = await start({ port: 0, trustProxy: false, legalPagesPublished: true, env: { ...process.env }, matchLog: { log() {}, warn() {}, error() {} } });
  const shipped = (name) => fs.readFileSync(path.join(__dirname, '..', 'lib', 'legal', name + '.md'), 'utf8');
  try {
    await test('with the switch off, /privacy and /terms answer 404 to everyone', async () => {
      for (const p of ['/privacy', '/terms']) {
        const res = await fetch(`http://127.0.0.1:${srvOff.port}${p}`, { redirect: 'manual' });
        assert.equal(res.status, 404, p);
      }
    });

    await test('with the switch on, the pages follow the shipped text: 200 only when it has no placeholders left', async () => {
      for (const [p, name] of [['/privacy', 'privacy'], ['/terms', 'terms']]) {
        const res = await fetch(`http://127.0.0.1:${srvOn.port}${p}`, { redirect: 'manual' });
        if (legal.legalTextComplete(shipped(name))) {
          assert.equal(res.status, 200, p);
          assert.match(res.headers.get('content-type') || '', /^text\/html/);
        } else {
          assert.equal(res.status, 404, p + ' must stay hidden while the text has placeholders');
        }
      }
    });

    await test('the raw draft files are never served from public/', async () => {
      const res = await fetch(`http://127.0.0.1:${srvOn.port}/legal/privacy.md`, { redirect: 'manual' });
      assert.equal(res.status, 404);
    });
  } finally {
    await srvOff.close();
    await srvOn.close();
    clearTimeout(guard);
  }
  console.log(`\n${passed} legal page tests passed`);
  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
})();
