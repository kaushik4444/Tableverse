'use strict';
// A late answer for a card the person has closed must not replace the card opened by a later tap. The first player's
// profile answer is held until after the second card is on screen.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const extras = [{ name: 'Aarav', username: 'aarav' }, { id: 'b', name: 'Bo', username: 'bobby' }, { id: 'c', name: 'Cy', username: 'cydney' }, { id: 'd', name: 'Di', username: 'dinesh' }];
const profile = (username, displayName) => ({ ok: true, profile: { username, displayName, avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played: 1, wins: 0, winRate: 0, blockedByViewer: false, blockedByMe: false, blockedByThem: false } });

(async () => {
  let releaseFirst;
  const held = new Promise((resolve) => { releaseFirst = resolve; });
  const srv = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/players/bobby': async () => { await held; return profile('bobby', 'Bo'); },
    'GET /api/players/cydney': () => profile('cydney', 'Cy'),
  });
  const browser = await chromium.launch();
  await test('a late answer for an earlier card does not replace the card opened by a newer tap', async () => {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: tableMessages('twentynine', extras) });
    await page.goto(srv.url + '/');
    await page.waitForSelector('.pseat[data-pid="b"]', { timeout: 8000 });
    await page.click('.pseat[data-pid="b"]'); // Bo's answer is held
    await page.keyboard.press('Escape'); // the card is closed while Bo's answer is still on its way
    await page.waitForFunction(() => !document.querySelector('#modal-overlay .modal-body'), null, { timeout: 4000 }).catch(() => {});
    await page.click('.pseat[data-pid="c"]'); // Cy's answer comes back at once
    await page.waitForSelector('#modal-overlay .modal-body[data-card="c"] [data-modal-act="cardReport"]', { timeout: 8000 });
    releaseFirst(); // Bo's answer arrives late
    await page.waitForTimeout(400);
    const shown = await page.evaluate(() => document.querySelector('#modal-overlay .modal-body') && document.querySelector('#modal-overlay .modal-body').dataset.card);
    assert.equal(shown, 'c', 'the card on screen is still Cy’s');
    const text = await page.evaluate(() => document.querySelector('#modal-overlay').innerText);
    assert.ok(text.includes('@cydney') || text.includes('cydney'), 'Cy’s handle is shown');
    assert.ok(!text.includes('bobby'), 'Bo’s late answer is not shown');
    await ctx.close();
  });
  await browser.close(); srv.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
