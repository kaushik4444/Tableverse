'use strict';
/** Changing one game setting in the lobby must not close the options panel or drop keyboard focus (the screen redraws on every update). */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const game = games.list().find((g) => g.id === 'propertyrivals');
const lobby = (options) => ({
  t: 'state', view: null,
  room: { code: 'ABCDEF', gameId: game.id, hostId: 'me', status: 'lobby', options, visibility: 'public', seats: 4, min: 2, max: 6, seatLabels: null,
    members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }, { id: 'b1', name: 'Merlin', bot: true, avatar: '🧙', connected: true }], spectators: [] },
});

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ games: games.list() }), lobby({ rounds: '60', startCash: '1500', auction: true })] });
  let failed = 0;
  try {
    await page.goto(url + '/');
    await page.waitForSelector('#fold-options', { timeout: 8000 });
    await page.click('#fold-options > summary');
    assert.equal(await page.$eval('#fold-options', (d) => d.open), true, 'the panel opens');
    await page.focus('#opt-startCash');
    await page.selectOption('#opt-startCash', '2000');
    // the server confirms the change by sending the whole room again: the screen redraws
    await page.evaluate((m) => window.__push(m), lobby({ rounds: '60', startCash: '2000', auction: true }));
    await page.waitForFunction(() => document.getElementById('opt-startCash') && document.getElementById('opt-startCash').value === '2000');
    assert.equal(await page.$eval('#fold-options', (d) => d.open), true, 'the options panel is still open after the redraw');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'opt-startCash', 'the changed setting keeps focus');
    // a second change in a row works too, and a collapsed panel stays collapsed
    await page.selectOption('#opt-rounds', '30');
    await page.evaluate((m) => window.__push(m), lobby({ rounds: '30', startCash: '2000', auction: true }));
    await page.waitForFunction(() => document.getElementById('opt-rounds').value === '30');
    assert.equal(await page.$eval('#fold-options', (d) => d.open), true, 'still open after a second change');
    await page.click('#fold-options > summary');
    await page.evaluate((m) => window.__push(m), lobby({ rounds: '30', startCash: '2000', auction: false }));
    await page.waitForTimeout(150);
    assert.equal(await page.$eval('#fold-options', (d) => d.open), false, 'a panel the person closed stays closed');
    console.log('  ok  the options panel stays open (and focused) while settings change; closed stays closed');
  } catch (e) { failed++; console.error('FAIL\n' + (e.stack || e)); }
  await ctx.close(); await browser.close(); server.close();
  process.exit(failed ? 1 : 0);
})();
