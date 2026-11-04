'use strict';
/** A bot playing for someone who left or went offline is marked on their seat in every game, and the mark goes when they return. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages } = require('./harness');
const { chromium } = loadPlaywright();

const CASES = [['wizard', 4], ['twentynine', 4], ['poker', 4], ['themind', 3], ['ludo', 4], ['gofish', 4], ['snakesladders', 4], ['propertyrivals', 4]];
const NAMES = ['Aarav', 'Bo', 'Cy', 'Di'];
let failed = 0;

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  for (const [game, n] of CASES) {
    const extras = NAMES.slice(0, n).map((name, i) => ({ name, ...(i === 1 ? { bot: true, standIn: true } : {}) }));
    const messages = tableMessages(game, extras);
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('[data-pid="p1"]', { timeout: 8000 });
      await page.waitForSelector('.standin', { timeout: 4000 });
      const r = await page.evaluate(() => ({ n: document.querySelectorAll('.standin').length, inSeat: !!document.querySelector('[data-pid="p1"] .standin'), label: (document.querySelector('.standin') || {}).getAttribute && document.querySelector('.standin').getAttribute('aria-label') }));
      assert.equal(r.n, 1, `${game}: exactly one stand-in mark`);
      assert.ok(r.inSeat, `${game}: the mark is on that player's seat`);
      assert.equal(r.label, 'A bot is playing for Bo');
      // the player comes back: the server sends the seat as a person again
      const back = JSON.parse(JSON.stringify(messages[1]));
      back.room.members[1].bot = false; back.room.members[1].standIn = false;
      await page.evaluate((m) => window.__push(m), back);
      await page.waitForFunction(() => document.querySelectorAll('.standin').length === 0, null, { timeout: 4000 });
      console.log('  ok  ' + game + ': bot mark on the seat, removed when the player returns');
    } catch (e) { failed++; console.error('FAIL  ' + game + '\n' + (e.stack || e)); }
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'stand-in UI: all passed');
  process.exit(failed ? 1 : 0);
})();
