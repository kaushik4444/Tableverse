'use strict';
// Hidden Miners in a real browser: the board and miners, picking a card then a place, breaking and repairing, scouting,
// collapsing, throwing a card away, the round summary with roles, and the layout from a small phone to a desktop.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte', 'Dmitri', 'Esme', 'Farid', 'Gita', 'Hugo'];
const people = (n) => names.slice(0, n).map((name) => ({ name }));
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

function scene(n, edit) {
  const m = tableMessages('hiddenminers', people(n));
  const v = m[1].view;
  Object.assign(v, {
    W: 9, H: 5, round: 1, rounds: 3, deck: 30, role: 'digger', myTurn: true, turn: v.me, phase: 'playing',
    board: [{ x: 0, y: 2, mask: 15, cut: false, start: true }, { x: 1, y: 2, mask: 10, cut: false, start: false }],
    goals: [0, 2, 4].map((y) => ({ x: 8, y, revealed: false, gold: null })),
    scouts: [], event: null, roundResult: null, winners: [],
    players: v.players.map((p) => ({ ...p, cards: 5, broken: [], score: 0 })),
    hand: [
      { id: 't1', k: 'tile', mask: 10, cut: false, ok: true },
      { id: 'b1', k: 'break', tool: 'pick', ok: true },
      { id: 'r1', k: 'repair', tools: ['pick'], ok: true },
      { id: 's1', k: 'scout', ok: true },
      { id: 'c1', k: 'collapse', ok: true },
    ],
    spots: { t1: [[2, 2, 0]] },
    targets: { b1: v.players.map((_, i) => i).filter((i) => i !== v.me), r1: [{ seat: 1, tool: 'pick' }], c1: [[1, 2]] },
  });
  v.players[1].broken = ['pick'];
  if (edit) edit(v);
  return m;
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.hm-game', { timeout: 8000 });
    return { page, ctx };
  };

  await test('the table shows every miner with tools, the 9 x 5 board, the chambers and your cards; your role is shown', async () => {
    const { page, ctx } = await open(scene(5));
    assert.equal(await page.locator('.hm-p').count(), 5);
    assert.equal(await page.locator('.hm-board .hm-cell').count(), 45);
    assert.equal(await page.locator('.hm-cell.goal').count(), 3);
    assert.equal(await page.locator('.hm-tool.broken').count(), 1);
    assert.equal(await page.locator('.hm-card').count(), 5);
    assert.match(await page.textContent('.hm-youare'), /You are a Digger/);
    await ctx.close();
  });

  await test('a tunnel piece: pick it, glowing places appear, tapping one sends the placement; turning it flips the preview', async () => {
    const { page, ctx } = await open(scene(4));
    assert.equal(await page.locator('.hm-cell.spot').count(), 0);
    await page.click('.hm-card[data-id="t1"]');
    assert.equal(await page.locator('.hm-cell.spot').count(), 1);
    await page.click('.hm-cell.spot');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'tile', card: 't1', x: 2, y: 2, flip: false });
    await ctx.close();
    const f = await open(scene(4, (v) => { v.hand[0] = { id: 't1', k: 'tile', mask: 3, cut: false, ok: true }; v.spots = { t1: [[2, 2, 1]] }; }));
    await f.page.click('.hm-card[data-id="t1"]');
    await f.page.click('.hm-cell.spot');
    assert.equal((await sent(f.page)).at(-1).action.flip, true, 'only the turned piece fits, so it is sent turned');
    await f.ctx.close();
  });

  await test('break: tap the card, then a miner (never yourself); repair: tap the card, then the broken tool', async () => {
    const { page, ctx } = await open(scene(4));
    await page.click('.hm-card[data-id="b1"]');
    assert.equal(await page.locator('.hm-p.target').count(), 3);
    await page.click('.hm-p.target >> nth=0');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'break', card: 'b1', target: 1 });
    await ctx.close();
    const r = await open(scene(4));
    await r.page.click('.hm-card[data-id="r1"]');
    assert.equal(await r.page.locator('.hm-tool.fixable').count(), 1);
    const box = await r.page.locator('.hm-tool.fixable').boundingBox();
    assert.ok(box.width >= 40 && box.height >= 40, `repair target is big enough to tap (${box.width}x${box.height})`);
    await r.page.click('.hm-tool.fixable');
    assert.deepEqual((await sent(r.page)).at(-1).action, { type: 'repair', card: 'r1', target: 1, tool: 'pick' });
    await r.ctx.close();
  });

  await test('scout sends the chosen chamber; your own scouting stays visible to you only; collapse sends the cell', async () => {
    const { page, ctx } = await open(scene(4, (v) => { v.scouts = [{ goal: 1, gold: true }]; }));
    assert.equal(await page.locator('.hm-seen').count(), 1);
    await page.click('.hm-card[data-id="s1"]');
    assert.equal(await page.locator('button.hm-cell.goal').count(), 3);
    await page.click('button.hm-cell.goal >> nth=2');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'scout', card: 's1', goal: 2 });
    await ctx.close();
    const c = await open(scene(4));
    await c.page.click('.hm-card[data-id="c1"]');
    await c.page.click('.hm-cell.cave');
    assert.deepEqual((await sent(c.page)).at(-1).action, { type: 'collapse', card: 'c1', x: 1, y: 2 });
    await c.ctx.close();
  });

  await test('throw a card away, even one that cannot be played; Cancel clears the choice', async () => {
    const { page, ctx } = await open(scene(4, (v) => { v.hand[1].ok = false; v.targets.b1 = []; }));
    await page.click('.hm-card[data-id="b1"]');
    await page.click('[data-hm="discard"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'discard', card: 'b1' });
    await page.click('.hm-card[data-id="t1"]');
    await page.click('[data-hm="cancel"]');
    assert.equal(await page.locator('.hm-card.sel').count(), 0);
    await ctx.close();
  });

  await test('not your turn: nothing can be sent; a spectator sees the board without a hand or role', async () => {
    const { page, ctx } = await open(scene(4, (v) => { v.myTurn = false; v.turn = 2; v.hand = v.hand.map((c) => ({ ...c, ok: false })); v.spots = {}; v.targets = {}; }));
    assert.match(await page.textContent('.wz-status'), /Charlotte is playing/);
    await page.click('.hm-card[data-id="t1"]', { force: true });
    assert.equal(await page.locator('.hm-cell.spot').count(), 0);
    assert.equal((await sent(page)).length, 0);
    await ctx.close();
    const s = await open(scene(3, (v) => { v.me = -1; v.hand = []; v.role = null; v.myTurn = false; v.spots = {}; v.targets = {}; }));
    assert.equal(await s.page.locator('.hm-card').count(), 0);
    assert.equal(await s.page.locator('.hm-youare').count(), 0);
    assert.match(await s.page.textContent('.wz-status'), /Watching/);
    await s.ctx.close();
  });

  await test('a broken tool of yours is explained; the table says what just happened', async () => {
    const { page, ctx } = await open(scene(4, (v) => { v.players[v.me].broken = ['lamp']; v.event = { seq: 4, type: 'break', by: 1, target: v.me, tool: 'lamp' }; }));
    assert.match(await page.textContent('.wz-status'), /broken/);
    assert.match(await page.textContent('.hm-event'), /Bo broke your Lamp/);
    await ctx.close();
  });

  await test('new events float over the board; opening the gold chamber is held in the middle; the first look shows no history', async () => {
    const { page, ctx } = await open(scene(4));
    assert.equal(await page.locator('.gf-item').count(), 0);
    await page.evaluate((m) => window.__push(m), scene(4, (v) => {
      v.myTurn = false; v.turn = 2;
      v.goals[1] = { x: 8, y: 2, revealed: true, gold: true };
      v.event = { seq: 15, type: 'tile', by: 1, x: 7, y: 2, mask: 10, cut: false, revealed: [1], goldIndex: 1 };
    })[1]);
    await page.waitForSelector('.gf-spot');
    assert.match(await page.textContent('.gf-spot'), /gold chamber is open/);
    assert.match(await page.textContent('.hm-boardwrap .gf-item'), /Bo dug a tunnel/);
    await ctx.close();
  });

  await test('keyboard: focus stays on the chosen card after the board redraws; cards are buttons, not list items', async () => {
    const { page, ctx } = await open(scene(4));
    await page.focus('.hm-card[data-id="t1"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 't1');
    assert.equal(await page.locator('.hm-cell.spot').count(), 1);
    assert.equal(await page.locator('[role="listitem"], button[role="img"]').count(), 0);
    await ctx.close();
  });

  await test('round summary reveals every role once and is dismissed; the final sheet shows winners and Play again', async () => {
    const result = { round: 1, side: 'diggers', finder: 0, roles: ['digger', 'saboteur', 'digger', 'digger'], gains: [4, 0, 3, 3], gold: 1 };
    const { page, ctx } = await open(scene(4));
    await page.evaluate((m) => window.__push(m), scene(4, (v) => { v.roundResult = result; v.round = 2; v.event = { seq: 30, type: 'roundEnd', side: 'diggers', round: 1 }; })[1]);
    await page.waitForSelector('.overlay .sheet');
    assert.match(await page.textContent('.overlay h2'), /Diggers found the gold/);
    assert.match(await page.textContent('.hm-final'), /Saboteur/);
    await page.click('[data-hm="next"]');
    assert.equal(await page.locator('.overlay').count(), 0);
    await ctx.close();
    const over = await open(scene(4, (v) => { v.phase = 'gameOver'; v.winners = [0]; v.myTurn = false; v.roundResult = result; v.players = v.players.map((p, i) => ({ ...p, score: [10, 3, 8, 6][i] })); }));
    assert.match(await over.page.textContent('.overlay h2'), /You won/);
    await over.ctx.close();
  });

  await test('the layout fits from a small phone to a desktop with 3 to 8 miners (no sideways page scroll, board inside the screen)', async () => {
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 700 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
      for (const n of [3, 5, 8]) {
        const { page, ctx } = await open(scene(n, (v) => { v.hand = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, k: 'tile', mask: [5, 10, 3, 6, 7, 15][i], cut: false, ok: true })); }), viewport);
        const m = await page.evaluate(() => { const b = document.querySelector('.hm-board').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, l: b.left, r: b.right, cell: document.querySelector('.hm-board .hm-cell').getBoundingClientRect().width }; });
        assert.ok(m.sw <= m.iw + 1, `${viewport.width}x${viewport.height} ${n}p: no sideways scroll (${m.sw} > ${m.iw})`);
        assert.ok(m.l >= -1 && m.r <= m.iw + 1, `${viewport.width}x${viewport.height} ${n}p: board inside the screen`);
        assert.ok(m.cell >= 28, `${viewport.width}x${viewport.height} ${n}p: cells stay tappable (${m.cell}px)`);
        await ctx.close();
      }
    }
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
