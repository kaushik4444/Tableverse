'use strict';
// Carrom in a real browser: the board and pieces, dragging to place and aim, the keyboard, four
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

  await test('dragging on the board aims: pulling back to the left of the striker flicks to the right, on release', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    // press well away from the striker (so it is not grabbed), then pull back: the flick goes from the pointer towards the striker
    await page.mouse.move(sx - 20, sy + 40);
    await page.mouse.down();
    await page.mouse.move(sx - 60, sy + 95, { steps: 6 });
    await page.mouse.up();
    const [, angle, power] = (await page.textContent('.cb-tip')).match(/Aim (-?\d+)° · power (\d+)%/).map(Number);
    assert.ok(angle > 0, `the flick goes to the player’s right (angle ${angle})`);
    assert.ok(power > 0, `the drag sets a power (${power}%)`);
    const sentNow = await sent(page);
    assert.equal(sentNow.length, 1, 'releasing the drag sends one flick');
    const a = sentNow.at(-1).action;
    assert.equal(a.type, 'flick');
    assert.ok(a.angle > 0 && a.power > 0);
    await ctx.close();
  });

  await test('the board and the Fire button keep their size and place when the turn passes', async () => {
    const measure = async (viewer) => {
      const { page, ctx } = await open(msgsFor(fresh(), viewer));
      const board = await box(page, '.cb-svg');
      const fire = await box(page, '.cb-fire');
      await ctx.close();
      return { board, fire };
    };
    const mine = await measure('p0');
    const theirs = await measure('p1');
    assert.equal(Math.round(mine.board.width), Math.round(theirs.board.width), 'the board keeps its width');
    assert.equal(Math.round(mine.board.height), Math.round(theirs.board.height), 'the board keeps its height');
    assert.equal(Math.round(mine.fire.y), Math.round(theirs.fire.y), 'the Fire button stays in place');
  });

  await test('on one page, the board and the Fire button do not move when a shot passes the turn', async () => {
    const g = fresh();
    const opening = JSON.parse(JSON.stringify(g));
    const { page: before, ctx: beforeCtx } = await open(msgsFor(opening, 'p0'));
    const first = { board: await box(before, '.cb-svg'), fire: await box(before, '.cb-fire') };
    await beforeCtx.close();
    const res = E.applyAction(g, 'p0', { type: 'flick', x: 0.5, angle: 0, power: 0.6, seq: g.seq });
    assert.equal(res.ok, true, `the shot should be legal: ${res.error || ''}`);
    const { page, ctx } = await open(msgsFor(JSON.parse(JSON.stringify(opening)), 'p0', [g]));
    await page.waitForFunction(() => !(document.querySelector('.cb-seat.turn') || { textContent: '' }).textContent.includes('Ann'), null, { timeout: 8000 });
    const after = { board: await box(page, '.cb-svg'), fire: await box(page, '.cb-fire') };
    assert.equal(Math.round(after.board.width), Math.round(first.board.width), 'the board keeps its width');
    assert.equal(Math.round(after.board.height), Math.round(first.board.height), 'the board keeps its height');
    assert.equal(Math.round(after.fire.y), Math.round(first.fire.y), 'the Fire button stays in place');
    await ctx.close();
  });

  await test('dragging forward of the striker (no pull back) sets no power and sends nothing', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx, sy - 80, { steps: 4 });
    await page.mouse.up();
    assert.match(await page.textContent('.cb-tip'), /Drag your striker along the baseline/, 'no aim is set');
    assert.equal((await sent(page)).length, 0, 'nothing was sent');
    await ctx.close();
  });

  await test('dragging the striker along the baseline places it without a shot, and a new spot clears the aim', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const before = Number(await page.getAttribute('.cb-striker', 'cx'));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 60, sy, { steps: 6 });
    await page.mouse.up();
    const after = Number(await page.getAttribute('.cb-striker', 'cx'));
    assert.ok(after > before, `the striker moved right (${before} → ${after})`);
    assert.equal((await sent(page)).length, 0, 'placing the striker is not a shot');
    assert.match(await page.textContent('.cb-tip'), /Drag your striker along the baseline/, 'the aim was cleared by the move');
    await ctx.close();
  });

  await test('keyboard: the striker moves with the arrows, Up sets the power, and Enter sends that spot and power', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    await page.focus('[data-id="striker"]');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // moving the striker first (it clears any aim)
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.match(await page.textContent('.cb-tip'), /power 10%/);
    assert.equal(await page.getAttribute('[data-id="striker"]', 'aria-valuenow'), '53', 'the slider value follows the striker');
    await page.keyboard.press('Enter');
    const a = (await sent(page)).at(-1).action;
    assert.equal(a.type, 'flick');
    assert.equal(a.x, 0.53, 'the striker moved three steps from the centre spot');
    assert.equal(a.power, 0.1);
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
    g.coins = [{ id: 'w1', kind: 'coin', colour: 'w', x: 0.03, y: 0.03, r: 0.022 }]; // inside a pocket
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
    assert.match(await page.textContent('.cb-tip'), /Drag your striker/, 'the new turn’s tip is there straight away');
    assert.equal(await page.locator('.overlay').count(), 0, 'no result sheet from the old match');
    await page.waitForTimeout(1200); // the old playback would have ended by now: nothing may change the new board
    assert.match(await page.textContent('.cb-tip'), /Drag your striker/);
    assert.equal(await page.locator('.cb-coin').count(), 18);
    await ctx.close();
  });

  await test('a completed drag on the board flicks on release, without the Flick button', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const s = await box(page, '.cb-striker');
    const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
    await page.mouse.move(sx - 20, sy + 40);
    await page.mouse.down();
    await page.mouse.move(sx - 60, sy + 95, { steps: 6 });
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
    const tipBefore = await page.textContent('.cb-tip');
    await page.mouse.click(sx - 40, tapY);
    assert.notEqual(await page.textContent('.cb-tip'), tipBefore, 'the tap sets the aim');
    assert.equal((await sent(page)).length, 0, 'a tap does not fire');
    await page.mouse.move(sx - 20, sy + 40);
    await page.mouse.down();
    await page.mouse.move(sx - 60, sy + 95, { steps: 6 });
    await page.evaluate(() => document.querySelector('.cb-svg').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await page.mouse.up();
    assert.equal((await sent(page)).length, 0, 'a cancelled drag does not fire');
    await ctx.close();
  });

  await test('the first time: the how-to-play cards open with the real board, step through, keep focus, and do not open again', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: msgsFor(fresh()), viewport: { width: 390, height: 844 }, firstTime: true });
    await page.goto(url + '/');
    await page.waitForSelector('.ht-overlay', { timeout: 8000 });
    const titles = [];
    for (let i = 0; i < 6; i++) {
      titles.push(await page.textContent('.ht-overlay h2'));
      assert.ok(await page.locator('.ht-overlay svg.cb-svg .cb-pocket').count() === 4, 'the card shows the real board with four pockets');
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.ht);
      assert.ok(focused === 'next' || focused === 'done', `focus sits on the primary button (${focused})`);
      assert.equal(await page.evaluate(() => document.querySelector('#app').hasAttribute('inert')), true, 'the game behind the card is inert');
      await page.click(i < 5 ? '[data-ht="next"]' : '[data-ht="done"]');
    }
    assert.deepEqual(titles, ['The board', 'Take the shot', 'Pocketing', 'The queen', 'The striker', 'Winning']);
    assert.equal(await page.locator('.ht-overlay').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#app').hasAttribute('inert')), false);
    await ctx.close();
  });

  await test('the striker track under the board places the striker, and the score pills show both teams', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    assert.equal(await page.locator('.cb-pill').count(), 2);
    const before = await page.getAttribute('[data-slider]', 'aria-valuenow');
    const b = await box(page, '.cb-track');
    await page.mouse.click(b.x + b.width * 0.85, b.y + b.height / 2);
    const after = Number(await page.getAttribute('[data-slider]', 'aria-valuenow'));
    assert.ok(after > Number(before) + 15, `the striker moved right (${before} to ${after})`);
    assert.equal((await sent(page)).length, 0, 'placing the striker never flicks');
    await ctx.close();
  });

  await test('phone width (375px): the board is on screen and wide, and the page does not scroll sideways', async () => {
    const { page, ctx } = await open(msgsFor(fresh()), { width: 375, height: 667 });
    const s = await box(page, '.cb-svg');
    assert.ok(s.x >= 0 && s.x + s.width <= 375, `board ${s.width}px wide fits the screen`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no horizontal scroll');
    assert.ok(s.width >= 300, `board ${s.width}px wide on a phone`);
    // the corner pockets are whole and on screen, not cut by the edge
    const pockets = await page.evaluate(() => [...document.querySelectorAll('.cb-pocket')].map((el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right }; }));
    assert.equal(pockets.length, 4, 'four pockets');
    assert.ok(pockets.every((p) => p.l >= 2 && p.r <= 373), 'every pocket is inside the screen: ' + JSON.stringify(pockets));
    await ctx.close();
  });

  await test('no Flick button and no sliders: Enter on the striker flicks once power is set, and sends nothing before', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    assert.equal(await page.locator('[data-aim]').count(), 0, 'no range sliders');
    assert.equal(await page.locator('[data-cb="flick"]').count(), 0, 'no Flick button');
    await page.focus('[data-id="striker"]');
    await page.keyboard.press('Enter');
    assert.equal((await sent(page)).length, 0, 'Enter with no aim sends nothing');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.equal((await sent(page)).length, 1, 'one flick with power set');
    assert.equal(typeof (await sent(page)).at(-1).action.seq, 'number', 'the flick names the board it was aimed at');
    await ctx.close();
  });

  await test('the table toolbar Leave button is wired to the plugin (data-cb, not a dead data-carrom key)', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    assert.equal(await page.locator('[data-cb="leave"]').count(), 1);
    assert.equal(await page.locator('[data-carrom]').count(), 0);
    await ctx.close();
  });

  await test('shot playback moves each disc smoothly between keyframes, and a pocketed disc fades out', async () => {
    const { page, ctx } = await open(msgsFor(fresh()));
    const r = await page.evaluate(() => {
      const P = window.CarromPlayback.poseAt;
      const frames = [{ t: 0, d: [['a', 0, 0], ['b', 1, 1]] }, { t: 0.1, d: [['a', 1, 0]] }];
      const mid = P(frames, 0.05);
      const a = mid.find((p) => p[0] === 'a');
      const b = mid.find((p) => p[0] === 'b');
      return { ax: a[1], aAlpha: a[3], bAlpha: b[3], bx: b[1], start: P(frames, 0)[0], end: P(frames, 0.1)[0] };
    });
    assert.ok(Math.abs(r.ax - 0.5) < 1e-9, 'halfway between keyframes is halfway between the positions: ' + r.ax);
    assert.equal(r.aAlpha, 1, 'a disc still on the board is fully shown');
    assert.ok(Math.abs(r.bAlpha - 0.5) < 1e-9, 'a disc that is pocketed fades out over the interval: ' + r.bAlpha);
    assert.deepEqual(r.start, ['a', 0, 0, 1]);
    assert.deepEqual(r.end, ['a', 1, 0, 1]);
    await ctx.close();
  });

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} carrom UI tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
