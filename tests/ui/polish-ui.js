'use strict';
// Regression checks for the redraw, navigation and drag polish: no repaint of an unchanged home page, game cards animate
// once, a friends action keeps the scroll position, presence dots, the tap highlight on a game card, the profile without
// the legacy raw score, and the Carrom striker drag without the drop-shadow filter. npm run test:ui -- polish-ui.js
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk, tableMessages } = require('./harness');
const E = require('../../games/carrom/engine');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const GAMES = [
  { id: 'wizard', name: 'Wizard', icon: '🧙', accent: '#8a5cf6', seats: { min: 3, max: 6 }, options: [], rules: [] },
  { id: 'carrom', name: 'Carrom', icon: '🎯', accent: '#c8985a', seats: { min: 2, max: 4 }, options: [], rules: [] },
];
const friends = Array.from({ length: 14 }, (_, i) => ({ id: 'f' + i, username: 'pl' + i, display_name: 'Player ' + i, avatar: '🦊', online: i % 2 === 0, playing: null, ping: 38 }));
const profile = { ok: true, profile: { username: 'aarav', displayName: 'Aarav', avatar: '🧙', email: 'a@b.c', emailVerified: true, joinedAt: '2026-01-01T00:00:00Z' }, stats: { played: 3, wins: 1, losses: 2, winRate: 33.3, perGame: [{ gameId: 'wizard', kind: 'solo', played: 3, wins: 1, draws: 0, losses: 2, winRate: 33.3, best: 50, bestLabel: 'Highest score', bestText: '50' }], recent: [], favouriteGame: 'wizard', streak: { current: 0, best: 1 }, progress: {} }, progress: {} };

(async () => {
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/profile': () => profile,
    'GET /api/me/friends': () => ({ ok: true, friends }),
    'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: [] }),
    'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [] }),
    'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
    'GET /api/me/history?page=1': () => ({ ok: true, items: [], total: 0, page: 1, pages: 1, pageSize: 10 }),
  });
  const browser = await chromium.launch();
  const open = async (opts = {}) => {
    const r = await scriptedPage(browser, { messages: [welcome({ games: GAMES })], viewport: { width: 390, height: 844 }, ...opts });
    await r.page.goto(url + '/');
    await r.page.waitForSelector('.game-grid .game-card');
    await r.page.waitForTimeout(300);
    return r;
  };

  await test('an unchanged home page is not repainted: the same game-card nodes survive a return to Games', async () => {
    const { page, ctx } = await open();
    const before = await page.evaluate(() => { const c = document.querySelector('.game-card'); c.__mark = 1; return c.__mark; });
    assert.equal(before, 1);
    await page.click('.bn [data-act="goGames"]').catch(() => page.evaluate(() => document.querySelector('[data-act="goGames"]').click()));
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.querySelector('.game-card').__mark), 1, 'the card was rebuilt although nothing changed');
    await ctx.close();
  });

  await test('game cards play their entrance animation once, not again on a same-screen redraw', async () => {
    const { page, ctx } = await open();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.game-card')).animationName), 'deal', 'the first paint animates');
    await page.waitForTimeout(700); // the entrance has finished
    // the game list changes while the person stays on Games: the page really repaints, but the cards that are still there must not replay
    await page.evaluate((games) => window.__push(games), welcome({ games: [{ ...GAMES[0], name: 'Wizard Plus' }, GAMES[1]] }));
    await page.waitForFunction(() => /Wizard Plus/.test(document.querySelector('.game-grid').textContent));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.game-card')).animationName), 'none', 'the card replays its entrance on redraw');
    await ctx.close();
  });

  await test('a friends action keeps the scroll position on the friends page', async () => {
    const { page, ctx } = await open({ messages: [welcome({ games: GAMES })] });
    await page.evaluate(() => document.querySelector('.bn [data-act="openFriendsPage"]').click());
    await page.waitForSelector('#friends-panel');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('[data-act="refreshSocial"]').click());
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => window.scrollY) >= 480, 'the friends page jumped back to the top');
    assert.ok(await page.$('#friends-panel'), 'still on friends');
    await ctx.close();
  });

  await test('friends show a presence dot: online friends mint, the rest hollow', async () => {
    const { page, ctx } = await open();
    await page.evaluate(() => document.querySelector('.bn [data-act="openFriendsPage"]').click());
    await page.waitForSelector('#friends-panel');
    assert.equal(await page.locator('.presence.online').count(), 7, 'seven of the fourteen friends are online');
    assert.equal(await page.locator('.presence.off').count(), 7, 'the offline ones show a hollow dot');
    await ctx.close();
  });

  await test('tapping a game card starts the tap highlight from the touch point', async () => {
    const { page, ctx } = await open();
    const box = await (await page.$('.game-card')).boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('.game-card').classList.contains('is-tapped'), null, { timeout: 2000 });
    assert.match(await page.evaluate(() => document.querySelector('.game-card').style.getPropertyValue('--mx')), /px$/);
    await page.mouse.up();
    await ctx.close();
  });

  await test('the profile game detail does not show the legacy raw "Highest score"', async () => {
    const { page, ctx } = await open();
    await page.goto(url + '/#profile');
    await page.waitForSelector('.stat-game-btn, .stat-game');
    if (await page.$('[data-act="openGameStats"]')) await page.click('[data-act="openGameStats"]');
    await page.waitForTimeout(300);
    assert.ok(!(await page.textContent('#app')).includes('Highest score'), 'the legacy score is still shown');
    await ctx.close();
  });

  await test('the striker drag takes the drop shadow off the board, and it returns on release', async () => {
    const g = E.createGame([{ id: 'p0', name: 'Ann' }, { id: 'p1', name: 'Bo' }]);
    const m = tableMessages('carrom', [{ id: 'p0', name: 'Ann' }, { id: 'p1', name: 'Bo' }]);
    m[1].view = E.viewFor(g, 'p0');
    const { page, ctx } = await scriptedPage(browser, { messages: [m[0], m[1]], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('.cb-svg');
    const hasShadow = () => page.evaluate(() => document.querySelector('.cb-svg > g[data-shadow]').getAttribute('filter'));
    assert.equal(await hasShadow(), 'url(#cb-shadow)');
    const b = await page.locator('.cb-striker').first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 3 });
    assert.equal(await hasShadow(), null, 'the filter is still on during the drag');
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await hasShadow(), 'url(#cb-shadow)', 'the shadow did not come back after the drag');
    await ctx.close();
  });

  await test('Appearance: light turns the chrome light, dark is the default, and the choice is kept', async () => {
    const { page, ctx } = await open();
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null, 'dark by default');
    await page.evaluate(() => { localStorage.setItem('tv_theme', 'light'); });
    await page.reload(); await page.waitForSelector('.game-grid .game-card');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light', 'the saved choice is applied before the page shows');
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.game-card')).backgroundColor);
    assert.notEqual(bg, 'rgb(12, 31, 23)', 'the cards still have the dark background');
    await page.evaluate(() => { localStorage.removeItem('tv_theme'); });
    await ctx.close();
  });

  await test('Appearance: the password-reset and verify-email pages follow the saved light choice', async () => {
    const { server: s2, url: u2 } = await serve({});
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('tv_theme', 'light'); } catch { /* storage refused */ } });
    const page = await ctx.newPage();
    for (const path of ['/reset-password.html', '/verify-email.html']) {
      await page.goto(u2 + path);
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      assert.notEqual(bg, 'rgb(7, 19, 14)', path + ' stayed dark');
    }
    await ctx.close();
    s2.close();
  });

  await browser.close();
  server.close();
  console.log(`\npolish ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
