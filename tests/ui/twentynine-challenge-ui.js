'use strict';
// The 29 double challenge (doubleChallenge option): the other team sees Double and Accept after trump is chosen, and a
// click sends the matching action. Runs at phone and desktop widths. Chromium emulation only.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e).split('\n').slice(0, 3).join('\n')); } }

const NAMES = ['Aarav', 'Bo', 'Charlotte', 'Dmitri'];
const VIEWPORTS = [
  { name: 'phone 390x844', width: 390, height: 844 },
  { name: 'desktop 1366x768', width: 1366, height: 768 },
];

// Finds a seed where, with the bots playing, the challenge is open and it is my turn to answer for the other team.
function challengeFor(seeds) {
  const def = games.get('twentynine');
  for (const seed of seeds) {
    const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
    let a = seed; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const g = def.create(players, { target: 6, doubleChallenge: true }, rng);
    for (let i = 0; i < 4000 && !g.isOver(); i++) {
      const v = g.view('me');
      if (v.phase === 'challenge' && v.myTurn) return { g, seed, v };
      const waiting = [].concat(g.awaiting() || []);
      if (!waiting.length) { const auto = g.autoAction && g.autoAction(); if (!auto) break; g.act(null, auto); continue; }
      const forced = g.forcedPlay && g.forcedPlay();
      const id = forced ? forced.playerId : waiting[0];
      g.act(id, forced ? forced.action : g.botAction(id));
    }
  }
  return null;
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    const found = challengeFor(Array.from({ length: 300 }, (_, i) => i + 1).filter((s) => s % 3 !== 0));
    await test('the engine reaches a challenge that I can answer', async () => assert.ok(found, 'no seed reached the challenge'));
    if (!found) return;
    const { g, v } = found;
    const room = { code: 'ABCDEF', gameId: 'twentynine', hostId: 'me', status: 'playing', options: { doubleChallenge: true }, visibility: 'public', seats: 4, min: 4, max: 4, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
      members: NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, bot: i > 0, avatar: '🧙', connected: true, ping: null, username: null })) };
    const messages = [welcome({ id: 'me', name: NAMES[0], games: games.list() }), { t: 'state', room, view: g.view('me') }];
    for (const vp of VIEWPORTS) {
      await test(`challenge: Double and Accept are offered and send the action at ${vp.name}`, async () => {
        const { page, ctx } = await scriptedPage(browser, { viewport: { width: vp.width, height: vp.height }, messages });
        try {
          await page.goto(url + '/');
          await page.waitForSelector('[data-t9="double"]', { timeout: 8000 });
          const shown = await page.evaluate(() => ({ double: !!document.querySelector('[data-t9="double"]'), accept: !!document.querySelector('[data-t9="accept"]'), redouble: !!document.querySelector('[data-t9="redouble"]') }));
          assert.deepEqual(shown, { double: true, accept: true, redouble: false });
          await page.evaluate(() => document.querySelector('[data-t9="double"]').click());
          await page.waitForTimeout(200);
          const sent = await page.evaluate(() => window.__sent);
          assert.ok(sent.some((m) => JSON.stringify(m).includes('"type":"double"')), 'a double action was sent: ' + JSON.stringify(sent.slice(-2)));
          assert.equal(v.multiplier, 1);
        } finally { await ctx.close(); }
      });
    }
  } finally {
    await browser.close(); server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
