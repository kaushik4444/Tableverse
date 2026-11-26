'use strict';
// Sound cues that had no test: button taps, the volume slider, chess captures and checks, Take 5 card-by-card sounds,
// a friend request arriving, and the level-up fanfare.
const assert = require('assert');
const { serve, scriptedPage, loadPlaywright, tableMessages, sessionOk, welcome } = require('./harness');
const { chromium } = loadPlaywright();

(async () => {
  let incoming = [];
  let progressLevel = 1;
  const profile = () => ({ ok: true, profile: { username: 'aarav', displayName: 'Aarav', avatar: '🧙', email: 'a@b.c', emailVerified: true, joinedAt: '2026-01-01T00:00:00Z' }, stats: { played: 0, wins: 0, losses: 0, winRate: null, perGame: [], recent: [], streak: { current: 0, best: 0 }, progress: { account: { level: progressLevel, into: 0, need: 100 } } } });
  const { server, url } = await serve({
    'GET /api/auth/session': () => sessionOk(),
    'GET /api/me/profile': () => profile(),
    'GET /api/me/friends': () => ({ ok: true, friends: [] }),
    'GET /api/me/friend-requests?direction=incoming': () => ({ ok: true, requests: incoming }),
    'GET /api/me/friend-requests?direction=outgoing': () => ({ ok: true, requests: [] }),
    'GET /api/me/table-invitations?direction=incoming': () => ({ ok: true, invitations: [] }),
    'GET /api/me/table-invitations?direction=outgoing': () => ({ ok: true, invitations: [] }),
    'GET /api/me/history?page=1': () => ({ ok: true, items: [], total: 0, page: 1, pages: 1, pageSize: 10 }),
  });
  const browser = await chromium.launch();
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`  ok  ${name}`); }
    catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
  };
  const spy = (page) => page.evaluate(() => {
    window.__snd = [];
    const s = window.CardTable.sound;
    const real = s.play;
    s.play = (name, arg) => { window.__snd.push(name); return real(name, arg); };
  });
  const heard = (page) => page.evaluate(() => window.__snd.slice());
  const open = async (msgs, opts = {}) => {
    const r = await scriptedPage(browser, { messages: msgs, viewport: { width: 390, height: 844 }, ...opts });
    await r.page.goto(url + '/');
    await r.page.waitForSelector('#app *', { timeout: 8000 });
    await r.page.waitForTimeout(400);
    await spy(r.page);
    return r;
  };

  await check('a button in the app plays a tap; a disabled button does not', async () => {
    const { page, ctx } = await open([welcome({ id: 'me', name: 'Aarav', games: [] })]);
    await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn'; b.id = 'probe'; b.textContent = 'probe'; document.getElementById('app').appendChild(b); });
    await page.click('#probe');
    await page.waitForTimeout(100);
    const afterOne = (await heard(page)).filter((n) => n === 'tap').length;
    await page.evaluate(() => { const b = document.getElementById('probe'); b.disabled = true; });
    await page.click('#probe', { force: true }).catch(() => {});
    await page.waitForTimeout(100);
    const afterTwo = (await heard(page)).filter((n) => n === 'tap').length;
    await ctx.close();
    assert.equal(afterOne, 1, `expected one tap for an enabled button, got ${afterOne}`);
    assert.equal(afterTwo, 1, `a disabled button should not tap, got ${afterTwo} in total`);
  });

  await check('the volume slider in Settings sets the volume and keeps it on this device', async () => {
    const { page, ctx } = await open([welcome({ id: 'me', name: 'Aarav', games: [] })]);
    await page.click('.tb-avatar-btn');
    await page.click('[data-act="openSettings"]');
    await page.waitForSelector('#modal-overlay [data-volume]');
    await page.evaluate(() => { const i = document.querySelector('#modal-overlay [data-volume]'); i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    const vol = await page.evaluate(() => window.CardTable.sound.volume());
    const saved = await page.evaluate(() => localStorage.getItem('ct_volume'));
    await page.evaluate(() => localStorage.removeItem('ct_volume'));
    await ctx.close();
    assert.equal(vol, 40, `volume should be 40, got ${vol}`);
    assert.equal(saved, '40', 'the volume is saved on this device');
  });

  await check('chess: a capture plays the thud, a check the double tap, a plain move the tap', async () => {
    const msgs = tableMessages('chess', [{ name: 'Aarav' }, { name: 'Bo' }]);
    const { page, ctx } = await open(msgs);
    const push = async (seq, extra) => {
      const m = JSON.parse(JSON.stringify(msgs[1]));
      m.view.event = { seq, type: 'move', from: 'e2', to: 'e4', capture: false, check: false, ...extra };
      await page.evaluate((x) => window.__push(x), m);
      await page.waitForTimeout(150);
    };
    await push(1, {});
    await push(2, { capture: true });
    await push(3, { check: true });
    await push(4, {});
    const got = (await heard(page)).filter((n) => ['place', 'pocket', 'check'].includes(n));
    await ctx.close();
    assert.deepEqual(got, ['place', 'pocket', 'check', 'place'], `expected a move, the capture, the check, then a move; got ${got.join(' ') || 'none'}`);
  });

  await check('Take 5: each card landing on a row plays a card sound, and the turn does not play a second one', async () => {
    const pen = (n) => 1 + (n % 5 === 0 ? 1 : 0) + (n % 10 === 0 ? 1 : 0) + (n % 11 === 0 ? 4 : 0);
    const c = (n) => ({ n, p: pen(n) });
    const four = [{ name: 'Aarav' }, { name: 'Bo' }, { name: 'Cy' }, { name: 'Di' }];
    const msgs = tableMessages('penaltyrows', four, { seed: 3 });
    const before = [[c(12)], [c(3)], [c(38)], [c(44)]];
    const first = JSON.parse(JSON.stringify(msgs[1]));
    first.view.rows = before; first.view.before = before; first.view.lastTurn = []; first.view.seq = 1;
    const second = JSON.parse(JSON.stringify(first));
    second.view.before = before;
    second.view.rows = [[c(12), c(18)], [c(3), c(7)], [c(38)], [c(44)]];
    second.view.lastTurn = [{ kind: 'place', by: 1, n: 18, p: pen(18), row: 0, took: 0 }, { kind: 'place', by: 2, n: 7, p: pen(7), row: 1, took: 0 }];
    second.view.seq = 2;
    second.view.after = second.view.rows;
    const { page, ctx } = await open([first]);
    await page.evaluate((m) => window.__push(m), second);
    await page.waitForTimeout(3000);
    const got = await heard(page);
    await ctx.close();
    const cards = got.filter((n) => n === 'card').length;
    assert.equal(cards, 2, `expected one card sound per landed card (2), got ${cards}: ${got.join(' ') || 'none'}`);
  });

  await check('a friend request arriving plays the notify cue once', async () => {
    incoming = [];
    const { page, ctx } = await open([welcome({ id: 'me', name: 'Aarav', games: [] })]);
    incoming = [{ id: 'r1', username: 'bo', display_name: 'Bo', avatar: '🦊' }];
    await page.click('.tb-avatar-btn');
    await page.locator('.menu-item[data-act="openFriendsPage"]').click({ force: true });
    await page.waitForTimeout(700);
    const got = (await heard(page)).filter((n) => n === 'notify').length;
    await ctx.close();
    incoming = [];
    assert.equal(got, 1, `expected one notify cue, got ${got}`);
  });

  await check('the level-up note plays the fanfare once, when it first appears', async () => {
    progressLevel = 1;
    const hello = welcome({ id: 'me', name: 'Aarav', username: 'aarav', games: [] });
    const { page, ctx } = await open([hello]); // level 1 is the level this device has seen
    progressLevel = 2;
    await page.evaluate((m) => window.__push(m), hello); // a welcome again asks for the level: now 2
    await page.waitForTimeout(800);
    const got = (await heard(page)).filter((n) => n === 'fanfare').length;
    await page.evaluate((m) => window.__push(m), hello);
    await page.waitForTimeout(800);
    const again = (await heard(page)).filter((n) => n === 'fanfare').length;
    await ctx.close();
    progressLevel = 1;
    assert.equal(got, 1, `expected one fanfare for the new level, got ${got}`);
    assert.equal(again, 1, `the same level-up note does not play the fanfare again, got ${again} in total`);
  });

  await browser.close(); server.close();
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log('\nsound coverage: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
