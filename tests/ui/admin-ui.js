'use strict';
// Admin console and banners in a real browser (Chromium) against a mocked API: tabs, owner-only controls, escaping of stored
// text, CSRF header on every POST, phone layout (no sideways scroll), and the home banners (dismissal, feedback form).
// The server-side rules are tested in tests/admin.test.js; this checks what the page shows and sends.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk, welcome } = require('./harness');
const { chromium } = loadPlaywright();

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(50); } }

const EVIL = '<img src=x onerror="window.__xss=1"> <b>bold</b>';
const U = (o) => ({ id: 'u1', username: 'ann', display_name: 'Ann', role: 'user', is_anonymous: false, verified: true, created_at: '2026-11-01T10:00:00Z', last_seen_at: '2026-11-08T09:00:00Z', ...o });
const api = (role) => ({
  'GET /api/auth/csrf': () => ({ ok: true, csrfToken: 'tok' }),
  'GET /api/admin/me': () => ({ ok: true, role, isAdmin: role !== 'user', isOwner: role === 'owner' }),
  'GET /api/admin/overview?days=30': () => ({ ok: true, days: 30, labels: [], series: { session: [1, 5, 2], game_finished: [0, 2, 1] }, totals: { registration: 4, session: 8, game_finished: 3, error: 1 }, active: { dau: 2, wau: 5, mau: 9 }, accounts: { registered: 12, registered_24h: 1, staff: 2 }, popularGames: [{ name: 'wizard', total: 3 }], startedGames: [], errors: [{ name: 'ws_handler', total: 1 }], retention: { activeDays: 35, dailyDays: 400 } }),
  'GET /api/admin/users?q=&page=1': () => ({ ok: true, total: 3, pageSize: 25, users: [U({ id: 'u1', display_name: EVIL }), U({ id: 'u2', username: 'bob', display_name: 'Bob', role: 'admin' }), U({ id: 'u3', username: 'own', display_name: 'Owner', role: 'owner' })] }),
  'GET /api/admin/feedback?status=&page=1': () => ({ ok: true, total: 1, pageSize: 25, items: [{ id: 'f1', category: 'bug', status: 'new', message: EVIL, created_at: '2026-11-08T08:00:00Z', username: null }] }),
  'GET /api/admin/announcements': () => ({ ok: true, limits: { maxMessage: 200, maxDays: 90 }, items: [{ id: 'a1', message: EVIL, level: 'info', audience: 'all', status: 'live', starts_at: '2026-11-08T08:00:00Z', ends_at: '2026-11-09T08:00:00Z', ended_at: null }] }),
  'GET /api/admin/health': () => ({ ok: true, platform: { uptimeSec: 4000, sockets: 3, players: 2, rooms: 1, memoryMb: 90, mode: 'postgres', node: 'v22' }, db: { ok: true, dbMs: 4, migrations: 13, feedback_new: 1 }, analytics: { enabled: true, buffered: 2, failures: 0, dropped: 0 } }),
  'GET /api/admin/audit?page=1': () => ({ ok: true, total: 1, pageSize: 25, items: [{ id: 'x', at: '2026-11-08T08:00:00Z', actor: 'boss', action: 'role.grant_admin', target_type: 'player', target_id: 'abcdef1234', detail: { to: 'admin' } }] }),
  'POST /api/admin/announcements': () => ({ ok: true, announcement: { id: 'a2' } }),
});

(async () => {
  const browser = await chromium.launch();
  const open = async (role, viewport = { width: 1100, height: 800 }) => {
    const { server, url, calls } = await serve(api(role));
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 800 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(url + '/admin.html');
    return { page, ctx, server, calls, errors, close: async () => { await ctx.close(); server.close(); } };
  };
  const tab = (p, name) => p.click(`[data-tab="${name}"]`);

  await test('a non-admin sees no console and no admin data is requested', async () => {
    const s = await open('user');
    await s.page.waitForSelector('.ad-msg.err');
    assert.match(await s.page.textContent('#adMain'), /administrators/);
    assert.equal(await s.page.isHidden('#adTabs'), true);
    assert.ok(!s.calls.some((c) => /overview|users|feedback/.test(c.path)));
    await s.close();
  });
  await test('an admin sees the overview and every tab renders', async () => {
    const s = await open('admin');
    await s.page.waitForSelector('.ad-grid');
    assert.match(await s.page.textContent('#adMain'), /active today/);
    for (const [name, text] of [['users', /Users/], ['feedback', /Feedback/], ['announcements', /Announcements/], ['health', /Platform health/], ['audit', /role\.grant_admin/]]) {
      await tab(s.page, name);
      await until(async () => text.test(await s.page.textContent('#adMain')), name);
    }
    assert.deepEqual(s.errors, []);
    await s.close();
  });
  await test('stored text is shown as text: no markup runs from names, feedback or announcements', async () => {
    const s = await open('owner');
    for (const name of ['users', 'feedback', 'announcements']) { await tab(s.page, name); await s.page.waitForSelector('#adMain .ad-t, #adMain .ad-card'); }
    await tab(s.page, 'users');
    await until(async () => (await s.page.textContent('#adMain')).includes('<img src=x'), 'escaped name');
    assert.equal(await s.page.evaluate(() => window.__xss), undefined);
    assert.equal(await s.page.$('#adMain img'), null);
    await s.close();
  });
  await test('role controls: the owner sees them (not for the owner row); an admin sees none', async () => {
    const o = await open('owner'); await tab(o.page, 'users'); await o.page.waitForSelector('.ad-t');
    assert.equal(await o.page.locator('[data-role="admin"]').count(), 1);
    assert.equal(await o.page.locator('[data-role="user"]').count(), 1);
    assert.equal(await o.page.locator('tr:has-text("Owner") [data-role]').count(), 0, 'no role control on the owner');
    await o.close();
    const a = await open('admin'); await tab(a.page, 'users'); await a.page.waitForSelector('.ad-t');
    assert.equal(await a.page.locator('[data-role]').count(), 0);
    assert.equal(await a.page.locator('tr:has-text("Bob") button').count(), 0, 'an admin cannot act on another admin');
    await a.close();
  });
  await test('publishing a 1-day announcement posts the preset (the CSRF header is covered by tests/admin.test.js)', async () => {
    const s = await open('admin'); await tab(s.page, 'announcements'); await s.page.waitForSelector('#aForm');
    await s.page.fill('#aForm textarea', 'Maintenance tonight');
    await s.page.click('#aGo');
    const post = await until(() => s.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/announcements'), 'POST');
    assert.deepEqual(JSON.parse(post.body), { message: 'Maintenance tonight', level: 'info', audience: 'all', durationHours: 24 });
    await s.close();
  });
  await test('custom dates are sent as UTC instants', async () => {
    const s = await open('admin'); await tab(s.page, 'announcements'); await s.page.waitForSelector('#aForm');
    await s.page.fill('#aForm textarea', 'Later');
    await s.page.selectOption('[name="preset"]', 'custom');
    await s.page.click('#aGo');
    const post = await until(() => s.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/announcements'), 'POST');
    const b = JSON.parse(post.body);
    assert.match(b.startsAt, /Z$/); assert.match(b.endsAt, /Z$/); assert.ok(!('durationHours' in b));
    await s.close();
  });
  await test('on a 360px phone no tab scrolls sideways and tap targets are at least 40px', async () => {
    const s = await open('owner', { width: 360, height: 740 });
    await s.page.waitForSelector('.ad-grid');
    for (const name of ['overview', 'users', 'feedback', 'announcements', 'health', 'audit']) {
      await tab(s.page, name); await sleep(150);
      const over = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `${name} overflows by ${over}px`);
    }
    await tab(s.page, 'users'); await s.page.waitForSelector('.ad-t');
    const small = await s.page.evaluate(() => [...document.querySelectorAll('button, input, select')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.outerHTML.slice(0, 60)));
    assert.deepEqual(small, []);
    await s.close();
  });

  // ---- banners and feedback on the home page of the main app
  const homeApi = (banners, signedIn) => ({
    'GET /api/auth/session': () => (signedIn ? sessionOk() : { ok: true, authenticated: false, csrfToken: 'tok' }),
    'GET /api/auth/csrf': () => ({ ok: true, csrfToken: 'tok' }),
    'GET /api/games': () => ({ ok: true, games: [], tables: [], announcement: 'Legacy banner' }),
    'GET /api/announcements': () => ({ ok: true, signedIn, announcements: banners }),
    'GET /api/admin/me': () => ({ ok: true, role: 'admin', isAdmin: true, isOwner: false }),
  });
  const BANNERS = [{ id: 'b1', revision: 1, message: 'Server restart at noon', level: 'warning', endsAt: '2026-11-09T00:00:00Z' }, { id: 'b2', revision: 1, message: EVIL, level: 'info', endsAt: '2026-11-09T00:00:00Z' }];
  await test('a guest sees managed banners next to the legacy one, dismisses one, and it stays dismissed in this browser', async () => {
    const { server, url } = await serve(homeApi(BANNERS, false));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(url + '/');
    await page.waitForSelector('.notice-bar.notice-warning');
    assert.equal(await page.locator('.notice-bar').count(), 3);
    assert.match(await page.textContent('.notice-bar'), /Server restart at noon|Legacy banner/);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.notice-bar img').count(), 0, 'banner text is escaped');
    await page.click('[data-act="dismissBanner"][data-id="b1"]');
    assert.equal(await page.locator('.notice-warning').count(), 0);
    await page.reload();
    await page.waitForSelector('.notice-bar.notice-info');
    assert.equal(await page.locator('.notice-warning').count(), 0, 'remembered by this browser');
    await ctx.close(); server.close();
  });
  // A guest who dismissed under the earlier format (`id:text`) keeps no hidden banner: the old key is never read.
  async function guestWithOldKey(banners, oldEntries, selector, message) {
    const { server, url } = await serve(homeApi(banners, false));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript((entries) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ct_ann_ids', JSON.stringify(entries)); sessionStorage.setItem('seeded', '1'); } } catch { /* no storage */ } }, oldEntries);
    await page.goto(url + '/');
    await page.waitForSelector(selector);
    assert.equal(await page.locator(selector).count(), 1, 'the banner shows: the old entry is not read');
    // the text is "<level icon> <message>": the message must be the whole trailing text ("12" is not "2")
    const shown = (await page.textContent(`${selector} > span`)).trim();
    assert.ok(shown === message || shown.endsWith(' ' + message), `shows "${message}", got "${shown}"`);
    await page.click(`[data-act="dismissBanner"][data-id="b1"]`);
    assert.equal(await page.evaluate(() => localStorage.getItem('ct_ann_ids')), null, 'the old key is removed');
    assert.equal(await page.evaluate(() => localStorage.getItem('ct_ann_rev')), '["b1:' + banners[0].revision + '"]', 'the new dismissal is stored with its revision');
    await page.reload();
    await page.waitForSelector('.notice-bar.notice-info');
    assert.equal(await page.locator(selector).count(), 0, 'the new dismissal survives a reload');
    await ctx.close(); server.close();
  }
  await test('a guest entry from before revisions (id and text) does not hide the banner; a new revision dismissal survives reload', async () => {
    await guestWithOldKey(BANNERS, ['b1:Server restart at noon'], '.notice-warning', 'Server restart at noon');
  });
  await test('an old guest entry whose text is exactly "2" cannot hide revision 2 of a banner', async () => {
    const TWO = [{ id: 'b1', revision: 2, message: '2', level: 'warning', endsAt: '2026-11-09T00:00:00Z' }, { id: 'b2', revision: 1, message: 'Other notice', level: 'info', endsAt: '2026-11-09T00:00:00Z' }];
    await guestWithOldKey(TWO, ['b1:2'], '.notice-warning', '2');
  });
  // A guest's dismissal of revision 2 must hide revision 2 and any older copy a stale server instance still sends; a newer revision shows.
  async function guestWithStoredRevision(banner, storedEntry) {
    // a second, always-shown info banner marks the moment the list has loaded
    const marker = { id: 'b9', revision: 1, message: 'List loaded', level: 'info', endsAt: '2026-11-09T00:00:00Z' };
    const { server, url } = await serve(homeApi([banner, marker], false));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript((entry) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ct_ann_rev', JSON.stringify([entry])); sessionStorage.setItem('seeded', '1'); } } catch { /* no storage */ } }, storedEntry);
    await page.goto(url + '/');
    await page.waitForSelector('.notice-info');
    const shown = await page.locator('.notice-warning').count();
    await ctx.close(); server.close();
    return shown;
  }
  await test('a guest dismissal of revision 2 hides a stale revision 1 from a cache; a newer revision 3 still shows', async () => {
    const endsAt = '2026-11-09T00:00:00Z';
    assert.equal(await guestWithStoredRevision({ id: 'b1', revision: 1, message: 'Stale copy', level: 'warning', endsAt }, 'b1:2'), 0, 'stale copy hidden');
    assert.equal(await guestWithStoredRevision({ id: 'b1', revision: 3, message: 'Newer copy', level: 'warning', endsAt }, 'b1:2'), 1, 'newer revision shown');
  });
  await test('with 50 stored guest dismissals, a newer revision of the oldest one is kept as the most recent when another banner is dismissed', async () => {
    const endsAt = '2026-11-09T00:00:00Z';
    const banners = [{ id: 'old0', revision: 2, message: 'Edited banner', level: 'warning', endsAt }, { id: 'fresh', revision: 1, message: 'New banner', level: 'info', endsAt }];
    const stored = Array.from({ length: 50 }, (_, i) => `old${i}:1`);
    const { server, url } = await serve(homeApi(banners, false));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript((entries) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ct_ann_rev', JSON.stringify(entries)); sessionStorage.setItem('seeded', '1'); } } catch { /* no storage */ } }, stored);
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="dismissBanner"][data-id="old0"]'); // revision 2 shows: only revision 1 was dismissed
    await page.click('[data-act="dismissBanner"][data-id="old0"]');
    await page.click('[data-act="dismissBanner"][data-id="fresh"]');
    const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('ct_ann_rev')));
    assert.equal(kept.length, 50, 'the list stays at its limit');
    assert.ok(kept.includes('old0:2'), 'the dismissal that was just updated is not the one trimmed');
    assert.ok(kept.includes('fresh:1'), 'the newest dismissal is kept');
    assert.ok(!kept.includes('old1:1'), 'the oldest untouched entry is trimmed instead');
    await ctx.close(); server.close();
  });
  await test('a signed-in player dismisses on the server (so every device agrees) and gets the feedback form; staff get the Admin entry', async () => {
    const { server, url, calls } = await serve({ ...homeApi(BANNERS, true), 'POST /api/feedback': () => ({ ok: true, message: 'Thank you!' }) });
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [] })] });
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="dismissBanner"]');
    await page.click('[data-act="dismissBanner"][data-id="b1"]');
    const d = await until(() => calls.find((c) => c.path === '/api/announcements/dismiss'), 'dismiss call');
    assert.deepEqual(JSON.parse(d.body), { id: 'b1', revision: 1 }, 'the revision on screen is sent');
    await page.click('[data-act="toggleMenu"]');
    await page.waitForSelector('[data-act="openAdmin"]');
    await page.click('[data-act="openFeedback"]');
    await page.fill('#fbMsg', 'Love it');
    await page.click('#fbForm button[type="submit"]');
    const f = await until(() => calls.find((c) => c.path === '/api/feedback'), 'feedback call');
    assert.deepEqual(JSON.parse(f.body), { category: 'idea', message: 'Love it' });
    await ctx.close(); server.close();
  });
  await test('a signed-in non-staff player gets no Admin entry', async () => {
    const a = homeApi([], true); a['GET /api/admin/me'] = () => ({ ok: true, role: 'user', isAdmin: false, isOwner: false });
    const { server, url } = await serve(a);
    const { page, ctx } = await scriptedPage(browser, { messages: [welcome({ games: [] })] });
    await page.goto(url + '/');
    await page.waitForSelector('[data-act="toggleMenu"]');
    await page.click('[data-act="toggleMenu"]');
    await page.waitForSelector('[data-act="openFeedback"]');
    assert.equal(await page.locator('[data-act="openAdmin"]').count(), 0);
    await ctx.close(); server.close();
  });

  await browser.close();
  console.log(`\n${passed} admin UI tests passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed) process.exit(1);
})();
