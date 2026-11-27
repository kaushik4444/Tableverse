'use strict';
// Before Ready, the table's top bar still works (leave, rules, reactions), but a game's own actions (Resign, a card or piece) do not.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const ids = ['me', 'p1', 'p2', 'p3'];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (gameId) => {
    const m = tableMessages(gameId, four, { roomExtra: { status: 'playing', gate: { ready: [], waiting: ids } } });
    const { page, ctx } = await scriptedPage(browser, { messages: m, viewport: { width: 393, height: 852 } });
    await page.goto(url + '/');
    await page.waitForSelector('[data-table-tools]', { timeout: 8000 });
    return { page, ctx };
  };
  // at phone width the less-used buttons sit in the "⋯" menu: opening that menu is allowed before Ready, so the test does the same
  const reveal = async (page, sel) => {
    if (!(await page.locator(sel).first().isVisible().catch(() => false))) await page.locator('[data-act="toggleTools"]').first().click();
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 4000 });
  };
  const sent = (page, t) => page.evaluate((x) => window.__sent.filter((m) => m.t === x).length, t);

  // Leaving with other people at the table asks first ("Leave game?"); the question itself proves the button works
  const leaveAsks = async (page) => { await page.waitForSelector('text=Leave game?', { timeout: 4000 }); };

  await test('before Ready: the leave button in the top bar works (it asks to confirm)', async () => {
    const { page, ctx } = await open('carrom');
    await page.locator('[data-table-tools] [data-cb="leave"], [data-table-tools] [data-act="leave"]').first().click();
    await leaveAsks(page);
    assert.equal(await sent(page, 'act'), 0, 'leaving is not a game action');
    await ctx.close();
  });

  await test('before Ready: Rules opens from the top bar', async () => {
    const { page, ctx } = await open('carrom');
    const sel = '[data-table-tools] [data-cb="rules"]';
    await reveal(page, sel);
    await page.locator(sel).first().click();
    await page.waitForSelector('.overlay, .sheet, dialog', { timeout: 4000 });
    await ctx.close();
  });

  await test('before Ready: the game\'s own Resign button does nothing', async () => {
    const { page, ctx } = await open('carrom');
    const resign = page.locator('[data-table-tools] [data-cb="resign"]');
    assert.equal(await resign.count(), 1, 'Resign is shown during play');
    await reveal(page, '[data-table-tools] [data-cb="resign"]');
    await resign.click({ force: true });
    assert.equal(await sent(page, 'act'), 0, 'no game action is sent');
    assert.match(await resign.innerText(), /Resign/);
    assert.doesNotMatch(await resign.innerText(), /Tap again/, 'the resign confirmation does not arm');
    await ctx.close();
  });

  await test('before Ready: a Take 5 card does not go to the server, but the Take 5 leave works', async () => {
    const { page, ctx } = await open('penaltyrows');
    await page.locator('.pr-hand .pr-card').first().click({ force: true });
    assert.equal(await sent(page, 'act'), 0, 'no pick is sent before Ready');
    await page.locator('[data-table-tools] [data-act="leave"]').first().click();
    await leaveAsks(page);
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\ngate toolbar ui: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
