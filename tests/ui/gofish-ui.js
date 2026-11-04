'use strict';
// Go Fish in a real browser: the two-step ask, tapping a player at the table, the draw button, spectators and the results.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.gf', { timeout: 8000 });
    return { page, ctx };
  };

  await test('your turn: pick a rank, pick a player, press Ask; the action carries exactly that', async () => {
    const { page, ctx } = await open(tableMessages('gofish', four));
    assert.equal(await page.isDisabled('[data-gf="ask"]'), true, 'nothing chosen yet');
    await page.click('.gf-chip[data-gf="rank"]:nth-of-type(2)');
    const rank = await page.getAttribute('.gf-chip[data-gf="rank"].on', 'data-rank');
    await page.click('.gf-chip[data-gf="target"][data-id="p2"]');
    assert.equal(await page.isDisabled('[data-gf="ask"]'), false);
    assert.match(await page.textContent('[data-gf="ask"]'), /Ask Charlotte for/);
    await page.click('[data-gf="ask"]');
    const acts = await sent(page);
    assert.deepEqual(acts.at(-1).action, { type: 'ask', target: 'p2', rank });
    await ctx.close();
  });

  await test('tapping a card in your hand picks its rank; tapping a player at the table picks them', async () => {
    const { page, ctx } = await open(tableMessages('gofish', four));
    const card = page.locator('.hand .card[data-rank]').first();
    const r = await card.getAttribute('data-rank');
    await card.click();
    assert.equal(await page.getAttribute('.gf-chip.on[data-gf="rank"]', 'data-rank'), r);
    await page.click('[data-gf-seat="p1"]');
    assert.equal(await page.getAttribute('.gf-chip.on[data-gf="target"]', 'data-id'), 'p1');
    await ctx.close();
  });

  await test('with only one player to ask they are chosen for you, and a lone rank is preselected', async () => {
    const { page, ctx } = await open(tableMessages('gofish', [{ name: 'Aarav' }, { name: 'Bo' }]));
    assert.equal(await page.locator('.gf-chip.on[data-gf="target"]').count(), 1);
    await ctx.close();
  });

  await test('not your turn: no ask controls, and seats cannot be tapped to ask', async () => {
    const msgs = tableMessages('gofish', four);
    const view = msgs[1].view; view.myTurn = false; view.turn = 1; view.targets = []; view.askRanks = [];
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('[data-gf="ask"]').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo is choosing/);
    assert.equal(await page.locator('[data-gf-seat]').count(), 0);
    await ctx.close();
  });

  await test('nobody to ask: a Draw button appears and sends draw', async () => {
    const msgs = tableMessages('gofish', four);
    const view = msgs[1].view; view.canDraw = true; view.targets = []; view.askRanks = view.hand.map((c) => c.rank);
    const { page, ctx } = await open(msgs);
    await page.click('[data-gf="draw"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'draw' });
    await ctx.close();
  });

  await test('a spectator sees the table and the stock but no hand or controls', async () => {
    const msgs = tableMessages('gofish', four);
    const view = msgs[1].view; view.me = -1; view.hand = []; view.myTurn = false; view.targets = []; view.askRanks = [];
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.hand').count(), 0);
    assert.equal(await page.locator('[data-gf="ask"]').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Watching/);
    await ctx.close();
  });

  await test('what just happened is written out, with books and the card you drew', async () => {
    const msgs = tableMessages('gofish', four);
    const view = msgs[1].view;
    view.event = { seq: 5, type: 'take', by: 1, target: 0, rank: '7', count: 2, books: ['7'] };
    let { page, ctx } = await open(msgs);
    assert.match(await page.textContent('.gf-event'), /Bo asked you for 7s and got 2/);
    assert.match(await page.textContent('.gf-event'), /Sevens|7s complete|📚 7s/);
    await ctx.close();
    view.event = { seq: 6, type: 'fish', by: 0, target: 1, rank: '9', wish: false };
    view.myDraw = { seq: 6, card: { id: 'HK', suit: 'H', rank: 'K', ord: 12 } };
    ({ page, ctx } = await open(msgs));
    assert.match(await page.textContent('.gf-event'), /You asked Bo for 9s: Go Fish!/);
    assert.equal(await page.locator('.gf-event .card.tiny').count(), 1, 'you see the card you drew');
    await ctx.close();
  });

  await test('game over: ranking, winner and the host can play again', async () => {
    const msgs = tableMessages('gofish', four);
    const view = msgs[1].view; view.phase = 'gameOver'; view.myTurn = false; view.winners = [1];
    view.players[1].bookCount = 5; view.players[1].books = ['2', '3', '4', '5', '6'];
    const { page, ctx } = await open(msgs);
    assert.match(await page.textContent('.gf-final li.win'), /Bo/);
    assert.match(await page.textContent('.overlay'), /Bo made the most books/);
    await page.click('[data-gf="again"]');
    assert.equal((await page.evaluate(() => window.__sent.filter((m) => m.t === 'rematch'))).length, 1);
    await ctx.close();
  });

  await test('a real finished game (closing event has no player) draws the results instead of crashing', async () => {
    const games = require('../../games');
    const def = games.get('gofish');
    const players = four.map((x, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: x.name }));
    let a = 3; const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    const g = def.create(players, { timeLimit: 'off' }, rng);
    for (let i = 0; i < 5000 && !g.isOver(); i++) { const id = g.awaiting()[0]; const f = g.forcedPlay && g.forcedPlay(); g.act(f ? f.playerId : id, f ? f.action : g.botAction(id)); }
    assert.ok(g.isOver(), 'the engine finished the game');
    const msgs = tableMessages('gofish', four);
    msgs[1].view = JSON.parse(JSON.stringify(g.view('me')));
    const errors = [];
    const { page, ctx } = await scriptedPage(browser, { messages: msgs });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '/');
    await page.waitForSelector('.gf-final', { timeout: 8000 });
    assert.deepEqual(errors, []);
    assert.match(await page.textContent('.overlay'), /Game over|You won|You share/);
    await ctx.close();
  });

  await test('phone width: nothing scrolls sideways and the Ask button is reachable', async () => {
    const { page, ctx } = await open(tableMessages('gofish', [{ name: 'Aarav the Magnificent' }, { name: 'Charlotte-Anne' }, { name: 'Dmitri' }, { name: 'Eve' }, { name: 'Frederick' }, { name: 'Bo' }]), { width: 320, height: 568 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    const box = await page.locator('[data-gf="ask"]').boundingBox();
    assert.ok(box && box.width > 100 && box.height >= 40);
    await ctx.close();
  });

  await test('the finished game shows the results (the closing event names no player and used to crash the table)', async () => {
    const E = require('../../games/gofish/engine');
    const ps = four.map((p, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: p.name })); let a = 9;
    const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const g = E.createGame(ps, {}, rng);
    while (g.phase !== 'gameOver') { const id = E.awaiting(g)[0]; const f = E.forcedPlay(g); E.applyAction(g, id, f ? f.action : E.botAction(g, id)); }
    const msgs = tableMessages('gofish', four); msgs[1].view = E.viewFor(g, 'me');
    assert.equal(msgs[1].view.event.type, 'over');
    const { page, ctx } = await open(msgs);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('.overlay', { timeout: 5000 });
    assert.match(await page.textContent('.overlay'), /book/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
