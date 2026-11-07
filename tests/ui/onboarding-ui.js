'use strict';
// Sign-in UX: a failed login or sign-up is announced as an alert on the auth sheet, so screen readers hear it at once.
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
    'POST /api/auth/register': () => ({ __status: 409, body: { ok: false, error: 'That username is already taken.' } }),
  });
  const browser = await chromium.launch();

  await test('a failed sign-up is announced as an alert on the sign-up tab', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.click('#auth-overlay [data-act="showRegister"]');
    await page.waitForSelector('#registerForm', { timeout: 8000 });
    await page.fill('#registerName', 'Aarav');
    await page.fill('#registerUsername', 'aarav');
    await page.fill('#registerEmail', 'someone@example.com');
    await page.fill('#registerPassword', 'TestPass123!');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 8000 });
    assert.match(await page.textContent('#auth-overlay .auth-msg'), /already taken/);
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
