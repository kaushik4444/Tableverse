'use strict';
// The how-to-play cards (every game) and the Lamplight top-bar tabs, in a real browser.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, welcome, closeOpenContexts } = require('./harness');
const { chromium } = loadPlaywright();
const games = require('../../games');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const OWN = /made with our own cards/i;

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();

  for (const id of ['chess', 'ludo', 'snakesladders', 'gofish', 'penaltyrows']) {
    await test(`${id}: the cards open the first time with one card per rule, and once closed do not open again`, async () => {
      const def = games.list().find((g) => g.id === id);
      const expectTitles = def.rules.map((r, i) => (OWN.test(r) ? null : def.ruleTitles[i])).filter(Boolean);
      const { page, ctx } = await scriptedPage(browser, { messages: tableMessages(id, [{ name: 'Ann' }, { name: 'Bo' }]), firstTime: true });
      await page.goto(url + '/');
      await page.waitForSelector('.ht-overlay', { timeout: 8000 });
      const seen = [];
      for (let n = 0; n < expectTitles.length; n++) {
        seen.push(await page.textContent('.ht-overlay h2'));
        await page.click('[data-ht="next"]');
      }
      assert.deepEqual(seen, expectTitles);
      assert.equal(await page.locator('.ht-overlay h2').count(), 1, 'an options card or the last card follows');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ht-overlay').count(), 0);
      await page.reload();
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('.ht-overlay').count(), 0, 'seen once, not shown again');
      await ctx.close();
    });
  }

  await test('How to play from the menu reopens the cards at any time, and Tab stays inside them', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: tableMessages('chess', [{ name: 'Ann' }, { name: 'Bo' }]) });
    await page.goto(url + '/');
    await page.waitForSelector('.wz-top, .ch-top, [data-game]', { timeout: 8000 });
    await page.evaluate(() => window.CardTable.showRules('chess'));
    await page.waitForSelector('.ht-overlay');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('.ht-overlay')), true, 'focus never leaves the card');
    }
    await ctx.close();
  });

  await test('overflowing how-to cards start at the heading and keep keyboard navigation in the sheet', async () => {
    const messages = tableMessages('chess', [{ name: 'Ann' }, { name: 'Bo' }]);
    const chess = messages[0].games.find((g) => g.id === 'chess');
    const longRule = 'Read this rule before going to the next card. '.repeat(80);
    Object.assign(chess, {
      rules: ['A short rule.', longRule, longRule, 'Another short rule.'],
      ruleTitles: ['Start', 'Long rule one', 'Long rule two', 'Finish'],
      options: [],
    });
    const { page, ctx } = await scriptedPage(browser, { messages, firstTime: true, viewport: { width: 320, height: 568 } });
    await page.goto(url + '/');
    const sheet = page.locator('.ht-sheet');
    await sheet.waitFor();
    assert.equal(await sheet.locator('[data-ht="next"]:focus').count(), 1, 'focus starts on Next when it fits');

    const checkHeading = async (title) => {
      assert.equal(await sheet.locator('h2:focus').textContent({ timeout: 1000 }), title);
      assert.equal(await sheet.evaluate((el) => el.scrollTop), 0, 'the card starts at the top');
    };
    await page.keyboard.press('ArrowRight');
    await checkHeading('Long rule one');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await sheet.locator('[data-ht="done"]:focus').count(), 1, 'reverse tab wraps to Skip');
    assert.ok(await sheet.evaluate((el) => el.scrollTop > 0), 'reaching Skip scrolls down');
    await sheet.locator('[data-ht="next"]').click();
    await checkHeading('Long rule two');
    await page.keyboard.press('Tab');
    assert.equal(await sheet.locator('[data-ht="back"]:focus').count(), 1, 'forward tab reaches Back');
    await page.keyboard.press('Enter');
    await checkHeading('Long rule one');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await sheet.locator('[data-ht="done"]:focus').textContent({ timeout: 1000 }), 'Got it');
    await ctx.close();
  });

  await test('top bar: the tabs show on a wide screen with a pill under the hovered tab, and not on a phone', async () => {
    const wide = await scriptedPage(browser, { messages: [welcome({ id: 'me', name: 'Ann', games: games.list() })], viewport: { width: 1100, height: 800 } });
    await wide.page.goto(url + '/');
    await wide.page.waitForSelector('.tb-tabs');
    assert.equal(await wide.page.locator('.topbar .tb-tab').count(), 4);
    assert.equal(await wide.page.getAttribute('.tb-tab[aria-current="page"]', 'data-act'), 'goHome');
    await wide.page.hover('.topbar .tb-tab[data-act="openFriendsPage"]');
    await wide.page.waitForTimeout(450);
    const w = await wide.page.evaluate(() => parseFloat(document.querySelector('.tb-pill').style.width));
    assert.ok(w > 20, `the pill has width (${w})`);
    await wide.ctx.close();
    const phone = await scriptedPage(browser, { messages: [welcome({ id: 'me', name: 'Ann', games: games.list() })], viewport: { width: 390, height: 800 } });
    await phone.page.goto(url + '/');
    await phone.page.waitForSelector('.topbar');
    assert.equal(await phone.page.evaluate(() => getComputedStyle(document.querySelector('.topbar .tb-tabs')).display), 'none');
    assert.equal(await phone.page.evaluate(() => getComputedStyle(document.querySelector('.bn')).position), 'fixed', 'the bottom tab bar shows on a phone');
    assert.equal(await phone.page.locator('[data-act="openFriendsPage"]').count() >= 1, true, 'the account menu still has Friends');
    await phone.ctx.close();
  });

  await closeOpenContexts();
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    for (const id of ['chess', 'ludo', 'snakesladders']) {
      await test(`${id} at ${size.width}x${size.height}: the how-to box keeps one size on every card`, async () => {
        const { page, ctx } = await scriptedPage(browser, { messages: tableMessages(id, [{ name: 'Ann' }, { name: 'Bo' }]), firstTime: true, viewport: size });
        await page.goto(url + '/');
        await page.waitForSelector('.ht-sheet', { timeout: 8000 });
        const box = () => page.locator('.ht-sheet').boundingBox().then((b) => ({ w: Math.round(b.width), h: Math.round(b.height) }));
        await page.waitForTimeout(600); // let the sheet's entrance animation finish before measuring
        const first = await box();
        const total = await page.locator('.ht-dots i').count();
        for (let n = 1; n < total; n++) await page.click('[data-ht="next"]');
        const last = await box();
        assert.deepEqual(last, first, `first card ${JSON.stringify(first)} vs last card ${JSON.stringify(last)}`);
        await ctx.close();
      });
    }
  }

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
