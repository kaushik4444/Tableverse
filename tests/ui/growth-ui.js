'use strict';
// Growth counters, page side: a join says how the person arrived (table link or accepted invitation, nothing for an ordinary
// join), and a tap on a share button is reported once per tap. The counting itself is in tests/growth-analytics.test.js.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, welcome, sessionOk } = require('./harness');
const games = require('../../games');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const invitation = { id: 'inv-1', game_id: 'wizard', room_code: 'ZXCVBN', status: 'pending', player_id: 'p9', username: 'bo', display_name: 'Bo', avatar: '🦊' };
const sentOf = (page, t) => page.evaluate((type) => window.__sent.filter((m) => m.t === type), t);

(async () => {
  let listed = [invitation];
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: listed }),
    'POST /api/me/table-invitations/accept': () => { listed = []; return { ok: true, invitation: { id: 'inv-1', status: 'accepted', room_code: 'ZXCVBN', game_id: 'wizard' } }; },
  });
  const browser = await chromium.launch();
  const list = games.list();

  await test('arriving through a table link (#CODE) joins with via "link"', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: list })] });
    await page.goto(url + '/#ABCDEF');
    await page.click('[data-join-mode="join"]');
    await page.waitForFunction(() => window.__sent.some((m) => m.t === 'join'));
    const j = (await sentOf(page, 'join')).at(-1);
    assert.equal(j.code, 'ABCDEF');
    assert.equal(j.via, 'link');
    await ctx.close();
  });

  await test('joining from the open tables list sends no via, so it is not counted as an invite', async () => {
    const table = { code: 'QRSTUV', gameId: 'ludo', host: 'Zoe', members: 1, seats: 4, status: 'lobby', visibility: 'public' };
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: list, tables: [table] })] });
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="joinPublic"]', { timeout: 8000 });
    await page.click('[data-act="joinPublic"]');
    await page.click('[data-join-mode="join"]');
    await page.waitForFunction(() => window.__sent.some((m) => m.t === 'join'));
    const j = (await sentOf(page, 'join')).at(-1);
    assert.equal(j.code, 'QRSTUV');
    assert.ok(!('via' in j), 'no via on an ordinary join');
    await ctx.close();
  });

  await test('accepting a friend invitation joins with via "friend"', async () => {
    listed = [invitation];
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: list })] });
    await page.goto(url + '/');
    await page.waitForSelector('.tb-bell', { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.click('.tb-bell');
    await page.waitForSelector('[data-act="acceptInvitation"]');
    await page.click('[data-act="acceptInvitation"]');
    await page.waitForFunction(() => window.__sent.some((m) => m.t === 'join'));
    const j = (await sentOf(page, 'join')).at(-1);
    assert.equal(j.code, 'ZXCVBN');
    assert.equal(j.via, 'friend');
    await ctx.close();
  });

  const lobby = { code: 'ABCDEF', gameId: 'wizard', hostId: 'me', status: 'lobby', options: {}, visibility: 'public', seats: 4, members: [{ id: 'me', name: 'Aarav', bot: false, avatar: '🧙', connected: true }], spectators: [] };
  await test('each tap on Copy link, WhatsApp and Share is reported once, by channel; nothing else is sent with it', async () => {
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: list }), { t: 'state', view: null, room: lobby }] });
    await page.addInitScript(() => { window.open = () => null; navigator.share = async () => {}; });
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="whatsapp"]', { timeout: 8000 });
    await page.click('[data-act="whatsapp"]');
    await page.click('[data-act="share"]');
    await page.click('[data-act="copyLink"]');
    await page.waitForFunction(() => window.__sent.filter((m) => m.t === 'share').length >= 3);
    const shares = await sentOf(page, 'share');
    assert.deepEqual(shares.map((m) => m.channel), ['whatsapp', 'native', 'copy']);
    for (const m of shares) assert.deepEqual(Object.keys(m).sort(), ['channel', 't'], 'no table code or link is sent');
    await ctx.close();
  });

  await browser.close(); server.close();
  console.log(failed ? `${failed} failed` : `growth UI: ${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
