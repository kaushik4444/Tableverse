'use strict';
// A registered player can be reported from their table card (not only from a chat message). The card offers a reason
// menu, sends one report for the chosen reason, and never offers it for a bot or for the viewer.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages } = require('./harness');

const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 12000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(100); } }

// Seat 0 is the viewer (signed in as aarav); Bo is a registered player; Robo is a bot.
const extras = [{ name: 'Aarav', username: 'aarav' }, { id: 'b', name: 'Bo', username: 'bo' }, { id: 'bot1', name: 'Robo', bot: true }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();

  /** A signed-in table with Bo (a registered player) and a bot at the table. */
  async function openTable() {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('wizard', extras) });
    await page.goto(url + '/');
    await page.waitForSelector('.pseat[data-pid="b"]', { timeout: 8000 });
    return { page, ctx };
  }

  /** Opens a seat's card and waits for it to be drawn for that player (a registered player's card loads its profile first). */
  async function openCard(page, pid, { loaded = pid !== 'bot1' } = {}) {
    await page.click(`.pseat[data-pid="${pid}"]`);
    await page.waitForSelector(`#modal-overlay .modal-body[data-card="${pid}"]`);
    if (loaded) await page.waitForSelector(`#modal-overlay .modal-body[data-card="${pid}"] [data-modal-act="cardReport"]`);
  }

  await test('a registered player’s card offers Report, and choosing a reason sends one report for that player', async () => {
    const { page, ctx } = await openTable();
    await openCard(page, 'b');
    await page.click('[data-modal-act="cardReport"]');
    await page.waitForSelector('.report-menu');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.reason), 'harassment', 'opening the menu focuses its first reason');
    await page.click('[data-modal-act="cardReportSend"][data-reason="spam"]');
    await until(async () => (await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer'))).length === 1, 'report sent');
    const [sent] = await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer'));
    assert.deepEqual(sent, { t: 'reportPlayer', id: 'b', reason: 'spam' });
    assert.equal(await page.locator('.report-menu').count(), 0, 'the reason menu closes after sending');
    await ctx.close();
  });

  await test('the reason menu can be cancelled, and cancelling sends nothing', async () => {
    const { page, ctx } = await openTable();
    await openCard(page, 'b');
    await page.click('[data-modal-act="cardReport"]');
    await page.waitForSelector('.report-menu');
    await page.click('.report-menu [data-modal-act="cardReport"]'); // the menu's Cancel
    assert.equal(await page.locator('.report-menu').count(), 0, 'Cancel closes the menu');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.modalAct), 'cardReport', 'Cancel returns focus to Report');
    assert.equal(await page.evaluate(() => window.__sent.filter((m) => m.t === 'reportPlayer').length), 0, 'nothing was sent');
    await ctx.close();
  });

  await test('a bot’s card does not offer Report', async () => {
    const { page, ctx } = await openTable();
    await openCard(page, 'bot1');
    assert.equal(await page.locator('[data-modal-act="cardReport"]').count(), 0);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
