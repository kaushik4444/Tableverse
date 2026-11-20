'use strict';
// Carrom in a real browser: the board and pieces, dragging on the board to aim, the striker slider, the Flick action, four
// seats and each seat's view, the shot playback, the game-over sheet and a phone-width layout.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const E = require('../../games/carrom/engine');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ id: 'p0', name: 'Ann' }, { id: 'p1', name: 'Bo' }, { id: 'p2', name: 'Cy' }, { id: 'p3', name: 'Di' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const fresh = (n = 4) => E.createGame(four.slice(0, n));
/** welcome + the table as seen by `viewer`; `later` are states sent after it, in order. */
function msgsFor(g, viewer = 'p0', later = []) {
  const m = tableMessages('carrom', four.map((p) => ({ id: p.id, name: p.name })));
  m[1].view = E.viewFor(g, viewer);
  return [m[0], m[1], ...later.map((gg) => ({ t: 'state', room: m[1].room, view: E.viewFor(gg, viewer) }))];
}
const box = (page, sel) => page.locator(sel).first().boundingBox();

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (m, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages: m, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.cb-svg', { timeout: 8000 });
    return { page, ctx };
  };

  await test('board: 18 coins and the queen on the opening layout, the striker on my turn, the whole board on screen', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    assert.equal(await page.locator('.cb-coin').count(), 18);
    assert.equal(await page.locator('.cb-queen').count(), 1);
    assert.equal(await page.locator('.cb-striker').count(), 1);
    const onScreen = await page.evaluate(() => { const s = document.querySelector('.cb-svg').getBoundingClientRect(); const b = document.querySelector('.cb-board').getBoundingClientRect(); return b.x >= s.x - 1 && b.y >= s.y - 1 && b.right <= s.right + 1 && b.bottom <= s.bottom + 1 && b.height > 200; });
    assert.equal(onScreen, true, 'the board is drawn inside the table area');
    assert.match(await page.textContent('.wz-status'), /Your turn/);
    await ctx.close();
  });

  await test('four seats: each shows its colour, its team’s score and whose turn it is', async () => {
    const { page, ctx } = await open(msgsFor(fresh(4)));
    assert.equal(await page.locator('.cb-seat').count(), 4);
    assert.match(await page.textContent('.cb-seat.turn'), /Ann/);
    assert.match(await page.textContent('.cb-seat:nth-child(2)'), /Black/);
    await ctx.close();
  });

  await test('dragging on the board aims: pulling back to the left of the striker flicks to the right, and Flick sends it', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    // the flick goes from the pointer towards the striker: pull down and to the left, so the shot goes up and to the right
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 40, sy + 90, { steps: 6 });
    await page.mouse.up();
    const angle = Number((await page.textContent('[data-out="angle"]')).replace('°', ''));
    const power = Number((await page.textContent('[data-out="power"]')).replace('%', ''));
    assert.ok(angle > 0, `the flick goes to the player’s right (angle ${angle})`);
    assert.ok(power > 0, `the drag sets a power (${power}%)`);
    assert.equal(await page.isDisabled('[data-cb="flick"]'), false);
    await page.click('[data-cb="flick"]');
    const a = (await sent(page)).at(-1).action;
    assert.equal(a.type, 'flick');
    assert.ok(a.angle > 0 && a.power > 0);
    await ctx.close();
  });

  await test('dragging forward of the striker (no pull back) sets no power, and Flick is disabled', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx, sy - 80, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.textContent('[data-out="power"]'), '0%');
    assert.equal(await page.isDisabled('[data-cb="flick"]'), true);
    await ctx.close();
  });

  await test('the striker slider moves the striker along the baseline', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const before = await page.getAttribute('.cb-striker', 'cx');
    await page.evaluate(() => { const el = document.querySelector('[data-aim="x"]'); el.value = '70'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const after = await page.getAttribute('.cb-striker', 'cx');
    assert.notEqual(before, after);
    assert.equal(await page.textContent('[data-out="x"]'), '70%');
    await page.click('[data-cb="flick"]');
    assert.equal((await sent(page)).at(-1).action.x, 0.7);
    await ctx.close();
  });

  await test('each seat sees its own side at the bottom: the striker is on the lower half for all four viewers', async () => {
    for (const viewer of ['p0', 'p1', 'p2', 'p3']) {
      const g = fresh();
      g.turn = Number(viewer.slice(1));
      const { page, ctx } = await open(msgsFor(g, viewer));
      const low = await page.evaluate(() => { const s = document.querySelector('.cb-svg').getBoundingClientRect(); const st = document.querySelector('.cb-striker').getBoundingClientRect(); return st.y > s.y + s.height / 2; });
      assert.equal(low, true, `${viewer}: striker on the near side`);
      await ctx.close();
    }
  });

  await test('not my turn: no controls, the status names the seat to play, and the coins are still shown', async () => {
    const g = fresh(); g.turn = 1;
    const { page, ctx } = await open(msgsFor(g, 'p0'));
    assert.equal(await page.locator('[data-aim]').count(), 0);
    assert.equal(await page.locator('.cb-striker').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo is aiming/);
    assert.equal(await page.locator('.cb-coin').count(), 18);
    await ctx.close();
  });

  await test('shot playback: controls are hidden while a shot plays, then the board is redrawn for the next seat', async () => {
    const g = fresh();
    const first = msgsFor(g, 'p0');
    assert.equal(E.applyAction(g, 'p0', { type: 'flick', x: 0.5, angle: 0, power: 0.05 }).ok, true);
    const { page, ctx } = await scriptedPage(browser, { messages: [first[0], first[1], { t: 'state', room: first[1].room, view: E.viewFor(g, 'p0') }], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('.cb-svg', { timeout: 8000 });
    await page.waitForFunction(() => /Shot in play/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 4000 });
    assert.equal(await page.locator('.cb-flick').count(), 0, 'no Flick while the shot plays');
    await page.waitForFunction(() => /is aiming/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.locator('.cb-coin').count(), 18, 'the board is redrawn after the shot');
    await ctx.close();
  });

  await test('game over: the winning team sees they won, and the other team sees they lost', async () => {
    const g = fresh();
    E.applyAction(g, 'p0', { type: 'resign' });
    const { page, ctx } = await open(msgsFor(g, 'p1'));
    assert.match(await page.textContent('.overlay'), /You won/);
    await ctx.close();
    const l = await open(msgsFor(g, 'p0'));
    assert.match(await l.page.textContent('.overlay'), /Bo & Di won/);
    await l.ctx.close();
  });

  await test('phone width (375px): the board is on screen, the controls fit, and the page does not scroll sideways', async () => {
    const { page, ctx } = await open(msgsFor(fresh()), { width: 375, height: 667 });
    const s = await box(page, '.cb-svg');
    assert.ok(s.x >= 0 && s.x + s.width <= 375, `board ${s.width}px wide fits the screen`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no horizontal scroll');
    const btn = await box(page, '[data-cb="flick"]');
    assert.ok(btn.height >= 40, 'the Flick button is a comfortable tap target');
    await ctx.close();
  });

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} carrom UI tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
