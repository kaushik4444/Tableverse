'use strict';
// Any seated player at a private lobby gets the invite form (not only the host); friends already seated are not offered.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

(async () => {
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/friends': () => ({ ok: true, friends: [{ id: 'f1', username: 'zoe', display_name: 'Zoe', online: true }, { id: 'p2', username: 'host', display_name: 'Host', online: true }] }),
    'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: [] }), 'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [] }), 'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
  });
  const browser = await chromium.launch();
  const room = (members) => ({ code: 'ABCDEF', gameId: 'wizard', hostId: 'p2', status: 'lobby', options: {}, visibility: 'private', seats: 4, members, spectators: [] });
  const me = { id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true };
  const host = { id: 'p2', name: 'Host', bot: false, avatar: '🎩', connected: true };
  await test('a seated non-host can invite; the friend already at the table is disabled', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: games.list() }), { t: 'state', view: null, room: room([host, me]) }] });
    await page.goto(url + '/'); await page.waitForSelector('#tableInviteForm', { timeout: 8000 });
    assert.equal(await page.locator('#tableInviteFriend option[value="zoe"]').isDisabled(), false);
    assert.equal(await page.locator('#tableInviteFriend option[value="host"]').isDisabled(), true);
    assert.match(await page.textContent('#tableInviteFriend option[value="host"]'), /At this table/);
    await ctx.close();
  });
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'invite UI: all passed');
  process.exit(failed ? 1 : 0);
})();
