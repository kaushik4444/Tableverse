'use strict';
// Twenty-Nine and Poker show only red and black suits, and the round summary never offers Ready again once everybody is ready.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk, PUBLIC } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

(async () => {
  // Suit classes: no blue, green or yellow suit in either game
  const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
  await test('twenty-nine: spades and clubs are black, hearts and diamonds red', async () => {
    const src = read('games/twentynine.js');
    const cls = (s) => { const m = src.match(new RegExp(`\\b${s}: \\{ sym: '[^']+', name: '\\w+', cls: '([^']+)'`)); return m && m[1]; };
    assert.equal(cls('S'), 'suit-K'); assert.equal(cls('C'), 'suit-K');
    assert.equal(cls('H'), 'suit-R'); assert.equal(cls('D'), 'suit-R');
  });
  await test('poker: spades and clubs black, hearts and diamonds red', async () => {
    const css = read('games/poker.css');
    const col = (c) => { const m = css.match(new RegExp(`\\.pkc\\.${c} \\{ --sc: (#[0-9a-f]{6});? \\}`)); return m && m[1]; };
    assert.equal(col('ps'), '#14161b'); assert.equal(col('pc'), '#14161b');
    assert.equal(col('ph'), '#d6303a'); assert.equal(col('pd'), '#d6303a');
  });

  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    await test('the black suit class renders black, not blue or green, inside Twenty-Nine', async () => {
      const { page, ctx } = await scriptedPage(browser, { messages: welcome(), viewport: { width: 1280, height: 900 } });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('#app', { timeout: 8000 });
        const colours = await page.evaluate(() => {
          const t = document.createElement('div'); t.className = 't29'; t.style.position = 'fixed'; t.style.top = '0';
          t.innerHTML = '<div class="card suit-K" id="k"></div><div class="card suit-R" id="r"></div>';
          document.body.appendChild(t);
          const out = { k: getComputedStyle(document.getElementById('k')).color, r: getComputedStyle(document.getElementById('r')).color };
          t.remove(); return out;
        });
        assert.equal(colours.k, 'rgb(20, 22, 27)');
        assert.notEqual(colours.r, colours.k);
      } finally { await ctx.close(); }
    });

    await test('the round summary shows no Ready button once the gate has cleared', async () => {
      const { page, ctx } = await scriptedPage(browser, { messages: welcome(), viewport: { width: 1280, height: 900 } });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('#app', { timeout: 8000 });
        const html = await page.evaluate(() => window.CardTable.readyBox({ gate: null }, { title: 'Ready for the next hand?', cls: 'in-sheet' }));
        assert.ok(!/data-act="readyUp"/.test(html), 'a Ready button is still offered after everybody is ready');
        assert.ok(/in-sheet/.test(html));
      } finally { await ctx.close(); }
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
