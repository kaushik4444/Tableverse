'use strict';
// While this seat has not pressed Ready, a game takes no action: a flick on the board or a card press sends nothing, and the
// Ready button blinks. Ready itself still works.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const people = [{ name: 'Aarav' }, { name: 'Bo' }];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const waiting = (gameId, ready = []) => {
    const seats = gameId === 'wizard' ? [...people, { name: 'Cy' }] : people;
    const ids = seats.map((_, i) => (i === 0 ? 'me' : 'p' + i));
    return tableMessages(gameId, seats, { roomExtra: { status: 'playing', gate: { ready, waiting: ids.filter((x) => !ready.includes(x)) } } });
  };
  const open = async (msgs) => {
    const { page, ctx } = await scriptedPage(browser, { messages: msgs, viewport: { width: 1280, height: 900 } });
    await page.goto(url + '/');
    await page.waitForSelector('[data-ready-here]', { timeout: 8000 });
    await page.waitForTimeout(300);
    return { page, ctx };
  };
  const acts = (page) => page.evaluate(() => (window.__sent || []).filter((m) => m.t === 'act').length);
  try {
    await test('carrom: setting the striker and pulling it send nothing before Ready; after Ready the same pull is sent', async () => {
      const pull = async (page) => {
        const st = await page.evaluate(() => { const s = document.querySelector('.cb-svg [data-id="striker"]'); if (!s) return null; const b = s.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        if (!st) return 'no striker';
        await page.mouse.move(st.x, st.y); await page.mouse.down(); await page.mouse.move(st.x, st.y + 70, { steps: 8 }); await page.mouse.up();
        await page.waitForTimeout(200);
        return 'ok';
      };
      const locked = await open(waiting('carrom'));
      try {
        const before = await locked.page.evaluate(() => document.querySelector('[data-slider]').getAttribute('aria-valuenow'));
        const tr = await locked.page.evaluate(() => { const b = document.querySelector('.cb-track').getBoundingClientRect(); return { l: b.left, r: b.right, y: b.top + b.height / 2 }; });
        await locked.page.mouse.click(tr.l + 4, tr.y); await locked.page.waitForTimeout(150);
        assert.equal(await locked.page.evaluate(() => document.querySelector('[data-slider]').getAttribute('aria-valuenow')), before, 'the striker moved on the slider before Ready');
        assert.equal(await pull(locked.page), 'ok');
        assert.equal(await acts(locked.page), 0, 'a flick was sent while Ready is pending');
      } finally { await locked.ctx.close(); }
      const ready = await open(waiting('carrom', ['me']));
      try {
        assert.equal(await pull(ready.page), 'ok');
        assert.equal(await acts(ready.page), 1, 'after Ready, the pull should be sent as a flick (proves the test can see a flick)');
      } finally { await ready.ctx.close(); }
    });
    await test('wizard: a card press is not sent before Ready, and the Ready button blinks', async () => {
      const { page, ctx } = await open(waiting('wizard'));
      try {
        const card = await page.evaluate(() => { const c = document.querySelector('#app .hand .card, #app .hand [class*="card"]'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        if (card) { await page.mouse.click(card.x, card.y); await page.waitForTimeout(200); }
        assert.equal(await acts(page), 0, 'an action was sent while Ready is pending');
        const anim = await page.evaluate(() => getComputedStyle(document.querySelector('[data-act="readyUp"]')).animationName);
        assert.notEqual(anim, 'none', 'the Ready button should blink');
      } finally { await ctx.close(); }
    });
    await test('Ready itself is sent, and nothing else is', async () => {
      const { page, ctx } = await open(waiting('carrom'));
      try {
        await page.click('[data-act="readyUp"]');
        await page.waitForTimeout(200);
        const sent = await page.evaluate(() => (window.__sent || []).map((m) => m.t));
        assert.ok(sent.includes('ready'), 'the ready message is sent');
        assert.equal(await acts(page), 0);
      } finally { await ctx.close(); }
    });
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\ngate lock ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
