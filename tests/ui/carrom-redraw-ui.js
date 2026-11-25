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
      // The striker's start on its bar, in SVG coordinates (the viewer is the bottom seat).
      const start = [0.4, 1 - 0.12];
      const { mid, redrawn } = await page.evaluate(({ start, msg }) => new Promise((resolve, reject) => {
        // The aiming striker is a slider; the playback striker only exists while the shot animates.
        const position = () => {
          const s = document.querySelector('.cb-svg [data-id="striker"]:not([role="slider"])');
          return s && s.style.display !== 'none' ? [Number(s.getAttribute('cx')), Number(s.getAttribute('cy'))] : null;
        };
        const deadline = performance.now() + 4000;
        function poll() {
          const mid = position();
          if (mid && Math.hypot(mid[0] - start[0], mid[1] - start[1]) > 0.02) {
            // One synchronous sample, push and sample: no animation frame can run between them.
            window.__push(msg);
            resolve({ mid, redrawn: position() });
          } else if (performance.now() >= deadline) reject(new Error('the striker did not move during playback'));
          else setTimeout(poll, 16);
        }
        poll();
      }), { start, msg: { t: 'state', room: { ...room, visibility: 'private', now: Date.now() }, view: after } });
      assert.ok(redrawn !== null, 'the striker should still be on the board after a redraw');
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      assert.ok(d(redrawn, mid) < 0.1, `the striker moved from ${mid} to ${redrawn} on a redraw mid-shot`);
      assert.ok(d(redrawn, start) > d(redrawn, mid), `the striker jumped back to its start ${start} on a redraw mid-shot (now at ${redrawn})`);
    } finally { await ctx.close(); }
  });
  await browser.close(); server.close();
  console.log(`\ncarrom redraw ui: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
