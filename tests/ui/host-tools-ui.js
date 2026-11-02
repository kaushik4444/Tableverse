'use strict';
/** Host tools in the lobby (make host / remove) in a real browser against a scripted WebSocket. npm run test:ui */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const game = { id: 'wizard', name: 'Wizard', icon: '🧙', accent: '#8a5cf6', seats: { min: 3, max: 6, default: 4 }, options: [], rules: [] };
const lobby = (hostId) => ({
  t: 'state', view: null,
  room: {
    code: 'ABCDEF', gameId: 'wizard', hostId, status: 'lobby', options: {}, visibility: 'public', seats: 4, min: 3, max: 6, seatLabels: null,
    members: [
      { id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true },
      { id: 'p1', name: 'Extraordinarily Long Player Name', bot: false, avatar: '🦊', connected: true },
      { id: 'b1', name: 'Merlin', bot: true, avatar: '🧙', connected: true },
    ],
    spectators: [{ id: 's1', name: 'Watcher With A Very Long Name Indeed', avatar: '🐉', connected: true }],
  },
});

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (hostId, viewport) => {
    const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcome({ games: [game] }), lobby(hostId)] });
    await page.goto(url + '/');
    await page.waitForSelector('.seats', { timeout: 8000 });
    return { page, ctx };
  };
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await test('the host sees Make host and Remove on other people, nothing on themselves, and the bot keeps its own remove button', async () => {
    const { page, ctx } = await open('me', { width: 390, height: 844 });
    const rows = await page.$$eval('.seats .seat:not(.empty)', (els) => els.map((e) => ({ name: e.querySelector('.nm').textContent, make: !!e.querySelector('[data-act=makeHost]'), kick: !!e.querySelector('[data-act=kickPlayer]'), bot: !!e.querySelector('[data-act=removeBot]') })));
    assert.deepEqual(rows.map((r) => [r.make, r.kick, r.bot]), [[false, false, false], [true, true, false], [false, false, true]]);
    await page.click('.spectator-list summary');
    assert.equal(await page.$$eval('.spectator-people [data-act=kickPlayer]', (b) => b.length), 1, 'a spectator can be removed');
    await ctx.close();
  });

  await test('a guest at the table (not the host) gets no host controls anywhere', async () => {
    const { page, ctx } = await open('p1', { width: 390, height: 844 });
    assert.equal(await page.$$eval('[data-act=makeHost], [data-act=kickPlayer], [data-act=removeBot]', (b) => b.length), 0);
    await ctx.close();
  });

  await test('the buttons send the right messages (after a confirmation)', async () => {
    const { page, ctx } = await open('me', { width: 390, height: 844 });
    await page.click('[data-act=makeHost][data-id=p1]');
    await page.click('#modal-overlay [data-modal-act="makeHostConfirm"]');
    await page.click('[data-act=kickPlayer][data-id=p1]');
    await page.click('#modal-overlay [data-modal-act="kickPlayerConfirm"]');
    await page.click('.spectator-list summary');
    await page.click('.spectator-people [data-act=kickPlayer]');
    await page.click('#modal-overlay [data-modal-act="kickPlayerConfirm"]');
    const sent = await page.evaluate(() => window.__sent.filter((m) => m.t === 'makeHost' || m.t === 'kick'));
    assert.deepEqual(sent, [{ t: 'makeHost', id: 'p1' }, { t: 'kick', id: 'p1' }, { t: 'kick', id: 's1' }]);
    await ctx.close();
  });

  await test('declining the confirmation sends nothing', async () => {
    const { page, ctx } = await open('me', { width: 390, height: 844 });
    await page.click('[data-act=kickPlayer][data-id=p1]');
    await page.click('#modal-overlay [data-modal-close]');
    assert.equal(await page.evaluate(() => window.__sent.filter((m) => m.t === 'kick').length), 0);
    await ctx.close();
  });

  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [768, 1024], [1280, 800]]) {
    await test(`no horizontal overflow and tappable buttons at ${w}x${h}`, async () => {
      const { page, ctx } = await open('me', { width: w, height: h });
      await page.click('.spectator-list summary');
      assert.ok((await overflow(page)) <= 0, 'page scrolls sideways by ' + (await overflow(page)) + 'px');
      const small = await page.$$eval('.seat-actions .btn, .spectator-people .btn', (bs) => bs.filter((b) => b.getBoundingClientRect().width < 36 || b.getBoundingClientRect().height < 34).length);
      assert.equal(small, 0, 'buttons smaller than 36x34');
      const clipped = await page.$$eval('.seat', (rows) => rows.filter((r) => r.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length);
      assert.equal(clipped, 0, 'a seat row is wider than the screen');
      await ctx.close();
    });
  }

  await browser.close(); server.close();
  console.log(`\nhost tools UI: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
