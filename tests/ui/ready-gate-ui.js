'use strict';
// The Ready box under the table: it shows who the table waits for, is rebuilt as people press, and goes once everybody is ready.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const two = [{ name: 'Aarav' }, { name: 'Bo' }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (m) => {
    const { page, ctx } = await scriptedPage(browser, { messages: m });
    await page.goto(url + '/');
    await page.waitForSelector('.cc-game, .wz-status', { timeout: 8000 });
    return { page, ctx };
  };
  // the table is waiting for everybody: Aarav (me) has not pressed, Bo has not pressed
  const waiting = () => tableMessages('colorclash', two, { roomExtra: { status: 'playing', gate: { ready: [], waiting: ['me', 'p1'] } } });
  const base = () => waiting().find((x) => x.t === 'state');
  try {
    await test('the Ready box shows while people are still expected to press it', async () => {
      const { page, ctx } = await open(waiting());
      await page.waitForSelector('[data-ready-placed]', { timeout: 5000 });
      assert.match(await page.textContent('[data-ready-placed]'), /0 of 2 ready/);
      await ctx.close();
    });
    await test('when everybody has pressed, the Ready box goes and the status line comes back', async () => {
      const { page, ctx } = await open(waiting());
      await page.waitForSelector('[data-ready-placed]', { timeout: 5000 });
      // the gate closes: the room has no gate and the table is playing
      await page.evaluate((st) => window.__push({ t: 'state', room: { ...st.room, gate: null }, view: st.view }), base());
      await page.waitForFunction(() => !document.querySelector('[data-ready-placed]'), null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.querySelector('.wz-status') && document.querySelector('.wz-status').hidden), false, 'the status line is shown again');
      await ctx.close();
    });
    await test('the box is rebuilt as people press, so the count is never stale', async () => {
      const { page, ctx } = await open(waiting());
      await page.waitForSelector('[data-ready-placed]', { timeout: 5000 });
      await page.evaluate((st) => window.__push({ t: 'state', room: { ...st.room, gate: { ready: ['p1'], waiting: ['me'] } }, view: st.view }), base());
      await page.waitForFunction(() => /1 of 2 ready/.test((document.querySelector('[data-ready-placed]') || {}).textContent || ''), null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-ready-placed]').length), 1, 'one box, not a stack of them');
      await ctx.close();
    });
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\n${passed} ready-gate UI checks passed` + (failed ? `, ${failed} failed` : ''));
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
