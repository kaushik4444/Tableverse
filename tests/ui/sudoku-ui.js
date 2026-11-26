'use strict';
// Sudoku in a real browser: your grid, tapping and typing numbers, red mistakes, the others' progress lines (counts only), the answer after the game, and watchers.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const E = require('../../games/sudoku/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte'];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
let seed = 3;
const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clock = { t: 1000, now: () => clock.t };

/** A real game with three people (the first is you), and the messages a browser would receive for it. */
function table(setup = () => {}, { viewer = 'me', count = 3 } = {}) {
  const players = names.slice(0, count).map((n, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: n, bot: i === 2 }));
  const g = E.createGame(players, { difficulty: 'easy', pace: 'slow' }, rng, clock.now);
  setup(g);
  const room = { code: 'ABCDEF', gameId: 'sudoku', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: players.length, min: players.length === 1 ? 1 : 2, max: 8, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, viewer) }];
}
const firstEmpty = (view) => view.puzzle.findIndex((v) => !v);

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.su', { timeout: 8000 });
    return { page, ctx };
  };

  await test('your grid has 81 squares; given numbers cannot be tapped, empty ones can', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('.su-board .su-c').count(), 81);
    const givens = await page.locator('.su-board .su-c.su-clue').count();
    const taps = await page.locator('button.su-c').count();
    assert.ok(givens >= 30 && givens <= 42, 'easy gives about 40 numbers');
    assert.equal(givens + taps, 81, 'every square is either given or tappable');
    await ctx.close();
  });

  await test('tapping an empty square selects it; the number pad then sends that exact number', async () => {
    const msgs = table();
    const k = firstEmpty(msgs[1].view);
    const { page, ctx } = await open(msgs);
    assert.equal(await page.isDisabled('[data-su="num"][data-v="5"]'), true, 'pad is off until a square is chosen');
    await page.locator(`button.su-c[data-k="${k}"]`).click();
    assert.equal(await page.isDisabled('[data-su="num"][data-v="5"]'), false);
    await page.click('[data-su="num"][data-v="5"]');
    const act = (await sent(page)).at(-1).action;
    assert.deepEqual(act, { type: 'place', r: Math.floor(k / 9), c: k % 9, v: 5 });
    await ctx.close();
  });

  await test('typing a number on the keyboard works once a square is selected', async () => {
    const msgs = table();
    const k = firstEmpty(msgs[1].view);
    const { page, ctx } = await open(msgs);
    await page.locator(`button.su-c[data-k="${k}"]`).click();
    await page.keyboard.press('7');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'place', r: Math.floor(k / 9), c: k % 9, v: 7 });
    await ctx.close();
  });

  await test('a wrong number shows red, and the guidance asks for it to be fixed', async () => {
    const msgs = table((g) => {
      const k = g.puzzle.findIndex((v) => !v);
      E.applyAction(g, 'me', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] === 9 ? 8 : g.solution[k] + 1 });
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.su-board .su-c.su-bad').count(), 1);
    assert.match(await page.locator('.wz-status').innerText(), /Fix the 1 red number/);
    await ctx.close();
  });

  await test("the others' lines show a bar and a count, and no numbers of theirs appear anywhere", async () => {
    const msgs = table((g) => {
      const k = g.puzzle.findIndex((v) => !v);
      E.applyAction(g, 'p1', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] });
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.su-prog li').count(), 3);
    assert.equal(await page.locator('.su-prog .su-c').count(), 0, 'no grid squares in the progress lines');
    const text = await page.locator('.su-prog').innerText();
    assert.match(text, /Bo/);
    assert.match(text, /1\/\d+/, 'Bo shows one right square');
    assert.match(await page.locator('.su-prog li').nth(2).innerText(), /bot/, 'the bot is marked as a bot');
    await ctx.close();
  });

  await test('a watcher sees the progress and no number pad', async () => {
    const msgs = table(undefined, { viewer: 'nobody' });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.su-pad').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Watching the game/);
    await ctx.close();
  });

  await test('when the game is over the winner is named, the answer appears in gold, and Play again is for the host', async () => {
    const msgs = table((g) => {
      const empties = g.puzzle.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
      clock.t += 61000;
      for (const k of empties) E.applyAction(g, 'p1', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] });
    });
    const { page, ctx } = await open(msgs);
    assert.match(await page.locator('.overlay .sheet h2').innerText(), /Bo filled the grid first/);
    assert.ok(await page.locator('.su-c.su-answer').count() > 0, 'your empty squares show the answer');
    assert.equal(await page.locator('[data-su="again"]').count(), 1, 'the host can play again');
    assert.match(await page.locator('.su-final').innerText(), /Bo/);
    await ctx.close();
  });

  await test('you start with three hearts and three undos; undo is off until you have made a move', async () => {
    const msgs = table();
    const { page, ctx } = await open(msgs);
    assert.match(await page.locator('.su-hearts').innerText(), /♥♥♥/);
    assert.equal(await page.isDisabled('[data-su="undo"]'), true);
    assert.match(await page.locator('[data-su="undo"]').innerText(), /\(3\)/);
    await ctx.close();
  });

  await test('undo takes back your last move and sends the undo action', async () => {
    const msgs = table((g) => {
      const k = g.puzzle.findIndex((v) => !v);
      E.applyAction(g, 'me', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] });
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.isDisabled('[data-su="undo"]'), false, 'undo is on after a move');
    await page.click('[data-su="undo"]');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'undo' });
    await ctx.close();
  });

  await test('out of lives: no more squares or numbers to tap, the status says so, and the lost hearts are empty', async () => {
    const msgs = table((g) => {
      const empties = g.puzzle.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0).slice(0, 3);
      for (const k of empties) E.applyAction(g, 'me', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] === 9 ? 8 : g.solution[k] + 1 });
    });
    const { page, ctx } = await open(msgs);
    assert.match(await page.locator('.wz-status').innerText(), /out of lives/);
    assert.equal(await page.locator('button.su-c').count(), 0, 'no square can be tapped');
    assert.equal(await page.locator('.su-pad button:not([disabled])').count(), 0, 'the pad is off');
    assert.match(await page.locator('.su-hearts').innerText(), /♡♡♡/);
    assert.match(await page.locator('.su-prog li.me').innerText(), /out/);
    await ctx.close();
  });

  await test('solo: the third mistake ends the game at once with the game-over sheet', async () => {
    const msgs = table((g) => {
      const empties = g.puzzle.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0).slice(0, 3);
      for (const k of empties) E.applyAction(g, 'me', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] === 9 ? 8 : g.solution[k] + 1 });
    }, { count: 1 });
    const { page, ctx } = await open(msgs);
    assert.match(await page.locator('.overlay .sheet h2').innerText(), /Out of lives: game over/);
    assert.ok(await page.locator('.su-c.su-answer').count() > 0, 'the answer is shown');
    await ctx.close();
  });

  await test('when the game is over, a wrong number gives way to the answer in gold', async () => {
    let k = -1; let solution = null;
    const msgs = table((g) => {
      k = g.puzzle.findIndex((v) => !v);
      solution = g.solution;
      E.applyAction(g, 'me', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] === 9 ? 8 : g.solution[k] + 1 });
      clock.t += 61000;
      for (const x of g.puzzle.map((v, y) => (v ? -1 : y)).filter((y) => y >= 0)) E.applyAction(g, 'p1', { type: 'place', r: Math.floor(x / 9), c: x % 9, v: g.solution[x] });
    });
    const { page, ctx } = await open(msgs);
    const cell = page.locator('.su-board .su-c').nth(k);
    assert.equal(await cell.innerText(), String(solution[k]), 'the right number is shown, not the wrong one');
    assert.match(await cell.getAttribute('class'), /su-answer/);
    await ctx.close();
  });

  await test('a redraw keeps keyboard focus on the grid square you are typing in', async () => {
    let G = null;
    const msgs = table((g) => { G = g; });
    const k = firstEmpty(msgs[1].view);
    const r = Math.floor(k / 9); const c = k % 9;
    const wrong = G.solution[k] === 7 ? 8 : 7; // a wrong number keeps the square open for another try
    const { page, ctx } = await open(msgs);
    await page.locator(`button.su-c[data-k="${k}"]`).click();
    await page.keyboard.press(String(wrong));
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'place', r, c, v: wrong });
    // the server's reply: the grid is redrawn with the number in it
    E.applyAction(G, 'me', { type: 'place', r, c, v: wrong });
    await page.evaluate((m) => window.__push(m), { t: 'state', room: msgs[1].room, view: E.viewFor(G, 'me') });
    await page.waitForFunction(() => document.querySelector('.su-board .su-c.su-bad'));
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-k')), String(k), 'focus is back on the square');
    await page.keyboard.press('Backspace');
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'erase', r, c }, 'the keyboard still works after the redraw');
    await ctx.close();
  });

  await test('a redraw does not move focus off another control, such as the number pad', async () => {
    let G = null;
    const msgs = table((g) => { G = g; });
    const k = firstEmpty(msgs[1].view);
    const { page, ctx } = await open(msgs);
    await page.locator(`button.su-c[data-k="${k}"]`).click();
    await page.click('[data-su="num"][data-v="5"]');
    E.applyAction(G, 'me', { type: 'place', r: Math.floor(k / 9), c: k % 9, v: 5 });
    await page.evaluate((m) => window.__push(m), { t: 'state', room: msgs[1].room, view: E.viewFor(G, 'me') });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('su-c')), false, 'focus is not pulled onto the grid');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\nsudoku UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
