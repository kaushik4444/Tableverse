'use strict';
// A legal Ludo token must be easy to tap on a phone: its invisible tap area (ludo.css, .ludo-token.legal::after, inset -18px)
// reaches about 44px. A tap 14px from the token's centre (outside the drawn token) must reach that token, and the move the
// page sends must be for that token's index. The page routes a tap to the nearest legal token (nearestLegal in ludo.js), so the
// assertion checks the sent move, not only which element is under the pointer. Two overlapping legal targets are not covered here.
const assert = require('node:assert/strict');
const games = require('../../games');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } }

const NAMES = ['Aarav', 'Bo', 'Cy', 'Di'];
const VIEWPORTS = [{ name: '320x568', width: 320, height: 568 }, { name: '360x640', width: 360, height: 640 }, { name: '390x844', width: 390, height: 844 }];

// Plays the real Ludo engine (bots for everyone) until it is the human's move, then returns the human's view.
function ludoAtMove(seed = 3) {
  const def = games.get('ludo');
  const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  let a = seed; const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = def.create(players, Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default])), rng);
  players.forEach((p) => g.act(p.id, { type: 'ready' }));
  for (let i = 0; i < 4000 && !g.isOver(); i++) {
    if (g.view('me').canMove) break;
    const aw = [].concat(g.awaiting() || []);
    if (!aw.length) { const au = g.autoAction && g.autoAction(); if (!au) break; g.act(null, au); continue; }
    g.act(aw[0], g.botAction(aw[0]));
  }
  return g;
}

function messagesFor(g) {
  const def = games.get('ludo');
  const players = NAMES.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  const room = { code: 'ABCDEF', gameId: 'ludo', hostId: 'me', status: 'playing', options: {}, visibility: 'public', seats: NAMES.length, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    members: players.map((p) => ({ id: p.id, name: p.name, bot: p.id !== 'me', avatar: p.avatar, connected: true })) };
  return [welcome({ id: 'me', name: NAMES[0], games: games.list() }), { t: 'state', room, view: g.view('me') }];
}

(async () => {
  const { server, url } = await serve({ 'GET /api/auth/session': () => sessionOk() });
  const browser = await chromium.launch();
  try {
    const g = ludoAtMove();
    const v = g.view('me');
    assert.ok(v.canMove, 'the engine reached a move for the human (test setup)');
    for (const vp of VIEWPORTS) {
      await test(`a legal Ludo token is tappable 14px outside its centre at ${vp.name}`, async () => {
        const { page, ctx } = await scriptedPage(browser, { viewport: { width: vp.width, height: vp.height }, messages: messagesFor(g) });
        try {
          await page.goto(url + '/');
          await page.waitForSelector('.ludo-token.legal', { timeout: 8000 });
          const r = await page.evaluate(() => {
            const el = document.querySelector('.ludo-token.legal');
            const b = el.getBoundingClientRect();
            const cx = b.left + b.width / 2; const cy = b.top + b.height / 2;
            // A finger 14px right of the centre: outside the drawn token (about 5px radius at 320px), inside the invisible legal area.
            const x = cx + 14;
            const hit = document.elementFromPoint(x, cy);
            const hitBtn = hit && hit.closest('.ludo-token');
            return { tokenW: b.width, hitIsLegal: !!(hitBtn && hitBtn.classList.contains('legal')), x, y: cy,
              hitLt: hitBtn ? hitBtn.dataset.lt : null, lt: el.dataset.lt };
          });
          assert.ok(r.tokenW < 14, `the drawn token is small (${r.tokenW.toFixed(1)}px), so the tap needs the invisible area`);
          assert.ok(r.hitIsLegal, `a tap 14px from the token centre (x ${Math.round(r.x)}) reaches a legal token`);
          // Tap for real, then read the move the page sent: it must be for the token whose centre was measured.
          await page.evaluate(() => { window.__sent = []; });
          await page.mouse.click(r.x, r.y);
          await page.waitForTimeout(150);
          const sent = await page.evaluate(() => window.__sent || []);
          const moves = sent.filter((m) => JSON.stringify(m).includes('"type":"move"'));
          const token = r.lt && r.lt.startsWith('tok:') ? Number(r.lt.slice(4)) : null;
          assert.equal(moves.length, 1, `the tap sends one move (sent: ${moves.length})`);
          assert.ok(JSON.stringify(moves[0]).includes(`"token":${token}`), `the move is for the measured token ${token} (sent ${JSON.stringify(moves[0])})`);
        } finally { await ctx.close(); }
      });
    }
  } finally {
    await browser.close();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();
