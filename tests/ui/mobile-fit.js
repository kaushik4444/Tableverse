'use strict';
/** Every game keeps its main play area (toolbar, table, hand, main buttons) on one 360x640 phone screen, with one shared toolbar. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const CASES = [['wizard', 4], ['twentynine', 4], ['poker', 4], ['themind', 3], ['ludo', 4], ['gofish', 4], ['snakesladders', 4], ['propertyrivals', 4], ['tictactoe', 2], ['fourinarow', 2]];
const NAMES = ['Aarav', 'Bo', 'Cy', 'Di', 'Eve', 'Fay'];
function build(gameId, n, untilMine = false) {
  const def = games.get(gameId);
  const players = NAMES.slice(0, n).map((nm, i) => ({ id: i ? 'p' + i : 'me', name: nm, avatar: '🧙' }));
  let a = 3; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), rng);
  if (gameId === 'ludo' || gameId === 'themind') players.forEach((p) => g.act(p.id, { type: 'ready' }));
  if (untilMine) { // let the bots play until it is the human's turn to bid or bet
    for (let steps = 0; steps < 400 && !g.isOver(); steps++) {
      const aw = g.awaiting();
      if (aw.includes('me')) break;
      if (!aw.length) { const au = g.autoAction && g.autoAction(); if (!au) break; g.act(null, au); continue; }
      const act = g.botAction(aw[0]); if (!act) break; g.act(aw[0], act);
    }
  }
  const room = { code: 'ABCDEF', gameId, hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: n, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ games: games.list() }), { t: 'state', room, view: g.view('me') }];
}

let failed = 0;
async function myTurnCheck(browser, url) {
  for (const [gameId, n] of [['wizard', 4], ['twentynine', 4], ['poker', 4]]) {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 360, height: 640 }, messages: build(gameId, n, true) });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('.game-supporting-details', { timeout: 8000 });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.wz button')].filter((b) => b.offsetParent && !b.disabled && !b.closest('.tb-pop, .game-supporting-details, .wz-top'));
        return { n: btns.length, low: btns.filter((b) => b.getBoundingClientRect().bottom + scrollY > innerHeight).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 18)) };
      });
      assert.ok(r.n > 0, `${gameId}: it is the human's turn, so there are actions`);
      assert.deepEqual(r.low, [], `${gameId}: your cards and actions stay on a 360x640 screen on your turn`);
      console.log('  ok  ' + gameId + ' your-turn actions fit 360x640 (' + r.n + ' controls)');
    } catch (e) { failed++; console.error('FAIL  ' + gameId + ' my turn\n' + (e.stack || e)); }
    await ctx.close();
  }
}
async function homeCheck(browser, url) {
  const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ games: games.list() })] });
  try {
    await page.goto(url + '/');
    await page.waitForSelector('.game-grid .game-card');
    const r = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, soonOpen: !!document.querySelector('details.soon-fold[open]'), soonCards: document.querySelectorAll('.soon-card').length, soonCount: (document.querySelector('.soon-count')||{}).textContent, emptyBlock: !!document.querySelector('.public-tables-panel'), games: document.querySelectorAll('.game-grid .game-card').length }));
    // the page chrome stays short (700px) and every game card adds at most 190px, so shipping a game never needs a new budget
    const budget = 700 + r.games * 190;
    assert.ok(r.h <= budget, `the home page stays short on a phone (${r.h}px, budget ${budget}px for ${r.games} games)`);
    assert.equal(r.soonOpen, false, 'the roadmap starts folded');
    assert.equal(r.soonCards, parseInt(r.soonCount, 10), 'the roadmap lists every planned game');
    assert.equal(r.emptyBlock, false, 'no empty open-tables block');
    console.log('  ok  home is compact: ' + r.h + 'px, roadmap folded, no empty blocks');
  } catch (e) { failed++; console.error('FAIL  home\n' + (e.stack || e)); }
  await ctx.close();
}
async function lobbyCheck(browser, url) {
  const def = games.get('wizard');
  const room = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'private', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }, { id: 'p1', name: 'Bo', bot: false, avatar: '🦊', connected: true }, { id: 'b1', name: 'Merlin', bot: true, avatar: '🐉', connected: true }] };
  const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: [welcome({ games: games.list() }), { t: 'state', room, view: null }] });
  try {
    await page.goto(url + '/');
    await page.waitForSelector('.code-card');
    const r = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, folds: document.querySelectorAll('details.fold').length, open: document.querySelectorAll('details.fold[open]').length, start: !!document.querySelector('[data-act="start"]') }));
    assert.ok(r.h <= 1300, `the lobby stays compact on a phone (${r.h}px tall)`);
    assert.equal(r.folds, 1, 'the game options are folded (no profile editor in the lobby)');
    assert.equal(r.open, 0, 'folds start closed');
    assert.ok(r.start, 'host can start');
    console.log('  ok  lobby is compact: ' + r.h + 'px, options folded');
  } catch (e) { failed++; console.error('FAIL  lobby\n' + (e.stack || e)); }
  await ctx.close();
}
(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  for (const [gameId, n] of CASES) {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 360, height: 640 }, messages: build(gameId, n) });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('.game-supporting-details', { timeout: 8000 });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const d = document.querySelector('.game-supporting-details');
        const bar = document.querySelector('.wz-top > .row, .ludo-tools');
        return { mainEnd: Math.round(d.getBoundingClientRect().top + scrollY), vh: innerHeight, direct: bar ? [...bar.children].map((c) => (c.classList.contains('chat-btn') ? 'chat' : c.dataset.act === 'emotes' ? 'emotes' : c.classList.contains('tb-more-wrap') ? 'more' : 'other')).join(',') : null,
          leaveLast: !!bar && Object.values(bar.lastElementChild.dataset).includes('leave'),
          menu: [...document.querySelectorAll('.tb-pop button')].map((b) => b.dataset.act || '').join(',') };
      });
      assert.ok(r.mainEnd <= r.vh, `${gameId}: the main play area ends at ${r.mainEnd}px but the screen is ${r.vh}px`);
      assert.equal(r.direct, 'chat,emotes,more,other', `${gameId}: toolbar is chat, reactions, more, leave (${r.direct})`);
      if (gameId === 'gofish') assert.doesNotMatch(r.menu, /activityLog/, 'gofish: no log, it would show what others asked for');
      else assert.match(r.menu, /activityLog/, `${gameId}: the log lives in the more menu`);
      assert.ok(r.leaveLast, `${gameId}: leave is the last button on the bar`);
      assert.match(r.menu, /sound/, `${gameId}: sound lives in the more menu`);
      await page.click('.tb-more-btn');
      assert.equal(await page.isVisible('.tb-pop'), true, `${gameId}: the more menu opens`);
      await page.keyboard.press('Escape');
      assert.equal(await page.isVisible('.tb-pop'), false, `${gameId}: Escape closes the more menu`);
      console.log('  ok  ' + gameId + ' fits 360x640 with the shared toolbar');
    } catch (e) { failed++; console.error('FAIL  ' + gameId + '\n' + (e.stack || e)); }
    await ctx.close();
  }
  await myTurnCheck(browser, url);
  await homeCheck(browser, url);
  await lobbyCheck(browser, url);
  await browser.close(); server.close();
  console.log(`\nmobile fit: ${CASES.length + 5 - failed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
