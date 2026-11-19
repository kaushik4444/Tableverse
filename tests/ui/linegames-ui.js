'use strict';
// Tic-Tac-Toe and Four in a Row (four or five) in a real browser: tapping, wins, draws, spectators, small screens.
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

  await test('five in a row option: a 9x8 grid of columns and the header says five', async () => {
    const E = require('../../games/linegames/engine');
    const m = msgs('fourinarow'); const g = E.createGame('fourinarow', [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'Bo' }], { starter: 'host', line: '5' }, () => 0.1);
    m[1].view = E.viewFor(g, 'me');
    const { page, ctx } = await open(m);
    assert.equal(await page.locator('.lg-col').count(), 9);
    assert.equal(await page.locator('.lg-col .lg-cell').count(), 72);
    assert.match(await page.textContent('.wz-round'), /Five in a Row/);
    await page.click('[data-col="8"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'drop', col: 8 });
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
    for (const id of ['tictactoe', 'fourinarow']) {
      const { page, ctx } = await open(msgs(id, (v) => { v.me = -1; v.myTurn = false; v.legal = []; }), { width: 360, height: 740 });
      assert.equal(await page.locator('.lg-cell:not(:disabled):not(.lg-gravity .lg-cell)').count(), 0, id);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${id}: no horizontal scroll`);
      const b = await page.locator('.lg-board').boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= 361, `${id}: board inside the screen`);
      await ctx.close();
    }
  });

  // A move arrives after the page is open: the same message with the mark on the board and a new event.
  const moveMsg = (m, cell, by, type = 'move') => {
    const msg = JSON.parse(JSON.stringify(m[1]));
    msg.view.board[cell] = by; msg.view.last = cell; msg.view.event = { seq: 50, type, by, cell };
    msg.view.legal = msg.view.legal.filter((k) => k !== cell);
    return msg;
  };
  const sizes = (page) => page.evaluate(() => [...document.querySelectorAll('.lg-cell')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));

  await test('tic-tac-toe: squares keep exactly the same size as marks are placed, on every screen size', async () => {
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
      const m = msgs('tictactoe', () => {});
      const { page, ctx } = await open(m, viewport);
      const empty = await sizes(page);
      assert.equal(new Set(empty.map((s) => s.join('x'))).size, 1, `${viewport.width}: nine equal squares`);
      for (const [cell, by] of [[4, 0], [0, 1], [8, 0], [2, 1], [6, 0], [3, 1]]) {
        await page.evaluate((x) => window.__push(x), moveMsg(m, cell, by));
        m[1].view.board[cell] = by; // the next message builds on the board so far
        await page.waitForTimeout(60);
        assert.deepEqual(await sizes(page), empty, `${viewport.width}: squares unchanged after a mark in ${cell}`);
      }
      assert.ok(await page.locator('.lg-glyph').count() >= 6, 'marks are drawn as shapes inside their squares');
      await ctx.close();
    }
  });

  await test('a new move animates once and plays its own sound; a redraw of the same position does not restart it', async () => {
    for (const [id, sound, selector] of [['tictactoe', 'place', '.lg-cell.enter .lg-glyph path, .lg-cell.enter .lg-glyph circle'], ['fourinarow', 'fall', '.lg-cell.enter .lg-piece']]) {
      const m = msgs(id, () => {});
      const { page, ctx } = await open(m);
      await page.evaluate(() => { window.__sounds = []; window.CardTable.sound.play = (n) => window.__sounds.push(n); });
      const cell = id === 'fourinarow' ? 38 : 4;
      await page.evaluate((x) => window.__push(x), moveMsg(m, cell, 0));
      await page.waitForSelector(selector, { timeout: 2000 });
      assert.ok((await page.evaluate((q) => getComputedStyle(document.querySelector(q)).animationName, selector)).match(/lg-(drop|draw)/), `${id}: the new mark is animated`);
      assert.ok((await page.evaluate(() => window.__sounds)).includes(sound), `${id}: plays the ${sound} sound`);
      const first = (await page.evaluate(() => window.__sounds)).length;
      await page.evaluate((x) => window.__push(x), moveMsg(m, cell, 0)); // the same event again: nothing new
      assert.equal((await page.evaluate(() => window.__sounds)).length, first, `${id}: the same event does not play again`);
      await ctx.close();
    }
  });

  await test('a disc really falls from above its square (and lands); a redraw in the middle continues the animation instead of restarting it', async () => {
    const m = msgs('fourinarow', () => {});
    const { page, ctx } = await open(m);
    await page.evaluate(() => { window.__sounds = []; window.CardTable.sound.play = (n) => window.__sounds.push(n); });
    await page.evaluate((x) => window.__push(x), moveMsg(m, 38, 0)); // the bottom row: the longest fall
    await page.waitForSelector('.lg-cell.enter .lg-piece');
    const offset = await page.evaluate(() => { const p = document.querySelector('.lg-cell.enter .lg-piece').getBoundingClientRect(); const c = document.querySelector('.lg-cell.enter').getBoundingClientRect(); return c.top - p.top; });
    assert.ok(offset > 100, `the disc starts well above its square (${Math.round(offset)}px)`);
    await page.waitForTimeout(350);
    await page.evaluate((x) => window.__push(x), moveMsg(m, 38, 0)); // a redraw of the same position, mid-fall
    const time = await page.evaluate(() => { const a = document.querySelector('.lg-cell.enter .lg-piece').getAnimations().find((x) => x.animationName === 'lg-drop'); return a ? a.currentTime : null; });
    assert.ok(time !== null && time > 250, `the fall continues from ${Math.round(time)} ms, it does not restart`);
    await page.waitForTimeout(900);
    const names = await page.evaluate(() => window.__sounds);
    assert.deepEqual(names.slice(0, 2), ['fall', 'land'], 'the fall sound now, the landing sound when it arrives');
    await ctx.close();
  });

  await test('every game renderer plays sounds (the trick games through the shared hook in app.js)', async () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '../../public/games');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.match(src, /sound|snd\./, `${f} uses sound`);
    }
    for (const name of ['card', 'deal', 'collect', 'turn', 'win', 'lose', 'place', 'fall', 'land']) {
      assert.match(fs.readFileSync(path.join(__dirname, '../../public/sound.js'), 'utf8'), new RegExp(`\\b${name}:`), `the ${name} sound exists`);
    }
  });

  await test('four in a row: the board keeps the shape of its grid (no empty space below the discs)', async () => {
    for (const [cols, rows] of [[7, 6]]) {
      const { page, ctx } = await open(msgs('fourinarow', () => {}), { width: 390, height: 700 });
      const b = await page.locator('.lg-board').boundingBox();
      assert.ok(Math.abs(b.height / b.width - rows / cols) < 0.08, `board is ${cols}x${rows}: ${Math.round(b.width)}x${Math.round(b.height)}`);
      const cells = await page.locator('.lg-gravity .lg-cell').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      assert.equal(new Set(cells).size, 1, 'every disc space has the same height');
      await ctx.close();
    }
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
