'use strict';
// Ready where the next thing happens: at the start of a round it takes the place of the bid panel (and of the status line in other
// games), and the bid appears once everybody is ready. It never sits on top of the table and its button is a full-size tap target.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const games = require('../../games');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const people = (n) => Array.from({ length: n }, (_, i) => ({ name: ['Ann', 'Bo', 'Cy', 'Di', 'Ed'][i] }));

function atPhase(gameId, n, phase) {
  const def = games.get(gameId);
  const extras = people(n);
  const ids = extras.map((x, i) => (i === 0 ? 'me' : 'p' + i));
  const options = Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));
  let a = 11; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(extras.map((x, i) => ({ id: ids[i], name: x.name, avatar: '🧙' })), options, rng);
  for (let i = 0; i < 20000; i++) {
    const v = g.view('me');
    if (v.phase === phase && (phase !== 'bidding' || v.myTurn)) return { g, extras };
    const auto = typeof g.autoAction === 'function' ? g.autoAction() : null;
    if (auto && auto.type === 'continue') { g.act(null, auto); continue; }
    const id = g.awaiting()[0];
    if (!id) break;
    g.act(id, g.botAction(id));
  }
  throw new Error(`${gameId} never reached ${phase}`);
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (gameId, n, phase, gate, viewport = { width: 393, height: 852 }) => {
    const { g, extras } = atPhase(gameId, n, phase);
    const m = tableMessages(gameId, extras);
    m[1].view = g.view('me');
    m[1].room.gate = gate;
    const { page, ctx } = await scriptedPage(browser, { messages: m, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.ready-box', { timeout: 8000 });
    return { page, ctx, m };
  };
  const waiting = { ready: [], waiting: ['me', 'p1', 'p2', 'p3'] };

  for (const [gameId, n, phase] of [['twentynine', 4, 'bidding'], ['wizard', 3, 'bidding']]) {
    await test(`${gameId}: at the start Ready takes the place of the bid, and the bid panel stays hidden until everybody is ready`, async () => {
      const { page, ctx } = await open(gameId, n, phase, waiting);
      assert.equal(await page.locator('.ready-box').count(), 1, 'one Ready box');
      assert.equal(await page.locator('.bidbox:visible').count(), 0, 'no bid panel while the table waits');
      const box = await page.locator('.ready-box [data-act="readyUp"]').boundingBox();
      assert.ok(box.height >= 44 && box.width >= 80, `Ready is a full-size tap target (${box.width}x${box.height})`);
      const inView = await page.evaluate(() => { const r = document.querySelector('.ready-box').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
      assert.ok(inView, 'the Ready box is on screen without scrolling');
      await page.click('.ready-box [data-act="readyUp"]');
      assert.equal(await page.evaluate(() => window.__sent.filter((x) => x.t === 'ready').length), 1);
      await ctx.close();
    });
  }

  await test('twentynine: once the gate is gone the bid panel is back', async () => {
    const { page, ctx, m } = await open('twentynine', 4, 'bidding', waiting);
    m[1].room.gate = null;
    await page.evaluate((x) => window.__push(x), m[1]);
    await page.waitForSelector('.bidbox:visible');
    assert.equal(await page.locator('.ready-box').count(), 0);
    await ctx.close();
  });

  await test('after pressing Ready the box shows who the table still waits for, with no second button', async () => {
    const { page, ctx, m } = await open('twentynine', 4, 'bidding', waiting);
    m[1].room.gate = { ready: ['me'], waiting: ['p1', 'p2', 'p3'] };
    await page.evaluate((x) => window.__push(x), m[1]);
    await page.waitForFunction(() => /You are ready/.test(document.querySelector('.ready-box')?.textContent || ''));
    assert.match(await page.textContent('.ready-box'), /Waiting for Bo, Cy, Di/);
    assert.equal(await page.locator('.ready-box [data-act="readyUp"]').count(), 0);
    await ctx.close();
  });

  for (const [gameId, n, phase] of [['stagerummy', 4, 'play'], ['penaltyrows', 4, 'choose'], ['colorclash', 4, 'playing']]) {
    await test(`${gameId}: at the start Ready replaces the status line above the hand and nothing covers the table`, async () => {
      const { g } = atPhase(gameId, n, g0(gameId));
      void g; void phase;
      const { page, ctx } = await open(gameId, n, g0(gameId), waiting, { width: 360, height: 640 });
      assert.equal(await page.locator('.ready-box').count(), 1);
      assert.equal(await page.locator('.wz-status:visible').count(), 0, 'one line, not two');
      const overlap = await page.evaluate(() => { const b = document.querySelector('.ready-box').getBoundingClientRect(); const t = document.querySelector('.pr-row, .pr-rows, .sr-table, .cc-tablewrap, .pt-center, .pt-board'); if (!t) return false; const r = t.getBoundingClientRect(); return b.top < r.bottom - 2 && b.bottom > r.top + 2; });
      assert.equal(overlap, false, 'the Ready box does not sit on the table');
      await page.click('.ready-box [data-act="readyUp"]');
      assert.equal(await page.evaluate(() => window.__sent.filter((x) => x.t === 'ready').length), 1);
      await ctx.close();
    });
  }
  function g0(gameId) { return gameId === 'stagerummy' ? 'play' : gameId === 'penaltyrows' ? 'choose' : 'playing'; }

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} ready placement tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
