'use strict';
/** Ludo in a real browser against the real engine view: board shape, selectable tokens, roll/ready buttons, no clutter. npm run test:ui */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

function messages(patch) {
  const players = ['Aarav', 'Bo', 'Cy', 'Di'].map((n, i) => ({ id: i ? 'p' + i : 'me', name: n, avatar: '🧙' }));
  const g = games.get('ludo').create(players, {}, () => 0.999999);
  const view = g.view('me');
  patch(view, g, players);
  const room = { code: 'ABCDEF', gameId: 'ludo', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: 4, min: 2, max: 4, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ games: games.list() }), { t: 'state', room, view }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();

  await test('the ready screen is one bar with a single I’m ready button, a square board and no extra panels', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: messages(() => {}) });
    await page.goto(url + '/');
    await page.waitForSelector('.ludo-board');
    assert.equal(await page.locator('.ludo-roll').count(), 1);
    assert.match(await page.textContent('.ludo-roll'), /ready/i);
    const b = await page.locator('.ludo-board').boundingBox();
    assert.ok(Math.abs(b.width - b.height) < 2, 'board is square');
    assert.equal(await page.locator('.ludo-token').count(), 16, 'four tokens per colour');
    assert.equal(await page.locator('.ludo-token.legal').count(), 0);
    for (const gone of ['.ludo-feedback', '.ludo-ready', '.ludo-header']) assert.equal(await page.$(gone), null, gone + ' is gone');
    await page.click('.ludo-roll');
    assert.ok((await page.evaluate(() => window.__sent)).some((m) => JSON.stringify(m).includes('ready')), 'sends ready');
    await ctx.close();
  });

  await test('on your move only legal tokens glow and a tap sends that move', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: messages((v) => {
      v.players[0].tokens = [0, 12, -1, 56]; v.players[1].tokens = [20, -1, -1, -1];
      Object.assign(v, { phase: 'moving', turn: 0, canMove: true, myTurn: true, canRoll: false, dice: 4, legalTokens: [1], sixes: 0 });
    }) });
    await page.goto(url + '/');
    await page.waitForSelector('.ludo-token.legal');
    assert.equal(await page.locator('.ludo-token.legal').count(), 1);
    assert.equal(await page.locator('.ludo-roll').count(), 0, 'no roll button while choosing a token');
    await page.click('.ludo-token.legal');
    const sent = await page.evaluate(() => window.__sent);
    assert.ok(sent.some((m) => JSON.stringify(m).includes('"move"') && JSON.stringify(m).includes('"token":1')), 'sends move for token 1: ' + JSON.stringify(sent));
    await ctx.close();
  });

  await test('a move walks the token square by square, then buttons come back', async () => {
    const base = (v) => { v.players[0].tokens = [3, -1, -1, -1]; Object.assign(v, { phase: 'moving', turn: 1, canMove: false, myTurn: false, canRoll: false, dice: 4, legalTokens: [] }); };
    const m = messages(base);
    const { page, ctx } = await scriptedPage(browser, { messages: m });
    await page.goto(url + '/');
    await page.waitForSelector('.ludo-token[data-pid="0-0"]');
    const moved = JSON.parse(JSON.stringify(m[1].view)); moved.players[0].tokens = [7, -1, -1, -1];
    Object.assign(moved, { phase: 'rolling', turn: 0, canRoll: true, myTurn: true, dice: null, lastMove: { player: 0, token: 0, from: 3, to: 7, dice: 4, captured: [] } });
    await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room: m[1].room, view: moved });
    await page.waitForTimeout(120);
    assert.equal(await page.isDisabled('.ludo-roll'), true, 'the roll button waits while the token walks');
    const seen = new Set();
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const state = await page.evaluate(() => { const t = document.querySelector('.ludo-token[data-pid="0-0"]'); return { pos: t.style.left + '|' + t.style.top, moving: t.classList.contains('moved') }; });
      seen.add(state.pos);
      if (!state.moving) break;
      await page.waitForTimeout(60);
    }
    assert.ok(seen.size >= 5, `it stopped on each square on the way (start + 4 steps): ${seen.size} positions`);
    assert.equal(await page.isDisabled('.ludo-roll'), true, 'the final landing transition still gates controls');
    await page.waitForTimeout(120);
    assert.equal(await page.isDisabled('.ludo-roll'), true, 'controls remain disabled through the landing transition');
    await page.waitForFunction(() => !document.querySelector('.ludo-roll').disabled, null, { timeout: 2000 });
    await ctx.close();
  });

  await test('switching tables clears unfinished animation state', async () => {
    const m = messages((v) => {
      v.players[3].tokens = [3, -1, -1, -1];
      Object.assign(v, { phase: 'rolling', turn: 0, canRoll: true, myTurn: true, canMove: false, dice: 4 });
    });
    const { page, ctx } = await scriptedPage(browser, { messages: m });
    await page.goto(url + '/');
    await page.waitForSelector('.ludo-roll');
    const moved = JSON.parse(JSON.stringify(m[1].view));
    moved.players[3].tokens[0] = 7;
    await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room: m[1].room, view: moved });
    await page.waitForTimeout(60);

    const next = JSON.parse(JSON.stringify(m[1]));
    next.room.code = 'GHIJKL';
    next.room.seats = 2;
    next.view.players = next.view.players.slice(0, 2);
    Object.assign(next.view, { n: 2, phase: 'rolling', turn: 0, me: 0, canRoll: true, myTurn: true, canMove: false, dice: null });
    await page.evaluate((st) => window.__push(st), next);
    assert.equal(await page.isDisabled('.ludo-roll'), false, 'the new table is not blocked by the old walk');
    await ctx.close();
  });

  await test('on your roll the Roll button is enabled; on someone else’s it is disabled', async () => {
    const mine = await scriptedPage(browser, { messages: messages((v) => Object.assign(v, { phase: 'rolling', turn: 0, canRoll: true, myTurn: true })) });
    await mine.page.goto(url + '/'); await mine.page.waitForSelector('.ludo-roll');
    assert.equal(await mine.page.isDisabled('.ludo-roll'), false);
    await mine.ctx.close();
    const theirs = await scriptedPage(browser, { messages: messages((v) => Object.assign(v, { phase: 'rolling', turn: 1, canRoll: false, myTurn: false })) });
    await theirs.page.goto(url + '/'); await theirs.page.waitForSelector('.ludo-roll');
    assert.equal(await theirs.page.isDisabled('.ludo-roll'), true);
    await theirs.ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\nludo UI: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
