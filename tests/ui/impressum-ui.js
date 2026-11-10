'use strict';
// Signed-out visitors can reach the Impressum from the footer, even while the sign-in sheet is open, and the page loads directly.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk } = require('./harness');

const { chromium } = loadPlaywright();

async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }) });
  const browser = await chromium.launch();
  try {
    await test('signed-out visitor sees the sign-in sheet and a footer link that is clickable above it, and it opens the Impressum', async () => {
      const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
      await page.goto(url + '/');
      await page.waitForSelector('#loginForm', { timeout: 8000 });
      const link = page.locator('footer.legal-foot a[href="/impressum.html"]');
      assert.equal(await link.count(), 1, 'footer link present');
      await link.click({ timeout: 5000 }); // fails if the sign-in overlay covers the link
      await page.waitForURL('**/impressum.html', { timeout: 8000 });
      assert.equal(await page.textContent('h1'), 'Impressum');
      await ctx.close();
    });

    await test('the Impressum loads directly with no session, and the page has no sign-in sheet', async () => {
      const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
      const res = await page.goto(url + '/impressum.html');
      assert.equal(res.status(), 200);
      assert.equal(await page.locator('#auth-overlay').count(), 0);
      assert.equal(await page.textContent('h1'), 'Impressum');
      await ctx.close();
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(process.exitCode ? '\nimpressum UI: FAILED' : '\nimpressum UI: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
