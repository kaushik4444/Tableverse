'use strict';
// Property Rivals in a real browser: the board ring, rolling, buying, auctions, trades, spectators and small screens.
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
    await page.waitForSelector('.pr', { timeout: 8000 });
    return { page, ctx };
  };
  const mutate = (fn) => { const m = tableMessages('propertyrivals', four); fn(m[1].view); return m; };

  await test('the board draws 40 squares in a ring, with start bottom-right and one token each', async () => {
    const { page, ctx } = await open(tableMessages('propertyrivals', four));
    assert.equal(await page.locator('.pr-sq').count(), 40);
    assert.equal(await page.locator('.pr-tok').count(), 4);
    const at = (i) => page.locator(`.pr-sq[data-sq="${i}"]`).boundingBox();
    const [s0, s10, s20, s30] = [await at(0), await at(10), await at(20), await at(30)];
    assert.ok(s10.x < s0.x && Math.abs(s10.y - s0.y) < 2, 'bottom row runs right to left');
    assert.ok(s20.y < s10.y && Math.abs(s20.x - s10.x) < 2, 'left column runs up');
    assert.ok(s30.x > s20.x && Math.abs(s30.y - s20.y) < 2, 'top row runs left to right');
    await ctx.close();
  });

  await test('your turn: roll sends a roll; others see who is rolling', async () => {
    const { page, ctx } = await open(tableMessages('propertyrivals', four));
    assert.match(await page.textContent('.wz-status'), /Your turn: roll/);
    await page.click('[data-pr="roll"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'roll' });
    await ctx.close();
    const m = mutate((v) => { v.turn = 1; v.myTurn = false; v.can.roll = false; });
    const o = await open(m);
    assert.equal(await o.page.locator('[data-pr="roll"]').count(), 0);
    assert.match(await o.page.textContent('.wz-status'), /Bo is rolling/);
    await o.ctx.close();
  });

  await test('buying: offers buy and pass/auction with the price', async () => {
    const { page, ctx } = await open(mutate((v) => { v.phase = 'buy'; v.players[0].pos = 3; v.can = { ...v.can, roll: false, buy: true, decline: true }; }));
    assert.match(await page.textContent('[data-pr="buy"]'), /Nairobi.*60/);
    await page.click('[data-pr="buy"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'buy' });
    await page.click('[data-pr="decline"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'decline' });
    await ctx.close();
  });

  await test('auction: bid input sends the amount, pass sends passBid', async () => {
    const { page, ctx } = await open(mutate((v) => { v.phase = 'auction'; v.auction = { sq: 3, high: 30, highBy: 1, out: [], cur: 0 }; v.can.roll = false; }));
    assert.match(await page.textContent('.pr-panel'), /High bid.*30.*Bo/);
    await page.click('[data-pr="bid"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'bid', amount: 31 });
    await page.click('[data-pr="passBid"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'passBid' });
    await ctx.close();
  });

  await test('property manager lists your cities with build / mortgage buttons', async () => {
    const { page, ctx } = await open(mutate((v) => { v.land[1] = { owner: 0, houses: 0, mortgaged: false }; v.land[3] = { owner: 0, houses: 0, mortgaged: false }; v.can.build = [1, 3]; v.can.mortgage = [1, 3]; }));
    await page.click('[data-pr="mgr"]');
    assert.equal(await page.locator('.pr-mgr li').count(), 2);
    await page.click('.pr-mgr [data-pr="build"][data-sq="1"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'build', square: 1 });
    await ctx.close();
  });

  await test('trade composer sends a proposal; an offer to you can be accepted', async () => {
    const m = mutate((v) => { v.land[1] = { owner: 0, houses: 0, mortgaged: false }; v.can.propose = true; });
    const { page, ctx } = await open(m);
    await page.click('[data-pr="tradeOpen"]');
    await page.click('[data-pr="tTarget"][data-i="1"]');
    await page.click('[data-pr="tGive"][data-sq="1"]');
    await page.click('[data-pr="tSend"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'propose', target: 'p1', give: [1], get: [], giveCash: 0, getCash: 0 });
    await ctx.close();
    const o = await open(mutate((v) => { v.phase = 'trade'; v.trade = { from: 1, to: 0, give: [3], get: [], giveCash: 10, getCash: 0 }; v.can.roll = false; }));
    await o.page.click('[data-pr="acceptTrade"]');
    assert.deepEqual((await sent(o.page)).at(-1).action, { type: 'acceptTrade' });
    await o.ctx.close();
  });

  await test('spectators get no controls; the board fits a phone without sideways scroll', async () => {
    const { page, ctx } = await open(mutate((v) => { v.me = -1; v.myTurn = false; for (const k of Object.keys(v.can)) v.can[k] = Array.isArray(v.can[k]) ? [] : false; }), { width: 360, height: 740 });
    assert.equal(await page.locator('.pr-actions button').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll');
    await ctx.close();
  });

  await test('game over shows the winner and results', async () => {
    const { page, ctx } = await open(mutate((v) => { v.phase = 'gameOver'; v.winner = 2; }));
    assert.match(await page.textContent('.overlay'), /Charlotte wins/);
    await ctx.close();
  });

  await test('a move walks the token square by square, then the messages describe the roll and the landing', async () => {
    const E = require('../../games/propertyrivals/engine'); const A = require('../../games/propertyrivals/actions');
    const people = four.map((p, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: p.name }));
    const g = E.createGame(people, {}, () => 0.5);
    const m = tableMessages('propertyrivals', four); const room = m[1].room;
    m[1].view = A.viewFor(g, 'me');
    const q = [3, 2].map((d) => (d - 0.5) / 6); g.rng = () => (q.length ? q.shift() : 0.5);
    A.applyAction(g, 'me', { type: 'roll' }); // 3 + 2 = 5: lands on Rotterdam Port, five squares away
    const after = A.viewFor(g, 'me');
    const { page, ctx } = await open(m);
    const seats = () => page.evaluate(() => { const t = document.querySelector('.pr-tok.p-a'); return t ? Number(t.closest('.pr-sq').dataset.sq) : -1; });
    assert.equal(await seats(), 0);
    await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room, view: after });
    await page.waitForSelector('.pr-news', { timeout: 3000 });
    assert.match(await page.textContent('.pr-news'), /rolled 3 \+ 2 = 5/, 'while the token walks the line shows the roll');
    const seen = [];
    for (let i = 0; i < 90; i++) { const at = await seats(); if (seen[seen.length - 1] !== at) seen.push(at); if (at === after.players[0].pos && i > 3) break; await page.waitForTimeout(60); }
    assert.equal(seen.at(-1), after.players[0].pos, 'the token ends where the server put it');
    assert.ok(seen.length >= 6, `it passed through the squares one by one: ${seen}`);
    assert.deepEqual(seen, seen.slice().sort((a, b) => a - b), 'it only moves forward');
    assert.equal(await page.locator('.cf-feed, .cf-msg').count(), 0, 'no floating feed: one line in the middle says what happened');
    await page.waitForFunction(() => { const n = document.querySelector('.pr-news'); return n && /landed on/.test(n.textContent); }, null, { timeout: 8000 });
    assert.equal(await page.locator('.pr-news').count(), 1, 'never more than one line');
    await ctx.close();
  });

  await test('while a token is walking the action buttons wait; they come back on arrival', async () => {
    const E = require('../../games/propertyrivals/engine'); const A = require('../../games/propertyrivals/actions');
    const people = four.map((p, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: p.name }));
    const g = E.createGame(people, {}, () => 0.5); const m = tableMessages('propertyrivals', four); const room = m[1].room;
    m[1].view = A.viewFor(g, 'me');
    const q = [3, 2].map((d) => (d - 0.5) / 6); g.rng = () => (q.length ? q.shift() : 0.5);
    A.applyAction(g, 'me', { type: 'roll' });
    const { page, ctx } = await open(m);
    await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room, view: A.viewFor(g, 'me') });
    await page.waitForTimeout(250);
    assert.match(await page.textContent('.pr-actions'), /Moving/);
    await page.waitForFunction(() => !/Moving/.test(document.querySelector('.pr-actions') ? document.querySelector('.pr-actions').textContent : ''), null, { timeout: 9000 });
    await ctx.close();
  });

  await test('the rivals list shows cash and net worth separately; the crown follows net worth, not cash', async () => {
    const { page, ctx } = await open(mutate((v) => {
      v.players[0].cash = 500; v.players[0].netWorth = 3200; // rich in property, short of cash
      v.players[1].cash = 1400; v.players[1].netWorth = 1450;
    }));
    const first = page.locator('.pr-players li').nth(0);
    const second = page.locator('.pr-players li').nth(1);
    assert.match(await first.textContent(), /net worth.*3,?200/);
    assert.match(await first.textContent(), /500/);
    assert.equal(await first.locator('.crown').count(), 1, 'the crown goes to the highest net worth');
    assert.equal(await second.locator('.crown').count(), 0);
    await ctx.close();
  });

  await test('tapping a holding opens the city card with rent, mortgage and build figures; close dismisses it', async () => {
    const m = mutate((v) => {
      v.land[1] = { owner: 0, houses: 0, mortgaged: false }; // Lagos, owned by you
      v.info[1] = { mortgage: 30, unmortgage: 33, house: 50, rentNow: 2 };
    });
    const { page, ctx } = await open(m);
    assert.equal(await page.locator('#pr-card-title').count(), 0);
    await page.click('[data-pr="card"][data-sq="1"]');
    assert.match(await page.textContent('#pr-card-title'), /Lagos/);
    const card = await page.textContent('.pr-card');
    assert.match(card, /Mortgage value[\s\S]*🪙30/);
    assert.match(card, /Unmortgage cost[\s\S]*🪙33/);
    assert.match(card, /Each house or hotel costs[\s\S]*🪙50/);
    assert.match(card, /Rent right now[\s\S]*🪙2/);
    assert.match(card, /No buildings[\s\S]*🪙2/);
    assert.match(card, /Hotel[\s\S]*🪙250/);
    await page.click('[data-pr="closeCard"]');
    assert.equal(await page.locator('#pr-card-title').count(), 0);
    await ctx.close();
  });

  await test('the current game settings show at the top right of a game; tapping them lists each setting', async () => {
    const { page, ctx } = await open(tableMessages('propertyrivals', four, { roomExtra: { options: { rounds: '30', startCash: '1500', auction: true, jackpot: false } } }));
    const chip = page.locator('.gs-chip');
    assert.equal(await chip.count(), 1);
    assert.match(await chip.getAttribute('aria-label'), /Game settings: .*Short: 30 rounds.*1,500 coins/);
    await chip.click();
    const list = await page.textContent('.gs-list');
    assert.match(list, /Game length/);
    assert.match(list, /Starting cash/);
    assert.match(list, /Auction unbought properties/);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
