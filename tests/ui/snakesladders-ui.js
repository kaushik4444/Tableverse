'use strict';
// Snakes and Ladders in a real browser: rolling, whose turn it is, the drawn board and tokens, spectators, results, small screens.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const engine = require('../../games/snakesladders/engine');
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
    await page.waitForSelector('.sl', { timeout: 8000 });
    return { page, ctx };
  };

  await test('your turn: the Roll button is enabled and sends a roll', async () => {
    const { page, ctx } = await open(tableMessages('snakesladders', four));
    assert.match(await page.textContent('.wz-status'), /Your turn: roll the dice/);
    assert.equal(await page.isDisabled('[data-sl="roll"]'), false);
    await page.click('[data-sl="roll"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'roll' });
    await ctx.close();
  });

  await test('after a roll the token walks square by square to its new square', async () => {
    const msgs = tableMessages('snakesladders', four);
    const g = engine.createGame(four.map((p, i) => ({ id: i ? 'p' + i : 'me', name: p.name })), {}, () => (4 - 1) / 6 + 0.01);
    engine.applyAction(g, 'me', { type: 'roll' });
    const view = engine.viewFor(g, 'me');
    assert.equal(view.event.type, 'turn');
    assert.equal(view.lastRoll.to, 25);
    const { page, ctx } = await open(msgs);
    await page.evaluate((m) => window.__push(m), { t: 'state', room: msgs[1].room, view });
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      seen.add(await page.evaluate(() => { const t = document.querySelector('.sl-token[data-i="0"]'); return t ? t.style.left + '|' + t.style.top : ''; }));
      if (await page.evaluate(() => document.querySelector('.sl-token[data-i="0"]').getAttribute('aria-label') === 'Aarav on square 25')) break;
      await page.waitForTimeout(100);
    }
    assert.ok(seen.size >= 5, `the token was drawn on several squares on its way (${seen.size} distinct positions)`);
    assert.equal(await page.evaluate(() => document.querySelector('.sl-token[data-i="0"]').getAttribute('aria-label')), 'Aarav on square 25');
    await ctx.close();
  });

  await test('joining another table does not replay its previous roll', async () => {
    const msgs = tableMessages('snakesladders', four);
    const { page, ctx } = await open(msgs);
    const players = four.map((p, i) => ({ id: i ? 'p' + i : 'me', name: p.name }));
    const g = engine.createGame(players, {}, () => (4 - 1) / 6 + 0.01);
    g.turn = 3;
    engine.applyAction(g, 'p3', { type: 'roll' });
    const room = { ...msgs[1].room, code: 'GHIJKL' };
    const view = engine.viewFor(g, 'me');
    await page.evaluate((m) => window.__push(m), { t: 'state', room, view });
    assert.equal(view.lastRoll.to, 25);
    assert.equal(await page.evaluate(() => document.querySelector('.sl-token[data-i="3"]').getAttribute('aria-label')), 'Dmitri on square 25');
    assert.equal(await page.isDisabled('[data-sl="roll"]'), false);
    await ctx.close();
  });

  await test('reduced motion disables token hop animations', async () => {
    const { page, ctx } = await open(tableMessages('snakesladders', four));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const animation = await page.locator('.sl-token').first().evaluate((token) => {
      token.classList.add('hop');
      return getComputedStyle(token).animationName;
    });
    assert.equal(animation, 'none');
    await ctx.close();
  });

  await test('not your turn: the button is disabled and names who we wait for', async () => {
    const msgs = tableMessages('snakesladders', four);
    const view = msgs[1].view; view.turn = 1; view.myTurn = false; view.canRoll = false;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.isDisabled('[data-sl="roll"]'), true);
    assert.match(await page.textContent('[data-sl="roll"]'), /Waiting for Bo/);
    assert.match(await page.textContent('.wz-status'), /Bo is rolling/);
    await ctx.close();
  });

  await test('the board draws 100 numbered squares, 8 ladders, 9 snakes and one token per player', async () => {
    const { page, ctx } = await open(tableMessages('snakesladders', four));
    assert.equal(await page.locator('.sl-sq').count(), 100);
    assert.equal(await page.locator('.sl-ladder').count(), 8);
    assert.equal(await page.locator('.sl-snake').count(), 9);
    assert.equal(await page.locator('.sl-token').count(), 4);
    assert.equal(await page.locator('.sl-token.me').count(), 1);
    // numbers wind up the board: square 1 bottom-left, 10 bottom-right, 11 directly above 10, 100 top-left
    const at = (n) => page.locator('.sl-sq', { has: page.locator(`i:text-is("${n}")`) }).boundingBox();
    const [b1, b10, b11] = [await at(1), await at(10), await at(11)];
    assert.ok(b1.x < b10.x && Math.abs(b1.y - b10.y) < 2, '1 to 10 runs left to right');
    assert.ok(Math.abs(b11.x - b10.x) < 2 && b11.y < b10.y, '11 sits above 10');
    await ctx.close();
  });

  await test('a token stands on the centre of its square, and tokens sharing a square are spread apart', async () => {
    const msgs = tableMessages('snakesladders', four);
    const view = msgs[1].view; view.players[0].pos = 15; view.players[1].pos = 15; view.players[2].pos = 100;
    const { page, ctx } = await open(msgs);
    const sq = await page.locator('.sl-sq.goal').boundingBox();
    const tok = await page.locator('.sl-token').nth(2).boundingBox();
    assert.ok(Math.abs(tok.x + tok.width / 2 - (sq.x + sq.width / 2)) < 3 && Math.abs(tok.y + tok.height / 2 - (sq.y + sq.height / 2)) < 3, 'token 3 is on square 100');
    const a = await page.locator('.sl-token').nth(0).boundingBox();
    const b = await page.locator('.sl-token').nth(1).boundingBox();
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 4, 'two tokens on one square do not hide each other');
    await ctx.close();
  });

  await test('what just happened is written out and the last roll shows on the die', async () => {
    const msgs = tableMessages('snakesladders', four);
    const view = msgs[1].view; view.lastRoll = { by: 1, dice: 4, seq: 3 }; view.log = [{ by: 'Bo', card: 'rolled a 4, climbed a ladder from 4 to 25', kind: 'ladder' }];
    const { page, ctx } = await open(msgs);
    assert.match(await page.textContent('.sl-feedback'), /Bo rolled a 4, climbed a ladder from 4 to 25/);
    assert.match(await page.textContent('.sl-panel-copy'), /Bo rolled a 4/);
    assert.equal(await page.locator('.sl-die i').count(), 4, 'four pips');
    await ctx.close();
  });

  await test('a spectator sees the board but has no roll button', async () => {
    const msgs = tableMessages('snakesladders', four);
    const view = msgs[1].view; view.me = -1; view.myTurn = false; view.canRoll = false;
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('[data-sl="roll"]').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Watching/);
    await ctx.close();
  });

  await test('game over: placings, winner and the host can play again', async () => {
    const msgs = tableMessages('snakesladders', four);
    const view = msgs[1].view; view.phase = 'gameOver'; view.myTurn = false; view.canRoll = false; view.winner = 1;
    view.players[1].pos = 100; view.players[0].pos = 60; view.placings = [1, 0, 2, 3];
    const { page, ctx } = await open(msgs);
    assert.match(await page.textContent('.sl-final li.win'), /Bo/);
    assert.match(await page.textContent('.overlay'), /Bo reached square 100 first/);
    await page.click('[data-sl="again"]');
    assert.equal((await page.evaluate(() => window.__sent.filter((m) => m.t === 'rematch'))).length, 1);
    await ctx.close();
  });

  await test('phone width: nothing scrolls sideways and the Roll button is on screen', async () => {
    const { page, ctx } = await open(tableMessages('snakesladders', [{ name: 'Aarav the Magnificent' }, { name: 'Charlotte-Anne' }, { name: 'Dmitri' }, { name: 'Eve' }]), { width: 320, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    const box = await page.locator('[data-sl="roll"]').boundingBox();
    assert.ok(box && box.width > 100 && box.height >= 40);
    await ctx.close();
  });

  await test('short laptop screen: the whole board fits in the window', async () => {
    const { page, ctx } = await open(tableMessages('snakesladders', four), { width: 1280, height: 720 });
    const b = await page.locator('.sl-board').boundingBox();
    assert.ok(b.y + b.height <= 720, `board bottom ${Math.round(b.y + b.height)} is inside 720`);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
