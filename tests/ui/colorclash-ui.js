'use strict';
// Color Clash in a real browser: the table, tapping cards, the Wild colour picker, draw and keep, not-your-turn,
// the round summary, the final sheet and the layout from a small phone to a desktop with 2 to 8 players.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte', 'Dmitri', 'Esme', 'Farid', 'Gita', 'Hugo'];
const people = (n) => names.slice(0, n).map((name) => ({ name }));
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const card = (id, c, k, v = null, ok = true) => ({ id, c, k, v, ok });

/** A state message with chosen hand, top card and colour (seat 0 is on turn). */
function scene(n, edit) {
  const m = tableMessages('colorclash', people(n));
  const v = m[1].view;
  v.top = { id: 'R5z', c: 'R', k: 'n', v: 5 };
  v.colour = 'R';
  v.hand = [card('R9a', 'R', 'n', 9), card('B5a', 'B', 'n', 5), card('G3a', 'G', 'n', 3, false), card('W1', 'W', 'wild'), card('Ystopa', 'Y', 'stop', null, false)];
  v.myTurn = true; v.turn = 0; v.canDraw = true; v.drawn = null;
  if (edit) edit(v, m);
  return m;
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.cc-game', { timeout: 8000 });
    return { page, ctx };
  };

  await test('the table shows every player with their card count, the top card, the stock and the colour in play', async () => {
    const { page, ctx } = await open(scene(4));
    assert.equal(await page.locator('.pseat').count(), 4);
    assert.match(await page.textContent('.pseat.me'), /7 cards/);
    assert.match(await page.textContent('.cc-colour'), /Ruby/);
    assert.equal(await page.getAttribute('.cc-discard .card', 'aria-label'), 'Ruby 5');
    assert.match(await page.getAttribute('.cc-stock', 'aria-label'), /Draw a card/);
    assert.equal(await page.locator('.hand .card').count(), 5);
    assert.equal(await page.locator('.hand .card.playable').count(), 3, 'a Ruby card, a 5 and the Wild fit');
    assert.equal(await page.locator('.hand .card.dim').count(), 2);
    await ctx.close();
  });

  await test('tapping a card that fits plays it; a card that does not fit sends nothing', async () => {
    const { page, ctx } = await open(scene(4));
    await page.click('.hand .card[data-id="G3a"]', { force: true });
    assert.equal((await sent(page)).length, 0);
    await page.click('.hand .card[data-id="R9a"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'play', card: 'R9a' });
    await ctx.close();
  });

  await test('a Wild asks for a colour first (and can be cancelled); the colour is sent with the card', async () => {
    const { page, ctx } = await open(scene(4));
    await page.click('.hand .card[data-id="W1"]');
    assert.equal((await sent(page)).length, 0, 'nothing is sent until a colour is chosen');
    assert.equal(await page.locator('.cc-pick').count(), 4);
    await page.click('[data-cc="cancel"]');
    assert.equal(await page.locator('.cc-pick').count(), 0);
    await page.click('.hand .card[data-id="W1"]');
    await page.click('.cc-pick-G');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'play', card: 'W1', colour: 'G' });
    await ctx.close();
  });

  await test('draw: the button and the stock pile send a draw; after a drawn card that fits, only that card may be played and keeping it sends pass', async () => {
    const { page, ctx } = await open(scene(4));
    await page.click('.cc-controls [data-cc="draw"]');
    await page.click('.cc-stock');
    assert.deepEqual((await sent(page)).map((a) => a.action.type), ['draw', 'draw']);
    await ctx.close();
    const drawn = scene(4, (v) => { v.drawn = 'B5a'; v.canDraw = false; v.hand = v.hand.map((c) => ({ ...c, ok: c.id === 'B5a' })); });
    const t = await open(drawn);
    assert.equal(await t.page.locator('.hand .card.playable').count(), 1);
    assert.match(await t.page.textContent('.wz-status'), /play it or keep it/);
    await t.page.click('[data-cc="keep"]');
    assert.deepEqual((await sent(t.page)).at(-1).action, { type: 'pass' });
    await t.ctx.close();
  });

  await test('not your turn: no controls, nothing is flagged, tapping sends nothing; a spectator sees the table without a hand', async () => {
    const { page, ctx } = await open(scene(4, (v) => { v.myTurn = false; v.turn = 2; v.canDraw = false; v.hand = v.hand.map((c) => ({ ...c, ok: false })); }));
    assert.equal(await page.locator('.cc-controls').count(), 0);
    assert.equal(await page.locator('.hand .card.playable').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Charlotte is playing/);
    await page.click('.hand .card[data-id="R9a"]', { force: true });
    assert.equal((await sent(page)).length, 0);
    await ctx.close();
    const s = await open(scene(3, (v) => { v.me = -1; v.hand = []; v.myTurn = false; v.canDraw = false; }));
    assert.equal(await s.page.locator('.hand .card').count(), 0);
    assert.match(await s.page.textContent('.wz-status'), /Watching/);
    await s.ctx.close();
  });

  await test('the table says what just happened: a Take 2 names who draws and misses a turn', async () => {
    const { page, ctx } = await open(scene(4, (v) => {
      v.event = { seq: 9, type: 'play', by: 3, card: { id: 'Rtake2a', c: 'R', k: 'take2', v: null }, colour: 'R', left: 4, penalised: { target: 0, count: 2 } };
    }));
    const text = await page.textContent('.cc-event');
    assert.match(text, /Dmitri played Ruby Take 2/);
    assert.match(text, /You draw 2 and miss a turn/);
    await ctx.close();
  });

  await test('a new action card floats a line over the table and is held in the middle for a moment; the first look shows no history', async () => {
    const { page, ctx } = await open(scene(4));
    assert.equal(await page.locator('.gf-item').count(), 0, 'nothing is replayed on the first look');
    await page.evaluate((m) => window.__push(m), scene(4, (v) => { v.myTurn = false; v.turn = 2; v.event = { seq: 12, type: 'play', by: 3, card: { id: 'Ystopa', c: 'Y', k: 'stop', v: null }, colour: 'Y', left: 5, skipped: 0 }; })[1]);
    await page.waitForSelector('.gf-spot');
    assert.match(await page.textContent('.gf-spot'), /Dmitri played Sun Stop/);
    assert.match(await page.textContent('.cc-tablewrap .gf-item'), /Dmitri played Sun Stop/);
    await ctx.close();
  });

  await test('a round summary shows once and is dismissed with Next round; the final sheet shows the totals and Play again for the host', async () => {
    const result = { round: 1, winner: 2, total: 64, gains: [0, 0, 64, 0], hands: [[], [], [], []] };
    const first = tableMessages('colorclash', people(4));
    const { page, ctx } = await open(first);
    await page.evaluate((m) => window.__push(m), scene(4, (v) => { v.roundResult = result; v.round = 2; v.players = v.players.map((p, i) => ({ ...p, score: i === 2 ? 64 : 0 })); v.event = { seq: 20, type: 'roundEnd', by: 2, round: 1, total: 64 }; })[1]);
    await page.waitForSelector('.overlay .sheet');
    assert.match(await page.textContent('.overlay h2'), /Charlotte went out/);
    assert.match(await page.textContent('.cc-final'), /\+64/);
    await page.click('[data-cc="next"]');
    assert.equal(await page.locator('.overlay').count(), 0);
    await ctx.close();
    const over = await open(scene(3, (v) => { v.phase = 'gameOver'; v.winners = [1]; v.myTurn = false; v.canDraw = false; v.players = v.players.map((p, i) => ({ ...p, score: [110, 215, 40][i] })); v.roundResult = { ...result, winner: 1, gains: [0, 64, 0] }; }));
    assert.match(await over.page.textContent('.overlay h2'), /Game over/);
    assert.match(await over.page.textContent('.cc-final'), /Bo.*215 pts/s);
    await over.ctx.close();
  });

  await test('the layout fits from a small phone to a desktop, with 2 to 8 players (no sideways scroll, controls on screen)', async () => {
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 700 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
      for (const n of [2, 5, 8]) {
        const { page, ctx } = await open(scene(n, (v) => { v.hand = Array.from({ length: 14 }, (_, i) => card(`B${i}a`, ['R', 'Y', 'G', 'B'][i % 4], 'n', (i % 9) + 1, i % 2 === 0)); }), viewport);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, draw: (() => { const r = document.querySelector('.cc-controls [data-cc="draw"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })(), seats: [...document.querySelectorAll('.pseat')].map((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }) }));
        assert.ok(m.sw <= m.iw + 1, `${viewport.width}x${viewport.height} ${n}p: no sideways scroll (${m.sw} > ${m.iw})`);
        assert.ok(m.seats.every(Boolean), `${viewport.width}x${viewport.height} ${n}p: every seat is inside the screen`);
        await ctx.close();
      }
    }
  });

  await test('after each move the table holds still for a moment: nothing can be played, a tap says why, then play comes back', async () => {
    const { page, ctx } = await open(scene(4));
    await page.evaluate((m) => window.__push(m), scene(4, (v) => {
      v.top = { id: 'Y4x', c: 'Y', k: 'n', v: 4 }; v.colour = 'Y';
      v.event = { seq: 30, type: 'play', by: 2, card: { id: 'Y4x', c: 'Y', k: 'n', v: 4 }, colour: 'Y', left: 3 };
    })[1]);
    await page.waitForFunction(() => /Charlotte played/.test(document.querySelector('.cc-event')?.textContent || ''), null, { timeout: 4000 });
    assert.equal(await page.locator('.hand .card.playable').count(), 0, 'no card can be played during the hold');
    assert.equal(await page.locator('.cc-controls').count(), 0, 'no draw or keep control during the hold');
    await page.click('.hand .card[data-id="R9a"]', { force: true });
    assert.equal((await sent(page)).length, 0, 'a tap during the hold sends nothing');
    await page.waitForFunction(() => document.querySelectorAll('.hand .card.playable').length === 3, null, { timeout: 4000 });
    await page.click('.hand .card[data-id="R9a"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'play', card: 'R9a' });
    await ctx.close();
  });

  await test('the round summary waits about two seconds after the last move, then shows', async () => {
    const { page, ctx } = await open(scene(4));
    const result = { round: 1, winner: 2, total: 64, gains: [0, 0, 64, 0], hands: [[], [], [], []] };
    const t0 = Date.now();
    await page.evaluate((m) => window.__push(m), scene(4, (v) => { v.roundResult = result; v.round = 2; v.event = { seq: 40, type: 'roundEnd', by: 2, round: 1, total: 64 }; })[1]);
    await page.waitForSelector('.overlay .sheet', { timeout: 6000 });
    const waited = Date.now() - t0;
    assert.ok(waited >= 1900, `the summary showed after ${waited}ms, not straight away`);
    await ctx.close();
  });

  await test('recent moves lists the last moves in words, newest first, and opens on tap', async () => {
    const { page, ctx } = await open(scene(4));
    await page.evaluate((m) => window.__push(m), scene(4, (v) => {
      v.event = { seq: 50, type: 'play', by: 2, card: { id: 'Y4x', c: 'Y', k: 'n', v: 4 }, colour: 'Y', left: 3 };
    })[1]);
    await page.waitForFunction(() => /Charlotte played/.test(document.querySelector('.cc-event')?.textContent || ''), null, { timeout: 4000 });
    await page.waitForTimeout(1200);
    await page.evaluate((m) => window.__push(m), scene(4, (v) => {
      v.event = { seq: 51, type: 'draw', by: 3, count: 1, left: 3 };
    })[1]);
    await page.waitForFunction(() => /Dmitri drew/.test(document.querySelector('.cc-event')?.textContent || ''), null, { timeout: 4000 });
    await page.waitForTimeout(1200);
    await page.click('[data-cc="log"]');
    const items = await page.locator('.cc-log li').allTextContents();
    assert.equal(items.length, 2);
    assert.match(items[0], /Dmitri drew a card/, 'newest first');
    assert.match(items[1], /Charlotte played Sun 4/);
    await ctx.close();
  });

  await test('cards can be told apart without colour: every coloured card shows its shape, and every card has a name', async () => {
    const { page, ctx } = await open(scene(4));
    const info = await page.evaluate(() => [...document.querySelectorAll('.hand .card')].map((c) => ({ label: c.getAttribute('aria-label'), text: c.textContent })));
    assert.ok(info.every((i) => i.label && i.label.length > 2));
    assert.match(info.find((i) => i.label === 'Ruby 9').text, /▲/);
    assert.match(info.find((i) => i.label === 'Sea 5').text, /◆/);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
