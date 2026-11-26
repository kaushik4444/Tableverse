'use strict';
/**
 * Takes a screenshot of the REAL table for a how-to-play card: the real front end (public/) shows the real engine's state
 * after a number of real engine steps (every seat plays through the engine's own bot logic, as in a bot-filled table).
 *
 * Usage: node scripts/howto-shot.js <gameId> <steps> <out.jpg> [seed] [--viewer=me]
 *   steps   how many engine moves to play forward before the screenshot (0 = the table as it opens)
 *   out     where to write the JPEG (1x phone width, 390 CSS px, 2x device pixels)
 *   seed    picks the deal (same seed, same game)
 *
 * Dev tool, not used by the server. Needs Playwright (as the UI tests do).
 */
const fs = require('node:fs');
const path = require('node:path');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('../tests/ui/harness');
const games = require('../games');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [GAME, STEPS, OUT, SEED = '1'] = args;
if (!GAME || STEPS === undefined || !OUT) { console.error('usage: node scripts/howto-shot.js <gameId> <steps> <out.jpg> [seed]'); process.exit(2); }

const def = games.get(GAME);
if (!def) throw new Error('unknown game ' + GAME);
const NAMES = ['Aarav', 'Bo', 'Cy', 'Di', 'Ed', 'Fi', 'Gu', 'Hi'];
const AVATARS = ['🧙', '🦊', '🐼', '🦉', '🐉', '🐸', '🦁', '🐙'];
const n = def.seats.default;
const players = Array.from({ length: n }, (_, i) => ({ id: i ? 'p' + i : 'me', name: NAMES[i], avatar: AVATARS[i] }));
const opts = Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));
let a = Number(SEED);
const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const g = def.create(players, { ...opts }, rng);

// play the engine forward: every seat that is waiting takes its bot move, as a table of bots would
let moves = 0;
const target = Number(STEPS);
while (moves < target && !g.isOver()) {
  const ids = [].concat(g.awaiting() || []);
  if (ids.length) {
    for (const id of ids) {
      if (moves >= target) break;
      const act = g.botAction(id); if (!act) continue;
      const r = g.act(id, act); if (r && r.ok === false) continue;
      moves++;
    }
  } else {
    const act = g.autoAction && g.autoAction();
    if (!act) break;
    const r = g.act(null, act); if (r && r.ok === false) break;
    moves++;
  }
}

const room = { code: 'REEL01', gameId: GAME, hostId: 'me', status: 'playing', options: opts, visibility: 'private', seats: players.length, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
  members: players.map((p) => ({ id: p.id, name: p.name, bot: p.id !== 'me', avatar: p.avatar, connected: true })) };
const stateMsg = { t: 'state', room, view: JSON.parse(JSON.stringify(g.view(flags.viewer || 'me'))) };

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const { page, ctx } = await scriptedPage(browser, {
    viewport: { width: 390, height: 693 },
    messages: [welcome({ id: 'me', name: 'Aarav', games: games.list() }), stateMsg],
  });
  await page.addInitScript((id) => { try { localStorage.setItem('tv_howto_' + id, '1'); } catch { /* no storage */ } }, GAME);
  await page.goto(url + '/');
  await page.waitForTimeout(2500);
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 72 });
  console.log(`${GAME} steps=${moves} over=${g.isOver()} -> ${OUT}`);
  await ctx.close(); await browser.close(); server.close();
})().catch((e) => { console.error('SHOT FAILED', GAME, e); process.exit(1); });
