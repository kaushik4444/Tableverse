'use strict';
// Regression: when a Wizard is the turned-up card and a suit has been chosen as trump, the trump suit must be readable on a
// short phone (393x660 is an iPhone with Safari's toolbars showing). Before this fix the corner caption was hidden on
// 4-player tables under 700px high, so only the card showed, with no suit name.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'];

// Plays the real engine forward with its bots until `done(view)` holds. Deterministic for a given seed.
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
    const cand = playTo('wizard', (v) => v.phase === 'playing' && v.trumpSuit && v.trumpCard && v.trumpCard.type === 'wizard', seed);
    const v = cand.view('me');
    if (v.phase === 'playing' && v.trumpSuit && v.trumpCard && v.trumpCard.type === 'wizard') g = cand;
  }
  assert.ok(g, 'no seed gives a Wizard-trump round');
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  for (const [name, viewport] of [['iPhone with toolbars 393x660', { width: 393, height: 660 }], ['iPhone 15 393x852', { width: 393, height: 852 }], ['small phone 320x568', { width: 320, height: 568 }]]) {
    try {
      const { page, ctx } = await scriptedPage(browser, { messages: messagesFor(g), viewport });
      await page.goto(url + '/');
      await page.waitForSelector('.wz-top', { timeout: 8000 });
      // On short phones the corner is hidden on 4-player tables (it would cover a seat), so the header shows the trump there.
      const cap = await page.evaluate(() => {
        const visible = (el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        const corner = document.querySelector('.pt-corner .cap');
        const header = document.querySelector('.wz-top .wz-trump');
        const el = visible(corner) ? corner : (visible(header) ? header : null);
        if (!el) return { display: 'none', text: '', overflow: false };
        return { display: getComputedStyle(el).display, text: el.textContent.trim(), overflow: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 };
      });
      await ctx.close();
      assert.notEqual(cap.display, 'none', 'the trump is hidden');
      assert.match(cap.text, /Trump/, 'the trump text does not say Trump');
      assert.equal(cap.overflow, false, 'the trump text is cut off');
      console.log(`  ok  ${name}: "${cap.text}"`);
    } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message.split('\n')[0]}`); }
  }
  await browser.close(); server.close();
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nwizard trump caption: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
