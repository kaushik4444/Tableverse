'use strict';
// Onboarding UX: a signed-in player without an avatar sees a dismissible welcome on home (dismissal stays in this
// browser), and a failed login is announced as an alert on the auth sheet.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

(async () => {
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
    'POST /api/auth/login': () => ({ __status: 401, body: { ok: false, error: 'That email and password do not match.' } }),
  });
  const browser = await chromium.launch();

  await test('a new player with no avatar sees the welcome card with the profile tip, and dismissing it keeps it hidden on reload', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ avatar: '', games: games.list() })] });
    await page.route('**/api/auth/session', (route) => route.fulfill({ json: sessionOk({ player: { id: 'me', display_name: 'Aarav', username: 'aarav', avatar: '', email: 'a@b.c' } }) }));
    await page.goto(url + '/');
    await page.waitForSelector('.onboarding-card', { timeout: 8000 });
    assert.match(await page.textContent('.onboarding-card'), /Choose an avatar/);
    await page.click('[data-act="dismissOnboarding"]');
    assert.equal(await page.locator('.onboarding-card').count(), 0, 'the card closes on dismiss');
    await page.reload();
    await page.waitForSelector('#games', { timeout: 8000 });
    assert.equal(await page.locator('.onboarding-card').count(), 0, 'a dismissed card stays hidden in this browser');
    await ctx.close();
  });

  await test('a player who already has an avatar sees the first steps but not the avatar tip', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ avatar: '🦊', games: games.list() })] });
    await page.goto(url + '/');
    await page.waitForSelector('.onboarding-card', { timeout: 8000 });
    const text = await page.textContent('.onboarding-card');
    assert.match(text, /Pick a game below/);
    assert.doesNotMatch(text, /Choose an avatar/);
    await ctx.close();
  });

  await test('a failed login is announced as an alert on the auth sheet', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'someone@example.com');
    await page.fill('#loginPassword', 'wrong-password');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 8000 });
    assert.match(await page.textContent('#auth-overlay .auth-msg'), /do not match/);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'onboarding UI: all passed');
  process.exit(failed ? 1 : 0);
})();
