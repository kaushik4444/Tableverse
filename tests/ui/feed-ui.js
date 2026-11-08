'use strict';
// The shared floating feed (public/feed.js): new public-log lines float over the table in every game that has a log, an old
// log is not replayed on load, and lines whose kind the cards/dice already show stay out.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const names = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'].map((name) => ({ name }));
// [game id, seats, host selector, a kind that floats + its line, a kind that must stay out]
const GAMES = [
  ['wizard', 3, '.pt', { by: 'System', card: 'Bo bids 2', kind: 'bid' }, { by: 'System', card: 'Bo plays 7 of Hearts', kind: 'play' }],
  ['themind', 3, '.tm-pile', { by: 'Bo', card: 'played 12 too early', kind: 'mistake' }, { by: 'Bo', card: 'played 30', kind: 'play' }],
];

const QUIET = ['poker', 'twentynine', 'ludo', 'propertyrivals', 'snakesladders']; // these show events some other way: nothing floats
(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  for (const [id, seats, host, shown, hidden] of GAMES) {
    await test(`${id}: a new log line floats over the table; kinds the table already shows do not`, async () => {
      const m = tableMessages(id, names.slice(0, seats));
      const old = [{ by: 'Aarav', card: 'earlier line', kind: shown.kind }];
      m[1].view = { ...m[1].view, log: old }; // the table is loaded with a log that already has a line in it
      const { page, ctx } = await scriptedPage(browser, { messages: m });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url + '/');
      await page.waitForSelector('.wz, .ludo, .tm, .pk', { timeout: 8000 });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.cf-msg').count(), 0, 'nothing floats on the first render');
      const first = m[1].view;
      await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room: m[1].room, view: { ...first, log: old } });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.cf-msg').count(), 0, 'an unchanged log is not replayed');
      await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room: m[1].room, view: { ...first, log: old.concat([hidden]) } });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.cf-msg').count(), 0, `a "${hidden.kind}" line stays in the log only`);
      await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room: m[1].room, view: { ...first, log: old.concat([hidden, shown]) } });
      await page.waitForSelector('.cf-msg', { timeout: 3000 });
      assert.match(await page.textContent('.cf-msg'), new RegExp(shown.card.replace(/[+?.*]/g, '\\$&').slice(0, 14)));
      assert.equal(await page.locator(`${host} > .cf-feed`).count(), 1, 'it floats over the table itself');
      assert.equal(await page.getAttribute('.cf-feed', 'aria-hidden'), 'true');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
  for (const id of QUIET) {
    await test(`${id}: no floating feed`, async () => {
      const seats = id === 'poker' ? 3 : 4;
      const m = tableMessages(id, names.slice(0, seats));
      const { page, ctx } = await scriptedPage(browser, { messages: m });
      await page.goto(url + '/');
      await page.waitForSelector('.wz, .ludo, .tm, .pk, .sl', { timeout: 8000 });
      const line = { by: 'Bo', card: 'raises to 40', kind: 'bet' };
      for (const kind of ['bet', 'capture', 'bid', 'rent', 'land']) {
        await page.evaluate((st) => window.__push({ t: 'state', room: st.room, view: st.view }), { room: m[1].room, view: { ...m[1].view, log: (m[1].view.log || []).concat([{ ...line, kind, n: 900 + kind.length }]) } });
      }
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.cf-feed, .cf-msg').count(), 0);
      await ctx.close();
    });
  }
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
