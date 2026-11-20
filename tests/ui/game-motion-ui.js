'use strict';
/** Game state changes glide (shared motion), and a reduced-motion person gets no glide. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const def = games.get('ludo');
function msgs() {
  const players = ['Aarav', 'Bo', 'Cy', 'Di'].map((nm, i) => ({ id: i ? 'p' + i : 'me', name: nm, avatar: '🧙' }));
  let a = 3; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, {}, rng);
  players.forEach((p) => g.act(p.id, { type: 'ready' }));
  const room = { code: 'ABCDEF', gameId: 'ludo', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: 4, min: 2, max: 4, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ games: games.list(), voiceEnabled: true }), { t: 'state', room, view: g.view('me') }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  let failed = 0;
  for (const [label, reduced] of [['normal motion', 'no-preference'], ['reduced motion', 'reduce']]) {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 390, height: 844 }, messages: msgs() });
    try {
      await page.emulateMedia({ reducedMotion: reduced });
      await page.goto(url + '/');
      await page.waitForSelector('.ludo-player', { timeout: 8000 });
      const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.ludo-player')).transitionDuration);
      if (reduced === 'reduce') assert.ok(/^0s(, 0s)*$/.test(dur) || dur === '0s', `${label}: no glide, got ${dur}`);
      else assert.ok(!/^0s$/.test(dur), `${label}: the state glides, got ${dur}`);
      console.log(`  ok  ${label}`);
    } catch (e) { failed++; console.error(`FAIL  ${label}\n` + e.stack); }
    finally { await ctx.close(); }
  }
  await browser.close(); server.close();
  console.log(`\n${2 - failed} game motion checks passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
