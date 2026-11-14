'use strict';
// A doubled hand of 29 shows its stakes (×2) in the round header, on screen, at phone sizes. The multiplier comes from the
// engine view, so the test sets it on a real table state and checks what the player sees.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const extras = [{ name: 'Aarav', username: 'aarav' }, { name: 'Bo' }, { name: 'Cy' }, { name: 'Di' }];
const SIZES = [{ width: 360, height: 640 }, { width: 390, height: 844 }];

(async () => {
  const srv = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  for (const viewport of SIZES) {
    await test(`a doubled hand shows ×2 on screen at ${viewport.width}×${viewport.height}`, async () => {
      const messages = tableMessages('twentynine', extras);
      for (const m of messages) if (m.t === 'state' && m.view) m.view.multiplier = 2;
      const { page, ctx } = await scriptedPage(browser, { viewport, messages });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.t29-stakes', { timeout: 8000 });
      const box = await page.locator('.t29-stakes').boundingBox();
      assert.ok(box, 'the stakes badge is drawn');
      assert.equal((await page.textContent('.t29-stakes')).trim(), '×2');
      // Visible means inside the screen and inside every ancestor that clips (overflow other than visible), not only
      // with a non-empty box: a clipped badge can still have a box inside the viewport.
      const clip = await page.evaluate(() => {
        const el = document.querySelector('.t29-stakes');
        const r = el.getBoundingClientRect();
        let L = 0; let T = 0; let R = window.innerWidth; let B = window.innerHeight;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const ar = a.getBoundingClientRect();
            L = Math.max(L, ar.left); T = Math.max(T, ar.top); R = Math.min(R, ar.right); B = Math.min(B, ar.bottom);
          }
        }
        return { fully: r.width > 0 && r.height > 0 && r.left >= L - 0.5 && r.top >= T - 0.5 && r.right <= R + 0.5 && r.bottom <= B + 0.5, rect: [r.left, r.top, r.right, r.bottom], clip: [L, T, R, B] };
      });
      assert.ok(clip.fully, `the whole badge is visible, not clipped (badge ${JSON.stringify(clip.rect)}, visible area ${JSON.stringify(clip.clip)})`);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'the badge is inside the screen sideways');
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'the badge is inside the screen vertically');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `no sideways scroll (overflow ${over}px)`);
      await ctx.close();
    });
  }
  await browser.close(); srv.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
