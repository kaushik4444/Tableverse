'use strict';
/** On a phone the Ludo board comes first and the status with its action (Roll dice, I'm ready) sits below it, within reach. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

const def = games.get('ludo');
function ludoMessages() {
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
  for (const [label, viewport] of [['a phone (390 by 844)', { width: 390, height: 844 }], ['a short phone (360 by 640)', { width: 360, height: 640 }]]) {
    const { page, ctx } = await scriptedPage(browser, { viewport, messages: ludoMessages() });
    try {
      await page.goto(url + '/');
      await page.waitForSelector('.ludo-board', { timeout: 8000 });
      const boxes = await page.evaluate(() => ({
        board: document.querySelector('.ludo-board').getBoundingClientRect().top,
        panel: document.querySelector('.ludo-dice-panel').getBoundingClientRect().top,
        button: (document.querySelector('.ludo-dice-panel .ludo-roll') || {}).getBoundingClientRect ? document.querySelector('.ludo-dice-panel .ludo-roll').getBoundingClientRect().bottom : 0,
      }));
      assert.ok(boxes.board < boxes.panel, `${label}: the board is above the status panel: ${JSON.stringify(boxes)}`);
      console.log('  ok  ' + label + ': board first, the action below it');
    } catch (e) { failed++; console.error('FAIL  ' + label + '\n' + e.stack); }
    finally { await ctx.close(); }
  }
  await browser.close(); server.close();
  console.log(`\n${2 - failed} ludo phone order checks passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})();
