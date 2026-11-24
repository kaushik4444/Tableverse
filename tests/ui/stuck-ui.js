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

  await test('a refused leave does not open the profile later, on some other leave', async () => {
    const { tableMessages } = require('./harness');
    const seats = [{ id: 'p0', name: 'Ann', username: 'ann' }, { id: 'p1', name: 'Bo', username: 'bo' }, { id: 'p2', name: 'Cy', username: 'cy' }];
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('wizard', seats), viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="playerCard"][data-pid="p1"]', { timeout: 8000 });
    await page.click('[data-act="playerCard"][data-pid="p1"]');
    await page.click('[data-modal-act="cardProfile"]');
    await page.click('[data-modal-act="cardProfileConfirm"]');
    await page.waitForFunction(() => (window.__sent || []).some((m) => m && m.t === 'leave'), null, { timeout: 3000 });
    await page.evaluate(() => window.__push({ t: 'error', code: 'leave_failed', message: 'Could not leave the table. Try again.' }));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__push({ t: 'left' })); // a later, ordinary leave
    await page.waitForTimeout(400);
    assert.ok(!/#u\//.test(await page.evaluate(() => location.hash)), 'the refused leave opened the profile later');
    await ctx.close();
  });

  await test('only a join failure for the linked table clears its hash', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: GAMES })] });
    try {
      await page.goto(url + '/#ABCDEF');
      await page.click('[data-join-mode="join"]');
      await page.waitForFunction(() => window.__sent.some((m) => m.t === 'join' && m.code === 'ABCDEF'));
      await page.evaluate(() => {
        window.__push({ t: 'error', code: 'leave_failed', message: 'Could not leave the table.' });
        window.__push({ t: 'error', code: 'join_failed', tableCode: 'ZYXWVU', message: 'No table with code ZYXWVU' });
      });
      assert.equal(await page.evaluate(() => location.hash), '#ABCDEF');
      await page.evaluate(() => window.__push({ t: 'error', code: 'join_failed', tableCode: 'ABCDEF', message: 'No table with code ABCDEF' }));
      assert.equal(await page.evaluate(() => location.hash), '');
    } finally { await ctx.close(); }
  });

  await test('a game ends while the connection is down: the ratings are asked for once it is back', async () => {
    const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }].map((x, i) => ({ id: 'p' + i, ...x, saved: true }));
    const { tableMessages } = require('./harness');
    const live = tableMessages('gofish', four);
    const { page, ctx } = await scriptedPage(browser, { messages: live, viewport: { width: 390, height: 844 } });
    await page.goto(url + '/');
    await page.waitForSelector('.gf', { timeout: 8000 });
    // the connection is down as the game ends (no close event: the page does not know yet)
    await page.evaluate(() => { window.__sock().readyState = 3; });
    const done = tableMessages('gofish', four)[1];
    done.view.phase = 'gameOver'; done.view.myTurn = false; done.view.winners = [1];
    Object.assign(done.room, { status: 'finished', hostId: 'p0', votes: [], outcome: { id: 'g1', winners: [{ id: 'p1', name: 'Bo' }], sinceMs: 0, xp: four.map((x) => ({ id: x.id, name: x.name, saved: true, isBot: false, penalised: false })) } });
    await page.evaluate((m) => window.__push(m), done);
    await page.waitForTimeout(4500); // past the game-over stages, which also redraw the card
    assert.equal((await page.evaluate(() => window.__sent.filter((m) => m.t === 'gameTotals'))).length, 0, 'nothing was sent while down');
    await page.evaluate(() => { window.__sock().readyState = 1; }); // the connection is back
    await page.waitForFunction(() => (window.__sent || []).some((m) => m.t === 'gameTotals'), null, { timeout: 4000 });
    await ctx.close();
  });

  await test('the notifications panel says when the friends list could not load, rather than "all caught up"', async () => {
    const srv = await serve({
      'GET /api/auth/session': () => sessionOk(),
      'GET /api/me/profile': () => ({ ok: true, profile: { username: 'aarav', displayName: 'Aarav', avatar: '🧙', email: 'a@b.c', emailVerified: true, joinedAt: '2026-01-01T00:00:00Z' }, stats: { played: 0, wins: 0, losses: 0, winRate: 0, perGame: [], recent: [], favouriteGame: null, streak: { current: 0, best: 0 }, progress: {} }, progress: {} }),
      'GET /api/me/friends': () => ({ __status: 500, body: { ok: false, error: 'Friends are unavailable.' } }),
      'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: [] }),
      'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
      'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [] }),
      'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: GAMES })], viewport: { width: 390, height: 844 } });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.tb-bell', { timeout: 8000 });
    await page.click('.tb-bell');
    await page.waitForSelector('.bell-panel', { timeout: 5000 });
    await page.waitForFunction(() => /Friends are unavailable/.test(document.querySelector('.bell-panel').textContent), null, { timeout: 5000 });
    assert.ok(!/caught up/.test(await page.textContent('.bell-panel')), 'the panel claims everything is handled after a failed load');
    assert.ok(await page.$('.bell-panel [data-act="refreshSocial"]'), 'no way to retry');
    await ctx.close();
    srv.server.close();
  });

  await browser.close();
  server.close();
  console.log(`\nstuck ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
