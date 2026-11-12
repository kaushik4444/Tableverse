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
const insightsFixture = (days, zone) => ({ ok: true, days, zone, labels: ['2026-11-08', '2026-11-09', '2026-11-10'],
  games: [{ gameId: 'ludo', matches: 12, avgMinutes: 21.4, avgSeats: 3.2, withLeaver: 3, draws: 0, humans: 30, leftEarly: 4, started: 16, finished: 12 }, { gameId: 'tictactoe', matches: 5, avgMinutes: 2.1, avgSeats: 2, withLeaver: 0, draws: 2, humans: 10, leftEarly: 0, started: 5, finished: 5 }],
  heat: [{ dow: 5, hour: 20, matches: 4, playerGames: 11 }, { dow: 6, hour: 21, matches: 3, playerGames: 7 }],
  playtime: { players: 9, totalMinutes: 310, avgMinutes: 34.4, medianMinutes: 22, buckets: [2, 3, 2, 1, 1] },
  returning: { activePlayers: 9, newPlayers: 5, returningPlayers: 4, newPerDay: [2, 3, 0], returningPerDay: [0, 1, 3], cohort: { size: 4, d1: 2, d7: 3 } },
  visits: { zone, byHour: Array.from({ length: 24 }, (_, h) => (h === 19 ? 30 : 1)), length: [{ name: 'under 1 min', total: 5 }, { name: '1–5 min', total: 9 }, { name: '5–15 min', total: 7 }, { name: '15–60 min', total: 4 }, { name: 'over 1 h', total: 1 }] },
  countryEngagement: { minPlayers: 10, rows: [{ country: 'DE', players: 12, gamesPerPlayer: 4.5, minutesPerPlayer: 38.2, leftEarlyPct: 8, daysPerPlayer: 2.1 }] },
  countries: [{ country: 'DE', players: 5 }, { country: 'IN', players: 3 }, { country: null, players: 1 }],
  top: [{ username: 'ann', displayName: 'Ann', games: 14, wins: 6, minutes: 130, peakHour: 20 }] });
const playersFixture = (sort, total = 1) => ({ ok: true, total, pageSize: 25, sort, players: [{ username: 'ann', displayName: 'Ann', country: 'DE', role: 'user', joinedAt: '2026-11-01T10:00:00Z', lastSeenAt: '2026-11-08T09:00:00Z', suspended: false, games: 14, rated: 11, wins: 6, draws: 1, leftEarly: 2, minutes: 130, lastGameAt: '2026-11-08T08:00:00Z' }] });
// the Right now figures: a test changes these between refreshes; `fail` makes the next answer an error
const live = { players: 3, tables: 1, sockets: 4, fail: false };
const liveFixture = () => (live.fail ? { __status: 500, body: { ok: false } } : { ok: true, at: new Date().toISOString(), players: live.players, tables: live.tables, sockets: live.sockets });
const api = (role) => ({
  'GET /api/admin/live': () => liveFixture(),
  'GET /api/auth/csrf': () => ({ ok: true, csrfToken: 'tok' }),
  'GET /api/admin/me': () => ({ ok: true, role, isAdmin: role !== 'user', isOwner: role === 'owner' }),
  'GET /api/admin/insights?days=7&tz=UTC': () => insightsFixture(7, 'UTC'),
  'GET /api/admin/insights?days=30&tz=UTC': () => insightsFixture(30, 'UTC'),
  'GET /api/admin/insights?days=7&tz=Asia%2FKolkata': () => insightsFixture(7, 'Asia/Kolkata'),
  'GET /api/admin/players?q=&sort=seen&page=1': () => playersFixture('seen'),
  'GET /api/admin/players?q=&sort=games&page=1': () => playersFixture('games'),
  'GET /api/admin/players?q=&sort=wins&page=1': () => playersFixture('wins', 40),
  'GET /api/admin/players?q=&sort=wins&page=2': () => playersFixture('wins', 40),
  'GET /api/admin/players/profile?username=ann': () => ({ ok: true, player: { username: 'ann', displayName: 'Ann', country: 'DE', role: 'user', verified: true, joinedAt: '2026-11-01T10:00:00Z', lastSeenAt: '2026-11-08T09:00:00Z', suspended: false },
    totals: { games: 14, rated: 11, wins: 6, draws: 1, losses: 4, leftEarly: 2, minutes: 130, activeDays: 5, firstGameAt: '2026-11-02T10:00:00Z', lastGameAt: '2026-11-08T08:00:00Z' },
    perGame: [{ gameId: 'ludo', games: 10, rated: 7, wins: 4, draws: 0, leftEarly: 2, minutes: 120 }],
    hourly: { UTC: Array.from({ length: 24 }, (_, h) => (h === 19 ? 9 : 0)), 'Europe/Berlin': Array.from({ length: 24 }, (_, h) => (h === 20 ? 9 : 0)), 'Asia/Kolkata': Array.from({ length: 24 }, (_, h) => (h === 0 ? 9 : 0)) },
    recent: [{ gameId: 'ludo', at: '2026-11-08T08:00:00Z', seats: 4, won: true, draw: false, leftEarly: false, unknown: false, minutes: 22 },
      { gameId: 'ludo', at: '2026-11-07T08:00:00Z', seats: 4, won: false, draw: false, leftEarly: false, unknown: true, minutes: 18 }] }),
  'GET /api/admin/overview?days=30': () => ({ ok: true, days: 30, labels: ['2026-11-08', '2026-11-09', '2026-11-10'], activeDaily: [3, 7, 5], series: { error: [0, 2, 1], session: [1, 5, 2], game_finished: [0, 2, 1], registration: [0, 1, 0] }, totals: { registration: 4, session: 8, game_finished: 3, error: 1 }, active: { dau: 2, wau: 5, mau: 9 }, accounts: { registered: 12, registered_24h: 1, staff: 2 }, popularGames: [{ name: 'wizard', total: 3 }], startedGames: [], errors: [{ name: 'ws_handler', total: 1 }], retention: { activeDays: 35, dailyDays: 400 } }),
  'GET /api/admin/overview?days=7': () => ({ ok: true, days: 7, labels: ['2026-11-08', '2026-11-09', '2026-11-10'], activeDaily: [3, 7, 5], series: { error: [0, 2, 1], session: [1, 5, 2], game_finished: [0, 2, 1], registration: [0, 1, 0] }, totals: { registration: 4, session: 8, game_finished: 3, error: 1 }, active: { dau: 2, wau: 5, mau: 9 }, accounts: { registered: 12, registered_24h: 1, staff: 2 }, popularGames: [{ name: 'wizard', total: 3 }], startedGames: [], errors: [{ name: 'ws_handler', total: 1 }], retention: { activeDays: 35, dailyDays: 400 } }),
  'GET /api/admin/users?q=&page=1': () => ({ ok: true, total: 3, pageSize: 25, users: [U({ id: 'u1', display_name: EVIL }), U({ id: 'u2', username: 'bob', display_name: 'Bob', role: 'admin' }), U({ id: 'u3', username: 'own', display_name: 'Owner', role: 'owner' })] }),
  'GET /api/admin/feedback?status=&page=1': () => ({ ok: true, total: 1, pageSize: 25, items: [{ id: 'f1', category: 'bug', status: 'new', message: EVIL, created_at: '2026-11-08T08:00:00Z', username: null }] }),
  'GET /api/admin/announcements': () => ({ ok: true, limits: { maxMessage: 200, maxDays: 90 }, items: [{ id: 'a1', message: EVIL, level: 'info', audience: 'all', status: 'live', starts_at: '2026-11-08T08:00:00Z', ends_at: '2026-11-09T08:00:00Z', ended_at: null }] }),
  'GET /api/admin/health': () => ({ ok: true, platform: { uptimeSec: 4000, sockets: 3, players: 2, rooms: 1, memoryMb: 90, mode: 'postgres', node: 'v22' }, db: { ok: true, dbMs: 4, migrations: 13, feedback_new: 1 }, analytics: { enabled: true, buffered: 2, failures: 0, dropped: 0 } }),
  'GET /api/admin/logs?level=&component=&event=&limit=100': () => ({ ok: true, held: 2, dropped: 0, capacity: 500, items: [{ time: '2026-11-08T08:00:00Z', level: 'error', component: 'db', event: 'db.pool_error', message: EVIL }, { time: '2026-11-08T07:00:00Z', level: 'info', component: 'app', event: 'server.started', port: 3000 }] }),
  'GET /api/admin/audit?page=1': () => ({ ok: true, total: 1, pageSize: 25, items: [{ id: 'x', at: '2026-11-08T08:00:00Z', actor: 'boss', action: 'role.grant_admin', target_type: 'player', target_id: 'abcdef1234', detail: { to: 'admin' } }] }),
  'POST /api/admin/announcements': () => ({ ok: true, announcement: { id: 'a2' } }),
  'GET /api/admin/broadcasts': () => ({ ok: true, total: 1, pageSize: 25, items: [{ id: 'b1', created_at: '2026-11-08T08:00:00Z', audience: 'all', category: 'promo', subject: `${EVIL}`, status: 'sent', recipient_count: 6, sent_count: 5, failed_count: 1, created_by: 'boss' }] }),
  'GET /api/admin/broadcasts/preview?audience=all&category=account': () => ({ ok: true, count: 6 }),
  'GET /api/admin/broadcasts/preview?audience=verified&category=account': () => ({ ok: true, count: 5 }),
  'POST /api/admin/broadcasts': () => ({ ok: true, id: 'b2', recipientCount: 6 }),
  'GET /api/admin/render-logs?text=&limit=100': () => ({ ok: true, configured: false, items: [] }),
  'GET /api/admin/users/lookup?username=ann': () => ({ ok: true, user: { id: 'u1', username: 'ann', display_name: 'Ann', role: 'user', verified: true, created_at: '2026-11-01T10:00:00Z', last_seen_at: '2026-11-08T09:00:00Z', suspended_at: '2026-11-09T09:00:00Z', suspended_reason: 'spam', active_sessions: 0 } }),
  'POST /api/admin/users/suspend': () => ({ ok: true, suspended: true, sessions: 1 }),
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
    for (const [name, text] of [['users', /Users/], ['feedback', /Feedback/], ['announcements', /Announcements/], ['health', /Platform health/], ['logs', /Logs/], ['audit', /role\.grant_admin/]]) {
      await tab(s.page, name);
      await until(async () => text.test(await s.page.textContent('#adMain')), name);
    }
    assert.deepEqual(s.errors, []);
    await s.close();
  });
  await test('the overview draws three line charts with data tables, and the range buttons ask for that range', async () => {
    const s = await open('admin');
    await s.page.waitForSelector('.ad-grid');
    assert.equal(await s.page.locator('.ad-chart svg').count(), 3, 'active players, registrations and errors');
    assert.equal(await s.page.locator('.ad-chart table').count(), 3, 'each chart has its data table');
    assert.equal(await s.page.locator('[data-days="30"][aria-pressed="true"]').count(), 1, '30 days is the default');
    await s.page.click('[data-days="7"]');
    await until(() => s.calls.some((c) => /overview\?days=7/.test(c.path)), 'the 7-day range is requested');
    await s.page.waitForSelector('[data-days="7"][aria-pressed="true"]');
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
  await test('the date fields are selectable at once; picking one chooses custom dates and sends it as such', async () => {
    const s = await open('admin'); await tab(s.page, 'announcements'); await s.page.waitForSelector('#aForm');
    await s.page.fill('#aForm textarea', 'Picked a date');
    assert.equal(await s.page.$eval('[name="startsAt"]', (el) => el.disabled), false, 'start is not disabled');
    assert.equal(await s.page.$eval('[name="endsAt"]', (el) => el.disabled), false, 'end is not disabled');
    await s.page.fill('[name="startsAt"]', '2030-01-02T10:00');
    await s.page.dispatchEvent('[name="startsAt"]', 'change');
    assert.equal(await s.page.$eval('[name="preset"]', (el) => el.value), 'custom', 'a picked date switches to custom');
    await s.page.fill('[name="endsAt"]', '2030-01-03T10:00');
    await s.page.dispatchEvent('[name="endsAt"]', 'change');
    await s.page.click('#aGo');
    const post = await until(() => s.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/announcements'), 'POST');
    const body = JSON.parse(post.body);
    // the selected wall-clock times, converted to UTC by the browser itself (its own time zone), must be exactly what is sent
    const expectStart = await s.page.evaluate(() => new Date('2030-01-02T10:00').toISOString());
    const expectEnd = await s.page.evaluate(() => new Date('2030-01-03T10:00').toISOString());
    assert.equal(body.startsAt, expectStart, 'start is the selected instant');
    assert.equal(body.endsAt, expectEnd, 'end is the selected instant');
    assert.ok(!('durationHours' in body), 'no preset duration is sent');
    await s.close();
  });
  await test('Right now: figures show, refresh every 15 seconds, one loop after a range change, stop on a tab change, and say so on an error', async () => {
    live.players = 3; live.tables = 1; live.sockets = 4; live.fail = false;
    const { server, url, calls } = await serve(api('admin'));
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install();
    await page.goto(url + '/admin.html');
    const first = () => page.locator('#liveNow .ad-card b').first().textContent();
    const liveCalls = () => calls.filter((c) => /\/api\/admin\/live/.test(c.path)).length;
    await until(async () => (await first()) === '3', 'the first figures');
    live.players = 5;
    await page.clock.runFor(15000);
    await until(async () => (await first()) === '5', 'figures refreshed after 15 seconds');
    // a range change draws the overview again and starts one loop; the old loop must not keep polling beside it
    await page.click('[data-days="7"]');
    await until(() => calls.some((c) => /overview\?days=7/.test(c.path)), 'the 7-day range is requested');
    await page.waitForSelector('[data-days="7"][aria-pressed="true"]');
    await until(async () => (await first()) === '5', 'figures shown after the redraw');
    const mark = liveCalls();
    await page.clock.runFor(15000);
    await sleep(400);
    assert.equal(liveCalls() - mark, 1, 'exactly one refresh per 15 seconds after the redraw');
    // a tab change takes the block off the page and the polling stops
    await tab(page, 'users');
    await page.waitForFunction(() => !document.getElementById('liveNow'));
    const left = liveCalls();
    await page.clock.runFor(60000);
    await sleep(400);
    assert.equal(liveCalls(), left, 'no refresh once Overview is left');
    // back on Overview, a failed refresh says so instead of showing old figures
    await tab(page, 'overview');
    await page.waitForSelector('#liveNow .ad-card b');
    live.fail = true;
    await page.clock.runFor(15000);
    await until(async () => (await page.textContent('#liveNow')).includes('could not load right now'), 'the error message');
    assert.deepEqual(errors, []);
    await ctx.close(); server.close();
  });
  await test('insights shows the figures, a heatmap with a table fallback, and the range and zone buttons ask again', async () => {
    const s = await open('admin');
    await s.page.waitForSelector('.ad-grid');
    await tab(s.page, 'insights');
    await s.page.waitForSelector('.ad-heat');
    const text = await s.page.textContent('#adMain');
    assert.match(text, /Insights/); assert.match(text, /ludo/); assert.match(text, /Busiest hour overall: 20:00/); assert.match(text, /@ann/); assert.match(text, /Germany/); assert.match(text, /Not set/); assert.match(text, /When people open the site/); assert.match(text, /Busiest around 19:00/); assert.match(text, /How long a visit lasts/); assert.match(text, /5–15 min/); assert.match(text, /How players from each country play/); assert.match(text, /not everyone/);
    assert.equal(await s.page.locator('.ad-hc').count(), 168, 'seven days of 24 hours');
    await s.page.click('[data-days="7"]');
    await s.page.click('[data-zone="Asia/Kolkata"]');
    await until(() => s.calls.some((c) => /insights\?days=7&tz=Asia%2FKolkata/.test(c.path)), 'range and zone are sent');
    await s.page.waitForSelector('[data-zone="Asia/Kolkata"][aria-pressed="true"]');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
  await test('overview charts errors per day next to the errors by kind', async () => {
    const s = await open('admin');
    await s.page.waitForSelector('.ad-grid');
    const text = await s.page.textContent('#adMain');
    assert.match(text, /Errors per day/); assert.match(text, /Errors by kind/);
    await s.close();
  });
  await test('players: the directory lists registered players, sorts, opens a profile with a per-game table, and switches zone without asking again', async () => {
    const s = await open('admin');
    await s.page.waitForSelector('.ad-grid');
    await tab(s.page, 'players');
    await s.page.waitForSelector('[data-view="ann"]');
    assert.match(await s.page.textContent('#adMain'), /1 registered/);
    await s.page.click('[data-sort="games"]');
    await s.page.waitForSelector('[data-sort="games"][aria-pressed="true"]');
    await s.page.click('[data-view="ann"]');
    await s.page.waitForSelector('#pBack');
    const text = await s.page.textContent('#adMain');
    assert.match(text, /Germany/); assert.match(text, /ludo/); assert.match(text, /Usually starts around 19:00/);
    assert.match(text, /result not recorded/, 'a game with no recorded result is not shown as a loss');
    assert.match(text, /60%/, 'win rate is wins over rated games without draws: 6 of 10');
    const asked = () => s.calls.filter((c) => /players\/profile/.test(c.path)).length;
    const before = asked();
    await s.page.click('[data-zone="Europe/Berlin"]');
    await s.page.waitForFunction(() => /around 20:00/.test(document.getElementById('adMain').textContent));
    assert.equal(asked(), before, 'a zone switch redraws from the same answer, so it is not audited again');
    assert.equal(await s.page.locator('.ad-col').count(), 24);
    await s.page.click('#pBack');
    await s.page.waitForSelector('[data-view="ann"]');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
  await test('players: going back from a profile returns to the page of the list that was open (not page 1)', async () => {
    const s = await open('admin');
    await s.page.waitForSelector('.ad-grid');
    await tab(s.page, 'players');
    await s.page.waitForSelector('[data-view="ann"]');
    await s.page.click('[data-sort="wins"]');
    await s.page.waitForSelector('[data-sort="wins"][aria-pressed="true"]');
    await s.page.click('#pNext');
    await s.page.waitForFunction(() => /Page 2 of 2/.test(document.getElementById('adMain').textContent));
    await s.page.click('[data-view="ann"]');
    await s.page.waitForSelector('#pBack');
    const mark = s.calls.length;
    await s.page.click('#pBack');
    await s.page.waitForFunction(() => /Page 2 of 2/.test(document.getElementById('adMain').textContent));
    assert.ok(s.calls.slice(mark).some((c) => /players\?q=&sort=wins&page=2/.test(c.path)), 'the list is asked for page 2 again');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
  await test('on a 360px phone no tab scrolls sideways and tap targets are at least 40px', async () => {
    const s = await open('owner', { width: 360, height: 740 });
    await s.page.waitForSelector('.ad-grid');
    for (const name of ['overview', 'insights', 'players', 'users', 'feedback', 'announcements', 'health', 'audit']) {
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

  await test('e-mail: the tab is shown to the owner only, and the owner\'s history shows stored text as text', async () => {
    const a = await open('admin'); await a.page.waitForSelector('#adTabs:not([hidden])');
    assert.equal(await a.page.locator('[data-tab="email"]').isVisible(), false, 'admins do not see the e-mail tab');
    await a.close();
    const o = await open('owner'); await o.page.waitForSelector('#adTabs:not([hidden])');
    assert.equal(await o.page.locator('[data-tab="email"]').isVisible(), true);
    await tab(o.page, 'email'); await o.page.waitForSelector('#mailForm');
    await o.page.waitForSelector('#mHistory table');
    assert.equal(await o.page.locator('#mHistory img').count(), 0, 'no markup from a subject runs');
    await o.close();
  });
  await test('e-mail: the send stays locked until the recipient count is checked and typed; changing the audience resets it', async () => {
    const o = await open('owner'); await tab(o.page, 'email'); await o.page.waitForSelector('#mailForm');
    assert.equal(await o.page.isDisabled('#mSend'), true, 'locked at first');
    await o.page.fill('#mSub', 'Diwali offer'); await o.page.fill('#mBody', 'Happy Diwali from Tableverse');
    assert.equal(await o.page.isDisabled('#mConfirm'), true, 'the confirmation waits for a check');
    await o.page.click('#mCheck');
    await o.page.waitForSelector('#mCount:has-text("6 recipients")');
    assert.equal(await o.page.isDisabled('#mConfirm'), false);
    assert.equal(await o.page.isDisabled('#mSend'), true, 'still locked until the count is typed');
    await o.page.fill('#mConfirm', '5');
    assert.equal(await o.page.isDisabled('#mSend'), true, 'a wrong count keeps it locked');
    await o.page.fill('#mConfirm', '6');
    assert.equal(await o.page.isDisabled('#mSend'), false);
    await o.page.selectOption('#mAud', 'verified');
    assert.equal(await o.page.isDisabled('#mSend'), true, 'a changed audience needs a new check');
    assert.equal(await o.page.inputValue('#mConfirm'), '');
    await o.close();
  });
  await test('e-mail: the queued send carries the count the owner confirmed; the form then clears', async () => {
    const o = await open('owner'); await tab(o.page, 'email'); await o.page.waitForSelector('#mailForm');
    await o.page.fill('#mSub', 'Release 2'); await o.page.fill('#mBody', 'New table themes are out');
    await o.page.click('#mCheck'); await o.page.waitForSelector('#mCount:has-text("6 recipients")');
    await o.page.fill('#mConfirm', '6');
    await o.page.click('#mSend');
    await o.page.waitForSelector('#mMsg:has-text("Queued for 6")');
    const post = o.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/broadcasts');
    assert.ok(post, 'the POST was sent');
    const body = JSON.parse(post.body);
    assert.deepEqual([body.audience, body.category, body.expectedCount], ['all', 'account', 6]);
    assert.equal(body.subject, 'Release 2');
    assert.equal(await o.page.inputValue('#mSub'), '', 'the form is cleared after queuing');
    await o.close();
  });

  await test('users: sign-out and suspension are owner only; an admin sees neither; lookup shows the state of an account', async () => {
    const a = await open('admin'); await tab(a.page, 'users'); await a.page.waitForSelector('.ad-t');
    assert.equal(await a.page.locator('[data-so]').count(), 0, 'admins cannot sign players out');
    assert.equal(await a.page.locator('[data-susp]').count(), 0, 'admins cannot suspend');
    await a.close();
    const o = await open('owner'); await tab(o.page, 'users'); await o.page.waitForSelector('.ad-t');
    assert.ok(await o.page.locator('[data-so]').count() >= 1, 'the owner can sign out');
    assert.ok(await o.page.locator('[data-susp]').count() >= 1, 'the owner can suspend an ordinary player');
    await o.page.fill('#lookupForm input', 'ann'); await o.page.click('#lookupForm button');
    await o.page.waitForSelector('#lookupOut:has-text("Suspended")');
    assert.equal(await o.page.locator('#lookupOut').innerText().then((t) => t.includes('@ann')), true);
    assert.equal(await o.page.locator('#lookupOut').innerText().then((t) => /@.*\.(com|test)|@example/.test(t)), false, 'no address shown');
    await o.close();
  });

  await test('logs: Render history is owner only and says when it is not set up', async () => {
    const o = await open('owner'); await tab(o.page, 'logs'); await o.page.waitForSelector('#rHist:has-text("not set up")');
    await o.close();
    const a = await open('admin'); await tab(a.page, 'logs'); await a.page.waitForSelector('.ad-t');
    assert.equal(await a.page.locator('#rHistWrap').count(), 0, 'admins do not see Render history');
    assert.equal(a.calls.some((c) => c.path.startsWith('/api/admin/render-logs')), false, 'and nothing is requested for them');
    await a.close();
  });

  await browser.close();
  console.log(`\n${passed} admin UI tests passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed) process.exit(1);
})();
