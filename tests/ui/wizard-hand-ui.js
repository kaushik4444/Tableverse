'use strict';
// A full Wizard hand stays inside the table on wide screens: the cards are not pushed off the right edge and the page does not scroll.
// (The home page's decorative fanned hand used the same .hc class and offset the table's cards by half a screen.)
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const WE = require('../../games/wizard/engine.js');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const pl = [{ id: 'me', name: 'Aarav' }, { id: 'p1', name: 'Bo' }, { id: 'p2', name: 'Cy' }];
  const room = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: 3, min: 3, max: 6, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members: pl.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: '🧙', connected: true, ping: null, username: null })) };
  for (const w of [1280, 1920]) {
    await test(`a ten-card hand fits the table at ${w}px`, async () => {
      const gm = WE.createGame(pl, {}, () => 0.37);
      const hand = []; for (let i = 0; i < 10; i++) hand.push({ suit: ['R', 'Y', 'G', 'B'][i % 4], rank: (i % 13) + 1, id: 'h' + i });
      gm.players.find((p) => p.id === 'me').hand = hand;
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: WE.viewFor(gm, 'me') }], viewport: { width: w, height: 800 } });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('#app .hand-in', { timeout: 8000 });
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('#app .hand-in > *')].map((c) => c.getBoundingClientRect());
          return { right: Math.max(...cards.map((c) => c.right)), left: Math.min(...cards.map((c) => c.left)), sw: document.documentElement.scrollWidth, iw: innerWidth };
        });
        assert.ok(r.right <= r.iw + 1, `the last card ends at ${Math.round(r.right)}px on a ${r.iw}px screen`);
        assert.ok(r.left >= 0, `the first card starts at ${Math.round(r.left)}px`);
        assert.ok(r.sw <= r.iw + 1, `the page is ${r.sw}px wide on a ${r.iw}px screen`);
      } finally { await ctx.close(); }
    });
  }
  await browser.close(); server.close();
  console.log(`\nwizard hand ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
