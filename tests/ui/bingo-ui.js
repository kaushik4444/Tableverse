'use strict';
// Bingo in a real browser: your card, tapping a called number to mark it, the Bingo button, Mark for me, watchers and the result.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
/** A card number that is not the free square, so it can be called. */
const cardNumber = (view) => view.card.find((c) => !c.free).n;

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.bg', { timeout: 8000 });
    return { page, ctx };
  };

  await test('your card shows 25 squares with the middle one free, and Bingo is disabled at the start', async () => {
    const { page, ctx } = await open(tableMessages('bingo', four));
    assert.equal(await page.locator('.bg-card .bg-sq').count(), 25);
    assert.equal(await page.locator('.bg-card .bg-sq.free').count(), 1);
    assert.equal(await page.isDisabled('[data-bg="claim"]'), true);
    await ctx.close();
  });

  await test('tapping a called number on your card marks it with exactly that number', async () => {
    const msgs = tableMessages('bingo', four);
    const n = cardNumber(msgs[1].view);
    msgs[1].view.called = [n]; msgs[1].view.lastCall = n; msgs[1].view.lastLetter = null;
    const { page, ctx } = await open(msgs);
    await page.click(`[data-bg="mark"][data-n="${n}"]`);
    const acts = await sent(page);
    assert.deepEqual(acts.at(-1).action, { type: 'mark', n });
    await ctx.close();
  });

  await test('a number that has not been called is not tappable', async () => {
    const msgs = tableMessages('bingo', four);
    const n = cardNumber(msgs[1].view);
    msgs[1].view.called = []; msgs[1].view.lastCall = null;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator(`[data-bg="mark"][data-n="${n}"]`).count(), 0);
    await ctx.close();
  });

  await test('the Bingo button sends a claim when your card has a line', async () => {
    const msgs = tableMessages('bingo', four);
    msgs[1].view.canClaim = true;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.isDisabled('[data-bg="claim"]'), false);
    await page.click('[data-bg="claim"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'claim' });
    await ctx.close();
  });

  await test('Mark for me: nothing on the card is tappable', async () => {
    const msgs = tableMessages('bingo', four, { seed: 3 });
    const n = cardNumber(msgs[1].view);
    msgs[1].view.options.autoMark = true; msgs[1].view.called = [n];
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('[data-bg="mark"]').count(), 0);
    await ctx.close();
  });

  await test('a watcher sees the board and no card', async () => {
    const msgs = tableMessages('bingo', four);
    msgs[1].view.me = -1; msgs[1].view.card = [];
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.bg-card').count(), 0);
    assert.match(await page.textContent('.bg'), /watching/);
    assert.equal(await page.locator('.bg-board .bg-n').count(), 75);
    await ctx.close();
  });

  await test('when the game is over the result names the winner; the host can play again', async () => {
    const msgs = tableMessages('bingo', four);
    msgs[1].view.phase = 'gameOver'; msgs[1].view.winners = [1];
    const { page, ctx } = await open(msgs);
    assert.match(await page.textContent('.bg-result'), /Bo/);
    assert.equal(await page.locator('[data-bg="again"]').count(), 1);
    await ctx.close();
  });

  await test('the called-numbers board shows each called number as lit', async () => {
    const msgs = tableMessages('bingo', four);
    msgs[1].view.called = [1, 16, 75]; msgs[1].view.lastCall = 75;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.bg-board .bg-n.on').count(), 3);
    assert.equal(await page.locator('.bg-board .bg-n.last').count(), 1);
    await ctx.close();
  });

  await server.close();
  await browser.close();
  console.log(failed ? `${failed} failed, ${passed} passed` : `bingo UI: all ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
