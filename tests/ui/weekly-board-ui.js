'use strict';
// The weekly board on a game's detail view: people who opted in, this week's Game XP, your own row marked, and the
// switch that puts you on the board (off by default; a change is saved on the server).
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;

const game = { gameId: 'ludo', games: 5, played: 5, wins: 2, losses: 3, draws: 0, leftEarly: 0, minutes: 50 };
const progress = { account: { level: 2, xp: 60, into: 10, need: 100, minutes: 60 }, games: { ludo: { points: 15, played: 5, rule: 'placing' } }, penalisedLeaves: 0 };
const stats = (optIn) => ({ streak: { current: 0, best: 0 }, played: 5, wins: 2, losses: 3, draws: 0, leftEarly: 0, minutes: 50, perGame: [game], progress, recent: [], hourly: {} });
const api = (state) => ({
  'GET /api/auth/session': () => sessionOk({ welcome: false }),
  'GET /api/me/profile': () => ({ ok: true, profile: { username: 'aarav', displayName: 'Aarav', leaderboardOptIn: state.optIn }, stats: stats(state.optIn) }),
  'GET /api/me/history?page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
  'GET /api/me/history?game=ludo&page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
  'GET /api/leaderboard?game=ludo': () => ({ ok: true, game: 'ludo', days: 7, board: [
    { username: 'alice', displayName: 'Alice', points: 20, played: 2 },
    { username: 'aarav', displayName: 'Aarav', points: 5, played: 1 }] }),
  'POST /api/me/leaderboard': (r) => { const body = JSON.parse(r.body || '{}'); state.optIn = body.optIn === true; return { ok: true, optIn: state.optIn }; },
});

(async () => {
  const state = { optIn: false };
  const srv = await serve(api(state));
  const browser = await chromium.launch();
  try {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() })] });
    try {
      await page.goto(srv.url + '/#profile');
      await page.waitForSelector('.progress-card', { timeout: 12000 });
      await page.click('[data-act="openGameStats"][data-game="ludo"]');
      await page.waitForSelector('.board-list li', { timeout: 8000 });
      const names = await page.locator('.board-list li span').allTextContents();
      assert.deepEqual(names, ['Alice', 'Aarav'], 'the board lists the opted-in players in order');
      assert.equal(await page.locator('.board-list li.me').count(), 1, 'your own row is marked');
      assert.match(await page.textContent('.board-list li b'), /\+20 XP/, 'this week’s Game XP shows with its sign');
      assert.equal(await page.getAttribute('[data-act="boardOptIn"]', 'aria-pressed'), 'false', 'off by default');
      await page.click('[data-act="boardOptIn"]');
      await page.waitForSelector('[data-act="boardOptIn"][aria-pressed="true"]', { timeout: 5000 });
      const posts = srv.calls.filter((c) => c.method === 'POST' && c.path === '/api/me/leaderboard');
      assert.equal(posts.length, 1, 'saved once');
      assert.deepEqual(JSON.parse(posts[0].body), { optIn: true });
      assert.equal(state.optIn, true);
      passed++; console.log('  ok  weekly board: list, your row, and the switch saves on the server');
    } finally { await ctx.close(); }
  } catch (e) { failed++; console.error('FAIL  weekly board\n' + (e.stack || e)); }
  finally { await browser.close(); srv.server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
