'use strict';
// Colour Clash: the colour chips keep their width when the colour named on them changes (a neighbour must not move sideways).
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  await test('colour chips keep their size when the table changes (393 by 852)', async () => {
    const extras = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }];
    const a = tableMessages('colorclash', extras, { seed: 1 });
    const b = tableMessages('colorclash', extras, { seed: 7 });
    const { page, ctx } = await scriptedPage(browser, { messages: a, viewport: { width: 393, height: 852 } });
    await page.goto(url + '/');
    await page.waitForTimeout(800);
    const boxes = () => page.evaluate(() => [...document.querySelectorAll('.cc-chip')].map((s) => { const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)].join('x'); }));
    const before = await boxes();
    assert.ok(before.length > 0, 'the table shows colour chips');
    await page.evaluate((m) => window.__push(m), b[1]);
    await page.waitForTimeout(700);
    const after = await boxes();
    assert.deepEqual(after.slice(0, before.length), before, 'every chip keeps its size');
    await ctx.close();
  });
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
