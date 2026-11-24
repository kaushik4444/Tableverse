'use strict';
// Another seat's shot: its striker first shows on its own bar at the middle, slides along the bar to the spot it was set on,
// holds there, and only then flicks. It never appears from off the board.
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
  const room = { code: 'ABCDEF', gameId: 'carrom', hostId: 'p0', status: 'playing', options: {}, visibility: 'public', seats: 2, min: 2, max: 2, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members: people.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: '🧙', connected: true, ping: null, username: null })) };
  await test("the opponent's striker starts on its bar, slides to its set spot, and flicks after that", async () => {
    const g = games.get('carrom').create(people, {}, () => 0.5);
    const before = g.view('p1');
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: 'p1', name: 'B', games: games.list() }), { t: 'state', room, view: before }], viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('.cb-svg', { timeout: 8000 });
      await page.waitForTimeout(300);
      g.act('p0', { type: 'flick', seq: g.view('p0').seq, x: 0.3, angle: 0, power: 0.8 });
      const after = g.view('p1');
      const pts = await page.evaluate(async ([view, ROOM]) => {
        const out = [];
        const board = document.querySelector('.cb-board').getBoundingClientRect();
        window.__push({ t: 'state', room: ROOM, view });
        const t0 = performance.now();
        await new Promise((resolve) => {
          const tick = () => {
            const s = document.querySelector('.cb-svg [data-id="striker"]');
            if (s) { const b = s.getBoundingClientRect(); out.push({ t: performance.now() - t0, x: b.left + b.width / 2, y: b.top + b.height / 2 }); }
            if (performance.now() - t0 < 1300) requestAnimationFrame(tick); else resolve();
          };
          requestAnimationFrame(tick);
        });
        return { board: { l: board.left, r: board.right, t: board.top, b: board.bottom }, out };
      }, [after, room]);
      const first = pts.out[0];
      const mid = (pts.board.l + pts.board.r) / 2;
      assert.ok(first, 'the striker is shown at the start of the shot');
      assert.ok(Math.abs(first.x - mid) < 3, `the striker starts at the middle of the bar (x ${first.x}, middle ${mid})`);
      const ys = pts.out.filter((p) => p.t < 800).map((p) => p.y);
      assert.ok(Math.max(...ys) - Math.min(...ys) < 2, 'the striker does not move off its bar while it is set up');
      const held = pts.out.filter((p) => p.t > 950 && p.t < 1150);
      assert.ok(held.length > 0, 'a sample during the hold');
      const target = held[held.length - 1];
      assert.ok(target.x > mid + 40, `the striker slid across the bar to its set spot (x ${target.x})`);
      assert.ok(pts.out.every((p) => p.x > pts.board.l && p.x < pts.board.r && p.y > pts.board.t && p.y < pts.board.b), 'the striker stays on the board');
    } finally { await ctx.close(); }
  });
  await browser.close(); server.close();
  console.log(`\ncarrom bot ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
