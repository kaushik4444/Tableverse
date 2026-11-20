'use strict';
// Chess in a real browser: the board and tapping to move, promotion, the flipped board for Black, check and game-over, the move list and small screens.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const E = require('../../games/chess/engine');
const R = require('../../games/chess/rules');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const players = [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'Bo' }];
const sq = (n) => (Number(n[1]) - 1) * 8 + (n.charCodeAt(0) - 97);
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

/** A game built by the real engine: colour is who has White ('host' = me), fen optionally sets the position, moves are [seatId, from, to, promo?]. */
function game({ colour = 'host', fen = null, moves = [] } = {}) {
  const g = E.createGame(players, { colour }, () => 0.1);
  if (fen) g.pos = R.fromFEN(fen);
  for (const [who, f, t, promo] of moves) assert.equal(E.applyAction(g, who, { type: 'move', from: sq(f), to: sq(t), promo: promo || null }).ok, true, `${f}-${t}`);
  return g;
}
const msgsFor = (g, viewer = 'me') => { const m = tableMessages('chess', [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'Bo' }]); m[1].view = E.viewFor(g, viewer); return m; };

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (m, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages: m, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.ch-board', { timeout: 8000 });
    return { page, ctx };
  };

  await test('board: 64 squares, my turn as White, tapping a piece then its target sends the move', async () => {
    const { page, ctx } = await open(msgsFor(game({ colour: 'host' })));
    assert.equal(await page.locator('[data-sq]').count(), 64);
    assert.match(await page.textContent('.wz-status'), /Your move/);
    assert.equal(await page.isDisabled('[data-sq="' + sq('e2') + '"]'), false);
    await page.click('[data-sq="' + sq('e2') + '"]');
    assert.equal(await page.locator('.dot').count() > 0, true, 'target squares are marked');
    await page.click('[data-sq="' + sq('e4') + '"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'move', from: sq('e2'), to: sq('e4'), promo: null });
    await ctx.close();
  });

  await test('not my turn: every square is disabled and the status names the other player', async () => {
    const g = game({ colour: 'guest' }); // Bo (second seat) is White and moves first
    const { page, ctx } = await open(msgsFor(g));
    assert.equal(await page.locator('[data-sq]:not(:disabled)').count(), 0);
    assert.match(await page.textContent('.wz-status'), /Bo/);
    await ctx.close();
  });

  await test('Black sees the board flipped, with their own pieces at the bottom', async () => {
    const { page, ctx } = await open(msgsFor(game({ colour: 'guest' })));
    assert.equal(await page.locator('.ch-board.flip').count(), 1);
    // Viewed from Black's side the first square of the top row is h1 (the board is turned around).
    assert.match(await page.getAttribute('[data-sq]', 'aria-label'), /^h1/);
    await ctx.close();
  });

  await test('promotion: a tap on an empty square cancels the open picker and sends no move', async () => {
    const g = game({ colour: 'host', fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1' });
    const { page, ctx } = await open(msgsFor(g));
    await page.click('[data-sq="' + sq('e7') + '"]');
    await page.click('[data-sq="' + sq('e8') + '"]');
    assert.equal(await page.locator('.ch-promo').count(), 1);
    await page.click('[data-sq="' + sq('e4') + '"]');
    assert.equal(await page.locator('.ch-promo').count(), 0, 'the picker closes');
    assert.equal((await sent(page)).filter((m) => m.action && m.action.type === 'move').length, 0, 'no move is sent');
    await ctx.close();
  });

  await test('promotion: a redraw with the picker still open keeps focus on the piece the player is choosing', async () => {
    const g = game({ colour: 'host', fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1' });
    const msgs = msgsFor(g);
    const { page, ctx } = await open(msgs);
    await page.click('[data-sq="' + sq('e7') + '"]');
    await page.click('[data-sq="' + sq('e8') + '"]');
    await page.focus('[data-ch-promo="N"]');
    // an unchanged position with a new state (e.g. a spectator joins): the board is redrawn
    const same = JSON.parse(JSON.stringify(msgs[1])); same.view.spectators = 1;
    await page.evaluate((m) => window.__push(m), same);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.chPromo), 'N', 'Knight keeps focus');
    assert.equal(await page.locator('.ch-promo').count(), 1, 'the picker is still open');
    await ctx.close();
  });

  await test('promotion: choosing a pawn’s last-rank square opens the picker and sends the chosen piece', async () => {
    const g = game({ colour: 'host', fen: 'k7/4P3/8/8/8/8/8/K7 w - - 0 1' });
    const { page, ctx } = await open(msgsFor(g));
    await page.click('[data-sq="' + sq('e7') + '"]');
    await page.click('[data-sq="' + sq('e8') + '"]');
    assert.equal(await page.locator('.ch-promo').count(), 1);
    await page.click('[data-ch-promo="N"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'move', from: sq('e7'), to: sq('e8'), promo: 'N' });
    await ctx.close();
  });

  await test('check: the king is highlighted while in check', async () => {
    const g = game({ colour: 'host', fen: 'k7/8/8/8/8/8/4q3/4K3 w - - 0 1' });
    const { page, ctx } = await open(msgsFor(g));
    assert.equal(await page.locator('.ch-sq.check').count(), 1);
    assert.equal(await page.getAttribute('.ch-sq.check', 'data-sq'), String(sq('e1')));
    await ctx.close();
  });

  await test('move list: moves appear as numbered pairs, White then Black', async () => {
    const g = game({ colour: 'host', moves: [['me', 'e2', 'e4'], ['p1', 'e7', 'e5'], ['me', 'g1', 'f3']] });
    const { page, ctx } = await open(msgsFor(g, 'p1'));
    assert.equal(await page.locator('.ch-log .ch-n').count(), 2);
    assert.equal(await page.textContent('.ch-log li:nth-child(1) .ch-w'), 'e4');
    assert.equal(await page.textContent('.ch-log li:nth-child(1) .ch-b'), 'e5');
    assert.equal(await page.textContent('.ch-log li:nth-child(2) .ch-w'), 'Nf3');
    await ctx.close();
  });

  await test('checkmate: the game-over sheet names the winner; the loser sees they lost', async () => {
    const g = game({ colour: 'host', moves: [['me', 'f2', 'f3'], ['p1', 'e7', 'e5'], ['me', 'g2', 'g4'], ['p1', 'd8', 'h4']] });
    const { page, ctx } = await open(msgsFor(g, 'me'));
    assert.match(await page.textContent('.overlay'), /Bo won/);
    await ctx.close();
    const w = await open(msgsFor(g, 'p1'));
    assert.match(await w.page.textContent('.overlay'), /You won/);
    await w.ctx.close();
  });

  await test('resignation: a name with an ampersand is shown once, not as &amp; in the game-over text', async () => {
    const named = [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'A&B' }];
    const g = E.createGame(named, { colour: 'host' }, () => 0.1);
    assert.equal(E.applyAction(g, 'me', { type: 'resign' }).ok, true);
    const m = tableMessages('chess', named);
    m[1].view = E.viewFor(g, 'me');
    const { page, ctx } = await open(m);
    const text = await page.textContent('.overlay');
    assert.match(text, /A&B won: you resigned/, 'the explanation reads A&B');
    assert.doesNotMatch(text, /&amp;/, 'no doubly escaped ampersand is shown');
    await ctx.close();
  });

  await test('phone width (375px): the board fits the screen and the page does not scroll sideways', async () => {
    const { page, ctx } = await open(msgsFor(game({ colour: 'host' })), { width: 375, height: 667 });
    const box = await page.locator('.ch-board').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 375, `board ${box.width}px wide sits inside the 375px screen`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no horizontal scroll');
    await ctx.close();
  });

  await test('a spectator is told which seat resigned, not that they resigned', async () => {
    const g = E.createGame(players, { colour: 'host' }, () => 0.1);
    assert.equal(E.applyAction(g, 'me', { type: 'resign' }).ok, true);
    const m = tableMessages('chess', players);
    m[1].view = E.viewFor(g, 'spectator');
    const { page, ctx } = await open(m);
    const text = await page.textContent('.overlay');
    assert.match(text, /Bo won: Aarav resigned/, 'the losing seat is named');
    assert.doesNotMatch(text, /you resigned/);
    await ctx.close();
  });

  await test('keyboard: the focused square stays focused after a selection re-renders the board', async () => {
    const { page, ctx } = await open(msgsFor(game({ colour: 'host' })));
    await page.focus('[data-sq="' + sq('e2') + '"]');
    await page.keyboard.press('Enter');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.sq);
    assert.equal(focused, String(sq('e2')), 'focus did not fall back to the page');
    await ctx.close();
  });

  await test('a tap elsewhere on the board cancels an open promotion choice', async () => {
    const g = game({ colour: 'host', fen: 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1' });
    const { page, ctx } = await open(msgsFor(g));
    await page.click('[data-sq="' + sq('e7') + '"]');
    await page.click('[data-sq="' + sq('e8') + '"]');
    assert.equal(await page.locator('[data-ch-promo]').count(), 4, 'the picker is open');
    await page.click('[data-sq="' + sq('e1') + '"]'); // tap my own king instead: an enabled square
    assert.equal(await page.locator('[data-ch-promo]').count(), 0, 'the picker closed');
    assert.equal((await sent(page)).length, 0, 'nothing was sent');
    await ctx.close();
  });

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} chess UI tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
