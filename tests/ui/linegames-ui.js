'use strict';
// Tic-Tac-Toe, Four in a Row and Five in a Row in a real browser: tapping, previewing, wins, draws, spectators, small screens.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const two = [{ name: 'Aarav' }, { name: 'Bo' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  // Seed 1 may give the first move to either seat: make it ours (and let tests flip it).
  const msgs = (id, fn) => { const m = tableMessages(id, two); const v = m[1].view; v.turn = 0; v.myTurn = true; v.legal = id === 'fourinarow' ? [35, 36, 37, 38, 39, 40, 41] : v.board.map((_, k) => k); if (fn) fn(v); return m; };
  const open = async (m, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages: m, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.lg', { timeout: 8000 });
    return { page, ctx };
  };

  await test('tic-tac-toe: 9 squares, a tap sends the square, taken squares are disabled', async () => {
    const { page, ctx } = await open(msgs('tictactoe', (v) => { v.board[4] = 1; v.legal = v.legal.filter((k) => k !== 4); }));
    assert.equal(await page.locator('.lg-cell').count(), 9);
    assert.match(await page.textContent('.wz-status'), /Your move/);
    assert.equal(await page.isDisabled('[data-cell="4"]'), true);
    await page.click('[data-cell="0"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'place', cell: 0 });
    await ctx.close();
  });

  await test('not your turn: squares are disabled and it names who is thinking', async () => {
    const { page, ctx } = await open(msgs('tictactoe', (v) => { v.turn = 1; v.myTurn = false; v.legal = []; }));
    assert.equal(await page.locator('.lg-cell:not(:disabled)').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo is thinking/);
    await ctx.close();
  });

  await test('four in a row: 7 columns of 6, a tap on a column sends a drop, full columns are disabled', async () => {
    const { page, ctx } = await open(msgs('fourinarow', (v) => { v.legal = [35, 36, 37, 38, 39, 40]; }));
    assert.equal(await page.locator('.lg-col').count(), 7);
    assert.equal(await page.locator('.lg-col .lg-cell').count(), 42);
    assert.equal(await page.isDisabled('[data-col="6"]'), true);
    await page.click('[data-col="2"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'drop', col: 2 });
    await ctx.close();
  });

  await test('five in a row: 225 points, the first tap previews, the second tap or Place sends', async () => {
    const { page, ctx } = await open(msgs('fiveinarow'));
    assert.equal(await page.locator('.lg-cell').count(), 225);
    assert.equal(await page.isDisabled('[data-lg="place"]'), true);
    await page.click('[data-cell="112"]');
    assert.equal((await sent(page)).length, 0, 'a first tap only previews');
    assert.equal(await page.locator('.lg-piece.ghost').count(), 1);
    await page.click('[data-lg="place"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'place', cell: 112 });
    await page.click('[data-cell="113"]'); await page.click('[data-cell="113"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'place', cell: 113 });
    await ctx.close();
  });

  await test('a win highlights the line and shows the result; a draw says so', async () => {
    const w = await open(msgs('tictactoe', (v) => { v.board = [0, 0, 0, 1, 1, null, null, null, null]; v.phase = 'gameOver'; v.winner = 0; v.line = [0, 1, 2]; v.myTurn = false; v.legal = []; }));
    assert.equal(await w.page.locator('.lg-cell.win').count(), 3);
    assert.match(await w.page.textContent('.overlay'), /You won/);
    await w.ctx.close();
    const d = await open(msgs('tictactoe', (v) => { v.phase = 'gameOver'; v.winner = null; v.draw = true; v.myTurn = false; v.legal = []; }));
    assert.match(await d.page.textContent('.overlay'), /A draw/);
    await d.ctx.close();
  });

  await test('spectators cannot move; every game fits a phone without sideways scroll', async () => {
    for (const id of ['tictactoe', 'fourinarow', 'fiveinarow']) {
      const { page, ctx } = await open(msgs(id, (v) => { v.me = -1; v.myTurn = false; v.legal = []; }), { width: 360, height: 740 });
      assert.equal(await page.locator('.lg-cell:not(:disabled):not(.lg-gravity .lg-cell)').count(), 0, id);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${id}: no horizontal scroll`);
      const b = await page.locator('.lg-board').boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= 361, `${id}: board inside the screen`);
      await ctx.close();
    }
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
