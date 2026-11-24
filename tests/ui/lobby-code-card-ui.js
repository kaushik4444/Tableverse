'use strict';
// Lobby code card, same for public and private tables: Copy invite link / WhatsApp / Share sit above the visibility line; the host's Make private / Make public button swaps its own label; a private table also shows the friend invitation form.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

(async () => {
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/friends': () => ({ ok: true, friends: [{ id: 'f1', username: 'zoe', display_name: 'Zoe', online: true }] }),
    'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: [] }), 'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [] }), 'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
  });
  const browser = await chromium.launch();
  const me = { id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true };
  const room = (visibility) => ({ code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility, seats: 4, members: [me], spectators: [] });
  const measure = async (visibility) => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: games.list() }), { t: 'state', view: null, room: room(visibility) }] });
    await page.goto(url + '/'); await page.waitForSelector('.visibility-control', { timeout: 8000 });
    const out = await page.evaluate(() => {
      const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
      return {
        actionsAboveToggle: top('.code-card .row') < top('.visibility-control'),
        actionLabels: [...document.querySelectorAll('.code-card .row')[0].querySelectorAll('button')].map((b) => b.textContent.trim()),
        label: document.querySelector('[data-act="toggleVisibility"]').textContent.trim(),
        picker: !!document.getElementById('tableInviteForm'),
      };
    });
    await ctx.close();
    return out;
  };
  for (const visibility of ['public', 'private']) {
    await test(`${visibility} table: Copy invite link, WhatsApp and Share sit above the visibility line`, async () => {
      const out = await measure(visibility);
      assert.ok(out.actionsAboveToggle, 'action row is not above the visibility line');
      assert.deepEqual(out.actionLabels.filter((l) => /Copy invite link|WhatsApp|Share/.test(l)), ['Copy invite link', 'WhatsApp', ...(out.actionLabels.includes('Share…') ? ['Share…'] : [])]);
    });
  }
  await test('the toggle swaps its label between public and private', async () => {
    assert.equal((await measure('public')).label, 'Make private');
    assert.equal((await measure('private')).label, 'Make public');
  });
  await test('a private table shows the invitation form; a public table does not', async () => {
    assert.equal((await measure('private')).picker, true);
    assert.equal((await measure('public')).picker, false);
  });
  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : 'lobby code card UI: all passed');
  process.exit(failed ? 1 : 0);
})();
