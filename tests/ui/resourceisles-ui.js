'use strict';
// Resource Isles in a real browser: the island is drawn, a setup settlement is tapped on a highlighted corner, the roll button,
// the phone-width layout, and that a watcher sees no taps.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const E = require('../../games/resourceisles/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Cy', 'Di'];
const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'act'));
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** A real game with four people (the first is you), and the messages a browser would receive for it. */
function table(setup = () => {}, { viewer = 'me', seed = 21 } = {}) {
  const players = names.map((n, i) => ({ id: i === 0 ? 'me' : 'p' + i, name: n, bot: i > 0 }));
  const g = E.createGame(players, { length: 'classic' }, rng(seed));
  setup(g);
  const room = { code: 'ABCDEF', gameId: 'resourceisles', hostId: 'me', status: 'playing', options: { length: 'classic' }, visibility: 'public', seats: 4, min: 4, max: 4, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: E.viewFor(g, viewer) }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.ri', { timeout: 8000 });
    return { page, ctx };
  };

  await test('the island is drawn with 19 lands and four seat bars', async () => {
    const { page, ctx } = await open(table());
    assert.equal(await page.locator('svg.ri-board .ri-land').count(), 19);
    assert.equal(await page.locator('.ri-seat').count(), 4);
    await ctx.close();
  });

  await test('in setup, the highlighted corners are tap targets and a tap sends a settlement', async () => {
    const { page, ctx } = await open(table());
    const spots = page.locator('svg.ri-board [data-v]');
    assert.ok((await spots.count()) > 0, 'legal corners are highlighted');
    await spots.first().click();
    const last = (await sent(page)).at(-1);
    assert.equal(last.action.type, 'setupSettlement');
    assert.equal(typeof last.action.vertex, 'number');
    await ctx.close();
  });

  await test('on your roll the roll button sends a roll; watchers see no buttons', async () => {
    const { page, ctx } = await open(table((g) => {
      // a finished setup: every seat has placed two settlements and two roads, so it is the first roll
      g.phase = 'roll'; g.turn = 0; g.step = 8;
    }));
    await page.locator('button[data-ra="roll"]').click();
    assert.deepEqual((await sent(page)).at(-1).action, { type: 'roll' });
    await ctx.close();
    const watch = await open(table(() => {}, { viewer: 'nobody' }));
    assert.equal(await watch.page.locator('.ri button[data-ra]').count(), 0, 'a watcher has no moves');
    await watch.ctx.close();
  });

  await test('the layout fits a phone screen without sideways scrolling', async () => {
    const { page, ctx } = await open(table(), { width: 360, height: 740 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(wide, false, 'no horizontal scroll at 360px');
    await ctx.close();
  });

  await browser.close();
  server.close();
  console.log(`\n${passed} Resource Isles UI tests passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
