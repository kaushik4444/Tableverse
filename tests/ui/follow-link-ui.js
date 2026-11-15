'use strict';
// The home footer links to the Tableverse Instagram account for guests and signed-in players, opens it safely in a new tab,
// stays a reachable tap target on a phone, and does not push the page sideways.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

(async () => {
  const guest = await serve({});
  const member = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    for (const [who, srv] of [['guest', guest], ['signed-in player', member]]) {
      for (const vp of [{ width: 360, height: 640 }, { width: 1280, height: 800 }]) {
        await test(`${who} sees the follow link in the footer at ${vp.width}px`, async () => {
          const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages: [welcome({ games: games.list() })] });
          try {
            await page.goto(srv.url + '/');
            await page.waitForSelector('.home-foot .foot-follow', { timeout: 8000 });
            const r = await page.evaluate(() => {
              const a = document.querySelector('.home-foot .foot-follow'); const b = a.getBoundingClientRect();
              return { href: a.href, target: a.target, rel: a.rel, text: a.textContent, h: b.height, sideways: document.documentElement.scrollWidth > innerWidth + 1 };
            });
            assert.equal(r.href, 'https://www.instagram.com/playtableverse/');
            assert.equal(r.target, '_blank');
            assert.ok(/noopener/.test(r.rel) && /noreferrer/.test(r.rel), 'opens without access to this page');
            assert.equal(r.text, 'Follow @playtableverse');
            assert.ok(r.h >= 40, 'tall enough to tap (' + Math.round(r.h) + 'px)');
            assert.equal(r.sideways, false, 'no sideways scroll');
          } finally { await ctx.close(); }
        });
      }
    }
  } finally {
    await browser.close(); guest.server.close(); member.server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();
