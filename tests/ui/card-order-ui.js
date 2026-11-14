'use strict';
// A late answer for a card the person has closed must not replace the card opened by a later tap. The first player's
// profile answer is held until Cy's card is showing Cy's own numbers; then it is released and the test waits for the
// browser to parse and handle it before checking what is on screen.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const extras = [{ name: 'Aarav', username: 'aarav' }, { id: 'b', name: 'Bo', username: 'bobby' }, { id: 'c', name: 'Cy', username: 'cydney' }, { id: 'd', name: 'Di', username: 'dinesh' }];
// Distinct numbers per player, so a stale answer cannot look like the current one.
const profile = (username, displayName, played, wins, winRate) => ({ ok: true, profile: { username, displayName, avatar: '🦊', joinedAt: '2026-01-01T00:00:00.000Z', played, wins, winRate, blockedByViewer: false, blockedByMe: false, blockedByThem: false } });
// Counts each finished JSON parse of Bo's profile in the page. The app's handler runs in the same microtask flush, right after.
const countBobAnswers = () => {
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    const p = json.call(this);
    if (String(this.url).includes('/api/players/bobby')) p.then(() => { window.__bobAnswers = (window.__bobAnswers || 0) + 1; }, () => {});
    return p;
  };
};

(async () => {
  let releaseFirst;
  const held = new Promise((resolve) => { releaseFirst = resolve; });
  const srv = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/players/bobby': async () => { await held; return profile('bobby', 'Bo', 9, 4, 44); },
    'GET /api/players/cydney': () => profile('cydney', 'Cy', 3, 2, 67),
  });
  const browser = await chromium.launch();
  await test('a late answer for an earlier card does not replace the card opened by a newer tap', async () => {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: tableMessages('twentynine', extras) });
    await page.addInitScript(countBobAnswers);
    await page.goto(srv.url + '/');
    await page.waitForSelector('.pseat[data-pid="b"]', { timeout: 8000 });
    await page.click('.pseat[data-pid="b"]'); // Bo's answer is held
    await page.keyboard.press('Escape'); // the card is closed while Bo's answer is still on its way
    await page.waitForFunction(() => !document.querySelector('#modal-overlay .modal-body'), null, { timeout: 4000 }).catch(() => {});
    await page.click('.pseat[data-pid="c"]'); // Cy's answer comes back at once
    // Cy's own numbers are on screen before Bo's late answer is released, so a stale overwrite would show as Bo's 44%.
    await page.waitForSelector('#modal-overlay .modal-body[data-card="c"] .pcard-stats', { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('#modal-overlay .modal-body[data-card="c"] .pcard-stats')?.innerText.includes('67%'), null, { timeout: 8000 });
    releaseFirst(); // Bo's answer arrives late
    await page.waitForFunction(() => window.__bobAnswers >= 1, null, { timeout: 8000 });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0))); // let the app's handler for that answer run
    const shown = await page.evaluate(() => document.querySelector('#modal-overlay .modal-body') && document.querySelector('#modal-overlay .modal-body').dataset.card);
    assert.equal(shown, 'c', 'the card on screen is still Cy’s');
    const text = await page.evaluate(() => document.querySelector('#modal-overlay').innerText);
    assert.ok(text.includes('cydney'), 'Cy’s handle is shown');
    assert.ok(text.includes('67%') && !text.includes('44%'), 'Cy’s win rate is shown and Bo’s is not');
    assert.ok(!text.includes('bobby'), 'Bo’s late answer is not shown');
    await ctx.close();
  });
  await browser.close(); srv.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
