'use strict';
// The customer login path, end to end in the browser: a good login reaches the lobby connection, an unverified account is
// told so with the email kept, a failed connection to the server is explained and the button works again, and a dropped
// connection while the login tab is open does not clear the typed email.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

const player = (verified) => ({ id: 'me', display_name: 'Aarav', username: 'aarav', avatar: '🧙', email: 'a@b.c', email_verified: verified });
const baseRoutes = (login) => ({
  'GET /api/auth/session': () => sessionOk(),
  'GET /api/auth/csrf': () => ({ csrfToken: 'c' }),
  'GET /api/auth/google/config': () => ({ ok: true, enabled: false }),
  'POST /api/auth/login': login,
});

(async () => {
  const browser = await chromium.launch();

  await test('a good password login closes the sheet and connects to the lobby', async () => {
    const { server, url } = await serve(baseRoutes(() => ({ ok: true, csrfToken: 'c2', player: player(true), requiresVerification: false })));
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'a@b.c');
    await page.fill('#loginPassword', 'TestPass123!');
    const helloBefore = await page.evaluate(() => window.__sent.filter((m) => m.t === 'hello').length);
    await page.click('#loginForm [type="submit"]');
    await page.waitForFunction(() => !document.getElementById('auth-overlay'), null, { timeout: 8000 });
    // a hello from before the login does not count: the login must open a new connection to the lobby
    await page.waitForFunction((before) => window.__sent.filter((m) => m.t === 'hello').length > before, helloBefore, { timeout: 8000 });
    await ctx.close(); server.close();
  });

  await test('an account whose email is not verified is told so, and the email is kept', async () => {
    const { server, url } = await serve(baseRoutes(() => ({ ok: true, csrfToken: 'c2', player: player(false), requiresVerification: true })));
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'a@b.c');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginForm [type="submit"]');
    // the sheet keeps the seeded "Log in to play." until the server answers, so wait for the verification text itself
    await page.waitForFunction(() => { const m = document.querySelector('#auth-overlay .auth-msg'); return !!m && /verify your email/i.test(m.textContent); }, null, { timeout: 8000 });
    assert.match(await page.textContent('#auth-overlay .auth-msg'), /verify your email/i);
    assert.equal(await page.inputValue('#loginEmail'), 'a@b.c', 'the email was cleared');
    await ctx.close(); server.close();
  });

  await test('a connection that fails before the server answers says so, and the button works again', async () => {
    const { server, url } = await serve(baseRoutes(() => ({ ok: true })));
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.route('**/api/auth/login', (route) => route.abort('internetdisconnected'));
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'a@b.c');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.click('#loginForm [type="submit"]');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 10000 });
    const msg = await page.textContent('#auth-overlay .auth-msg');
    assert.match(msg, /Could not reach the server/, 'the message should say the server could not be reached');
    assert.doesNotMatch(msg, /Failed to fetch|TypeError|undefined/i, 'a raw browser error reached the customer');
    await page.waitForFunction(() => { const b = document.querySelector('#loginForm [type="submit"]'); return b && !b.disabled && b.textContent.trim() === 'Log in'; }, null, { timeout: 5000 });
    assert.equal(await page.inputValue('#loginEmail'), 'a@b.c', 'the email was cleared');
    await ctx.close(); server.close();
  });

  await test('a dropped connection while the login tab is open keeps the typed email and password', async () => {
    const { server, url } = await serve(baseRoutes(() => ({ ok: false, error: 'That email and password do not match.', __status: 401 })));
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'a@b.c');
    await page.fill('#loginPassword', 'TestPass123!');
    await page.evaluate(() => { document.getElementById('loginForm').dataset.marker = 'same-node'; });
    await page.evaluate(() => window.__drop());
    await page.waitForTimeout(1500);
    assert.equal(await page.getAttribute('#loginForm', 'data-marker'), 'same-node', 'the login form was rebuilt after the reconnect');
    assert.equal(await page.inputValue('#loginEmail'), 'a@b.c', 'the email was lost');
    assert.equal(await page.inputValue('#loginPassword'), 'TestPass123!', 'the password was lost');
    await ctx.close(); server.close();
  });

  await browser.close();
  if (failed) { console.error(`\n${failed} login flow test(s) failed`); process.exit(1); }
  console.log('\nlogin flow ui: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
