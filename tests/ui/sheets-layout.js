'use strict';
// Layout of the sheets and dialogs (login, feedback, what's new, game log, leave), the lobby and the admin page on phone widths.
// Each sheet is opened the way a player opens it: by clicking its real control. A sheet must fit the width, and if it is taller
// than the screen its overlay or the sheet itself must scroll, so its controls can still be reached.
// A case that cannot find its control is reported as SKIP (not a pass) so a missing trigger is visible.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome, tableMessages } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0; let skipped = 0;
const SKIP = Symbol('skip');
async function test(name, fn) {
  try {
    const r = await fn();
    if (r === SKIP) { skipped++; console.log('  SKIP  ' + name + ' (no control found; not counted as a pass)'); return; }
    passed++; console.log('  ok  ' + name);
  } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
}

const VIEWPORTS = [{ name: '360x640', width: 360, height: 640 }, { name: '390x844', width: 390, height: 844 }];

// Clicks the first element the finder returns (the app handles the click like a tap). Returns false when there is none.
async function tap(page, finderSrc) {
  return page.evaluate((src) => {
    const el = (new Function('return ' + src)())(document);
    if (!el) return false;
    el.click();
    return true;
  }, finderSrc);
}

// The sheet fits the width; if it is taller than the screen, it (or its overlay) scrolls.
async function assertSheetFits(page, sheetSel, label) {
  const r = await page.evaluate((sel) => {
    const sheet = document.querySelector(sel);
    if (!sheet) return { missing: true };
    const overlay = sheet.closest('.overlay') || sheet;
    const b = sheet.getBoundingClientRect();
    const scroller = [sheet, overlay].find((e) => /auto|scroll/.test(getComputedStyle(e).overflowY)) || null;
    // The controls are what a player needs, so judge their real positions, not only the sheet's border box: a sheet can fit its
    // box while its lower buttons are clipped by overflow:hidden.
    const controls = [...sheet.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter((c) => c.offsetParent !== null && getComputedStyle(c).visibility !== 'hidden');
    const bottoms = controls.map((c) => c.getBoundingClientRect().bottom);
    const tops = controls.map((c) => c.getBoundingClientRect().top);
    return { missing: false, x: b.x, right: b.right, vw: innerWidth, vh: innerHeight,
      controlsCount: controls.length,
      lowest: bottoms.length ? Math.max(...bottoms) : 0, highest: tops.length ? Math.min(...tops) : 0,
      scrollerReaches: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : false,
      clipped: scroller === null && sheet.scrollHeight > sheet.clientHeight + 1,
      pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1 };
  }, sheetSel);
  assert.equal(r.missing, false, `${label}: the sheet is on screen`);
  assert.ok(r.x >= -1 && r.right <= r.vw + 1, `${label}: the sheet fits the width (${Math.round(r.x)}..${Math.round(r.right)} of ${r.vw})`);
  assert.equal(r.pageScrollsSideways, false, `${label}: the page does not scroll sideways`);
  assert.ok(r.controlsCount > 0, `${label}: the sheet has controls`);
  const reachable = r.lowest <= r.vh + 1 && r.highest >= -1;
  assert.ok(reachable || r.scrollerReaches, `${label}: every control can be reached (lowest ${Math.round(r.lowest)}, highest ${Math.round(r.highest)} of ${r.vh}; a scrolling sheet is needed when they do not fit)`);
  assert.equal(r.clipped, false, `${label}: the sheet does not clip its content (no hidden overflow)`);
}

(async () => {
  // Guest: the session answer says not signed in (no `authenticated`), so the guest topbar and footer render.
  const guest = await serve({});
  // Signed in: the session answer is the normal signed-in one.
  const member = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      const viewport = { width: vp.width, height: vp.height };
      const at = vp.name;

      // Logged-out home: the Log in and Feedback controls in the topbar. The topbar is stressed with wider letter-spacing, so
      // a wider fallback font on a runner cannot push the bar past the screen without this failing.
      for (const [label, finder, sheet] of [
        ['login sheet', "(d) => d.querySelector('[data-act=\"showLogin\"]')", '.auth-sheet'],
        ['feedback dialog', "(d) => d.querySelector('[data-act=\"openFeedback\"]')", '.modal-sheet'],
      ]) {
        await test(`${label} fits ${at}`, async () => {
          const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcome({ games: games.list() })] });
          try {
            await page.goto(guest.url + '/');
            await page.waitForSelector('.topbar', { timeout: 8000 });
            await page.addStyleTag({ content: '.topbar, .topbar * { letter-spacing: .08em !important; }' });
            if (!(await tap(page, finder))) return SKIP;
            await page.waitForSelector(sheet, { timeout: 4000 });
            await page.waitForTimeout(150);
            await assertSheetFits(page, sheet, `${label} at ${at}`);
          } finally { await ctx.close(); }
        });
      }

      // Signed-in home: What's new in the footer.
      await test(`what's new dialog fits ${at}`, async () => {
        const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcome({ games: games.list() })] });
        try {
          await page.goto(member.url + '/');
          await page.waitForSelector('.game-grid .game-card', { timeout: 8000 });
          if (!(await tap(page, "(d) => d.querySelector('[data-act=\"openWhatsNew\"]')"))) return SKIP;
          await page.waitForSelector('.modal-sheet', { timeout: 4000 });
          await page.waitForTimeout(150);
          await assertSheetFits(page, '.modal-sheet', `what's new at ${at}`);
        } finally { await ctx.close(); }
      });

      // A wizard table in progress: the game log button and the leave control.
      for (const [label, finder, sheet] of [
        ['game log', "(d) => d.querySelector('[data-act=\"activityLog\"]')", '.activity-sheet'],
        ['leave confirmation', "(d) => [...d.querySelectorAll('button')].find((b) => b.offsetParent && Object.values(b.dataset).includes('leave'))", '.modal-sheet', "(d) => d.querySelector('[data-act=\"toggleTools\"]')"],
      ]) {
        await test(`${label} fits ${at}`, async () => {
          const { page, ctx } = await scriptedPage(browser, { viewport, messages: tableMessages('wizard', [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Cy' }, { name: 'Di' }]) });
          try {
            await page.goto(member.url + '/');
            await page.waitForSelector('.wz-top', { timeout: 8000 });
            if (label === 'game log') {
              // The log button sits in the More menu. Open it with a real click, then click the log button the way a player does
              // (Playwright checks visibility and that nothing covers it). A missing control fails here rather than skipping.
              await page.locator('[data-act="toggleTools"]').click({ timeout: 4000 });
              await page.waitForTimeout(150);
              await page.locator('[data-act="activityLog"]').click({ timeout: 4000 });
            } else {
              if (label === 'leave confirmation') { if (!(await tap(page, "(d) => d.querySelector('[data-act=\"toggleTools\"]')"))) return SKIP; await page.waitForTimeout(150); }
              if (!(await tap(page, finder))) return SKIP;
            }
            await page.waitForSelector(sheet, { timeout: 4000 });
            await page.waitForTimeout(150);
            await assertSheetFits(page, sheet, `${label} at ${at}`);
          } finally { await ctx.close(); }
        });
      }

      // The lobby (private table, waiting): no sideways scroll, and the host's start control is on the page.
      await test(`lobby fits ${at}`, async () => {
        const def = games.get('wizard');
        const room = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'private', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
          members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }, { id: 'p1', name: 'Bo', bot: false, avatar: '🦊', connected: true }, { id: 'b1', name: 'Merlin', bot: true, avatar: '🐉', connected: true }] };
        const { page, ctx } = await scriptedPage(browser, { viewport, messages: [welcome({ games: games.list() }), { t: 'state', room, view: null }] });
        try {
          await page.goto(member.url + '/');
          await page.waitForSelector('.code-card', { timeout: 8000 });
          const r = await page.evaluate(() => ({ sideways: document.documentElement.scrollWidth > innerWidth + 1, start: !!document.querySelector('[data-act="start"]') }));
          assert.equal(r.sideways, false, `the lobby does not scroll sideways at ${at}`);
          assert.ok(r.start, 'the host can start from the lobby');
        } finally { await ctx.close(); }
      });

      // The admin page shell is public static HTML; it must not scroll sideways on a phone before anyone signs in.
      await test(`admin page shell fits ${at}`, async () => {
        const { page, ctx } = await scriptedPage(browser, { viewport, messages: [] });
        try {
          await page.goto(member.url + '/admin.html');
          await page.waitForTimeout(300);
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.equal(sideways, false, `the admin page does not scroll sideways at ${at}`);
        } finally { await ctx.close(); }
      });
    }
  } finally {
    await browser.close();
    guest.server.close();
    member.server.close();
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (failed) process.exit(1);
  }
})();
