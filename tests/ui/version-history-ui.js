'use strict';
// Version history: focus moves into the dialog (onto Close), Tab stays inside it, and closing returns focus to the account button.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }) });
  const browser = await chromium.launch();
  try {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room: null, view: null }] });
    await page.goto(url + '/');
    await page.waitForSelector('.tb-avatar-btn', { timeout: 8000 });
    await page.click('.tb-avatar-btn');
    await page.click('[data-act="openVersionHistory"]', { timeout: 5000 });
    await page.waitForSelector('#modal-overlay [role="dialog"]', { timeout: 5000 });
    assert.ok(await page.$('#modal-overlay .wn-release h3 small'), 'releases show their version in the heading');
    const onClose = () => page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-modal-close'));
    assert.ok(await onClose(), 'focus starts on Close');
    await page.keyboard.press('Tab');
    assert.ok(await onClose(), 'Tab keeps focus on Close');
    await page.keyboard.press('Shift+Tab');
    assert.ok(await onClose(), 'Shift+Tab keeps focus on Close');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#modal-overlay', { state: 'detached', timeout: 5000 });
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('tb-avatar-btn')), 'focus returns to the account button');
    console.log('  ok  Version history focus: Close, Tab trap, return focus');
    await ctx.close();
  } catch (e) { console.error('FAIL\n' + e.stack); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
