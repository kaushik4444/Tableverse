'use strict';
// Ludo is easy to miss when bots play fast: a six, a capture or a token reaching home is held mid-screen for a moment, the recent lines
// float over the board, and a roll that passes the turn stays on the die. A first look at a table (or a reload) does not replay anything.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }
const NAMES = ['Aarav', 'Bo', 'Cy', 'Di'];

function setup() {
  const def = games.get('ludo');
  const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  let a = 5; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), rng);
  players.forEach((p) => g.act(p.id, { type: 'ready' }));
  const room = { code: 'ABCDEF', gameId: 'ludo', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: 4, min: 2, max: 6, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: p.id !== 'me', avatar: p.avatar, connected: true })) };
  return { g, room, welcome: welcome({ id: 'me', name: NAMES[0], games: games.list() }) };
}
const msg = (room, view) => ({ t: 'state', room, view });

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    const { g, room, welcome: w } = setup();
    const base = g.view('me');
    const withLog = (extra, lastRoll, seq) => ({ ...base, phase: 'rolling', turn: 1, myTurn: false, canRoll: false, event: { seq, type: 'turn', by: 1 }, logTotal: 1 + extra.length, lastRoll,
      log: [{ id: 0, by: 'Aarav', card: 'rolled a 2', kind: 'roll' }, ...extra.map((x, k) => ({ id: 1 + k, ...x }))] });
    const first = withLog([], { by: 0, dice: 2, no: 1, outcome: 'none' }, 3);

    await test('nothing is replayed on the first look; a new six, a capture and a home are announced; the last roll stays on the die', async () => {
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 393, height: 852 }, messages: [w, msg(room, first)] });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('.ludo-die');
        assert.equal(await page.locator('.gf-spot').count(), 0, 'no spotlight on the first look');
        assert.equal(await page.locator('.ludo-die.blank').count(), 0, 'the die still shows the last roll');
        const six = withLog([{ by: 'Bo', card: 'rolled a 6', kind: 'roll' }], { by: 1, dice: 6, no: 2, outcome: 'moves' }, 4);
        await page.evaluate((m) => window.__push(m), msg(room, six));
        await page.waitForSelector('.gf-spot');
        assert.match(await page.textContent('.gf-spot'), /Bo rolled a six/);
        assert.match(await page.textContent('.ludo-status'), /Bo.*rolled a 6/);
        const cap = withLog([{ by: 'Bo', card: 'rolled a 6', kind: 'roll' }, { by: 'Bo', card: 'sent Cy home', kind: 'capture' }, { by: 'Bo', card: 'moved token 1 by 6', kind: 'move' }], { by: 1, dice: 6, no: 2, outcome: 'moves' }, 5);
        await page.evaluate((m) => window.__push(m), msg(room, cap));
        await page.waitForFunction(() => /sent Cy home/.test(document.querySelector('.gf-spot')?.textContent || ''));
        const home = withLog([{ by: 'Bo', card: 'rolled a 6', kind: 'roll' }, { by: 'Bo', card: 'sent Cy home', kind: 'capture' }, { by: 'Bo', card: 'moved token 1 by 6', kind: 'move' }, { by: 'Bo', card: 'got a token home', kind: 'home' }], { by: 1, dice: 6, no: 2, outcome: 'moves' }, 6);
        await page.evaluate((m) => window.__push(m), msg(room, home));
        await page.waitForFunction(() => /got a token home/.test(document.querySelector('.gf-spot')?.textContent || ''));
      } finally { await ctx.close(); }
    });

    await test('a reload with a long log does not replay old lines', async () => {
      const six = withLog([{ by: 'Bo', card: 'rolled a 6', kind: 'roll' }], { by: 1, dice: 6, no: 2, outcome: 'moves' }, 4);
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 393, height: 852 }, messages: [w, msg(room, six)] });
      try {
        await page.goto(url + '/');
        await page.waitForSelector('.ludo-die');
        assert.equal(await page.locator('.gf-spot').count(), 0);
      } finally { await ctx.close(); }
    });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
