'use strict';
/** The host arranges seats in the lobby: tap two players to swap their seats, or shuffle. Only the host sees the controls. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const game = games.list().find((g) => g.id === 'twentynine');
const lobby = (hostId = 'me') => ({
  t: 'state', view: null,
  room: { code: 'ABCDEF', gameId: game.id, hostId, status: 'lobby', options: {}, visibility: 'public', seats: 4, min: 4, max: 4,
    seatLabels: ['Team A', 'Team B', 'Team A', 'Team B'],
    members: [
      { id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true },
      { id: 'b1', name: 'Merlin', bot: true, avatar: '🧙', connected: true },
      { id: 'b2', name: 'Nadia', bot: true, avatar: '🧙', connected: true },
      { id: 'b3', name: 'Oren', bot: true, avatar: '🧙', connected: true },
    ], spectators: [] },
});
const sent = (page, t) => page.evaluate((x) => window.__sent.filter((m) => m.t === x), t);

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  const run = async (name, fn, hostId) => {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ games: games.list() }), lobby(hostId)] });
    try { await page.goto(url + '/'); await page.waitForSelector('.seat-tools, .seats', { timeout: 8000 }); await fn(page); console.log('  ok  ' + name); }
    catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); }
    finally { await ctx.close(); }
  };

  await run('the host swaps two seats by tapping them, and the new order is sent', async (page) => {
    await page.click('[aria-label="Swap the seat of Aarav"]');
    assert.equal(await page.$eval('[aria-label="Swap the seat of Aarav"]', (b) => b.getAttribute('aria-pressed')), 'true', 'the first pick is shown');
    await page.click('[aria-label="Swap the seat of Merlin"]');
    const sentNow = await sent(page, 'arrangeSeats');
    assert.deepEqual(sentNow, [{ t: 'arrangeSeats', order: ['b1', 'me', 'b2', 'b3'] }]);
  });

  await run('tapping the same seat twice cancels the swap', async (page) => {
    await page.click('[aria-label="Swap the seat of Aarav"]');
    await page.click('[aria-label="Swap the seat of Aarav"]');
    assert.deepEqual(await sent(page, 'arrangeSeats'), []);
  });

  await run('shuffle sends a shuffle request', async (page) => {
    await page.click('[data-act="shuffleSeats"]');
    assert.equal((await sent(page, 'shuffleSeats')).length, 1);
  });

  await run('keyboard focus stays on Shuffle seats when a broadcast redraws the lobby', async (page) => {
    const base = lobby();
    const reordered = JSON.parse(JSON.stringify(base));
    reordered.room.members.reverse();
    await page.focus('[data-act="shuffleSeats"]');
    await page.keyboard.press('Enter');
    await page.evaluate((m) => window.__push(m), reordered);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.act), 'shuffleSeats');
  });

  await run('a player who is not the host sees no seat controls', async (page) => {
    assert.equal(await page.$('[data-act="pickSeat"]'), null);
    assert.equal(await page.$('[data-act="shuffleSeats"]'), null);
  }, 'b2');

  await browser.close(); server.close();
  console.log(`\n${5 - failed} lobby seat tests passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
