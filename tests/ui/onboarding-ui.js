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
    await page.check('#registerAdult');
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

  await test('sign-up needs the 18+ box, and sends the confirmation only when it is ticked', async () => {
    const srv = await serve({
      'GET /api/auth/session': () => sessionOk(),
      'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
      'POST /api/auth/register': () => ({ ok: true, csrfToken: 'c', message: 'Check your email for a verification link.', emailVerificationRequired: true }),
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(srv.url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.click('#auth-overlay [data-act="showRegister"]');
    await page.waitForSelector('#registerForm', { timeout: 8000 });
    await page.fill('#registerName', 'Aarav');
    await page.fill('#registerUsername', 'aarav');
    await page.fill('#registerEmail', 'someone@example.com');
    await page.fill('#registerPassword', 'TestPass123!');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(300);
    assert.equal(srv.calls.filter((c) => c.path === '/api/auth/register').length, 0, 'the form is not sent without the box');
    await page.check('#registerAdult');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(500);
    const reg = srv.calls.find((c) => c.path === '/api/auth/register');
    assert.ok(reg, 'the registration is sent once the box is ticked');
    assert.equal(JSON.parse(reg.body).adultConfirmed, true);
    await ctx.close();
    srv.server.close();
  });

  await test('a login retries only a server-marked safe temporary failure', async () => {
    let attempts = 0;
    const retryServer = await serve({
      'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
      'POST /api/auth/login': () => {
        attempts++;
        if (attempts === 1) return { __status: 503, body: { ok: false, retryable: true, error: 'Sign-in is temporarily unavailable.' } };
        return { ok: true, csrfToken: 'new-csrf', emailVerificationRequired: false,
          player: { display_name: 'Aarav', username: 'aarav', avatar: '🧙', email: 'someone@example.com', email_verified: true } };
      },
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome()] });
    await page.goto(retryServer.url + '/');
    await page.locator('nav.topbar button[data-act="showLogin"]').click();
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'someone@example.com');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForFunction(() => !document.getElementById('auth-overlay'), null, { timeout: 8000 });
    assert.equal(attempts, 2);
    await ctx.close();
    retryServer.server.close();
  });

  await test('a gateway timeout is not replayed because the login may have completed', async () => {
    let attempts = 0;
    const timeoutServer = await serve({
      'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
      'POST /api/auth/login': () => {
        attempts++;
        return { __status: 504, body: { ok: false, error: 'Gateway timeout.' } };
      },
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(timeoutServer.url + '/');
    await page.locator('nav.topbar button[data-act="showLogin"]').click();
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'someone@example.com');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 8000 });
    assert.equal(attempts, 1);
    await ctx.close();
    timeoutServer.server.close();
  });

  await test('the sign-up hint follows the password, e-mail and username in any order, and never says "Looks good." for a refused password', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.click('#auth-overlay [data-act="showRegister"]');
    await page.waitForSelector('#registerForm', { timeout: 8000 });
    const hint = () => page.textContent('#registerPwHint');
    await page.fill('#registerPassword', 'MyPassword123!'); // password first; username and e-mail still empty
    assert.match(await hint(), /obvious/, 'a refused password is explained before the username is typed');
    assert.equal(await page.locator('#registerPwHint.bad').count(), 1, 'and marked as a problem');
    await page.fill('#registerUsername', 'sunshine99');
    await page.fill('#registerEmail', 'annabel@example.com');
    await page.fill('#registerPassword', 'Sunshine99!ok');
    assert.match(await hint(), /username/, 'the hint re-checks when the password is typed after the username');
    await page.fill('#registerPassword', 'Blue Tractor 42');
    assert.equal(await hint(), 'Looks good.', 'an accepted passphrase is approved');
    assert.equal(await page.locator('#registerPwHint.bad').count(), 0);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'onboarding UI: all passed');
  process.exit(failed ? 1 : 0);
})();
