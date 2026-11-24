'use strict';
// Opening the Ready gate must not move or resize any box on a table. For every game: the table is shown with no gate, its
// boxes are measured, the gate opens on the same view (the Ready bar appears), and the boxes are measured again.
// Only the Ready bar itself may be new. Run all games: node tests/ui/ready-layout-shift-ui.js
// One game: UI_GAME=wizard node tests/ui/ready-layout-shift-ui.js
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri', 'Eve', 'Frederick', 'Giuseppe', 'Hannah'];
const ids = (n) => NAMES.slice(0, n).map((_, i) => (i === 0 ? 'me' : 'p' + i));
const measure = (page) => page.evaluate(() => {
  const root = document.querySelector('#app');
  const out = [];
  // a box is identified by where it sits in the tree, not by its classes (a class changes when the gate opens)
  const pathOf = (el) => { const parts = []; for (let n = el; n && n !== root; n = n.parentElement) parts.unshift(n.tagName.toLowerCase() + ':' + Array.prototype.indexOf.call(n.parentElement.children, n)); return parts.join('>'); };
  root.querySelectorAll('*').forEach((el) => {
    if (el.closest('.ready-box, .overlay, .toast, .bell-panel, .chat, [data-chat], .topbar, .tb-tabs, .modal, dialog')) return;
    if (el.closest('[hidden]') || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    out.push({ name: pathOf(el), tag: el.tagName.toLowerCase(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  });
  return out;
});

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const only = process.env.UI_GAME;
  const all = games.list().map((g) => g.id).filter((id) => games.get(id) && id !== 'ludo' && (!only || id === only));
  const report = [];
  const SIZES = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1280, height: 800 }];
  for (const [gameId, size] of all.flatMap((g) => SIZES.map((s) => [g, s]))) {
    const def = games.get(gameId);
    const n = Math.max(2, def.seats && def.seats.min ? def.seats.min : 2);
    const extras = NAMES.slice(0, n).map((name) => ({ name }));
    const closed = tableMessages(gameId, extras);
    const gated = tableMessages(gameId, extras, { roomExtra: { status: 'playing', gate: { ready: [], waiting: ids(n) } } });
    gated[1].view = closed[1].view; // the same table, only the gate differs
    const { page, ctx } = await scriptedPage(browser, { messages: closed, viewport: size });
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url + '/');
      await page.waitForSelector('#app [data-game], #app .wz, #app .page', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      const before = await measure(page);
      await page.evaluate((m) => window.__push(m), gated[1]);
      await page.waitForSelector('.ready-box', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      const after = await measure(page);
      const moved = [];
      const am = new Map(after.map((e) => [e.name, e]));
      for (const e of before) {
        if (e.x === 0 && e.y === 0) continue; // the game's outer box grows by the new bar at its bottom, which is not a box above it
        const f = am.get(e.name);
        if (!f) { moved.push(`${e.tag} removed (was ${e.w}x${e.h}@${e.x},${e.y})`); continue; }
        if (Math.abs(e.x - f.x) > 1 || Math.abs(e.y - f.y) > 1 || Math.abs(e.w - f.w) > 1 || Math.abs(e.h - f.h) > 1) moved.push(`${e.tag} ${e.w}x${e.h}@${e.x},${e.y} -> ${f.w}x${f.h}@${f.x},${f.y}`);
      }
      report.push({ gameId: `${gameId} ${size.width}x${size.height}`, moved: [...new Set(moved)].slice(0, 8), count: moved.length });
    } catch (e) {
      report.push({ gameId: `${gameId} ${size.width}x${size.height}`, error: e.message.split('\n')[0] });
    } finally { await ctx.close(); }
  }
  await browser.close(); server.close();
  let bad = 0;
  for (const r of report) {
    if (r.error) { console.log(`ERROR  ${r.gameId}: ${r.error}`); bad++; continue; }
    if (r.count) { bad++; console.log(`SHIFT  ${r.gameId} (${r.count}):\n   ${r.moved.join('\n   ')}`); } else console.log(`ok     ${r.gameId}`);
  }
  console.log(`\n${report.length - bad} of ${report.length} games keep every box in place`);
  process.exitCode = bad ? 1 : 0;
})();
