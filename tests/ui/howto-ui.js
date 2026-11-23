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
    const bottom = phone.page.getByRole('navigation', { name: 'Sections' });
    await bottom.getByRole('button', { name: 'Friends' }).click();
    await phone.page.waitForSelector('#friends-panel');
    assert.equal(await bottom.getByRole('button', { name: 'Friends' }).getAttribute('aria-current'), 'page');
    await bottom.getByRole('button', { name: 'Games' }).click();
    await phone.page.waitForSelector('#games .game-grid');
    assert.equal(await bottom.getByRole('button', { name: 'Home' }).getAttribute('aria-current'), 'page');
    await phone.ctx.close();
  });

  await test('tap bloom uses the contact point and open tables show occupied and empty seats', async () => {
    const table = { code: 'ABCDEF', gameId: 'carrom', host: 'Ann', members: 2, seats: 4, status: 'lobby' };
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: games.list(), tables: [table] })] });
    await page.goto(url + '/');
    const dots = page.locator('.public-table').filter({ hasText: "Ann's table" }).locator('.seat-dots');
    await dots.waitFor();
    assert.equal(await dots.getAttribute('aria-hidden'), 'true');
    assert.equal(await dots.locator('i.on').count(), 2);
    assert.equal(await dots.locator('i:not(.on)').count(), 2);

    const card = page.locator('.game-card:not(.is-locked)').filter({ has: page.getByRole('heading', { name: /^Carrom/ }) });
    const bloom = await card.evaluate((el) => {
      const { left, top } = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: left + 24, clientY: top + 36 }));
      return [el.classList.contains('is-tapped'), el.style.getPropertyValue('--mx'), el.style.getPropertyValue('--my')];
    });
    assert.deepEqual(bloom, [true, '24px', '36px']);
    await page.waitForSelector('.game-card.is-tapped', { state: 'detached', timeout: 2500 });
    await ctx.close();
  });

  await test('spectators can open rules manually, but never receive the first-play overlay', async () => {
    const messages = tableMessages('chess', [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }], {
      roomExtra: { spectators: [{ id: 'me', name: 'Watcher' }] },
    });
    const { page, ctx } = await scriptedPage(browser, { messages, firstTime: true });
    await page.goto(url + '/');
    await page.waitForSelector('.wz-status');
    assert.equal(await page.locator('.ht-overlay').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('tv_howto_chess')), null);
    await page.evaluate(() => window.CardTable.showRules('chess'));
    await page.waitForSelector('.ht-overlay');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.textContent('.ht-overlay h2'), 'The pieces');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.textContent('.ht-overlay h2'), 'Moving');
    await page.getByRole('button', { name: 'Skip' }).click();
    assert.equal(await page.locator('#app[inert]').count(), 0);
    await ctx.close();
  });

  await test('the turn bar uses the full server duration, warns, clamps and clears', async () => {
    const now = Date.UTC(2026, 0, 1);
    const messages = tableMessages('chess', [{ name: 'Ann' }, { name: 'Bo' }], {
      roomExtra: { now, deadline: now + 15000, turnMs: 30000 },
    });
    const { page, ctx } = await scriptedPage(browser, { messages });
    await page.clock.setFixedTime(now);
    await page.goto(url + '/');
    const bar = page.locator('.ct-timebar');
    const fill = bar.locator('i');
    const waitForScale = (scale) => page.waitForFunction((x) =>
      document.querySelector('.ct-timebar i')?.style.transform === `scaleX(${x})`, scale);
    await waitForScale(0.5);
    assert.equal(await page.locator('.ct-timebar.on:not(.warn)').count(), 1);
    await page.clock.setFixedTime(now + 7500);
    await waitForScale(0.25);
    assert.equal(await page.locator('.ct-timebar.on.warn').count(), 1);
    await page.clock.setFixedTime(now + 16000);
    await waitForScale(0);
    await page.evaluate((m) => window.__push(m), { ...messages[1], room: { ...messages[1].room, now: now + 16000, deadline: null, turnMs: null } });
    await page.waitForSelector('.ct-timebar.on', { state: 'detached' });
    assert.equal(await fill.evaluate((el) => el.style.transform), 'scaleX(0)');
    assert.equal(await page.locator('.ct-timebar.warn').count(), 0);
    await ctx.close();
  });

  await closeOpenContexts();
  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
