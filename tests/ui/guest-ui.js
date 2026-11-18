'use strict';
// Guest play in the page (Playwright, mocked server, scripted socket): the "Play as a guest" button, the name sheet, the
// locked game for a guest (the account prompt), the account reminder (shown, dismissed), the upgrade form (a confirmation
// e-mail, nothing changes yet) and the live update when a guest's account is confirmed.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome } = require('./harness');
const { chromium } = loadPlaywright();
const games = require('../../games').list();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

/** The public game list (no viewer): a game is open to everybody only when its access is 'on'. */
const snapshotGames = (access = {}) => games.map((g) => ({ ...g, access: access[g.id] || 'on', enabled: (access[g.id] || 'on') === 'on' }));
const anonymous = () => ({ ok: true, authenticated: false, emailVerificationRequired: false, csrfToken: 'c' });
const guestSession = () => ({ ok: true, authenticated: true, isGuest: true, role: 'guest', emailVerificationRequired: false, emailVerified: false, csrfToken: 'c',
  player: { id: 'ann', display_name: 'Ann', username: null, avatar: '🧙', is_anonymous: true } });

(async () => {
  const browser = await chromium.launch();

  await test('the home page offers "Play as a guest" only when the server allows guest play', async () => {
    for (const guestPlay of [true, false]) {
      const srv = await serve({ 'GET /api/auth/session': () => anonymous(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': () => ({ ok: true, guestPlay, games: snapshotGames() }) });
      const { page, ctx } = await scriptedPage(browser, { messages: [] });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.game-card', { timeout: 8000 });
      const count = await page.locator('[data-act="playAsGuest"]').count();
      assert.equal(count, guestPlay ? 1 : 0, 'guestPlay=' + guestPlay);
      await ctx.close(); srv.server.close();
    }
  });

  await test('"Play as a guest" opens the name sheet, and submitting it starts a guest visit', async () => {
    const seen = {};
    let signedIn = false;
    const srv = await serve({
      'GET /api/auth/session': () => (signedIn ? guestSession() : anonymous()), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }),
      'GET /api/games': () => ({ ok: true, guestPlay: true, games: snapshotGames() }),
      'POST /api/auth/guest': ({ body }) => { seen.body = JSON.parse(body); signedIn = true; return { ok: true, guest: true, isGuest: true, role: 'guest', csrfToken: 'c', player: { id: 'ann', display_name: 'Ann', avatar: '🧙', is_anonymous: true }, expiresInHours: 72 }; },
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [] });
    await page.goto(srv.url + '/');
    await page.click('[data-act="playAsGuest"]');
    await page.waitForSelector('#guestForm', { timeout: 4000 });
    await page.fill('#guestName', 'Ann');
    await page.click('#guestForm [type="submit"]');
    await page.waitForFunction(() => document.getElementById('auth-overlay') === null, null, { timeout: 6000 });
    assert.equal(seen.body.displayName, 'Ann', 'the chosen name is sent');
    await ctx.close(); srv.server.close();
  });

  await test('a guest sees a game locked for guests with the account prompt; a tap opens the register form', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': () => ({ ok: true, guestPlay: true, games: snapshotGames() }) });
    const locked = games.map((g) => ({ ...g, access: g.id === 'wizard' ? 'guests' : 'on', enabled: g.id !== 'wizard' }));
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: locked })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.game-card.is-locked', { timeout: 8000 });
    assert.match(await page.textContent('.game-card.is-locked'), /Create a free account to play/);
    assert.equal(await page.locator('.game-card.is-locked [data-act="create"]').isEnabled(), true, 'the button stays enabled: a tap explains');
    await page.click('.game-card.is-locked [data-act="create"]');
    await page.waitForSelector('#registerForm', { timeout: 4000 });
    await ctx.close(); srv.server.close();
  });

  await test('a registered player sees the same game as open (no prompt, no lock)', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => ({ ok: true, authenticated: true, isGuest: false, role: 'user', emailVerified: true, csrfToken: 'c', player: { id: 'me', display_name: 'Aarav', username: 'aarav', avatar: '🧙', email: 'a@b.c' } }), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }) });
    const open = games.map((g) => ({ ...g, access: g.id === 'wizard' ? 'guests' : 'on', enabled: true }));
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ role: 'user', games: open })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.game-card', { timeout: 8000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.game-card.is-locked').count(), 0);
    assert.equal(await page.locator('.guest-nudge').count(), 0, 'no guest reminder for a registered player');
    await ctx.close(); srv.server.close();
  });

  await test('the reminder is shown to a guest, and "Not now" hides it', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': () => ({ ok: true, guestPlay: true, games: snapshotGames() }) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: games.map((g) => ({ ...g, access: 'on', enabled: true })) })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.guest-nudge', { timeout: 8000 });
    assert.match(await page.textContent('.guest-nudge'), /playing as a guest/);
    await page.click('.guest-nudge [data-guest-act="dismiss"]');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.guest-nudge').count(), 0, 'hidden after "Not now"');
    await ctx.close(); srv.server.close();
  });

  await test('the upgrade form sends a confirmation request; nothing changes until the link is used (the guest stays a guest)', async () => {
    const seen = {};
    const srv = await serve({
      'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': () => ({ ok: true, guestPlay: true, games: snapshotGames() }),
      'POST /api/auth/upgrade-guest': ({ body }) => { seen.body = JSON.parse(body); return { ok: true, upgraded: false, pending: true, csrfToken: 'c', message: 'Check your email to confirm your account. Until you do, nothing changes and you keep playing as a guest.' }; },
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: games.map((g) => ({ ...g, access: 'on', enabled: true })) })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.guest-nudge [data-guest-act="upgrade"]', { timeout: 8000 });
    await page.click('.guest-nudge [data-guest-act="upgrade"]');
    await page.waitForSelector('#registerForm', { timeout: 4000 });
    await page.fill('#registerName', 'Ann');
    await page.fill('#registerUsername', 'ann_guest');
    await page.fill('#registerEmail', 'ann@example.com');
    await page.fill('#registerPassword', 'Correct-Horse-9');
    await page.check('#registerAdult');
    await page.click('#registerForm [type="submit"]');
    await page.waitForFunction(() => !document.getElementById('auth-overlay'), null, { timeout: 6000 });
    assert.equal(seen.body.username, 'ann_guest');
    assert.equal(seen.body.email, 'ann@example.com');
    assert.equal(seen.body.adultConfirmed, true);
    assert.equal(await page.locator('.guest-nudge').count(), 1, 'still a guest on the page');
    await ctx.close(); srv.server.close();
  });

  await test('when the account is confirmed (here or in another tab), the page drops its guest state at once', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => guestSession(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/games': () => ({ ok: true, guestPlay: true, games: snapshotGames() }) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'ann', name: 'Ann', role: 'guest', games: games.map((g) => ({ ...g, access: 'on', enabled: true })) })] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.guest-nudge', { timeout: 8000 });
    await page.evaluate(() => window.__push({ t: 'identity', isGuest: false, role: 'user', username: 'ann_guest', guestLocked: [] }));
    await page.waitForFunction(() => !document.querySelector('.guest-nudge'), null, { timeout: 4000 });
    assert.match(await page.textContent('body'), /Your account is confirmed/);
    await ctx.close(); srv.server.close();
  });

  await browser.close();
  if (failed) { console.error(`\n${failed} guest UI test(s) failed`); process.exit(1); }
  console.log('\nguest UI tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
