'use strict';
// Regression: the Trump indicator of the 29 game must be on screen in every phase where a trump is relevant (bidding, choosing,
// playing), at phone, tablet and desktop widths. Before this fix, the phone header hid it (`.wz-trump { display: none }` at 520px
// and below), so on an iPhone 15 nothing showed the trump suit.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'];
const VIEWPORTS = [
  { name: 'iPhone 15 393x852', width: 393, height: 852 },
  { name: 'small phone 320x568', width: 320, height: 568 },
  { name: 'large phone 430x932', width: 430, height: 932 },
  { name: 'phone landscape 852x393', width: 852, height: 393 },
  { name: 'tablet portrait 768x1024', width: 768, height: 1024 },
  { name: 'desktop 1366x768', width: 1366, height: 768 },
];

// Plays the real engine forward with its bots until `done(view)` holds. Deterministic: the same seed gives the same game.
function playTo(gameId, done, seed = 7) {
  const def = games.get(gameId);
  const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  let a = seed; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), rng);
  for (let i = 0; i < 4000 && !done(g.view('me'), g) && !g.isOver(); i++) {
    const waiting = [].concat(g.awaiting() || []);
    if (!waiting.length) { const auto = g.autoAction && g.autoAction(); if (!auto) break; g.act(null, auto); continue; }
    const forced = g.forcedPlay && g.forcedPlay();
    const id = forced ? forced.playerId : waiting[0];
    g.act(id, forced ? forced.action : g.botAction(id));
  }
  return g;
}

function messagesFor(g) {
  const def = games.get('twentynine');
  const room = { code: 'ABCDEF', gameId: 'twentynine', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: NAMES.length, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, bot: i > 0, avatar: '🧙', connected: true, ping: null, username: null })) };
  return [welcome({ id: 'me', name: NAMES[0], games: games.list() }), { t: 'state', room, view: g.view('me') }];
}


// The scoreboard shows a failed bid's game points against the bidding team: "−N us" when we bid and lost, never "them".
(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  try {
    const g = playTo('twentynine', (v) => v.history.some((h) => h.bidder === 0 && h.game < 0), 11);
    const row = g.view('me').history.find((h) => h.bidder === 0 && h.game < 0);
    if (!row) { console.error('FAIL  the engine reached a failed bid by seat 0 (test setup)'); process.exit(1); }
    const expected = `−${Math.abs(row.game)} us`;
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 1366, height: 768 }, messages: messagesFor(g) });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('.wz-top', { timeout: 8000 });
      await page.evaluate(() => document.querySelector('[data-t9="scores"]').click());
      await page.waitForSelector('.overlay .sheet table', { timeout: 4000 });
      const text = await page.evaluate(() => document.querySelector('.overlay .sheet').innerText);
      // The row for that hand: it names our team ("us") for the points the bidding team lost.
      const line = text.split('\n').find((l) => l.startsWith(`#${row.hand}\t`)) || '';
      assert.ok(line.includes(expected), `hand ${row.hand} shows "${expected}" (its row is ${JSON.stringify(line)})`);
      console.log('  ok  failed bid by our team shows "' + expected + '" on its row');
    } finally { await ctx.close(); }
  } catch (e) { failed++; console.error('FAIL  ' + e.message); }
  finally { await browser.close(); server.close(); }
  if (failed) process.exit(1);
  console.log('\n1 passed, 0 failed');
})();
