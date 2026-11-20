'use strict';
/** The six-player board is one piece: each home triangle and yard is the colour of its seat, with no white seam to the next. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const def = games.get('ludo');
function sixPlayers() {
  const players = ['Aarav', 'Bo', 'Cy', 'Di', 'Eve', 'Fay'].map((nm, i) => ({ id: i ? 'p' + i : 'me', name: nm, avatar: '🧙' }));
  let a = 3; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, {}, rng);
  players.forEach((p) => g.act(p.id, { type: 'ready' }));
  const room = { code: 'ABCDEF', gameId: 'ludo', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: 6, min: 2, max: 6, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ games: games.list(), voiceEnabled: true }), { t: 'state', room, view: g.view('me') }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const { page, ctx } = await scriptedPage(browser, { viewport: { width: 900, height: 900 }, messages: sixPlayers() });
  let failed = 0;
  try {
    await page.goto(url + '/');
    await page.waitForSelector('.ludo-board svg', { timeout: 8000 });
    const seams = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('.ludo-board svg path')];
      // the home triangles (filled) and the yards: a white outline would show a seam between two pieces of one board
      const homes = paths.filter((p) => p.getAttribute('stroke-width') === '0.6');
      const yards = paths.filter((p) => p.getAttribute('stroke-width') === '3');
      return { homes: homes.length, whiteHome: homes.filter((p) => p.getAttribute('stroke') !== p.getAttribute('fill')).length, yards: yards.length, whiteYard: yards.filter((p) => p.getAttribute('stroke') !== p.getAttribute('fill')).length };
    });
    assert.equal(seams.homes, 6, 'six home triangles');
    assert.equal(seams.whiteHome, 0, 'no home triangle has a seam: ' + JSON.stringify(seams));
    assert.equal(seams.yards, 6, 'six yards');
    assert.equal(seams.whiteYard, 0, 'each yard is the same colour as its outline, so it meets the track: ' + JSON.stringify(seams));
    console.log('  ok  six-player board: one piece, no seams');
  } catch (e) { failed++; console.error('FAIL  six-player board\n' + e.stack); }
  finally { await ctx.close(); }
  await browser.close(); server.close();
  console.log(`\n${1 - failed} ludo six-player board checks passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
