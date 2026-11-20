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
    const released = (await sent(page)).length; // the drag release already flicked once
    await page.click('[data-cb="flick"]');
    const sentNow = await sent(page);
    assert.equal(sentNow.length, released + 1, 'the Flick button itself sends a flick');
    const a = sentNow.at(-1).action;
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
    assert.equal(E.applyAction(g, 'p0', { seq: g.seq, type: 'flick', x: 0.5, angle: 0, power: 0.05 }).ok, true);
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

  /** A won game: the last coin of the winning team goes in, so the board goes to game over with the final shot. */
  function winningShot() {
    const g = fresh();
    g.coins = [{ id: 'w1', kind: 'coin', colour: 'w', x: 0.035, y: 0.035, r: 0.022 }]; // inside a pocket
    g.score = { w: 8, b: 0 }; g.queenHeld = 'w';
    const before = msgsFor(g, 'p0');
    E.applyAction(g, 'p0', { seq: g.seq, type: 'flick', x: 0.2, angle: 0, power: 0.05 });
    return { g, first: before[0], table: before[1], end: { t: 'state', room: before[1].room, view: E.viewFor(g, 'p0') } };
  }

  await test('game over: the result sheet waits for the final shot to finish playing, then appears', async () => {
    const { first, table, end } = winningShot();
    const { page, ctx } = await scriptedPage(browser, { messages: [first, table, end], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('.cb-svg', { timeout: 8000 });
    // the status already names the result, but the final shot is still moving: the sheet must not cover it yet
    await page.waitForFunction(() => /all nine/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 4000 });
    assert.equal(await page.locator('.overlay').count(), 0, 'no overlay over the board while the last shot is in play');
    await page.waitForSelector('.overlay', { timeout: 15000 });
    assert.match(await page.textContent('.overlay'), /You won/);
    await ctx.close();
  });

  await test('play again during the final shot: the new opening board and the Flick control show at once, with no old frame', async () => {
    const { first, table, end } = winningShot();
    const again = { t: 'state', room: table.room, view: E.viewFor(fresh(), 'p0') };
    const { page, ctx } = await scriptedPage(browser, { messages: [first, table, end], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForFunction(() => /all nine/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 8000 });
    // the host presses Play again while the final shot is still moving
    await page.evaluate((m) => window.__push(m), again);
    await page.waitForFunction(() => /Your turn/.test(document.querySelector('.wz-status')?.textContent || ''), null, { timeout: 4000 });
    assert.equal(await page.locator('.cb-coin').count(), 18, 'the opening coins, not the old frame');
    assert.equal(await page.locator('.cb-flick').count(), 1, 'the Flick control is there straight away');
    assert.equal(await page.locator('.overlay').count(), 0, 'no result sheet from the old match');
    await page.waitForTimeout(1200); // the old playback would have ended by now: nothing may change the new board
    assert.equal(await page.locator('.cb-flick').count(), 1);
    assert.equal(await page.locator('.cb-coin').count(), 18);
    await ctx.close();
  });

  await test('a completed drag on the board flicks on release, without the Flick button', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 40, sy + 90, { steps: 6 });
    await page.mouse.up();
    const sentActs = await sent(page);
    assert.equal(sentActs.length, 1, 'releasing the drag sends the flick');
    assert.equal(sentActs[0].action.type, 'flick');
    assert.ok(sentActs[0].action.angle > 0 && sentActs[0].action.power > 0);
    await ctx.close();
  });

  await test('a tap on the board sets the aim but does not flick; a cancelled drag does not flick either', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    const svg = await box(page, '.cb-svg');
    const tapY = Math.min(sy + 30, svg.y + svg.height - 6); // inside the board, behind the striker
    assert.ok(tapY > svg.y && tapY < svg.y + svg.height, 'the tap point is on the board');
    const angleBefore = await page.textContent('[data-out="angle"]');
    await page.mouse.click(sx - 40, tapY);
    assert.notEqual(await page.textContent('[data-out="angle"]'), angleBefore, 'the tap sets the aim');
    assert.equal((await sent(page)).length, 0, 'a tap does not fire');
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 40, sy + 90, { steps: 6 });
    await page.evaluate(() => document.querySelector('.cb-svg').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await page.mouse.up();
    assert.equal((await sent(page)).length, 0, 'a cancelled drag does not fire');
    await ctx.close();
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

  await test('the Flick button sends the aim set with the sliders, without a drag', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    await page.evaluate(() => {
      for (const [k, v] of [['x', 50], ['angle', 10], ['power', 60]]) {
        const el = document.querySelector('[data-aim="' + k + '"]');
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    assert.equal((await sent(page)).length, 0, 'nothing is sent until Flick is pressed');
    await page.click('[data-cb="flick"]');
    const acts = await sent(page);
    assert.equal(acts.length, 1, 'the button sends one flick');
    assert.equal(acts[0].action.type, 'flick');
    assert.equal(typeof acts[0].action.seq, 'number', 'the flick names the board it was aimed at');
    await ctx.close();
  });

  await test('the table toolbar Leave button is wired to the plugin (data-cb, not a dead data-carrom key)', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    assert.equal(await page.locator('[data-cb="leave"]').count(), 1);
    assert.equal(await page.locator('[data-carrom]').count(), 0);
    await ctx.close();
  });

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} carrom UI tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
