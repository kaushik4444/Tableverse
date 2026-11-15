'use strict';
// Captures the phone screenshots used in the carousel. It runs the real Tableverse front-end (public/) in Chromium at phone size,
// fed by the real game engines (games/) through the test harness. Players are sample names; no server or database is involved.
// Run from the repo root:  NODE_PATH=<dir with playwright> node marketing/instagram/first-post/src/capture.js
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require(path.join(ROOT, 'tests/ui/harness'));
const games = require(path.join(ROOT, 'games'));
const { chromium } = loadPlaywright();
const OUT = path.join(__dirname, 'shots');
const NAMES = ['Aarav', 'Bo', 'Cy', 'Di', 'Eve', 'Fay'];
const AV = ['🧙', '🦊', '🐼', '🦉', '🐙', '🦄'];
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function play(gameId, n, steps, seed) {
  const def = games.get(gameId);
  const players = NAMES.slice(0, n).map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: AV[i] }));
  const opts = Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));
  const g = def.create(players, { ...opts, timeLimit: 'off' }, mulberry(seed));
  const step = () => {
    const w = [].concat(g.awaiting() || []);
    if (!w.length) { const a = g.autoAction && g.autoAction(); if (!a) return false; g.act(null, a); return true; }
    const f = g.forcedPlay && g.forcedPlay(); const id = f ? f.playerId : w[0];
    const r = g.act(id, f ? f.action : g.botAction(id)); return r && r.ok !== false;
  };
  for (let i = 0; i < steps && !g.isOver() && step(); i++);
  for (let k = 0; k < 60 && !g.isOver() && !g.view('me').myTurn; k++) if (!step()) break;
  const room = { code: 'ABCDEF', gameId, hostId: 'me', status: 'playing', options: {}, visibility: 'private', seats: n, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: JSON.parse(JSON.stringify(g.view('me'))) }];
}

const SHOTS = [['wizard', 4, 14], ['twentynine', 4, 14], ['poker', 4, 12], ['themind', 3, 6], ['ludo', 4, 30], ['gofish', 3, 10], ['snakesladders', 4, 18], ['propertyrivals', 4, 24], ['tictactoe', 2, 3], ['fourinarow', 2, 5]];

(async () => {
  const member = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  const shot = async (name, messages, wait = '.topbar, .wz-top, #app > *', vp = { width: 390, height: 844 }) => {
    const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages });
    await page.goto(member.url + '/'); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, name + '.png') }); await ctx.close(); console.log('ok', name);
  };
  await shot('home', [welcome({ id: 'me', name: 'Aarav', games: games.list() })]);
  for (const [id, n, steps] of SHOTS) await shot('game-' + id, play(id, n, steps, 7));
  const def = games.get('wizard');
  const lobby = { code: 'KQ7M2X', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'private', seats: 4, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }, { id: 'p1', name: 'Bo', bot: false, avatar: '🦊', connected: true }, { id: 'p2', name: 'Cy', bot: false, avatar: '🐼', connected: true }] };
  await shot('lobby', [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room: lobby, view: null }]);
  await browser.close(); member.server.close();
})();
