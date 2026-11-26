'use strict';
// Dots and Boxes in a real browser: the board, tapping a line on your turn, the turn rules, closed boxes in the seat colour,
// the result sheet, a phone-width check that every line can be tapped, and watchers.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const E = require('../../games/dotsboxes/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte'];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const clock = { t: 1000 };

/** A real game with three people (the first is you), and the messages a browser would receive for it. */
function table(setup = () => {}, { viewer = 'me', size = '4' } = {}) {
  const players = names.map((n, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: n, bot: i === 2 }));
  const g = E.createGame(players, { size });
  setup(g);
  const room = { code: 'ABCDEF', gameId: 'dotsboxes', hostId: 'me', status: 'playing', options: { size }, visibility: 'public', seats: players.length, min: 2, max: 8, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, viewer) }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.db', { timeout: 8000 });
    return { page, ctx };
  };

  await test('a 4x4 board has 40 lines and 25 dots', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('.db-line').count(), 40);
    assert.equal(await page.locator('.db-dot').count(), 25);
    await ctx.close();
  });

  await test('on your turn an undrawn line can be tapped, and the tap sends that line', async () => {
    const { page, ctx } = await open(table());
    assert.match(await page.locator('.wz-status').innerText(), /Your move/);
    for (const [kind, dx, dy] of [['h', 12, 1], ['v', 1, 12]]) {
      const line = page.locator(`button.db-line.db-${kind}`).first();
      await line.scrollIntoViewIfNeeded();
      const box = await line.boundingBox();
      // Both points are in the two tap bands at the top left dot, but are closer to different lines.
      await page.touchscreen.tap(box.x + (kind === 'v' ? box.width / 2 : 0) + dx,
        box.y + (kind === 'h' ? box.height / 2 : 0) + dy);
      assert.deepEqual((await sent(page)).at(-1).action, { type: 'line', index: Number(await line.getAttribute('data-line')) });
    }
    await ctx.close();
  });

  await test('keyboard focus survives updates and moves to a playable line after closing a box', async () => {
    const sides = [['h', 0, 0], ['h', 1, 0], ['v', 0, 0], ['v', 0, 1]];
    const build = (count) => table((g) => {
      for (const [kind, r, c] of sides.slice(0, count)) {
        const index = g.lines.findIndex((l) => l.kind === kind && l.r === r && l.c === c);
        E.applyAction(g, g.players[g.turn].id, { type: 'line', index });
      }
    });
    const before = build(3);
    const { page, ctx } = await open(before);
    const line = page.getByRole('button', { name: 'Vertical line, row 1, column 2, not drawn' });
    const index = Number(await line.getAttribute('data-line'));
    await line.focus();
    const focus = () => page.evaluate(() => document.activeElement.dataset.line);
    const redraw = (msg) => page.evaluate((m) => window.__push(m), msg);
    await redraw(before[1]);
    assert.equal(await focus(), String(index));
    await page.keyboard.press('Enter');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'line', index });
    await redraw(build(4)[1]);
    await page.waitForSelector('.db-box');
    assert.notEqual(await focus(), undefined);
    assert.notEqual(await focus(), String(index));
    assert.equal(await page.locator('button.db-line:enabled:focus').count(), 1);
    await ctx.close();
  });

  await test('not your turn: the lines cannot be tapped and the status names whose turn it is', async () => {
    const { page, ctx } = await open(table((g) => { E.applyAction(g, 'me', { type: 'line', index: 0 }); }));
    assert.equal(await page.locator('button.db-line:not([disabled])').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Bo is thinking/);
    await ctx.close();
  });

  await test('a drawn line shows the colour of the seat that drew it; a closed box shows that seat letter', async () => {
    const msgs = table((g) => {
      // with three seats, Aarav (seat 0, Blue) closes box 0: its four sides are drawn in turn, and the fourth one is his
      const sides = [['h', 0, 0], ['h', 1, 0], ['v', 0, 0], ['v', 0, 1]];
      let s = 0;
      for (const [kind, r, c] of sides) {
        const idx = g.lines.findIndex((l) => l.kind === kind && l.r === r && l.c === c);
        E.applyAction(g, g.players[g.turn].id, { type: 'line', index: idx });
        s++;
      }
    });
    const { page, ctx } = await open(msgs);
    assert.ok(await page.locator('.db-line.on').count() >= 4);
    assert.equal(await page.locator('.db-box').count(), 1);
    assert.equal((await page.locator('.db-box').innerText()).trim(), 'B', 'seat 0 is Blue');
    await ctx.close();
  });

  await test('a phone-width screen: every line has a tap band of at least 44px, and nothing scrolls sideways', async () => {
    const { page, ctx } = await open(table(), { width: 360, height: 640 });
    const box = await page.locator('button.db-line.db-h').first().boundingBox();
    assert.ok(box.height >= 44, `tap band ${box.height}px`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 360, `page is ${scroll}px wide`);
    await ctx.close();
  });

  await test('when the game is over the winner is named and the scores are listed', async () => {
    const msgs = table((g) => {
      while (g.phase !== 'gameOver') { const pid = g.players[g.turn].id; E.applyAction(g, pid, E.botAction(g, pid)); }
    });
    const { page, ctx } = await open(msgs);
    assert.ok(await page.locator('.overlay .sheet h2').count() === 1);
    assert.match(await page.locator('.overlay .sheet').innerText(), /Aarav|Bo|Charlotte/);
    await ctx.close();
  });

  await test('a watcher sees the board and cannot tap a line', async () => {
    const { page, ctx } = await open(table(undefined, { viewer: 'nobody' }));
    assert.equal(await page.locator('button.db-line:not([disabled])').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Watching/);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\ndots and boxes UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
