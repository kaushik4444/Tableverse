'use strict';
// Wizard and Twenty-Nine: on a tall phone a seat keeps its box when its status line appears or goes (neighbours must not move).
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const cases = [['wizard', 3], ['twentynine', 4]];
  for (const [id, n] of cases) {
    await test(`${id}: the seats keep their size when the table changes (393 by 852)`, async () => {
      const extras = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }].slice(0, n);
      const a = tableMessages(id, extras, { seed: 1 });
      const b = tableMessages(id, extras, { seed: 7 });
      const { page, ctx } = await scriptedPage(browser, { messages: a, viewport: { width: 393, height: 852 } });
      await page.goto(url + '/');
      await page.waitForSelector('.wz', { timeout: 8000 });
      await page.waitForTimeout(500);
      const sizes = () => page.evaluate(() => [...document.querySelectorAll('.pt-seat')].map((s) => Math.round(s.getBoundingClientRect().height)));
      const before = await sizes();
      await page.evaluate((m) => window.__push(m), b[1]);
      await page.waitForTimeout(700);
      assert.deepEqual(await sizes(), before, 'every seat keeps its height');
      await ctx.close();
    });
  }
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
