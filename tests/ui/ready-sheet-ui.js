'use strict';
// Regression: the round-end sheet must not replay its entrance fade on every state change (each Ready tap redraws the table),
// and once everybody is ready the Ready box says the next round is starting instead of just "Everybody is ready".
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'];
function playTo(gameId, done, seed) {
  const def = games.get(gameId);
  const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  let a = seed; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), rng);
  for (let i = 0; i < 4000 && !done(g.view('me')) && !g.isOver(); i++) {
    const waiting = [].concat(g.awaiting() || []);
    if (!waiting.length) { const auto = g.autoAction && g.autoAction(); if (!auto) break; g.act(null, auto); continue; }
    const forced = g.forcedPlay && g.forcedPlay();
    const id = forced ? forced.playerId : waiting[0];
    g.act(id, forced ? forced.action : g.botAction(id));
  }
  return g;
}
function messagesFor(g) {
  const def = games.get('wizard');
  const room = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: NAMES.length, min: def.seats.min, max: def.seats.max, seatLabels: null,
    members: NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, bot: i > 0, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: NAMES[0], games: games.list() }), { t: 'state', room, view: g.view('me') }];
}

(async () => {
  let g = null;
  for (let seed = 1; seed < 400 && !g; seed++) {
    const cand = playTo('wizard', (v) => v.phase === 'roundEnd', seed);
    if (cand.view('me').phase === 'roundEnd') g = cand;
  }
  assert.ok(g, 'no seed reaches a round end');
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const { page, ctx } = await scriptedPage(browser, { messages: messagesFor(g), viewport: { width: 393, height: 852 } });
  await page.goto(url + '/');
  await page.waitForSelector('.overlay .sheet', { timeout: 8000 });
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.overlay')).animationName);
  assert.equal(anim, 'none', `the round-end overlay replays an entrance animation (${anim}) on every redraw`);
  const copy = await page.evaluate(() => window.CardTable.readyBox({ gate: { seated: true, youReady: true, ready: 4, total: 4, waiting: [] } }));
  assert.match(copy, /next round starts shortly/, 'the all-ready copy does not say what happens next');
  await ctx.close(); await browser.close(); server.close();
  console.log('  ok  round-end overlay has no replayed fade; all-ready copy says the next round is starting');
  console.log('\nready sheet: all passed');
})().catch((e) => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
