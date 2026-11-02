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
