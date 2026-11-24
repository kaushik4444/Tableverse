'use strict';
// The sign-in and sign-up sheet keeps what was typed when a request fails: the same form, the same values, the same focus,
// and no jump in height when the message appears. A refused login re-enables its button.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk } = require('./harness');
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

  await test('a failed sign-up keeps every typed value and the same form on screen', async () => {
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
    await page.evaluate(() => { document.getElementById('registerForm').dataset.marker = 'same-node'; });
    const heightBefore = await page.$eval('#auth-overlay .sheet', (el) => el.getBoundingClientRect().height);
    await page.click('#registerForm button[type="submit"]');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 8000 });
    assert.match(await page.textContent('#auth-overlay .auth-msg'), /already taken/);
    assert.equal(await page.getAttribute('#registerForm', 'data-marker'), 'same-node', 'the form was not rebuilt');
    assert.equal(await page.inputValue('#registerName'), 'Aarav');
    assert.equal(await page.inputValue('#registerUsername'), 'aarav');
    assert.equal(await page.inputValue('#registerEmail'), 'someone@example.com');
    assert.equal(await page.inputValue('#registerPassword'), 'TestPass123!', 'the password is kept too');
    const heightAfter = await page.$eval('#auth-overlay .sheet', (el) => el.getBoundingClientRect().height);
    assert.equal(heightAfter, heightBefore, 'the sheet does not change height when the message appears');
    await ctx.close();
  });

  await test('a refused login keeps the typed values, and the button works again for the next try', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await page.goto(url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.fill('#loginEmail', 'someone@example.com');
    await page.fill('#loginPassword', 'wrong-password');
    await page.evaluate(() => { document.getElementById('loginForm').dataset.marker = 'same-node'; });
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 8000 });
    assert.equal(await page.getAttribute('#loginForm', 'data-marker'), 'same-node', 'the login form was not rebuilt');
    assert.equal(await page.inputValue('#loginEmail'), 'someone@example.com');
    assert.equal(await page.inputValue('#loginPassword'), 'wrong-password');
    const btn = await page.$('#loginForm button[type="submit"]');
    assert.equal(await btn.isDisabled(), false, 'the button is not left disabled');
    assert.equal((await btn.textContent()).trim(), 'Log in');
    await ctx.close();
  });

  await server.close();
  await browser.close();
  if (failed) { console.error(`${failed} auth form test(s) failed`); process.exit(1); }
  console.log('auth form UI: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
