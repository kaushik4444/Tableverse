'use strict';
// Stage Rummy in a real browser: drawing, assigning cards to the stage's groups, laying down, discarding, hitting, game over, narrow phone.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const card = (id) => { const c = require('../../games/stagerummy/engine').makeCard(id); return { id: c.id, k: c.k, c: c.c, v: c.v }; };

/** Messages where it is my turn in the given phase, with a chosen hand. */
function scene(phase, handIds, tweak) {
  const msgs = tableMessages('stagerummy', four);
  const v = msgs[1].view;
  v.me = 0; v.turn = 0; v.myTurn = true; v.phase = phase;
  v.hand = handIds.map(card);
  if (tweak) tweak(v);
  return msgs;
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.sr', { timeout: 8000 });
    return { page, ctx };
  };

  await test('draw phase: stock and discard are buttons and send the draw', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5, 6]));
    await page.click('[data-sr="draw"][data-from="stock"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'draw', from: 'stock' });
    await ctx.close();
  });

  await test('a skip on the discard pile cannot be taken', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5, 6], (v) => { v.discardTop = card(104); }));
    assert.equal(await page.isDisabled('[data-sr="draw"][data-from="discard"]'), true);
    await ctx.close();
  });

  await test('stage 1: select cards, add them to the two groups, lay down sends both groups', async () => {
    // 5 red/blue/green (ids 4, 28, 52) as the set; red 2,3,4 (ids 1,2,3) as the run
    const { page, ctx } = await open(scene('play', [4, 28, 52, 1, 2, 3, 80, 90]));
    assert.equal(await page.isDisabled('[data-sr="lay"]'), true);
    for (const id of [4, 28, 52]) await page.click(`.sr-hand [data-id="${id}"]`);
    await page.click('[data-sr="assign"][data-group="0"]');
    for (const id of [1, 2, 3]) await page.click(`.sr-hand [data-id="${id}"]`);
    await page.click('[data-sr="assign"][data-group="1"]');
    assert.equal(await page.isDisabled('[data-sr="lay"]'), false);
    await page.click('[data-sr="lay"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'lay', groups: [[4, 28, 52], [1, 2, 3]] });
    await ctx.close();
  });

  await test('a card put in a group can be taken back out', async () => {
    const { page, ctx } = await open(scene('play', [4, 28, 52, 1, 2, 3]));
    await page.click('.sr-hand [data-id="4"]');
    await page.click('[data-sr="assign"][data-group="0"]');
    assert.equal(await page.locator('.sr-tcards [data-id="4"]').count(), 1);
    await page.click('.sr-tcards [data-id="4"]');
    assert.equal(await page.locator('.sr-hand [data-id="4"]').count(), 1);
    await ctx.close();
  });

  await test('select one card and discard it', async () => {
    const { page, ctx } = await open(scene('play', [4, 28, 52]));
    await page.click('.sr-hand [data-id="28"]');
    await page.click('[data-sr="discard"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'discard', card: 28 });
    await ctx.close();
  });

  await test('after laying down: select a card, tap a laid group to add it', async () => {
    const { page, ctx } = await open(scene('play', [76, 9], (v) => {
      v.players[0].laid = [{ kind: 'set', num: 5, cards: [card(4), card(28), card(52)] }, { kind: 'run', lo: 2, hi: 4, cards: [card(1), card(2), card(3)] }];
    }));
    await page.click('.sr-hand [data-id="76"]');
    await page.click('[data-sr="hit"][data-owner="0"][data-group="0"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'hit', card: 76, owner: 0, group: 0 });
    await ctx.close();
  });

  await test('a wild card on a run: the player chooses the low or high end', async () => {
    const { page, ctx } = await open(scene('play', [96, 9], (v) => {
      v.players[0].laid = [{ kind: 'run', lo: 2, hi: 4, cards: [card(1), card(2), card(3)] }];
    }));
    await page.click('.sr-hand [data-id="96"]');
    assert.equal(await page.locator('[data-sr="hit"][data-end="low"]').count(), 1, 'low end offered');
    assert.equal(await page.locator('[data-sr="hit"][data-end="high"]').count(), 1, 'high end offered');
    await page.click('[data-sr="hit"][data-end="low"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'hit', card: 96, owner: 0, group: 0, end: 'low' });
    await ctx.close();
  });

  await test('not your turn: nothing to press', async () => {
    const { page, ctx } = await open(scene('draw', [4, 5], (v) => { v.myTurn = false; v.turn = 1; }));
    assert.equal(await page.locator('[data-sr="draw"]:not([disabled])').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo is playing/);
    await ctx.close();
  });

  await test('game over lists stages and points and offers rematch to the host', async () => {
    const { page, ctx } = await open(scene('gameOver', [], (v) => { v.myTurn = false; v.winners = [1]; v.players.forEach((p, i) => { p.stage = [4, 6, 5, 3][i]; p.score = 10 * i; }); }));
    const items = await page.locator('.sr-final li').allTextContents();
    assert.match(items[0], /Bo/);
    assert.equal(await page.locator('[data-sr="again"]').count(), 1);
    await ctx.close();
  });

  await test('a 320 px phone: six players, nothing overflows sideways', async () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name }));
    const { page, ctx } = await open(tableMessages('stagerummy', six), { width: 320, height: 640 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow ' + over);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
