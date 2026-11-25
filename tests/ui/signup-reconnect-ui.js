'use strict';
// A dropped connection while someone is filling in the sign-up form must not wipe it. The reconnect is answered with
// authRequired (the visitor has no session yet), and that must not switch the sheet to the login tab.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

(async () => {
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
  });
  const browser = await chromium.launch();

  await test('a dropped connection and reconnect keep the sign-up form and what was typed', async () => {
    const { page, ctx } = await scriptedPage(browser);
    await page.goto(url + '/');
    const waitForHello = (before) => page.waitForFunction(
      (count) => window.__sent.filter((m) => m.t === 'hello').length > count, before, { timeout: 8000 },
    );
    // Deliver one response per hello, without any competing replies scheduled by the harness.
    await waitForHello(0);
    await page.evaluate(() => window.__push({ t: 'authRequired', message: 'Please log in to play.' }));
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.click('#auth-overlay [data-act="showRegister"]');
    await page.waitForSelector('#registerForm', { timeout: 8000 });
    await page.fill('#registerName', 'Aarav');
    await page.fill('#registerUsername', 'aarav');
    await page.fill('#registerEmail', 'someone@example.com');
    await page.evaluate(() => { document.getElementById('registerForm').dataset.marker = 'same-node'; });
    const helloBefore = await page.evaluate(() => {
      const count = window.__sent.filter((m) => m.t === 'hello').length;
      window.__drop();
      return count;
    });
    await waitForHello(helloBefore);
    await page.evaluate(() => window.__push({ t: 'authRequired', message: 'Reconnected. Create your account.' }));
    await page.waitForFunction(() => document.querySelector('#auth-overlay .auth-msg')?.textContent === 'Reconnected. Create your account.', null, { timeout: 8000 });
    assert.equal(await page.getAttribute('#registerForm', 'data-marker'), 'same-node', 'the sign-up form was rebuilt after the reconnect');
    assert.equal(await page.inputValue('#registerName'), 'Aarav', 'the display name was lost');
    assert.equal(await page.inputValue('#registerUsername'), 'aarav', 'the username was lost');
    assert.equal(await page.inputValue('#registerEmail'), 'someone@example.com', 'the email was lost');
    await ctx.close();
  });

  await server.close();
  await browser.close();
  if (failed) { console.error(`\n${failed} signup reconnect test(s) failed`); process.exit(1); }
  console.log('\nsignup reconnect ui: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
