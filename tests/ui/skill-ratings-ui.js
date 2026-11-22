'use strict';
// The profile and the skill ratings: no Game XP or weekly XP board anywhere, the ratings board for a game (all time or this
// month, ranked by rating, your row marked), and the switch that puts you on the boards (off by default; saved on the server).
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;

const game = { gameId: 'ludo', games: 5, played: 5, wins: 2, losses: 3, draws: 0, leftEarly: 0, minutes: 50 };
const progress = { account: { level: 2, xp: 60, into: 10, need: 100, minutes: 60 }, games: { ludo: { points: 15, played: 5, rule: 'placing' } }, penalisedLeaves: 0 };
const stats = () => ({ streak: { current: 0, best: 0 }, played: 5, wins: 2, losses: 3, draws: 0, leftEarly: 0, minutes: 50, perGame: [game], progress, recent: [], hourly: {} });
const api = (state) => ({
  'GET /api/auth/session': () => sessionOk({ welcome: false }),
  'GET /api/me/profile': () => ({ ok: true, profile: { username: 'aarav', displayName: 'Aarav', leaderboardOptIn: state.optIn }, stats: stats() }),
  'GET /api/me/history?page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
  'GET /api/me/history?game=ludo&page=1': () => ({ ok: true, items: [], page: 1, total: 0, pageSize: 20 }),
  'GET /api/ratings/board': (r) => {
    const scope = r.url.searchParams.get('scope');
    const board = scope === 'month'
      ? [{ username: 'aarav', displayName: 'Aarav', rating: 1012, ratedGames: 5 }]
      : [{ username: 'alice', displayName: 'Alice', rating: 1085, ratedGames: 9 }, { username: 'aarav', displayName: 'Aarav', rating: 1031, ratedGames: 6 }];
    return { ok: true, enabled: true, game: 'ludo', scope, board };
  },
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
      const overview = await page.textContent('.profile-page');
      assert.doesNotMatch(overview, /XP/, 'the profile shows no XP: skill is shown as ratings');
      assert.doesNotMatch(overview, /This week/, 'no weekly XP board');

      await page.click('[data-act="openGameStats"][data-game="ludo"]');
      await page.waitForSelector('.board-list li', { timeout: 8000 });
      assert.deepEqual(await page.locator('.board-list .bl-name').allTextContents(), ['Alice', 'Aarav'], 'ranked by rating');
      assert.deepEqual(await page.locator('.board-list .bl-val').allTextContents(), ['1085', '1031']);
      assert.equal(await page.locator('.board-list li.me').count(), 1, 'your own row is marked');
      assert.equal(await page.getAttribute('[data-act="ratingScope"][data-scope="lifetime"]', 'aria-pressed'), 'true', 'all time is the default');
      assert.doesNotMatch(await page.textContent('.profile-page'), /Game XP/, 'the game page shows no Game XP');

      await page.click('[data-act="ratingScope"][data-scope="month"]');
      await page.waitForSelector('[data-act="ratingScope"][data-scope="month"][aria-pressed="true"]', { timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('.board-list .bl-name').length === 1, null, { timeout: 5000 });
      assert.deepEqual(await page.locator('.board-list .bl-name').allTextContents(), ['Aarav'], 'this month has its own board');

      assert.equal(await page.getAttribute('[data-act="boardOptIn"]', 'aria-pressed'), 'false', 'off by default');
      await page.click('[data-act="boardOptIn"]');
      await page.waitForSelector('[data-act="boardOptIn"][aria-pressed="true"]', { timeout: 5000 });
      const posts = srv.calls.filter((c) => c.method === 'POST' && c.path === '/api/me/leaderboard');
      assert.equal(posts.length, 1, 'saved once');
      assert.deepEqual(JSON.parse(posts[0].body), { optIn: true });
      assert.equal(state.optIn, true);
      passed++; console.log('  ok  skill ratings: no XP on the profile, ranked board per period, the switch saves');
    } finally { await ctx.close(); }
  } catch (e) { failed++; console.error('FAIL  skill ratings\n' + (e.stack || e)); }
  finally { await browser.close(); srv.server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
