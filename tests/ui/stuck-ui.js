'use strict';
// Stale answers: when a person opens one public profile and then another, an answer for the first must never replace the
// second on screen, even if it arrives last. npm run test:ui -- stuck-ui.js
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const GAMES = [{ id: 'wizard', name: 'Wizard', icon: '🧙', accent: '#8a5cf6', seats: { min: 3, max: 6 }, options: [], rules: [] }];
const player = (username, displayName) => ({ ok: true, profile: { username, displayName, avatar: '🦊', joinedAt: '2026-01-01T00:00:00Z', blockedByMe: false, country: null, stats: { played: 0, wins: 0, losses: 0, winRate: 0, perGame: [], recent: [], favouriteGame: null, streak: { current: 0, best: 0 }, progress: {} }, games: [] } });

(async () => {
  let releaseSlow; let releaseFast;
  const slowGate = new Promise((r) => { releaseSlow = r; });
  const fastGate = new Promise((r) => { releaseFast = r; });
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/profile': () => ({ ok: true, profile: { username: 'aarav', displayName: 'Aarav', avatar: '🧙', email: 'a@b.c', emailVerified: true, joinedAt: '2026-01-01T00:00:00Z' }, stats: { played: 0, wins: 0, losses: 0, winRate: 0, perGame: [], recent: [], favouriteGame: null, streak: { current: 0, best: 0 }, progress: {} }, progress: {} }),
    'GET /api/me/friends': () => ({ ok: true, friends: [] }),
    'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: [] }),
    'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [] }),
    'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
    'GET /api/me/history?page=1': () => ({ ok: true, items: [], total: 0, page: 1, pages: 1, pageSize: 10 }),
    'GET /api/players/slow': async () => { await slowGate; return player('slow', 'Slow Person'); },
    'GET /api/players/fast': async () => { await fastGate; return player('fast', 'Fast Person'); },
  });
  const browser = await chromium.launch();

  await test('a late answer for an earlier profile neither replaces nor empties the profile opened after it', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: GAMES })], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/#u/slow');
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#u/fast'; });
    await page.waitForTimeout(300);
    releaseSlow(); // the first person's answer arrives while the second is still loading
    await page.waitForTimeout(500);
    const mid = await page.textContent('#app');
    assert.ok(/Loading profile/.test(mid), 'the second profile stopped loading and shows an empty page: ' + mid.slice(-120));
    assert.ok(!/Slow Person/.test(mid), 'the first profile replaced the second');
    releaseFast();
    await page.waitForFunction(() => /Fast Person/.test(document.querySelector('#app').textContent), null, { timeout: 5000 });
    assert.ok(!/Slow Person/.test(await page.textContent('#app')), 'the first profile replaced the second at the end');
    await ctx.close();
  });

  await test('a signed-in player with every game switched off sees a clear message, not a loading skeleton', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [] })], viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForFunction(() => /No games are open right now/.test(document.querySelector('#app').textContent), null, { timeout: 5000 });
    assert.equal(await page.$('.game-card.sk'), null, 'the loading skeleton is still shown');
    await ctx.close();
  });

  await test('a signed-out visitor whose game list fails sees an error, not a loading skeleton forever', async () => {
    const anon = { ok: true, authenticated: false, emailVerificationRequired: false, csrfToken: 'c' };
    const srv = await serve({
      'GET /api/auth/session': () => anon,
      'GET /api/auth/csrf': () => ({ csrfToken: 'c' }),
      'GET /api/games': () => ({ __status: 500, body: { ok: false, error: 'boom' } }),
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [] });
    await page.goto(srv.url + '/');
    await page.waitForFunction(() => /Could not load the games/.test(document.querySelector('#app').textContent), null, { timeout: 8000 });
    assert.equal(await page.$('.game-card.sk'), null, 'the loading skeleton is still shown');
    await ctx.close();
    srv.server.close();
  });

  await browser.close();
  server.close();
  console.log(`\nstuck ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
