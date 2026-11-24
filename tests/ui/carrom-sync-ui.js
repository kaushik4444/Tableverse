'use strict';
// The Carrom striker slider is the board's own baseline: at its left end, middle and right end the thumb, the striker on the
// board and the baseline's end dots are all at the same place, for the first seat and for a seat on the other side.
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
  const fresh = () => games.get('carrom').create(people, {}, () => 0.5);
  const room = { code: 'ABCDEF', gameId: 'carrom', hostId: 'p0', status: 'playing', options: {}, visibility: 'public', seats: 2, min: 2, max: 2, seatLabels: null, deadline: null, now: Date.now(), spectators: [], members: people.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: '🧙', connected: true, ping: null, username: null })) };
  try {
    for (const seat of ['p0', 'p1']) {
      await test(`the slider lines up with the board for ${seat === 'p0' ? 'the first' : 'the second'} seat`, async () => {
        const g = fresh();
        if (seat === 'p1') g.act('p0', { type: 'flick', seq: g.view('p0').seq, x: 0.4, angle: 0, power: 0.3 }); // seat p1 is on turn after the opening shot
        const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ id: seat, name: seat, games: games.list() }), { t: 'state', room, view: g.view(seat) }], viewport: { width: 1280, height: 900 } });
        try {
          await page.goto(url + '/');
          await page.waitForSelector('.cb-svg', { timeout: 8000 });
          await page.waitForTimeout(300);
          const pos = () => page.evaluate(() => {
            const cx = (el) => { const b = el.getBoundingClientRect(); return (b.left + b.right) / 2; };
            const dots = [...document.querySelectorAll('.cb-svg .cb-base-dot')].map((d) => d.getBoundingClientRect());
            const low = Math.max(...dots.map((r) => r.top));
            const own = dots.filter((r) => Math.abs(r.top - low) < 2).map((r) => r.left + r.width / 2).sort((a, b) => a - b);
            const st = document.querySelector('.cb-svg [data-id="striker"]');
            return { own, striker: cx(st), thumb: cx(document.querySelector('.cb-thumb')) };
          });
          const tr = await page.evaluate(() => { const b = document.querySelector('.cb-track').getBoundingClientRect(); return { l: b.left, r: b.right, y: b.top + b.height / 2 }; });
          for (const x of [tr.l + 2, (tr.l + tr.r) / 2, tr.r - 2]) {
            await page.mouse.click(x, tr.y);
            await page.waitForTimeout(150);
            const p = await pos();
            assert.ok(Math.abs(p.striker - p.thumb) < 1.5, `thumb ${p.thumb} is not on the striker ${p.striker}`);
            assert.ok(Math.abs(p.striker - p.own[0]) < 1.5 || Math.abs(p.striker - p.own[1]) < 1.5 || p.striker > p.own[0] && p.striker < p.own[1], `striker ${p.striker} is off the baseline ${p.own}`);
          }
        } finally { await ctx.close(); }
      });
    }
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\ncarrom sync ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
