'use strict';
// The game-over screen for a player who is not the host (no "Play again" button): the XP card and the shared actions must sit
// inside the result sheet, be visible on a phone without the fixed bar covering them, and not push the page sideways.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let passed = 0; let failed = 0;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// Plays a real game of `gameId` to its end with the engine, then returns the messages that show the finished table to 'me'.
function finishedTable(gameId, n) {
  const def = games.get(gameId);
  const names = ['Aarav', 'Bo', 'Cy', 'Di'].slice(0, n);
  const players = names.map((name, i) => ({ id: i === 0 ? 'me' : 'p' + i, name, avatar: '🧙' }));
  const opts = Object.fromEntries((def.options || []).filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));
  const g = def.create(players, { ...opts, timeLimit: 'off' }, mulberry(11));
  for (let i = 0; i < 5000 && !g.isOver(); i++) {
    const w = [].concat(g.awaiting() || []);
    if (!w.length) { const a = g.autoAction && g.autoAction(); if (!a) break; g.act(null, a); continue; }
    const f = g.forcedPlay && g.forcedPlay(); const id = f ? f.playerId : w[0];
    g.act(id, f ? f.action : g.botAction(id));
  }
  assert.ok(g.isOver(), gameId + ' finishes in the engine');
  const xp = players.map((p, i) => ({ seat: i, id: p.id, name: p.name, saved: p.id !== 'p3', isBot: false, timeXp: 10 + i, minutes: 3, penalised: false }));
  const room = { code: 'ENDXP1', gameId, hostId: 'p1', status: 'finished', options: {}, visibility: 'private', seats: n, min: def.seats.min, max: def.seats.max, seatLabels: null, deadline: null, now: Date.now(), spectators: [],
    outcome: { winners: [{ id: 'p1', name: 'Bo' }], sinceMs: 60000, at: Date.now() - 60000, xp },
    members: players.map((p) => ({ id: p.id, name: p.name, bot: false, avatar: p.avatar, connected: true })) };
  return [welcome({ id: 'me', name: 'Aarav', games: games.list() }), { t: 'state', room, view: JSON.parse(JSON.stringify(g.view('me'))) }];
}

(async () => {
  const srv = await serve({ 'GET /api/auth/session': () => sessionOk() }); // a signed-in player: tables are only shown to accounts
  const browser = await chromium.launch();
  const cases = [['tictactoe', 2], ['gofish', 3], ['ludo', 4]];
  try {
    for (const [gameId, n] of cases) for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
      const name = `${gameId} result for a non-host at ${vp.width}x${vp.height}`;
      try {
        const { page, ctx } = await scriptedPage(browser, { viewport: vp, messages: finishedTable(gameId, n) });
        try {
          await page.goto(srv.url + '/');
          await page.waitForSelector('.end-xp', { timeout: 12000 });
          // The sheet scrolls, so the card may sit below the fold: scroll the sheet to each part and check it can be reached.
          const scrolled = await page.evaluate(() => {
            const card = document.querySelector('.end-xp'); const sheet = card.closest('.sheet, .ludo-end');
            if (!sheet) return { inSheet: false };
            sheet.scrollTop = sheet.scrollHeight; // the card and the shared actions are at the bottom of the sheet
            return { inSheet: true, canScroll: sheet.scrollHeight > sheet.clientHeight + 1 };
          });
          // The Leave action must be reachable: bring it into view the way a player scrolls, then check it is on screen.
          await page.evaluate(() => { const b = document.querySelector('.end-bar button[data-act="endLeave"], .end-actions button[data-act="endLeave"]'); if (b) b.scrollIntoView({ block: 'center' }); });
          await page.waitForTimeout(100);
          const r = await page.evaluate(() => {
            const card = document.querySelector('.end-xp'); let cb = card.getBoundingClientRect();
            const sheet = card.closest('.sheet, .ludo-end'); let sb = sheet ? sheet.getBoundingClientRect() : null;
            const bar = document.querySelector('.end-bar'); const bb = bar ? bar.getBoundingClientRect() : null;
            const btn = document.querySelector('.end-bar button[data-act="endLeave"], .end-actions button[data-act="endLeave"]');
            const bt = btn ? btn.getBoundingClientRect() : null;
            return {
              // the sheet is scrolled to its end first: some part of the card must then be inside the sheet's visible area
              inSheet: !!sheet,
              cardInside: (() => { if (!sheet) return false; sheet.scrollTop = sheet.scrollHeight; cb = card.getBoundingClientRect(); sb = sheet.getBoundingClientRect(); return cb.bottom > sb.top && cb.top < sb.bottom; })(),
              cardVisible: cb.height > 0,
              barFixed: bar ? getComputedStyle(bar).position === 'fixed' : false,
              barCoversCard: bb && bar.getBoundingClientRect() && bb.top < cb.bottom && cb.top < bb.bottom && getComputedStyle(bar).position === 'fixed',
              // on screen, and inside the sheet's visible box when the action lives in the sheet (clipping counts)
              leaveVisible: bt ? (bt.height > 0 && bt.top >= -1 && bt.bottom <= innerHeight + 1 && (() => { const sh = btn.closest('.sheet, .ludo-end'); if (!sh) return true; const q = sh.getBoundingClientRect(); return bt.top >= q.top - 1 && bt.bottom <= q.bottom + 1; })()) : false,
              sideways: document.documentElement.scrollWidth > innerWidth + 1,
              names: [...document.querySelectorAll('.xp-name')].length,
              // Two amounts side by side, labelled, and never a combined total (there is no total element or heading)
              // one table: no progress cards, and the headers are this match, this month and all time
              cards: document.querySelectorAll('.end-xp .xp-card').length,
              progressShown: /Player Progress/.test(document.querySelector('.end-xp')?.textContent || ''),
              headers: [...document.querySelectorAll('.end-xp .xp-th [role=columnheader]')].map((h) => h.textContent.trim()),
              noTotal: !document.querySelector('.end-xp .xp-total, .end-xp .xp-bar') && !/XP this game/.test(document.querySelector('.end-xp')?.textContent || ''),
              nameWide: [...document.querySelectorAll('.xp-name')].every((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.height < 30; }), // a name is a line of text, not a 22px circle
            };
          });
          assert.ok(scrolled.inSheet, 'the XP card is inside the result sheet');
          assert.ok(r.inSheet, 'the XP card is inside the result sheet (after the layout settled)');
          assert.ok(r.cardInside, 'the XP card is reachable inside the result sheet (scrolled to its end, some part is visible)');
          assert.equal(r.barCoversCard, false, 'the fixed action bar does not cover the XP card');
          assert.ok(r.leaveVisible, 'the Leave game action is on screen');
          assert.equal(r.sideways, false, 'no sideways scroll');
          assert.ok(r.names >= 1, 'the XP rows render');
          assert.equal(r.cards, 0, 'no progress cards on the game-over screen');
          assert.equal(r.progressShown, false, 'Player Progress is not shown on the game-over screen');
          assert.equal(r.headers.length, 4, 'table has Player, this match, this month and all-time columns: ' + r.headers.join(' | '));
          assert.ok(/All time/.test(r.headers[3]), 'the last column is the all-time rating: ' + r.headers.join(' | '));
          assert.equal(r.noTotal, true, 'there is no combined total on the game-over card');
          assert.ok(r.nameWide, 'the XP names keep their width');
          passed++; console.log('  ok  ' + name);
        } finally { await ctx.close(); }
      } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); }
    }
  } finally {
    await browser.close(); srv.server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
  }
})();
