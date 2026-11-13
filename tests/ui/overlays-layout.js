'use strict';
/**
 * Layout of the two overlays that the sheets test does not cover: the "How to play" rules dialog (opened from a game
 * card on the home page and from the table bar) and the table's More menu. Each must fit the viewport, or scroll inside
 * itself, keep its close control reachable, and every menu item must be on screen. The page must not scroll sideways.
 * Chromium emulation only (real iOS Safari and Android are not covered).
 */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk, tableMessages } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const SIZES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '667x375', width: 667, height: 375 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
];

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e).split('\n').slice(0, 3).join('\n')); }
}

// Reads an open overlay: whether it fits, whether it can scroll, and which of its controls are on screen.
async function readOverlay(page, sel) {
  return page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fits = r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
    const scrolls = el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
    const btns = [...el.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => {
      const q = b.getBoundingClientRect();
      return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 22), w: q.width, h: q.height, l: q.left, r: q.right, t: q.top, b: q.bottom };
    });
    const contentFits = el.scrollHeight <= el.clientHeight + 2;
    return { fits, scrolls, contentFits, box: { l: r.left, r: r.right, t: r.top, b: r.bottom }, btns, sideways: document.documentElement.scrollWidth > innerWidth + 1, vw: innerWidth, vh: innerHeight };
  }, sel);
}

function assertOnScreen(info, what, { menu = false } = {}) {
  assert.equal(info.sideways, false, `${what}: the page does not scroll sideways`);
  // The container's own edges must be on screen, always. Scrolling can only move its contents, not its edges.
  assert.ok(info.fits, `${what}: the box itself is on screen (${Math.round(info.box.t)}..${Math.round(info.box.b)} of ${info.vh}px)`);
  if (!info.contentFits) assert.ok(info.scrolls, `${what}: content taller than the box must scroll inside it`);
  if (menu) {
    assert.ok(info.btns.length > 0, `${what}: the menu has controls`);
    for (const b of info.btns) {
      const inView = b.l >= -1 && b.r <= info.vw + 1 && b.t >= -1 && b.b <= info.vh + 1;
      const inBox = b.l >= info.box.l - 1 && b.r <= info.box.r + 1 && b.t >= info.box.t - 1 && b.b <= info.box.b + 1;
      assert.ok(inView && inBox, `${what}: "${b.label}" is fully on screen and inside the menu`);
    }
  }
}

// A dialog that scrolls inside itself is fine if its close control can be scrolled into view (the path a user takes).
async function closeReachable(page, sel) {
  return page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null);
    const btn = [...el.querySelectorAll('button')].find((b) => /got it|close|done|back/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')) || b.hasAttribute('data-close'));
    if (!btn) return { found: false };
    btn.scrollIntoView({ block: 'nearest' });
    const q = btn.getBoundingClientRect();
    return { found: true, onScreen: q.top >= -1 && q.bottom <= innerHeight + 1 && q.left >= -1 && q.right <= innerWidth + 1, w: q.width, h: q.height };
  }, sel);
}

async function openAndCheck(browser, url, vp, { messages, trigger, overlay, ready, what }) {
  const { page, ctx } = await scriptedPage(browser, { viewport: { width: vp.width, height: vp.height }, messages });
  try {
    await page.goto(url + '/');
    await page.waitForSelector(ready, { timeout: 8000 });
    await page.waitForTimeout(200);
    await page.evaluate((sel) => document.querySelector(sel).click(), trigger);
    await page.waitForTimeout(300);
    const info = await readOverlay(page, overlay);
    assert.ok(info, `${what} opens`);
    assertOnScreen(info, what, { menu: overlay === '.tb-pop' });
    if (overlay.includes('sheet')) {
      const c = await closeReachable(page, overlay);
      assert.ok(c.found, `${what}: has a close control`);
      assert.ok(c.onScreen, `${what}: close control can be scrolled into view`);
      assert.ok(Math.min(c.w, c.h) >= 30, `${what}: close control is at least 30px (${Math.round(c.w)}x${Math.round(c.h)})`);
    }
    return info;
  } finally { await ctx.close(); }
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const wizard = games.get('wizard');
  const homeMsgs = [welcome({ games: games.list(), tables: [] })];
  const tableMsgs = tableMessages('wizard', [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Cy' }]);
  const def = wizard;
  const lobbyRoom = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'public', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }, { id: 'p1', name: 'Bo', bot: false, avatar: '🦊', connected: true }] };
  const lobbyMsgs = [welcome({ games: games.list(), tables: [] }), { t: 'state', room: lobbyRoom, view: null }];
  try {
    for (const vp of SIZES) {
      await test(`home rules dialog fits, closes, at ${vp.name}`, () => openAndCheck(browser, url, vp, {
        messages: homeMsgs, ready: '.game-grid .game-card', trigger: '.game-card [data-act="rules"]',
        overlay: '.overlay .sheet[role="dialog"]', what: 'home rules dialog',
      }));
      await test(`lobby rules dialog fits, closes, at ${vp.name}`, () => openAndCheck(browser, url, vp, {
        messages: lobbyMsgs, ready: '.code-card', trigger: '[data-act="rules"]',
        overlay: '.overlay .sheet[role="dialog"]', what: 'lobby rules dialog',
      }));
      await test(`table More menu stays on screen at ${vp.name}`, () => openAndCheck(browser, url, vp, {
        messages: tableMsgs, ready: '.tb-more-btn', trigger: '[data-act="toggleTools"]',
        overlay: '.tb-pop', what: 'table More menu',
      }));
    }
  } finally {
    await browser.close(); server.close();
    console.log(`\n${passed} passed, ${failed} failed (${SIZES.length} sizes; the rules dialog from a table in progress is not covered)`);
    if (failed) process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
