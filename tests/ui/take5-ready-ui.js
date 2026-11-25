'use strict';
// Take 5: the Ready bar sits under the table (only while the gate is open), the top row never moves, and the round summary
// neither offers Ready again once everybody is ready nor replays its entrance on each redraw.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Charlotte' }, { name: 'Dmitri' }];
const ids = ['me', 'p1', 'p2', 'p3'];
const gateOpen = (ready) => ({ ready, waiting: ids.filter((i) => !ready.includes(i)) });

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const open = async (messages, viewport = { width: 390, height: 844 }) => {
    const { page, ctx } = await scriptedPage(browser, { messages, viewport });
    await page.goto(url + '/');
    await page.waitForSelector('.prt', { timeout: 8000 });
    return { page, ctx };
  };
  const topBox = (page) => page.evaluate(() => {
    const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
    return { tabs: r('.pr-tabs'), bar: r('.prt .pr-bar'), table: r('.pr-table') };
  });

  await test('the Ready bar is the shared bottom strip while the gate is open, and the top row does not move', async () => {
    const closed = tableMessages('penaltyrows', four);
    const { page, ctx } = await open(closed);
    const before = await topBox(page);
    assert.equal(await page.locator('.prt [data-act="readyUp"]').count(), 0, 'no Ready bar without a gate');
    const m = tableMessages('penaltyrows', four, { roomExtra: { status: 'playing', gate: gateOpen([]) } });
    await page.evaluate((msg) => window.__push(msg), m[1]);
    await page.waitForSelector('.prt [data-act="readyUp"]', { timeout: 5000 });
    const bar = page.locator('.ready-slot [data-act="readyUp"]');
    assert.equal(await bar.count(), 1, 'one Ready button, in the bottom bar');
    const after = await topBox(page);
    assert.deepEqual(after.tabs, before.tabs, 'the Table and Scores tabs did not move or change size');
    assert.deepEqual(after.bar, before.bar, 'the status panel did not move or change size');
    assert.deepEqual(after.table, before.table, 'the table did not move or change size');
    const pinned = await page.evaluate(() => { const r = document.querySelector('.ready-slot').getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight, fixed: getComputedStyle(document.querySelector('.ready-slot')).position }; });
    assert.equal(pinned.fixed, 'fixed', 'the Ready bar is pinned to the screen');
    assert.ok(Math.abs(pinned.bottom - pinned.vh) <= 1, 'the Ready bar sits at the bottom of the screen');
    await ctx.close();
  });

  await test('the round summary shows no Ready button once everybody is ready', async () => {
    const m = tableMessages('penaltyrows', four, { roomExtra: { status: 'playing', gate: gateOpen([]) } });
    const v = m[1].view;
    v.phase = 'roundEnd'; v.lastRound = { round: 1, penalties: [1, 2, 0, 3] };
    const { page, ctx } = await open(m);
    await page.waitForSelector('.overlay .sheet', { timeout: 5000 });
    assert.equal(await page.locator('.overlay [data-act="readyUp"]').count(), 1, 'the summary offers Ready while the gate is open');
    const done = tableMessages('penaltyrows', four, { roomExtra: { status: 'playing', gate: null } });
    done[1].view.phase = 'roundEnd'; done[1].view.lastRound = { round: 1, penalties: [1, 2, 0, 3] };
    await page.evaluate((msg) => window.__push(msg), done[1]);
    assert.equal(await page.locator('.overlay [data-act="readyUp"]').count(), 0, 'no Ready button after everybody is ready');
    assert.match(await page.locator('.overlay').innerText(), /Everybody is ready/);
    await ctx.close();
  });

  await test('the round summary does not replay its entrance when a Ready tap redraws the table', async () => {
    const m = tableMessages('penaltyrows', four, { roomExtra: { status: 'playing', gate: gateOpen([]) } });
    m[1].view.phase = 'roundEnd'; m[1].view.lastRound = { round: 1, penalties: [1, 2, 0, 3] };
    const { page, ctx } = await open(m);
    await page.waitForSelector('.overlay .sheet', { timeout: 5000 });
    const anim = (selector) => page.locator(selector).evaluate((el) => getComputedStyle(el).animationName);
    assert.equal(await anim('.overlay'), 'none', 'the backdrop does not fade in');
    assert.equal(await anim('.overlay .sheet'), 'rise', 'the score sheet plays its entrance on first showing');
    const again = tableMessages('penaltyrows', four, { roomExtra: { status: 'playing', gate: gateOpen(['me']) } });
    again[1].view.phase = 'roundEnd'; again[1].view.lastRound = { round: 1, penalties: [1, 2, 0, 3] };
    await page.evaluate((msg) => window.__push(msg), again[1]);
    assert.equal(await anim('.overlay'), 'none', 'the backdrop does not fade on a Ready redraw');
    assert.equal(await anim('.overlay .sheet'), 'none', 'a Ready redraw does not replay the sheet entrance');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(`\ntake 5 ready ui: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
