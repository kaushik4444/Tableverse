'use strict';
/** The lobby says why a seat control is unavailable, and states how many seats are filled, for the host and for players. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const game = games.list().find((g) => g.id === 'propertyrivals');
const lobby = ({ hostId, seats, members }) => ({
  t: 'state', view: null,
  room: { code: 'ABCDEF', gameId: game.id, hostId, status: 'lobby', options: {}, visibility: 'public', seats, min: 2, max: 6, seatLabels: null,
    members, spectators: [] },
});
const me = { id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true };
const bot = { id: 'b1', name: 'Merlin', bot: true, avatar: '🧙', connected: true };

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  const run = async (name, fn) => {
    try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
  };

  await run('the host at the minimum sees why "fewer players" is unavailable, and how many seats are filled', async () => {
    const { page, ctx } = await scriptedPage(browser, {
      viewport: { width: 390, height: 844 },
      messages: [welcome({ games: games.list() }), lobby({ hostId: 'me', seats: 2, members: [me, bot] })],
    });
    await page.goto(url + '/');
    await page.waitForSelector('.stepper', { timeout: 8000 });
    const fewer = page.locator('.stepper [aria-label="Fewer players"]');
    assert.equal(await fewer.isDisabled(), true, 'at the minimum the control is disabled');
    assert.match(await fewer.getAttribute('title'), /needs at least 2 players/);
    assert.equal(await page.locator('.seat-status').textContent(), '2 of 2 seats filled.', 'a full table says so');
    await ctx.close();
  });

  await run('the host with an open seat is told the open seat becomes a bot, and "more players" is enabled', async () => {
    const { page, ctx } = await scriptedPage(browser, {
      viewport: { width: 390, height: 844 },
      messages: [welcome({ games: games.list() }), lobby({ hostId: 'me', seats: 4, members: [me, bot] })],
    });
    await page.goto(url + '/');
    await page.waitForSelector('.seat-status', { timeout: 8000 });
    assert.equal(await page.locator('.stepper [aria-label="More players"]').isEnabled(), true);
    assert.equal(await page.locator('.seat-status').textContent(), '2 of 4 seats filled; empty seats become bots when the game starts.');
    await ctx.close();
  });

  await run('a player who is not the host sees the seat count (no host controls) and the waiting line shows the seats', async () => {
    const host = { id: 'h1', name: 'Host', bot: false, avatar: '🧙', connected: true };
    const { page, ctx } = await scriptedPage(browser, {
      viewport: { width: 390, height: 844 },
      messages: [welcome({ games: games.list() }), lobby({ hostId: 'h1', seats: 4, members: [host, bot] })],
    });
    await page.goto(url + '/');
    await page.waitForSelector('.start-bar.wait', { timeout: 8000 });
    assert.equal(await page.locator('.stepper').count(), 0, 'players see no seat stepper');
    assert.match(await page.locator('.start-bar.wait').textContent(), /Waiting for the host to start… 2 of 4 seats filled/);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'lobby status checks passed');
  process.exit(failed ? 1 : 0);
})();
