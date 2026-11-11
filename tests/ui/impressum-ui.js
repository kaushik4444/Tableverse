'use strict';
// The Impressum is reachable from the sign-in sheet (signed out) and from the home footer (signed in), with no fixed footer
// in the way: links and the host's Start game button are fully visible and clickable at phone and desktop sizes.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');

const { chromium } = loadPlaywright();
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];

async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

/** Fully inside the viewport and the element at its centre is the element itself or one of its children. */
async function assertVisibleAndClickable(page, selector, label) {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true,
      inViewport: b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth && b.width > 0 && b.height > 0,
      top: Math.round(b.top), bottom: Math.round(b.bottom), viewportH: innerHeight,
      tapHitsTarget: !!top && (top === el || el.contains(top)),
    };
  }, selector);
  assert.ok(r.found, `${label}: element present`);
  assert.ok(r.inViewport, `${label}: fully inside the viewport (top ${r.top}, bottom ${r.bottom}, viewport ${r.viewportH})`);
  assert.ok(r.tapHitsTarget, `${label}: nothing covers its centre`);
}

(async () => {
  const sessionApi = { 'GET /api/auth/session': () => sessionOk(), 'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }) };
  const { server, url } = await serve(sessionApi);
  const guestApi = {
    'GET /api/auth/session': () => ({ ok: true, authenticated: false, requireEmailVerification: true, csrfToken: 'test-csrf' }),
    'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
    'GET /api/games': () => ({ ok: true, games: require('../../games').list(), tables: [], impressumPublished: true }),
  };
  const guest = await serve(guestApi);
  const browser = await chromium.launch();
  try {
    for (const vp of SIZES) {
      const size = `${vp.width}x${vp.height}`;

      await test(`signed out (${size}): the sign-in sheet has an Impressum link that is visible and opens the page`, async () => {
        // A fresh visitor: no session and no welcome. The flag must arrive through /api/games (loadSnapshot), not the socket.
        const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages: [] });
        await page.goto(guest.url + '/');
        // the guest home footer shows the link only once /api/games has delivered the flag
        await page.waitForSelector('.home-foot a[href="/impressum.html"]', { state: 'attached', timeout: 8000 });
        await page.click('[data-act="create"]', { timeout: 5000 });
        await page.waitForSelector('#loginForm', { timeout: 8000 });
        await assertVisibleAndClickable(page, '#auth-overlay .auth-legal a[href="/impressum.html"]', 'sign-in sheet link');
        // WCAG AA for small text: the link must reach 4.5:1 against the darker stop of the sheet's dark gradient (#1d1c55)
        const css = await page.$eval('#auth-overlay .auth-legal a', (el) => getComputedStyle(el).color);
        const [r, g, b] = css.match(/\d+(\.\d+)?/g).map(Number);
        const lum = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        const L1 = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
        const L2 = 0.2126 * lum(0x1d) + 0.7152 * lum(0x1c) + 0.0722 * lum(0x55);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        assert.ok(ratio >= 4.5, `sign-in link contrast ${ratio.toFixed(2)}:1 (colour ${css}) must be at least 4.5:1`);
        await page.click('#auth-overlay .auth-legal a[href="/impressum.html"]', { timeout: 5000 });
        await page.waitForURL('**/impressum.html', { timeout: 8000 });
        assert.equal(await page.textContent('h1'), 'Impressum');
        await ctx.close();
      });

      await test(`signed in (${size}): the home footer has an Impressum link that is visible and opens the page`, async () => {
        const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list(), impressumPublished: true }), { t: 'state', room: null, view: null }] });
        await page.goto(url + '/');
        await page.waitForSelector('.home-foot', { timeout: 8000 });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await assertVisibleAndClickable(page, '.home-foot a[href="/impressum.html"]', 'home footer link');
        await page.click('.home-foot a[href="/impressum.html"]', { timeout: 5000 });
        await page.waitForURL('**/impressum.html', { timeout: 8000 });
        assert.equal(await page.textContent('h1'), 'Impressum');
        await ctx.close();
      });

      await test(`host lobby (${size}): the Start game button is fully visible and clickable`, async () => {
        const def = games.get('wizard');
        const members = [
          { id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true, ping: null, username: null },
          { id: 'p1', name: 'Bo', bot: false, avatar: '🧙', connected: true, ping: null, username: null },
        ];
        const room = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'public', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members };
        const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list(), impressumPublished: true }), { t: 'state', room, view: null }] });
        await page.goto(url + '/');
        await page.waitForSelector('.start-bar button', { timeout: 8000 });
        await assertVisibleAndClickable(page, '.start-bar button', 'Start game');
        await ctx.close();
      });

      await test(`(${size}): no fixed footer is rendered, and no visible clickable fixed element sits over the home page`, async () => {
        const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list(), impressumPublished: true }), { t: 'state', room: null, view: null }] });
        await page.goto(url + '/');
        await page.waitForSelector('.home-foot', { timeout: 8000 });
        const fixed = await page.evaluate(() => {
          return {
            legalFoot: !!document.querySelector('.legal-foot'),
            fixed: [...document.querySelectorAll('body *')].filter((el) => {
              const cs = getComputedStyle(el);
              const b = el.getBoundingClientRect();
              // only fixed elements that can take clicks matter; pointer-events:none ones (the 1px voice audio root) cannot obstruct
              return cs.position === 'fixed' && cs.pointerEvents !== 'none' && cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0;
            }).map((el) => el.id || el.className || el.tagName),
          };
        });
        assert.equal(fixed.legalFoot, false, 'no .legal-foot');
        assert.deepEqual(fixed.fixed, [], 'no visible, clickable fixed element on the home page');
        await ctx.close();
      });
    }

    await test('timing: a sign-in sheet opened before /api/games answers still gets the link once the flag arrives', async () => {
      let release;
      const gate = new Promise((r) => { release = r; });
      const slow = await serve({
        'GET /api/auth/session': () => sessionOk(),
        'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
        'GET /api/games': async () => { await gate; return { ok: true, games: require('../../games').list(), tables: [], impressumPublished: true }; },
      });
      try {
        // authRequired opens the sheet at once and asks for a snapshot, whose answer (the flag) is still held back here
        const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
        await page.goto(slow.url + '/');
        await page.waitForSelector('#loginForm', { timeout: 8000 });
        assert.equal(await page.locator('#auth-overlay .auth-legal a').count(), 0, 'sheet open before the flag: no link yet');
        release();
        await page.waitForSelector('#auth-overlay .auth-legal a[href="/impressum.html"]', { state: 'attached', timeout: 8000 });
        await page.fill('#loginEmail', 'typed@example.com');
        assert.equal(await page.inputValue('#loginEmail'), 'typed@example.com', 'typed input survives the update');
        await ctx.close();
      } finally {
        release();
        slow.server.close();
      }
    });

    await test('publication off: a guest sees no Impressum link in the footer or on the sign-in sheet', async () => {
      const off = await serve({
        'GET /api/auth/session': () => ({ ok: true, authenticated: false, requireEmailVerification: true, csrfToken: 'test-csrf' }),
        'GET /api/auth/csrf': () => ({ csrfToken: 'test-csrf' }),
        'GET /api/games': () => ({ ok: true, games: require('../../games').list(), tables: [], impressumPublished: false }),
      });
      try {
        const { page, ctx } = await scriptedPage(browser, { messages: [] });
        await page.goto(off.url + '/');
        await page.waitForSelector('[data-act="create"]', { timeout: 8000 });
        await page.click('[data-act="create"]', { timeout: 5000 });
        await page.waitForSelector('#loginForm', { timeout: 8000 });
        assert.equal(await page.locator('a[href="/impressum.html"]').count(), 0, 'no Impressum link anywhere on the page');
        await ctx.close();
      } finally {
        off.server.close();
      }
    });

    await test('publication off: no Impressum link in the home footer or the sign-in sheet', async () => {
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'me', name: 'Aarav', games: games.list(), impressumPublished: false }), { t: 'state', room: null, view: null }] });
      await page.goto(url + '/');
      await page.waitForSelector('.home-foot', { timeout: 8000 });
      assert.equal(await page.locator('.home-foot a[href="/impressum.html"]').count(), 0, 'footer link hidden');
      await ctx.close();
    });

    await test('the Impressum loads directly with no session, and the page has no sign-in sheet', async () => {
      const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.', impressumPublished: true }] });
      const res = await page.goto(url + '/impressum.html');
      assert.equal(res.status(), 200);
      assert.equal(await page.locator('#auth-overlay').count(), 0);
      assert.equal(await page.textContent('h1'), 'Impressum');
      await ctx.close();
    });
  } finally {
    await browser.close();
    server.close();
    guest.server.close();
  }
  console.log(process.exitCode ? '\nimpressum UI: FAILED' : '\nimpressum UI: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
