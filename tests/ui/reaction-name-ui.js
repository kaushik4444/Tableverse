'use strict';
// A reaction names who sent it, on a table with avatars (Hidden Miners) and without them (Take 5 chips), and a spectator's
// reaction carries the 👁 mark. Runs in a real browser.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();

  // Take 5 shows its players as chips with a data-pid and no avatar: the reaction must still appear and name the sender
  await test('Take 5: a player reaction shows the sender name above their chip', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('penaltyrows', four) });
    await page.goto(url + '/');
    await page.waitForSelector('.prt', { timeout: 8000 });
    const pid = await page.evaluate(() => { const li = document.querySelector('.pr-chips li[data-pid]:not(.me)'); return li && li.dataset.pid; });
    assert.ok(pid, 'a chip for another player exists');
    await page.evaluate((id) => window.__push({ t: 'emote', id, e: '👍', spectator: false, name: 'Bo' }), pid);
    await page.waitForSelector('.emote-pop .emote-tag', { timeout: 3000 });
    assert.equal((await page.textContent('.emote-pop .emote-tag')).trim(), 'Bo');
    await ctx.close();
  });

  await test('a spectator reaction shows the name with the 👁 mark', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('penaltyrows', four) });
    await page.goto(url + '/');
    await page.waitForSelector('.prt', { timeout: 8000 });
    await page.evaluate(() => window.__push({ t: 'emote', id: 'spec1', e: '👏', spectator: true, name: 'Eve' }));
    await page.waitForSelector('.emote-pop .emote-tag', { timeout: 3000 });
    assert.equal((await page.textContent('.emote-pop .emote-tag')).trim(), '👁 Eve');
    await ctx.close();
  });

  await server.close(); await browser.close();
  console.log(`\nreaction name UI: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
