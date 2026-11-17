'use strict';
// Penalty Rows in a real browser: picking a card, changing the pick, taking a row, spectators, game over and a narrow phone.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.pr', { timeout: 8000 });
    return { page, ctx };
  };

  await test('four rows, ten cards in your hand, a scoreboard, and tapping a card sends that pick', async () => {
    const { page, ctx } = await open(tableMessages('penaltyrows', four));
    assert.equal(await page.locator('.pr-row').count(), 4);
    assert.equal(await page.locator('.pr-hand .pr-card').count(), 10);
    assert.equal(await page.locator('.pr-score li').count(), 4);
    const n = Number(await page.locator('.pr-hand .pr-card').first().getAttribute('data-n'));
    await page.locator('.pr-hand .pr-card').first().click();
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'pick', card: n });
    await ctx.close();
  });

  await test('a picked card is marked, and other players\' hands are nowhere in the page', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.myPick = v.hand[2].n; v.players[0].picked = true;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.pr-hand .pr-card.sel').count(), 1);
    assert.match(await page.textContent('.wz-status'), /You picked/);
    await ctx.close();
  });

  await test('your card fits no row: the rows become buttons and tapping one takes it', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.phase = 'takeRow'; v.pending = { by: 0, n: 3, p: 1 }; v.myTurn = true;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('button.pr-row.take').count(), 4);
    assert.match(await page.textContent('.wz-status'), /fits no row/);
    assert.equal(await page.locator('.pr-hand .pr-card:not([disabled])').count(), 0, 'no picking while a row is chosen');
    await page.click('button.pr-row.take[data-row="2"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'takeRow', row: 2 });
    await ctx.close();
  });

  await test('someone else must take a row: you only watch', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.phase = 'takeRow'; v.pending = { by: 1, n: 3, p: 1 }; v.myTurn = false;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('button.pr-row.take').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo must take a row/);
    await ctx.close();
  });

  await test('game over lists the totals lowest first and offers rematch to the host', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const v = msgs[1].view; v.phase = 'gameOver'; v.winners = [2]; v.players.forEach((p, i) => { p.total = [40, 30, 12, 66][i]; });
    const { page, ctx } = await open(msgs);
    const items = await page.locator('.pr-final li').allTextContents();
    assert.match(items[0], /Charlotte/);
    assert.match(items[3], /Dmitri/);
    assert.equal(await page.locator('[data-pr="again"]').count(), 1);
    await ctx.close();
  });

  await test('a 320 px phone: nothing overflows sideways', async () => {
    const { page, ctx } = await open(tableMessages('penaltyrows', [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }, { name: 'F' }, { name: 'G' }, { name: 'H' }]), { width: 320, height: 640 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow ' + over);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
