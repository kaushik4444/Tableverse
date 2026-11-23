'use strict';
// The profile's progress: the "next level in N min" hint, and a one-time level-up notice per device. A device that has
// never seen an account only remembers its level (no notice for levels reached before).
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;

const progress = (level) => ({ account: { level, xp: 160, into: 10, need: 140, minutes: 160 }, games: {}, penalisedLeaves: 0 });
const profileApi = (level) => ({
  'GET /api/auth/session': () => sessionOk({ welcome: false }),
  'GET /api/me/profile': () => ({ ok: true, profile: { username: 'aarav', displayName: 'Aarav', email: null }, stats: { progress: progress(level), played: 0, totals: {} } }),
  'GET /api/me/history?page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
});

async function run(name, { level = 3, seen = null, url = '#profile' }, check) {
  const srv = await serve(profileApi(level));
  const browser = await chromium.launch();
  try {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() })] });
    try {
      if (seen !== null) await page.addInitScript((v) => { try { localStorage.setItem('ct_level_seen_aarav', v); } catch {} }, seen);
      await page.goto(srv.url + '/' + url);
      if (url === '#profile') await page.waitForSelector('.progress-card', { timeout: 12000 });
      await check(page);
      passed++; console.log('  ok  ' + name);
    } finally { await ctx.close(); }
  } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
  finally { await browser.close(); srv.server.close(); }
}

(async () => {
  await run('the profile says how many minutes are left to the next level', { level: 3 }, async (page) => {
    const text = await page.textContent('.progress-card .pg-level');
    assert.match(text, /130 min to level 4/);
  });

  await run('a level reached since this device last looked opens a one-time level-up dialog on the menu', { level: 3, seen: '2', url: '#home' }, async (page) => {
    await page.waitForSelector('#modal-overlay');
    assert.match(await page.textContent('#modal-overlay'), /Congratulations on reaching level 3/);
    assert.match(await page.textContent('#modal-overlay'), /Next level in 130 min/);
    await page.click('[data-modal-close]');
    await page.waitForSelector('#modal-overlay', { state: 'detached', timeout: 5000 });
    const stored = await page.evaluate(() => localStorage.getItem('ct_level_seen_aarav'));
    assert.equal(stored, '3', 'the device remembers level 3 now');
  });

  await run('a device that has never seen the account announces nothing', { level: 3, seen: null }, async (page) => {
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#modal-overlay').count(), 0, 'no notice on a first visit');
    const stored = await page.evaluate(() => localStorage.getItem('ct_level_seen_aarav'));
    assert.equal(stored, '3', 'the current level is remembered');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
