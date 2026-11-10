'use strict';
// The current game settings appear at the top right of every game, and tapping them lists each setting with its choice.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

const GAMES = ['ludo', 'gofish', 'wizard', 'themind', 'snakesladders', 'propertyrivals'];
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let passed = 0; let failed = 0;
  for (const gameId of GAMES) {
    try {
      const { page, ctx } = await scriptedPage(browser, { messages: tableMessages(gameId, four) });
      await page.goto(url + '/');
      await page.waitForSelector('.gs-chip', { timeout: 8000 });
      const label = await page.getAttribute('.gs-chip', 'aria-label');
      assert.match(label, /^Game settings: /, gameId);
      await page.click('.gs-chip');
      const body = await page.textContent('.gs-list');
      assert.ok(body && body.length > 0, gameId + ' lists its settings');
      // focus moves into the dialog, and Tab stays on its close button rather than reaching the game behind
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-modal-close'));
      assert.ok(focused, gameId + ' focuses the dialog close button');
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-modal-close')), gameId + ' keeps Tab in the dialog');
      // closing returns focus to the settings chip
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('gs-chip')), gameId + ' returns focus to the chip on close');
      // Space on the focused chip opens the settings, and does not fall through to a game's Space shortcut
      await page.keyboard.press('Space');
      await page.waitForSelector('.gs-list', { timeout: 2000 });
      assert.ok(await page.isVisible('.gs-list'), gameId + ' opens settings with Space on the chip');
      await ctx.close();
      passed++; console.log(`  ok  ${gameId}: settings chip and full list`);
    } catch (e) {
      failed++; console.error(`FAIL  ${gameId}\n${e.message}`);
    }
  }
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
