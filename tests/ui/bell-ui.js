'use strict';
/** The notification bell is in the lobby header and in every game's toolbar, answers friend requests in place, never lets a stray tap leave a running game, and the game still fits 360x640. */
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, tableMessages, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

(async () => {
  const posts = [];
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(), 'GET /api/me/friends': () => ({ ok: true, friends: [] }),
    'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: [{ id: 'r1', username: 'zoe', display_name: 'Zoe' }] }),
    'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [{ id: 'i1', username: 'zoe', display_name: 'Zoe', game_id: 'wizard' }] }),
    'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
    'POST /api/me/friend-requests/accept': (req, body) => { posts.push(body); return { ok: true }; },
  });
  const browser = await chromium.launch();
  const lobbyMsgs = [welcome({ games: games.list() }), { t: 'state', view: null, room: { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'public', seats: 4, min: 3, max: 6, seatLabels: null,
    members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }], spectators: [] } }];
  await test('lobby: bell with the waiting count; no Accept for a table invitation while seated; Escape closes it', async () => {
    const { page, ctx } = await scriptedPage(browser, { viewport: { width: 360, height: 640 }, messages: lobbyMsgs });
    await page.goto(url + '/'); await page.waitForSelector('.tb-bell .bell-count', { timeout: 8000 });
    assert.equal(await page.textContent('.tb-bell .bell-count'), '2');
    await page.click('.tb-bell');
    assert.ok(await page.isVisible('.bell-panel'));
    assert.equal(await page.locator('.bell-panel [data-act="acceptInvitation"]').count(), 0, 'no Accept for a table invitation while at a table');
    assert.ok(await page.isVisible('.bell-panel [data-act="acceptFriend"]'), 'friend requests can still be answered');
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(noOverflow, 'no horizontal overflow');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('.bell-panel'), false, 'Escape closes the panel');
    await ctx.close();
  });
  for (const id of ['wizard', 'twentynine', 'poker', 'themind', 'ludo', 'gofish', 'snakesladders', 'propertyrivals']) {
    await test(`${id}: bell in the toolbar, opens in place, game still fits 360x640`, async () => {
      const n = id === 'themind' ? 3 : 4;
      const { page, ctx } = await scriptedPage(browser, { viewport: { width: 360, height: 640 }, messages: tableMessages(id, ['Aarav', 'Bo', 'Cy', 'Di'].slice(0, n).map((name) => ({ name }))) });
      await page.goto(url + '/'); await page.waitForSelector('.tb-bell .bell-count', { timeout: 8000 });
      const before = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bar: [...document.querySelectorAll('.tb-bell, .chat-btn, [data-act="emotes"], .tb-more-btn')].map((b) => Math.round(b.getBoundingClientRect().width)) }));
      assert.ok(before.sw <= before.iw, `${id}: no horizontal overflow (${before.sw} > ${before.iw})`);
      await page.click('.tb-bell');
      assert.ok(await page.isVisible('.bell-panel'), `${id}: the panel opens`);
      assert.equal(await page.locator('.bell-panel [data-act="acceptInvitation"]').count(), 0, `${id}: no accidental leave through an invitation`);
      await page.click('.bell-panel [data-act="acceptFriend"]');
      await page.waitForTimeout(100);
      assert.ok(posts.length >= 1, `${id}: a friend request is answered in place`);
      posts.length = 0;
      await ctx.close();
    });
  }
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'bell UI: all passed');
  process.exit(failed ? 1 : 0);
})();
