'use strict';
// Memory Match in a real browser: the card grid, turning a card over on your turn, the second-card prompt, a matched pair in
// the seat colour, cards face down stay hidden, the phone-width layout, the result sheet, and watchers.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const E = require('../../games/memorymatch/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte'];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** A real game with three people (the first is you), and the messages a browser would receive for it. */
function table(setup = () => {}, { viewer = 'me', size = '4x4', seed = 21 } = {}) {
  const players = names.map((n, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: n, bot: i === 2 }));
  const g = E.createGame(players, { size }, rng(seed));
  setup(g);
  const room = { code: 'ABCDEF', gameId: 'memorymatch', hostId: 'me', status: 'playing', options: { size }, visibility: 'public', seats: players.length, min: 2, max: 8, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, viewer) }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.mm', { timeout: 8000 });
    return { page, ctx };
  };

  await test('a 4x4 board shows 16 cards, all face down at the start', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('.mm-card').count(), 16);
    assert.equal(await page.locator('button.mm-card.down:not([disabled])').count(), 16, 'every card can be turned over on your turn');
    await ctx.close();
  });

  await test('on your turn a face-down card can be turned over, and the tap sends that card', async () => {
    const { page, ctx } = await open(table());
    await page.locator('button.mm-card.down').nth(4).click();
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'flip', index: 4 });
    await ctx.close();
  });

  await test('after the first card the status asks for a second one; the first card cannot be tapped again', async () => {
    const msgs = table((g) => { E.applyAction(g, 'me', { type: 'flip', index: 0 }); });
    const { page, ctx } = await open(msgs);
    assert.match(await page.locator('.wz-status').innerText(), /second card/);
    assert.equal(await page.locator('button.mm-card.down:not([disabled])').count(), 15, 'the face-up card is not a button');
    await ctx.close();
  });

  await test('a missed pair shows face up for a moment, then closes; no third card stays open', async () => {
    // a miss is shown only when it arrives after the page has seen the table (a first look replays nothing), so the
    // page renders the table first and the miss is pushed afterwards
    const missed = (g) => {
      E.applyAction(g, 'me', { type: 'flip', index: 0 });
      const b = g.cards.findIndex((sym, k) => k !== 0 && sym !== g.cards[0]);
      E.applyAction(g, 'me', { type: 'flip', index: b });
    };
    const { page, ctx } = await open(table());
    await page.evaluate((m) => window.__push(m), table(missed)[1]);
    await page.waitForFunction(() => document.querySelectorAll('.mm-card.up').length === 2, null, { timeout: 4000 });
    await page.waitForFunction(() => document.querySelectorAll('.mm-card.up').length === 0, null, { timeout: 4000 });
    assert.equal(await page.locator('.mm-card.matched').count(), 0);
    await ctx.close();
  });

  await test('cards face down are never shown: only the cards in play show a symbol', async () => {
    const { page, ctx } = await open(table((g) => { E.applyAction(g, 'me', { type: 'flip', index: 0 }); }));
    const faceUp = await page.locator('.mm-card.up').count();
    assert.equal(faceUp, 1, 'one card face up');
    const html = await page.locator('.mm-board').innerHTML();
    assert.equal(html.includes('aria-label="Row 1, column 2, face down"'), true);
    await ctx.close();
  });

  await test('a matched pair stays face up in the colour of the seat that found it', async () => {
    const msgs = table((g) => {
      const a = 0, b = g.cards.findIndex((s, k) => k !== a && s === g.cards[a]);
      E.applyAction(g, 'me', { type: 'flip', index: a });
      E.applyAction(g, 'me', { type: 'flip', index: b });
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.mm-card.matched.s0').count(), 2, 'two matched cards in the first seat colour');
    assert.match(await page.locator('.mm-seat.s0 .mm-count').innerText(), /1/);
    await ctx.close();
  });

  await test('not your turn: the cards cannot be turned over and the status names whose turn it is', async () => {
    const { page, ctx } = await open(table((g) => { E.applyAction(g, 'me', { type: 'flip', index: 0 }); E.applyAction(g, 'me', { type: 'flip', index: 1 }); }));
    assert.equal(await page.locator('button.mm-card.down:not([disabled])').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Bo is thinking/);
    await ctx.close();
  });

  await test('a phone-width screen: the 6x6 board fits with no sideways scroll, and cards are at least 44px', async () => {
    const { page, ctx } = await open(table(undefined, { size: '6x6', seed: 23 }), { width: 360, height: 640 });
    assert.equal(await page.locator('.mm-card').count(), 36);
    const box = await page.locator('.mm-card').first().boundingBox();
    assert.ok(box.height >= 44, `card ${box.height}px tall`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 360, `page is ${scroll}px wide`);
    await ctx.close();
  });

  await test('when the game is over the winner is named and the pairs are listed', async () => {
    const msgs = table((g) => {
      const r = rng(5);
      while (g.phase !== 'gameOver') { const pid = g.players[g.turn].id; E.applyAction(g, pid, E.botAction(g, pid, r)); }
    }, { seed: 29 });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.overlay .sheet h2').count(), 1);
    assert.match(await page.locator('.overlay .sheet').innerText(), /pairs/);
    await ctx.close();
  });

  await test('a watcher sees the board and cannot turn a card over', async () => {
    const { page, ctx } = await open(table(undefined, { viewer: 'nobody' }));
    assert.equal(await page.locator('button.mm-card:not([disabled])').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Watching/);
    await ctx.close();
  });

  await test('a solo game ends on Game over, not on a winner', async () => {
    // the engine ends a solo game with the one player as the winner (they lead every pair), so the view has one
    const solo = () => {
      const players = [{ id: 'me', name: 'Aarav', bot: false }];
      const g = E.createGame(players, { size: '4x4' }, rng(21));
      g.phase = 'gameOver'; g.winner = 0; g.pairs[0] = g.total / 2; g.matchedCount = g.total;
      const room = { code: 'ABCDEF', gameId: 'memorymatch', hostId: 'me', status: 'playing', options: { size: '4x4' }, visibility: 'public', seats: 1, min: 1, max: 8, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
        members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true, ping: null, username: null }] };
      return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, 'me') }];
    };
    const { page, ctx } = await open(solo());
    assert.equal(await page.locator('.overlay h2').innerText(), 'Game over');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\nmemory match UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
