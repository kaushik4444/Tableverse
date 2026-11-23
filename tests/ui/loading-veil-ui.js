'use strict';
// The loading veil: a user-started request that is still running after a short moment shows "Loading…" and makes the page
// behind it inert; a quick answer never shows it; a background poll (the level refresh) stays quiet.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const game = { gameId: 'ludo', games: 5, played: 5, wins: 2, losses: 3, draws: 0, leftEarly: 0, minutes: 50 };
const progress = { account: { level: 2, xp: 60, into: 10, need: 100, minutes: 60 }, games: { ludo: { points: 15, played: 5, rule: 'placing' } }, penalisedLeaves: 0 };
const stats = () => ({ streak: { current: 0, best: 0 }, played: 5, wins: 2, losses: 3, draws: 0, leftEarly: 0, minutes: 50, perGame: [game], progress, recent: [], hourly: {} });

function api({ boardDelay = 0, profileDelay = 0 }) {
  return {
    'GET /api/auth/session': () => sessionOk({ welcome: false }),
    'GET /api/me/profile': async () => { await wait(profileDelay); return { ok: true, profile: { username: 'aarav', displayName: 'Aarav', leaderboardOptIn: false }, stats: stats() }; },
    'GET /api/me/history?page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
    'GET /api/me/history?game=ludo&page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
    'GET /api/ratings/board': async () => {
      await wait(boardDelay);
      return { ok: true, enabled: true, game: 'ludo', scope: 'all', board: [{ username: 'alice', displayName: 'Alice', rating: 1085, ratedGames: 9 }] };
    },
  };
}

// Records whether the veil ever appears, and with which label
async function watchVeil(page) {
  await page.evaluate(() => {
    window.__veil = { seen: false, label: '' };
    new MutationObserver(() => {
      const el = document.getElementById('busyBlock');
      if (el) { window.__veil.seen = true; window.__veil.label = el.querySelector('b').textContent; }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
}

(async () => {
  const browser = await chromium.launch();
  const viewport = { width: 390, height: 844 };
  const welcomeMsg = welcome({ id: 'me', name: 'Aarav', games: games.list() });

  await test('a slow request shows "Loading…", makes the page inert, and clears when the answer arrives', async () => {
    const srv = await serve(api({ boardDelay: 1500 }));
    const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcomeMsg] });
    try {
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(srv.url + '/#profile');
      await page.waitForSelector('.progress-card', { timeout: 12000 });
      await watchVeil(page);
      await page.click('[data-act="openGameStats"][data-game="ludo"]');
      await page.waitForSelector('#busyBlock', { timeout: 3000 });
      assert.equal(await page.textContent('#busyBlock b'), 'Loading…');
      assert.ok((await page.locator('[inert]').count()) > 0, 'the page behind the veil is inert');
      await page.waitForSelector('.board-list li', { timeout: 8000 });
      await page.waitForFunction(() => !document.getElementById('busyBlock'), null, { timeout: 3000 });
      assert.equal(await page.locator('[inert]').count(), 0, 'nothing stays inert after the answer');
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); srv.server.close(); }
  });

  await test('a quick answer never shows the veil', async () => {
    const srv = await serve(api({ boardDelay: 0 }));
    const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcomeMsg] });
    try {
      await page.goto(srv.url + '/#profile');
      await page.waitForSelector('.progress-card', { timeout: 12000 });
      await watchVeil(page);
      await page.click('[data-act="openGameStats"][data-game="ludo"]');
      await page.waitForSelector('.board-list li', { timeout: 8000 });
      await wait(400);
      assert.equal(await page.evaluate(() => window.__veil.seen), false, 'no flash for a fast request');
    } finally { await ctx.close(); srv.server.close(); }
  });

  await test('the background level refresh stays quiet while it waits', async () => {
    const srv = await serve(api({ profileDelay: 1500 }));
    const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcomeMsg] });
    try {
      await page.goto(srv.url + '/');
      await watchVeil(page);
      await wait(2500);
      assert.ok(srv.calls.some((c) => c.method === 'GET' && c.path === '/api/me/profile'), 'the level refresh did ask the server');
      assert.equal(await page.evaluate(() => window.__veil.seen), false, 'a background poll shows no veil');
    } finally { await ctx.close(); srv.server.close(); }
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
