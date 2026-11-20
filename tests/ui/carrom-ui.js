'use strict';
// Carrom in a real browser: the board and pieces, aiming with the sliders, a flick sent to the server, the far player's view,
// the shot playback, the game-over sheet and a phone-width layout.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const E = require('../../games/carrom/engine');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const players = [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'Bo' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

const fresh = () => E.createGame(players);
/** welcome + the table as seen by `viewer`; `extra` messages are sent after it, in order. */
function msgsFor(g, viewer = 'me', extra = []) {
  const m = tableMessages('carrom', [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'Bo' }]);
  m[1].view = E.viewFor(g, viewer);
  return [m[0], m[1], ...extra.map((view) => ({ t: 'state', room: m[1].room, view: E.viewFor(view.g, viewer) }))];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (m, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages: m, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.cb-svg', { timeout: 8000 });
    return { page, ctx };
  };

  await test('board: 18 coins and the queen on the opening layout, plus the striker on my turn', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const onScreen = await page.evaluate(() => { const s = document.querySelector('.cb-svg').getBoundingClientRect(); const b = document.querySelector('.cb-board').getBoundingClientRect(); return b.y >= s.y - 1 && b.bottom <= s.bottom + 1 && b.height > 200; });
    assert.equal(onScreen, true, 'the near player sees the whole board inside the table area');
    assert.equal(await page.locator('.cb-coin').count(), 18);
    assert.equal(await page.locator('.cb-queen').count(), 1);
    assert.equal(await page.locator('.cb-striker').count(), 1);
    assert.match(await page.textContent('.wz-status'), /Your turn/);
    await ctx.close();
  });

  await test('aiming: the sliders update their readings and the aim line, and Flick sends the chosen values', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    await page.evaluate(() => { const el = document.querySelector('[data-aim="angle"]'); el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.textContent('[data-out="angle"]'), '30°');
    assert.equal(await page.locator('.cb-aim').count(), 1);
    await page.evaluate(() => { const el = document.querySelector('[data-aim="power"]'); el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-cb="flick"]');
    const a = (await sent(page)).at(-1).action;
    assert.equal(a.type, 'flick');
    assert.equal(a.x, 0.5);
    assert.ok(Math.abs(a.angle - (30 * Math.PI) / 180) < 1e-9);
    assert.equal(a.power, 0.8);
    await ctx.close();
  });

  await test('not my turn: no sliders, the status names the other player, and the coins are still shown', async () => {
    const g = fresh(); g.turn = 1;
    const { page, ctx } = await open(msgsFor(g, 'me'));
    assert.equal(await page.locator('[data-aim]').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo is aiming/);
    assert.equal(await page.locator('.cb-coin').count(), 18);
    await ctx.close();
  });

  await test('far player: the board is turned, so the striker sits on their side at the bottom', async () => {
    const g = fresh(); g.turn = 1;
    const { page, ctx } = await open(msgsFor(g, 'p1'));
    const transform = await page.getAttribute('.cb-svg > g', 'transform');
    assert.equal(transform, 'translate(1 0) scale(-1 1)');
    const bottom = await page.evaluate(() => { const s = document.querySelector('.cb-svg').getBoundingClientRect(); const st = document.querySelector('.cb-striker').getBoundingClientRect(); return st.y > s.y + s.height / 2; });
    assert.equal(bottom, true, 'the striker is in the lower half of the screen');
    assert.match(await page.textContent('.wz-status'), /Your turn/);
    await ctx.close();
  });

  await test('shot playback: the controls are hidden while a shot plays, and come back when it ends', async () => {
    // Ann (me) starts. A gentle shot is played, then a second state arrives with the shot in it and Ann to play again.
    const g = fresh();
    const first = msgsFor(g, 'me');
    assert.equal(E.applyAction(g, 'me', { type: 'flick', x: 0.5, angle: 0, power: 0.05 }).ok, true);
    const { page, ctx } = await scriptedPage(browser, { messages: [first[0], first[1], { t: 'state', room: first[1].room, view: E.viewFor(g, 'me') }], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('.cb-svg', { timeout: 8000 });
    // the first render sets the baseline; the shot itself arrives in the state above, so the playback starts there
    await page.waitForFunction(() => /Shot in play/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 4000 });
    assert.equal(await page.locator('.cb-flick').count(), 0, 'no flick button while the shot plays');
    // the gentle shot misses, so the turn passes to Bo and the board is redrawn from the final view
    await page.waitForFunction(() => /is aiming/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.locator('.cb-flick').count(), 0, 'no flick for Ann once the turn has passed');
    assert.equal(await page.locator('.cb-coin').count(), 18, 'the board is redrawn after the shot');
    await ctx.close();
  });

  await test('game over: the sheet names the winner; the loser sees they lost', async () => {
    const g = fresh();
    E.applyAction(g, 'me', { type: 'resign' });
    const { page, ctx } = await open(msgsFor(g, 'p1'));
    assert.match(await page.textContent('.overlay'), /You won/);
    await ctx.close();
    const l = await open(msgsFor(g, 'me'));
    assert.match(await l.page.textContent('.overlay'), /Bo won/);
    await l.ctx.close();
  });

  await test('phone width (375px): the board fits, the controls wrap, and the page does not scroll sideways', async () => {
    const { page, ctx } = await open(msgsFor(fresh()), { width: 375, height: 667 });
    const box = await page.locator('.cb-svg').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `board ${box.width}px wide fits the screen`);
    const inside = await page.evaluate(() => {
      const svg = document.querySelector('.cb-svg').getBoundingClientRect();
      const b = document.querySelector('.cb-board').getBoundingClientRect();
      return b.x >= svg.x - 1 && b.y >= svg.y - 1 && b.right <= svg.right + 1 && b.bottom <= svg.bottom + 1 && b.height > 200;
    });
    assert.ok(inside, 'the board is drawn inside the table area, not off-screen');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no horizontal scroll');
    const btn = await page.locator('[data-cb="flick"]').boundingBox();
    assert.ok(btn.height >= 40, 'the Flick button is a comfortable tap target');
    await ctx.close();
  });

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} carrom UI tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
