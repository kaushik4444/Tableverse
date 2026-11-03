'use strict';
// Redraws must not eat what the person is typing, and identical updates must not rebuild the screen.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const table = (code) => ({ code, gameId: 'wizard', host: 'Bo', seats: 4, members: 1, humans: 1, spectators: 0 });

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (hash) => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [] })] });
    await page.goto(url + '/' + hash);
    await page.waitForSelector('#friendSearch', { timeout: 8000 });
    return { page, ctx };
  };

  await test('text typed in the friend search survives a redraw, with focus and cursor', async () => {
    const { page, ctx } = await open('#friends');
    await page.fill('#friendSearch', 'priya');
    await page.focus('#friendSearch');
    await page.evaluate(() => window.__push({ t: 'tables', tables: [{ code: 'QWERTY', gameId: 'wizard', host: 'Bo', seats: 4, members: 1, humans: 1, spectators: 0 }], rejoin: [] }));
    await page.waitForTimeout(100);
    assert.equal(await page.inputValue('#friendSearch'), 'priya');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'friendSearch');
    await ctx.close();
  });

  await test('an identical directory update does not rebuild the screen; a changed one does', async () => {
    const { page, ctx } = await open('#friends');
    const push = (tables) => page.evaluate((t) => window.__push({ t: 'tables', tables: t, rejoin: [] }), tables);
    await push([table('AAAAAA')]);
    await page.waitForTimeout(60);
    await page.evaluate(() => { document.querySelector('#app').firstElementChild.dataset.marker = 'kept'; });
    await push([table('AAAAAA')]);
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => document.querySelector('#app').firstElementChild.dataset.marker), 'kept', 'same data: same DOM');
    await push([table('BBBBBB')]);
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => document.querySelector('#app').firstElementChild.dataset.marker), undefined, 'new data: redrawn');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
