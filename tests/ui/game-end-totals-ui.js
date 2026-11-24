'use strict';
// The game-over rating card while the server answers: a loading line (not dashes) until the answer, "updating" while the
// ratings are still being rebuilt, then the final numbers replace the placeholders in place.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

// A finished two-player Tic-Tac-Toe table as seen by 'me' (the engine plays it out), with rating rows for both players.
function finishedTable() {
  const def = games.get('tictactoe');
  const players = [{ id: 'me', name: 'Aarav', avatar: '🧙' }, { id: 'p1', name: 'Bo', avatar: '🦊' }];
  const g = def.create(players, { timeLimit: 'off' }, () => 0.5);
  for (let i = 0; i < 200 && !g.isOver(); i++) {
    const w = [].concat(g.awaiting() || []);
    if (!w.length) break;
    g.act(w[0], g.botAction(w[0]));
  }
  const at = Date.now() - 60000;
  const xp = players.map((p, i) => ({ seat: i, id: p.id, name: p.name, saved: true, isBot: false, timeXp: 10, gameXp: 5, total: 15, minutes: 1, penalised: false }));
  const room = { code: 'ENDTOT', gameId: 'tictactoe', hostId: 'p1', status: 'finished', options: {}, visibility: 'private', seats: 2, min: 2, max: 2, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    outcome: { id: at, winners: [{ id: 'p1', name: 'Bo' }], sinceMs: 60000, at, xp },
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return { at, messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: JSON.parse(JSON.stringify(g.view('me'))) }] };
}
const cells = (page) => page.$$eval('.xp-table-rating .xp-tr:not(.xp-th) .xp-c', (els) => els.map((e) => e.textContent.trim()));

(async () => {
  const srv = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    await test('until the server answers, the card says it is loading and shows no dashes', async () => {
      const { messages } = finishedTable();
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.end-xp', { timeout: 12000 });
      assert.match(await page.textContent('.xp-status'), /Loading ratings/);
      const c = await cells(page);
      assert.ok(c.length >= 2 && c.every((t) => t === '…'), 'placeholders are ellipses while loading, not dashes: ' + JSON.stringify(c));
      await ctx.close();
    });

    await test('a pending answer says it is updating; the final answer replaces the placeholders in place', async () => {
      const { at, messages } = finishedTable();
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.end-xp', { timeout: 12000 });
      await page.evaluate((id) => window.__push({ t: 'gameTotals', code: 'ENDTOT', id, ratings: {}, pending: true }), at);
      await page.waitForFunction(() => /Updating ratings/.test((document.querySelector('.xp-status') || {}).textContent || ''), null, { timeout: 5000 });
      const ratings = { me: { rated: true, matchDelta: 5, monthRating: 1200, monthDelta: 3, lifetimeRating: 1100 }, p1: { rated: true, matchDelta: -5, monthRating: 1100, monthDelta: -3, lifetimeRating: 1000 } };
      await page.evaluate((m) => window.__push(m), { t: 'gameTotals', code: 'ENDTOT', id: at, ratings, pending: false });
      await page.waitForFunction(() => !document.querySelector('.xp-status'), null, { timeout: 5000 });
      const c = await cells(page);
      assert.ok(c.includes('+5') && c.includes('−5'), 'the final match deltas are shown: ' + JSON.stringify(c));
      await ctx.close();
    });

    await test('a pending answer whose final message never arrives is asked for again, then shows the final numbers', async () => {
      // After a reconnect the final message can be lost: the cached pending answer must not stop the client from asking again
      const { at, messages } = finishedTable();
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.end-xp', { timeout: 12000 });
      await page.evaluate((id) => window.__push({ t: 'gameTotals', code: 'ENDTOT', id, ratings: {}, pending: true }), at);
      await page.waitForFunction(() => /Updating ratings/.test((document.querySelector('.xp-status') || {}).textContent || ''), null, { timeout: 5000 });
      await page.waitForFunction(() => window.__sent.filter((m) => m.t === 'gameTotals').length >= 2, null, { timeout: 9000 });
      const ratings = { me: { rated: true, matchDelta: 5, monthRating: 1200, monthDelta: 3, lifetimeRating: 1100 }, p1: { rated: true, matchDelta: -5, monthRating: 1100, monthDelta: -3, lifetimeRating: 1000 } };
      await page.evaluate((m) => window.__push(m), { t: 'gameTotals', code: 'ENDTOT', id: at, ratings, pending: false });
      await page.waitForFunction(() => !document.querySelector('.xp-status'), null, { timeout: 5000 });
      assert.ok((await cells(page)).includes('+5'), 'the final match deltas replace the pending state');
      await ctx.close();
    });

    await test('a failed follow-up lookup does not replace final ratings already shown', async () => {
      const { at, messages } = finishedTable();
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.end-xp', { timeout: 12000 });
      const ratings = { me: { rated: true, matchDelta: 5, monthRating: 1200, monthDelta: 3, lifetimeRating: 1100 }, p1: { rated: true, matchDelta: -5, monthRating: 1100, monthDelta: -3, lifetimeRating: 1000 } };
      await page.evaluate((m) => window.__push(m), { t: 'gameTotals', code: 'ENDTOT', id: at, ratings, pending: false });
      await page.waitForFunction(() => !document.querySelector('.xp-status'), null, { timeout: 5000 });
      await page.evaluate((id) => window.__push({ t: 'gameTotals', code: 'ENDTOT', id, ratings: {}, pending: false, failed: true }), at);
      await page.waitForTimeout(400);
      assert.ok((await cells(page)).includes('+5'), 'the stored final ratings survive a failed lookup');
      await ctx.close();
    });

    await test('a failed lookup with no answer yet is not final: the card stays loading and asks again', async () => {
      const { at, messages } = finishedTable();
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages });
      await page.goto(srv.url + '/');
      await page.waitForSelector('.end-xp', { timeout: 12000 });
      await page.evaluate((id) => window.__push({ t: 'gameTotals', code: 'ENDTOT', id, ratings: {}, pending: false, failed: true }), at);
      await page.waitForFunction(() => window.__sent.filter((m) => m.t === 'gameTotals').length >= 2, null, { timeout: 9000 });
      assert.match(await page.textContent('.xp-status'), /Loading ratings/, 'a failed answer is not shown as ready');
      await ctx.close();
    });
  } finally {
    await browser.close();
    srv.server.close();
  }
  console.log(`\ngame-end totals UI: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
