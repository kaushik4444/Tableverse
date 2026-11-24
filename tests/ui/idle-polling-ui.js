'use strict';
// A tab left open must not keep asking the server (and so the database) for banners and friends: the background refresh runs only
// while the page is visible and the person has done something in the last 5 minutes, and picks up again at once on the next input.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

(async () => {
  const { server, calls, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/announcements': () => ({ ok: true, signedIn: true, announcements: [] }),
  });
  const browser = await chromium.launch();
  const count = (re) => calls.filter((c) => re.test(c.path)).length;
  // the clock is faked in the page, but requests are real: let the ones started by the timers reach the test server before counting
  const settle = async (page) => { await page.waitForLoadState('networkidle'); await new Promise((r) => setTimeout(r, 100)); };
  try {
    await test('twenty minutes with no input: banners and friends are asked for a handful of times, not twenty', async () => {
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 1280, height: 800 }, messages: [welcome({ games: games.list() })] });
      try {
        await page.clock.install();
        await page.goto(url + '/');
        await page.waitForSelector('.game-card, .home-hero');
        await page.clock.runFor(1000);
        await settle(page);
        const b0 = count(/^\/api\/announcements/); const f0 = count(/^\/api\/me\/friends/);
        await page.clock.runFor(20 * 60 * 1000);
        await settle(page);
        const banners = count(/^\/api\/announcements/) - b0;
        const friends = count(/^\/api\/me\/friends/) - f0;
        assert.ok(banners <= 6, `banners asked ${banners} times in 20 idle minutes`);
        assert.ok(friends <= 6, `friends asked ${friends} times in 20 idle minutes`);
        const settled = count(/^\/api\/announcements/);
        await page.clock.runFor(30 * 60 * 1000);
        await settle(page);
        assert.equal(count(/^\/api\/announcements/), settled, 'nothing more after the pause has begun');
        // the first input after the pause refreshes at once
        const resumed = page.waitForRequest((r) => /\/api\/announcements/.test(r.url()));
        await page.mouse.move(200, 200);
        await page.mouse.move(240, 260);
        await resumed;
        await settle(page);
        assert.equal(count(/^\/api\/announcements/), settled + 1, 'one refresh on coming back');
      } finally { await ctx.close(); }
    });

    await test('while the person keeps using the page it keeps refreshing every minute', async () => {
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 1280, height: 800 }, messages: [welcome({ games: games.list() })] });
      try {
        await page.clock.install();
        await page.goto(url + '/');
        await page.waitForSelector('.game-card, .home-hero');
        await page.clock.runFor(1000);
        await settle(page);
        const b0 = count(/^\/api\/announcements/);
        for (let i = 0; i < 10; i++) { await page.mouse.move(100 + i, 100 + i); await page.clock.runFor(60 * 1000); await settle(page); }
        const banners = count(/^\/api\/announcements/) - b0;
        assert.ok(banners >= 9 && banners <= 11, `banners asked ${banners} times in 10 active minutes`);
      } finally { await ctx.close(); }
    });

    await test('a hidden home tab skips all background requests and refreshes once when visible again', async () => {
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 1280, height: 800 }, messages: [welcome({ games: games.list() })] });
      const paths = [
        '/api/announcements', '/api/me/friends',
        '/api/me/friend-requests?direction=incoming', '/api/me/friend-requests?direction=outgoing',
        '/api/me/table-invitations?direction=incoming', '/api/me/table-invitations?direction=outgoing',
      ];
      const counts = () => paths.map((path) => calls.filter((c) => c.path === path).length);
      const visibility = (value) => page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, value);
      try {
        await page.clock.install();
        await page.goto(url + '/');
        await page.waitForSelector('.game-card');
        await settle(page);
        const before = counts();
        await visibility('hidden');
        await page.clock.runFor(120000);
        await page.evaluate(() => window.dispatchEvent(new Event('keydown')));
        await settle(page);
        assert.deepEqual(counts(), before, 'ticks and input while hidden do not refresh any endpoint');
        await visibility('visible');
        await page.evaluate(() => window.dispatchEvent(new Event('keydown')));
        await settle(page);
        assert.deepEqual(counts(), before.map((n) => n + 1), 'return refreshes all endpoints once, even with immediate input');
      } finally { await ctx.close(); }
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
