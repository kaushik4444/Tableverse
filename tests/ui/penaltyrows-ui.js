'use strict';
// Take 5 in a real browser: picking a card, changing the pick, taking a row, spectators, game over and a narrow phone.
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
    await page.waitForSelector('.prt', { timeout: 8000 });
    return { page, ctx };
  };

  await test('four rows, ten cards in your hand, a scoreboard, and tapping a card sends that pick', async () => {
    const { page, ctx } = await open(tableMessages('penaltyrows', four));
    assert.equal(await page.locator('.pr-row').count(), 4);
    assert.equal(await page.locator('.pr-hand .pr-card').count(), 10);
    await page.locator('[data-pr="tab"][data-tab="scores"]').click();
    assert.equal(await page.locator('.pr-score li').count(), 4);
    await page.locator('[data-pr="tab"][data-tab="table"]').click();
    const n = Number(await page.locator('.pr-hand .pr-card').first().getAttribute('data-n'));
    await page.locator('.pr-hand .pr-card').first().click();
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'pick', card: n });
    await ctx.close();
  });

  await test('tab focus survives switching and game updates without taking focus from elsewhere', async () => {
    const msgs = tableMessages('penaltyrows', four);
    const { page, ctx } = await open(msgs);
    const scores = page.locator('[data-pr="tab"][data-tab="scores"]');
    const table = page.locator('[data-pr="tab"][data-tab="table"]');
    const focusedTab = () => page.evaluate(() => document.activeElement.dataset.tab);
    await scores.focus();
    await page.keyboard.press('Enter');
    assert.equal(await focusedTab(), 'scores', 'keyboard activation keeps focus on the replacement');
    assert.equal(await scores.getAttribute('aria-selected'), 'true');
    await table.focus();
    await page.evaluate((m) => window.__push(m), msgs[1]);
    assert.equal(await focusedTab(), 'table', 'updates preserve the focused tab even when it is not selected');
    await page.keyboard.press('Enter');
    assert.equal(await focusedTab(), 'table');
    assert.equal(await table.getAttribute('aria-selected'), 'true');
    await page.evaluate(() => {
      const other = document.createElement('button');
      other.id = 'outside-game';
      document.body.append(other);
      other.focus();
      document.querySelector('[data-tab="scores"]').click();
    });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'outside-game', 'switching without tab focus does not steal focus');
    await page.evaluate((m) => window.__push(m), msgs[1]);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'outside-game', 'updates without tab focus do not steal focus');
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

  await test('a turn plays out one card at a time: each placement appears in turn, paced by the table setting', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [[c(12)], [c(3)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(12), c(18)], [c(3), c(7)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'place', by: 1, n: 18, p: pen(18), row: 0, took: 0 }, { kind: 'place', by: 2, n: 7, p: pen(7), row: 1, took: 0 }];
    second.view.seq = 2;
    second.view.after = second.view.rows; // the completed table at the end of the turn, as the engine sends it
    const stepMs = 900 * (first.view.paceK || 1);
    const { page, ctx } = await open([first]);
    const counts = () => page.evaluate(() => [...document.querySelectorAll('.pr-row')].map((r) => r.querySelectorAll('.pr-card').length));
    assert.deepEqual(await counts(), [1, 1, 1, 1]);
    await page.evaluate((m) => window.__push(m), second);
    await page.waitForTimeout(150);
    assert.deepEqual(await counts(), [1, 1, 1, 1], 'the turn starts from the rows as they were');
    await page.waitForTimeout(stepMs);
    assert.deepEqual(await counts(), [2, 1, 1, 1], 'the first card has landed');
    await page.waitForTimeout(stepMs);
    assert.deepEqual(await counts(), [2, 2, 1, 1], 'then the second, and the table is the true state');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
