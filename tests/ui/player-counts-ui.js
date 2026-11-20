'use strict';
// Penalty Rows (2 to 8 players) and Stage Rummy (2 to 6, its engine's limit) in a real browser at five screen sizes:
// every seat shows up, the table fits the screen without scrolling sideways, and the play area ends inside the window.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri', 'Ed', 'Fay', 'Gus', 'Hal'];
const SIZES = [['phone', 390, 844], ['short phone', 360, 640], ['tablet', 768, 1024], ['laptop', 1280, 800], ['desktop', 1920, 1080]];
const CASES = [
  { gameId: 'penaltyrows', min: 2, max: 8 },
  { gameId: 'stagerummy', min: 2, max: 6 },
];

let passed = 0; let failed = 0;
(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    for (const { gameId, min, max } of CASES) {
      for (let n = min; n <= max; n++) {
        for (const [size, w, h] of SIZES) {
          const label = `${gameId}, ${n} players, ${size} ${w}x${h}`;
          const names = NAMES.slice(0, n).map((name) => ({ name }));
          const { page, ctx } = await scriptedPage(browser, { viewport: { width: w, height: h }, messages: tableMessages(gameId, names) });
          try {
            await page.goto(url + '/');
            await page.waitForSelector(gameId === 'stagerummy' ? '.pseat' : '.prt .pr-row', { timeout: 8000 });
            await page.waitForTimeout(250);
            if (gameId === 'penaltyrows') { // players are listed on the Scores tab; open it, count, and go back to the table
              await page.locator('[data-pr="tab"][data-tab="scores"]').click();
              await page.waitForSelector('.pr-score li', { timeout: 8000 });
              const listed = await page.locator('.pr-score li').count();
              assert.equal(listed, n, `${label}: every player is on the scores tab`);
              await page.locator('[data-pr="tab"][data-tab="table"]').click();
              await page.waitForSelector('.prt .pr-row', { timeout: 8000 });
            }
            const seen = await page.evaluate(([gid, n]) => {
              const wz = document.querySelector('.wz');
              const seats = gid === 'stagerummy' ? document.querySelectorAll('.pseat').length : n; // Stage Rummy seats its players around the table; checked above for Penalty Rows
              return {
                overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                bottom: Math.round(wz.getBoundingClientRect().bottom),
                vh: window.innerHeight,
                rows: gid === 'penaltyrows' ? document.querySelectorAll('.pr-row').length : null,
                seats,
              };
            }, [gameId, n]);
            if (gameId === 'penaltyrows') assert.equal(seen.rows, 4, `${label}: four rows on the table`);
            if (gameId === 'stagerummy') assert.equal(seen.seats, n, `${label}: every player has a seat`);
            assert.equal(seen.overflowX, false, `${label}: no sideways scroll`);
            assert.ok(seen.bottom <= seen.vh + 1, `${label}: the play area ends at ${seen.bottom}px, screen is ${seen.vh}px`);
            passed++; console.log(`  ok  ${label}`);
          } catch (e) {
            failed++; console.error('FAIL  ' + label + '\n' + e.message);
          } finally {
            await ctx.close();
          }
        }
      }
    }
  } finally {
    await browser.close(); server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
