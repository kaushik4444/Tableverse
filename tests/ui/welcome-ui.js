'use strict';
// First login: the welcome dialog shows once for an account that has not seen it, says what Tableverse is, and is marked
// as seen on the server. A returning player (welcome: false) gets no dialog and no request.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;

async function run(name, session, check) {
  const srv = await serve({
    'GET /api/auth/session': () => sessionOk(session),
    'POST /api/me/welcome-seen': () => ({ ok: true }),
  });
  const browser = await chromium.launch();
  try {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() })] });
    try {
      await page.goto(srv.url + '/');
      await check(page, srv.calls);
      passed++; console.log('  ok  ' + name);
    } finally { await ctx.close(); }
  } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
  finally { await browser.close(); srv.server.close(); }
}

(async () => {
  await run('a first login sees the welcome once and it is marked as seen', { welcome: true }, async (page, calls) => {
    await page.waitForSelector('.modal-sheet[aria-label="Welcome to Tableverse"]', { timeout: 12000 });
    const text = await page.textContent('.modal-sheet');
    assert.ok(/Tableverse is a place to play/.test(text), 'the dialog says what Tableverse is');
    assert.ok(/What’s new/.test(text), 'the dialog shows what is new');
    await page.waitForTimeout(300);
    const seen = calls.filter((c) => c.path === '/api/me/welcome-seen');
    assert.equal(seen.length, 1, 'marked as seen exactly once');
    assert.equal(seen[0].method, 'POST');
    await page.click('[data-modal-act="welcomeStart"]');
    await page.waitForSelector('#modal-overlay', { state: 'detached', timeout: 5000 });
  });

  await run('a returning player gets no welcome dialog and no request', { welcome: false }, async (page, calls) => {
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('.modal-sheet[aria-label="Welcome to Tableverse"]').count(), 0, 'no welcome dialog');
    assert.equal(calls.filter((c) => c.path === '/api/me/welcome-seen').length, 0, 'nothing is marked');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
