'use strict';
// The welcome-back card on the home screen: shown after a break, dismissed for that visit, and not brought back by a reload.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const SINCE = '2026-11-18T10:00:00.000Z';
const profile = (welcomeBack) => () => ({ ok: true, profile: {}, stats: {}, welcomeBack });
const gameList = () => ({ ok: true, guestPlay: true, games: games.list().map((g) => ({ ...g, access: 'on', enabled: true })) });

(async () => {
  const browser = await chromium.launch();
  const run = async (welcomeBack, body) => {
    const { server, url } = await serve({
      'GET /api/auth/session': () => sessionOk(),
      'GET /api/me/profile': profile(welcomeBack),
      'GET /api/games': gameList,
    });
    try { await body(url); } finally { server.close(); }
  };

  await test('a returning player sees the welcome card with the days away and the streak', () => run(
    { awayDays: 4, streak: 3, since: SINCE },
    async (url) => {
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome()] });
      await page.goto(url + '/');
      await page.waitForSelector('.welcome-back', { timeout: 8000 });
      const text = await page.textContent('.welcome-back');
      assert.match(text, /Welcome back/);
      assert.match(text, /4 days/);
      assert.match(text, /3-day streak/);
      await ctx.close();
    }));

  await test('dismissing the card keeps it hidden on reload for that visit', () => run(
    { awayDays: 2, streak: 0, since: SINCE },
    async (url) => {
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome()] });
      await page.goto(url + '/');
      await page.waitForSelector('.welcome-back', { timeout: 8000 });
      await page.click('[data-act="dismissWelcome"]');
      await page.waitForSelector('.welcome-back', { state: 'detached', timeout: 5000 });
      await page.reload();
      await page.waitForLoadState('networkidle'); // the profile request has finished and the home screen has re-rendered
      await page.waitForSelector('#games', { timeout: 8000 });
      assert.equal(await page.$('.welcome-back'), null, 'a reload does not bring the card back');
      await ctx.close();
    }));

  await test('a player with no previous visit gets no card', () => run(
    null,
    async (url) => {
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome()] });
      await page.goto(url + '/');
      await page.waitForLoadState('networkidle'); // the profile request has finished and the home screen has re-rendered
      await page.waitForSelector('#games', { timeout: 8000 });
      assert.equal(await page.$('.welcome-back'), null);
      await ctx.close();
    }));

  await test('a returning socket reconnect refreshes the welcome-back card without a reload', async () => {
    // The first profile has no break to show. The reconnect sends welcome again in the same session, and its profile has one.
    let answer = null;
    let profileAnswers = 0; // counts each profile answer as it is decided, so the test knows the startup one has been given
    const { server: s2, url: u2 } = await serve({
      'GET /api/auth/session': () => sessionOk(),
      'GET /api/me/profile': () => { profileAnswers++; return { ok: true, profile: {}, stats: {}, welcomeBack: answer }; },
      'GET /api/games': gameList,
    });
    try {
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome()] });
      await page.goto(u2 + '/');
      await page.waitForSelector('#games', { timeout: 8000 });
      // wait until the startup profile requests (session load and the first welcome) have all been answered: the count is stable for 0.5 s
      let last = -1;
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (profileAnswers >= 1 && profileAnswers === last) break;
        last = profileAnswers;
      }
      assert.ok(profileAnswers >= 1, 'the startup profile was answered');
      assert.equal(await page.$('.welcome-back'), null, 'no card on the first load');
      answer = { awayDays: 5, streak: 0, since: SINCE };
      await page.evaluate((m) => window.__push(m), welcome());
      await page.waitForSelector('.welcome-back', { timeout: 8000 });
      assert.match(await page.textContent('.welcome-back'), /5 days/);
      await ctx.close();
    } finally { s2.close(); }
  });

  await browser.close();
  console.log(`\nwelcome-back UI: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
