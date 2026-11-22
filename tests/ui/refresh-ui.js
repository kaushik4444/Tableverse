'use strict';
// The visual refresh must not take away behaviour: a game card still lifts on hover once its entrance animation has finished
// (an animation that keeps its end values would pin `transform` and block the lift), and nothing animates for reduced motion.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const { chromium } = loadPlaywright();

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  const msgs = [welcome({ id: 'me', name: 'Aarav', games: games.list() })];
  try {
    const { page, ctx } = await scriptedPage(browser, { messages: msgs, viewport: { width: 1280, height: 800 } });
    await page.goto(url + '/');
    await page.waitForSelector('.game-card');
    await page.waitForTimeout(1200); // the cards have dealt in
    await page.hover('.game-card');
    await page.waitForTimeout(450);
    const t = await page.evaluate(() => getComputedStyle(document.querySelector('.game-card')).transform);
    assert.notEqual(t, 'none', 'the hovered card lifts');
    await ctx.close();
    console.log('  ok  game cards lift on hover after they have dealt in');

    const r = await scriptedPage(browser, { messages: msgs, viewport: { width: 1280, height: 800 } });
    await r.page.emulateMedia({ reducedMotion: 'reduce' });
    await r.page.goto(url + '/');
    await r.page.waitForSelector('.game-card');
    const anim = await r.page.evaluate(() => getComputedStyle(document.querySelector('.game-card')).animationName);
    assert.equal(anim, 'none', 'no entrance animation for reduced motion');
    await r.ctx.close();
    console.log('  ok  reduced motion switches the entrance animation off');
  } catch (e) { failed++; console.error('FAIL\n' + (e.stack || e)); }
  await browser.close(); server.close();
  console.log(failed ? 'refresh UI: failed' : 'refresh UI checks passed');
  if (failed) process.exitCode = 1;
})();
