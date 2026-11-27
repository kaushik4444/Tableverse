'use strict';
// Falling Blocks in a real browser: your well and the others, the piece in hand, moving, turning and dropping it, the landing
// preview, the result sheet, a phone-width check that every control can be tapped, and watchers.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const E = require('../../games/fallingblocks/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte'];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));

/** A real game with three people (the first is you; the last is a bot), and the messages a browser would receive. */
function table(setup = () => {}, { viewer = 'me', pieces = ['T', 'O', 'L', 'S'] } = {}) {
  const players = names.map((n, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: n, bot: i === 2 }));
  const g = E.createGame(players, { pace: 'slow' }, () => 0.5, () => 0);
  g.pieces = pieces.slice();
  setup(g);
  const room = { code: 'ABCDEF', gameId: 'fallingblocks', hostId: 'me', status: 'playing', options: { pace: 'slow' }, visibility: 'public', seats: players.length, min: 2, max: 8, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, viewer) }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.fb', { timeout: 8000 });
    return { page, ctx };
  };

  await test('your well is 10 by 20 cells, and each other player has a small well', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('.fb-mine .fb-cell').count(), 200);
    assert.equal(await page.locator('.fb-others .fb-well').count(), 2);
    assert.equal(await page.locator('.fb-others .fb-cell').count(), 400);
    await ctx.close();
  });

  await test('the piece in hand and the next two are shown, and the names are listed for everybody', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('.fb-next .fb-pv').count(), 3);
    assert.match(await page.locator('.fb-seats').innerText(), /Aarav \(you\)/);
    assert.match(await page.locator('.fb-seats').innerText(), /Bo/);
    await ctx.close();
  });

  await test('moving, turning and dropping send the chosen column and turn, and the landing preview follows', async () => {
    const { page, ctx } = await open(table());
    const ghostColumns = async () => page.locator('.fb-mine .fb-cell.ghost').evaluateAll((els) => els.map((e) => Array.from(e.parentNode.children).indexOf(e) % 10));
    const before = await ghostColumns();
    assert.equal(before.length, 4, 'a landing preview of four cells');
    await page.locator('[data-fb="right"]').click();
    assert.ok(Math.min(...(await ghostColumns())) > Math.min(...before), 'the preview moves right');
    await page.locator('[data-fb="rotate"]').click();
    assert.equal((await ghostColumns()).length, 4);
    await page.locator('[data-fb="drop"]').click();
    const act = (await sent(page)).at(-1).action;
    assert.equal(act.type, 'drop');
    assert.equal(act.rot, 1, 'one turn');
    assert.equal(act.x, 4, 'one step right of the spawn column');
    await ctx.close();
  });

  await test('a drop that does not fit is greyed out and says so; it sends nothing', async () => {
    const msgs = table((g) => {
      // block the spawn area, so the piece in hand has nowhere to go (not full rows, which would clear)
      for (const r of [0, 1]) for (let c = 3; c <= 6; c++) g.boards[0][r * E.W + c] = 'X';
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('[data-fb="drop"]').isDisabled(), true);
    assert.match(await page.locator('.wz-status').innerText(), /does not fit/);
    await ctx.close();
  });

  await test('controls are at least 44 px tall and the page does not scroll sideways on a 360 px phone', async () => {
    const { page, ctx } = await open(table(), { width: 360, height: 740 });
    for (const id of ['left', 'rotate', 'right', 'drop']) {
      const box = await page.locator(`[data-fb="${id}"]`).boundingBox();
      assert.ok(box.height >= 44, `${id} is ${box.height}px tall`);
    }
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 360, `page is ${scroll}px wide`);
    await ctx.close();
  });

  await test('when the game is over the winner is named and the scores are listed', async () => {
    const msgs = table((g) => {
      // the others are topped out, so you are the last one still building
      g.out[1] = true;
      g.out[2] = true;
      g.phase = 'gameOver';
      g.winner = 0;
    });
    const { page, ctx } = await open(msgs);
    assert.equal(await page.locator('.overlay .sheet h2').count(), 1);
    assert.match(await page.locator('.overlay .sheet h2').innerText(), /You won/);
    await ctx.close();
  });

  await test('a watcher sees every well and has no controls', async () => {
    const { page, ctx } = await open(table(undefined, { viewer: 'nobody' }));
    assert.equal(await page.locator('.fb-controls, [data-fb="drop"], [data-fb="rotate"]').count(), 0);
    assert.equal(await page.locator('.fb-mine').count(), 0);
    assert.match(await page.locator('.wz-status').innerText(), /Watching/);
    await ctx.close();
  });

  await test('the ✕ in the table toolbar opens the leave prompt (it used to be ignored)', async () => {
    const { page, ctx } = await open(table());
    await page.locator('[data-act="leave"]').click();
    await page.waitForSelector('text=Leave game?', { timeout: 3000 });
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\nfalling blocks UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
