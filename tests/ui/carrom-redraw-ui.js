'use strict';
// A table redraw in the middle of a shot (another player's state, a timer) carries on from where the striker is, and does not
// jump back to the shot's first frame.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const people = [{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }];
  const room = { code: 'ABCDEF', gameId: 'carrom', hostId: 'p0', status: 'playing', options: {}, visibility: 'public', seats: 2, min: 2, max: 2, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members: people.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: '🧙', connected: true })) };
  await test('a redraw in the middle of a shot does not move the striker back to where the shot began', async () => {
    const g = games.get('carrom').create(people, {}, () => 0.5);
    const before = g.view('p0');
    g.act('p0', { type: 'flick', seq: g.view('p0').seq, x: 0.4, angle: 0, power: 0.6 });
    const after = g.view('p0');
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'p0', name: 'A', games: games.list() }), { t: 'state', room, view: before }, { t: 'state', room, view: after }], viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('.cb-svg', { timeout: 8000 });
      const x = () => page.evaluate(() => { const s = document.querySelector('.cb-svg [data-id="striker"]'); return s ? [Number(s.getAttribute('cx')), Number(s.getAttribute('cy'))] : null; });
      await page.waitForTimeout(300); // in flight: the striker has left its bar
      const mid = await x();
      assert.ok(mid !== null, 'the striker should be on the board during the shot');
      // the push and the read happen in one step, so no animation frame runs between them
      const redrawn = await page.evaluate((msg) => { window.__push(msg); const s = document.querySelector('.cb-svg [data-id="striker"]'); return s ? [Number(s.getAttribute('cx')), Number(s.getAttribute('cy'))] : null; }, { t: 'state', room: { ...room, visibility: 'private', now: Date.now() }, view: after });
      assert.ok(redrawn !== null, 'the striker should still be on the board after a redraw');
      // the striker's start on its bar, in the board's own units (the viewer is the bottom seat, so no rotation)
      const start = [0.4, 1 - 0.12];
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      assert.ok(d(redrawn, mid) < 0.1, `the striker moved from ${mid} to ${redrawn} on a redraw mid-shot`);
      assert.ok(d(redrawn, start) > d(redrawn, mid), `the striker jumped back to its start ${start} on a redraw mid-shot (now at ${redrawn})`);
    } finally { await ctx.close(); }
  });
  await browser.close(); server.close();
  console.log(`\ncarrom redraw ui: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
