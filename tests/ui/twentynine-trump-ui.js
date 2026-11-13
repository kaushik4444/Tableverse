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

// Every phase in which the 29 trump is relevant. The first state is bidding (no trump yet); the others come from play.
const STATES = [
  { label: 'bidding', done: (v) => v.phase === 'bidding' },
  { label: 'choosing trump', done: (v) => v.phase === 'chooseTrump' },
  { label: 'playing', done: (v) => v.phase === 'playing' && v.trumpSuit },
];

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    for (const st of STATES) {
      const g = playTo('twentynine', st.done);
      if (!st.done(g.view('me'), g)) { await test(`reaches the ${st.label} phase`, async () => { throw new Error('the engine did not reach ' + st.label); }); continue; }
      for (const vp of VIEWPORTS) {
        await test(`${st.label}: the Trump indicator is on screen at ${vp.name}`, async () => {
          const { page, ctx } = await scriptedPage(browser, { viewport: { width: vp.width, height: vp.height }, messages: messagesFor(g) });
          try {
            await page.goto(url + '/');
            await page.waitForSelector('.wz-top', { timeout: 8000 });
            // One indicator is shown at any width: the header copy (.wz-trump) or, on phones, the score-strip copy (.t29-mini-trump).
            const shown = await page.evaluate(() => [...document.querySelectorAll('.wz-trump, .t29-mini-trump')]
              .filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')
              .map((e) => ({ box: e.getBoundingClientRect().toJSON(), text: e.innerText })));
            assert.equal(shown.length, 1, `exactly one Trump indicator is shown (found ${shown.length})`);
            const [{ box, text }] = shown;
            assert.ok(box.width > 0 && box.height > 0, 'the Trump indicator has a size');
            assert.ok(box.x >= 0 && box.x + box.width <= vp.width + 1, `the Trump indicator leaves the screen (${Math.round(box.x)}..${Math.round(box.x + box.width)} of ${vp.width})`);
            assert.match(text, /trump/i, 'the indicator names the trump; it shows ' + JSON.stringify(text)); // rendered text is upper-cased by CSS
          } finally { await ctx.close(); }
        });
      }
    }
  } finally {
    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();
