'use strict';
// Accepting a table invitation joins that table (it used to fail with "no table code" because the server's answer had none).
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const invitation = { id: 'inv-1', game_id: 'wizard', room_code: 'ZXCVBN', status: 'pending', player_id: 'p9', username: 'bo', display_name: 'Bo', avatar: '🦊' };

(async () => {
  let acceptAnswer = { ok: true, invitation: { id: 'inv-1', status: 'accepted' } }; // the old shape: no room_code
  let listed = [invitation];
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: listed }),
    'POST /api/me/table-invitations/accept': () => { listed = []; return acceptAnswer; },
  });
  const browser = await chromium.launch();
  const open = async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [{ id: 'wizard', name: 'Wizard', tagline: '', icon: '🧙', accent: '#7b4bd0', seats: { min: 3, max: 6, default: 4 }, options: [], rules: [] }] })] });
    await page.goto(url + '/');
    await page.waitForSelector('.tb-bell', { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.click('.tb-bell');
    await page.waitForSelector('[data-act="acceptInvitation"]');
    return { page, ctx };
  };
  const joins = (page) => page.evaluate(() => window.__sent.filter((m) => m.t === 'join'));

  await test('accepting joins the invited table even when the server answer carries no code', async () => {
    const { page, ctx } = await open();
    await page.click('[data-act="acceptInvitation"]');
    await page.waitForFunction(() => window.__sent.some((m) => m.t === 'join'));
    assert.equal((await joins(page)).at(-1).code, 'ZXCVBN');
    await ctx.close();
  });

  await test('accepting joins with the code from the server answer when it has one', async () => {
    listed = [invitation];
    acceptAnswer = { ok: true, invitation: { id: 'inv-1', status: 'accepted', game_id: 'wizard', room_code: 'QWERTY' } };
    const { page, ctx } = await open();
    await page.click('[data-act="acceptInvitation"]');
    await page.waitForFunction(() => window.__sent.some((m) => m.t === 'join'));
    assert.equal((await joins(page)).at(-1).code, 'QWERTY');
    await ctx.close();
  });

  await test('friend names are real buttons: the keyboard opens a profile (friends page and online chips on home)', async () => {
    const friend = { id: 'p9', username: 'bo', display_name: 'Bo', avatar: '🦊', online: true, playing: null, ping: 40, last_seen: null };
    const { server: s2, url: u2 } = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/me/friends': () => ({ ok: true, friends: [friend] }) });
    for (const [hash, selector] of [['#friends', 'button.friend-name'], ['', 'button.fs-chip']]) {
      const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [] })] });
      await page.goto(u2 + '/' + hash);
      await page.waitForSelector(selector, { timeout: 8000 });
      await page.focus(selector);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash === '#u/bo');
      await ctx.close();
    }
    s2.close();
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
