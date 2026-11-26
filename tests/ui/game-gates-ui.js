'use strict';
// Game and feature gates in the page (Playwright, mocked server, scripted socket). An owner-only game is not shown to others;
// an admin-only game says it is in development and testing (hover and tap); a guest at the trial limit gets the account
// prompt; a guest sees the profile and friends pages blurred behind one "Create account" button.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const games = require('../../games').list();
let failed = 0;
const live = [];
const serveT = async (...args) => { const s = await serve(...args); live.push(() => new Promise((done) => s.server.close(() => done()))); return s; };
const test = async (name, fn) => {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } finally {
    await closeOpenContexts();
    while (live.length) await live.pop()();
  }
};
const DEV = 'In development and testing: currently disabled.';
const withAccess = (access = {}) => games.map((g) => ({ ...g, access: access[g.id] || 'on', enabled: (access[g.id] || 'on') === 'on' }));
const anonymous = () => ({ ok: true, authenticated: false, emailVerificationRequired: false, csrfToken: 'c' });
const guestSession = () => ({ ok: true, authenticated: true, isGuest: true, role: 'guest', emailVerificationRequired: false, emailVerified: false, csrfToken: 'c',
  player: { id: 'ann', display_name: 'Ann', username: null, avatar: '🧙', is_anonymous: true } });
const userSession = (role = 'user') => ({ ok: true, authenticated: true, isGuest: false, role, emailVerified: true, emailVerificationRequired: false, csrfToken: 'c',
  player: { id: 'me', display_name: 'Aarav', username: 'aarav', avatar: '🧙' } });
const gamesApi = (list) => () => ({ ok: true, guestPlay: true, games: list });

(async () => {
  const browser = await chromium.launch();

  await test('a game only the owner may play is not shown to a registered player', async () => {
    const list = withAccess({ wizard: 'owner' });
    const srv = await serveT({ 'GET /api/auth/session': () => userSession('user'), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': gamesApi(list) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ role: 'user', games: list })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.game-card', { timeout: 8000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-act="create"][data-game="wizard"]').count(), 0, 'hidden');
    assert.ok(await page.locator('.game-card').count() >= 1, 'the other games are still shown');
    await ctx.close();
  });

  await test('a game only the owner may play is shown to the owner', async () => {
    const list = withAccess({ wizard: 'owner' });
    const srv = await serveT({ 'GET /api/auth/session': () => userSession('owner'), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': gamesApi(list) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ role: 'owner', games: list })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('[data-act="create"][data-game="wizard"]', { timeout: 8000 });
    await ctx.close();
  });

  await test('a game in development (admins only) says so on hover and when tapped', async () => {
    const list = withAccess({ wizard: 'admins' });
    const srv = await serveT({ 'GET /api/auth/session': () => userSession('user'), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': gamesApi(list) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ role: 'user', games: list })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('[data-act="create"][data-game="wizard"]', { timeout: 8000 });
    const btn = page.locator('[data-act="create"][data-game="wizard"]');
    assert.equal(await btn.getAttribute('title'), DEV, 'hover shows the reason');
    assert.match(await page.textContent('.game-card:has([data-game="wizard"]) .game-off'), /In development and testing/);
    await btn.click({ force: true }); // aria-disabled, not disabled: a tap still fires; Playwright only refuses to click it by default
    await page.waitForSelector('.toast', { timeout: 4000 });
    assert.match(await page.textContent('.toast'), /In development and testing/);
    await ctx.close();
  });

  await test('a guest at the trial limit is told at once and gets the account prompt', async () => {
    const list = withAccess({});
    const srv = await serveT({ 'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': gamesApi(list) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: list })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('[data-act="create"][data-game="wizard"]', { timeout: 8000 });
    await page.evaluate(() => window.__push({ t: 'error', code: 'guest_locked', feature: 'trial', gameId: 'wizard', message: 'Create a free account to keep playing.' }));
    await page.waitForSelector('#registerForm', { timeout: 4000 });
    assert.match(await page.textContent('#auth-overlay'), /used your free plays of this game/);
    await ctx.close();
  });

  await test('a guest opening the profile page sees it blurred, with one Create account button (no redirect)', async () => {
    const srv = await serveT({ 'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': gamesApi(withAccess({})) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: withAccess({}) })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('[data-act="create"]', { timeout: 8000 });
    await page.evaluate(() => { location.hash = '#profile'; });
    await page.waitForSelector('.locked-cta', { timeout: 4000 });
    assert.equal(await page.locator('.locked-preview').count(), 1, 'the page is shown behind the prompt');
    assert.match(await page.textContent('.locked-cta'), /to see player profiles and stats/);
    await page.click('.locked-cta [data-act="showRegister"]');
    await page.waitForSelector('#registerForm', { timeout: 4000 });
    await ctx.close();
  });

  await test('a guest opening friends sees it locked too', async () => {
    const srv = await serveT({ 'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': gamesApi(withAccess({})) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: withAccess({}) })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('[data-act="create"]', { timeout: 8000 });
    await page.evaluate(() => { location.hash = '#friends'; });
    await page.waitForSelector('.locked-cta', { timeout: 4000 });
    assert.match(await page.textContent('.locked-cta'), /friends/i);
    await ctx.close();
  });

  await browser.close();
  console.log(`\n${games.length ? '' : ''}game gate UI tests ${failed ? `${failed} FAILED` : 'passed'}`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
