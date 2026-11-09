'use strict';
require('./helpers/env');
// Admin console on a REAL PostgreSQL (throw-away database from tests/helpers/testdb.js), through the running server over HTTP:
// the single-owner index, role rules inside transactions, owner bootstrap, audit rows, announcements (expiry and dismissal across
// logins), feedback, analytics storage (hashed actors, upserts, retention) and owner protection. Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const { Browser, registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';
const OWNER_EMAIL = 'boss.admin@test.local';

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  let srv = null;
  try {
    process.env.DATABASE_URL = t.url;
    process.env.ANNOUNCEMENT_CACHE_MS = '0'; // the live-banner list is cached 15 s in production; these tests change rows directly and expect them to apply at once
    const dbAdmin = require('../db/admin');
    const policy = require('../lib/adminPolicy');
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet(), env: { ...process.env, ADMIN_OWNER_EMAIL: OWNER_EMAIL }, announcement: 'Legacy banner' };
    srv = await start(fast);
    let seq = 1;
    const newUser = async (tag, email) => {
      const e = email || `${tag.toLowerCase()}.adm.${seq++}@test.local`;
      const u = await registerAndVerify(srv.port, { email: e, username: `${tag.toLowerCase()}adm${seq}`.slice(0, 24), displayName: tag, password: PW });
      const me = (await u.browser.get('/api/auth/session')).json.player;
      return { ...u, email: e, id: me.id };
    };

    console.log('schema');
    await test('migration 013 is applied and the database allows exactly one owner and only known roles', async () => {
      assert.ok((await q("SELECT 1 FROM schema_migrations WHERE version = '013_admin_console.sql'")).length === 1);
      const a = await newUser('Sa'); const b = await newUser('Sb');
      await q("UPDATE players SET role = 'owner' WHERE id = $1", [a.id]);
      await assert.rejects(q("UPDATE players SET role = 'owner' WHERE id = $1", [b.id]), (e) => e.code === '23505', 'a second owner is impossible');
      await assert.rejects(q("UPDATE players SET role = 'root' WHERE id = $1", [b.id]), (e) => e.code === '23514', 'unknown roles are impossible');
      await q("UPDATE players SET role = 'user' WHERE id = $1", [a.id]); // reset for the tests below
      await dbAdmin._resetForTests();
    });

    let bossUser = null;
    console.log('owner bootstrap');
    await test('the configured, VERIFIED e-mail becomes the owner at first admin access; nobody else can', async () => {
      const stranger = await newUser('Stranger');
      assert.equal((await stranger.browser.get('/api/admin/me')).json.isOwner, false);
      // an unverified registration with the owner address does not qualify (register only, never verify)
      const b = new Browser(srv.port); await b.csrf();
      const reg = await b.post('/api/auth/register', { email: OWNER_EMAIL, username: 'bossunverified', password: PW, displayName: 'Boss' });
      assert.ok(reg.ok);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM players WHERE role = 'owner'"))[0].n, 0);
      const boss = await registerAndVerifyExisting(b, reg);
      const me = await boss.browser.get('/api/admin/me');
      assert.deepEqual([me.json.isOwner, me.json.role], [true, 'owner']);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'owner.claimed'"))[0].n, 1);
      bossUser = boss;
    });
    async function registerAndVerifyExisting(b, reg) {
      await b.must('/api/auth/verify-email', { token: reg.json.debug.verifyToken });
      const login = await b.must('/api/auth/login', { email: OWNER_EMAIL, password: PW });
      return { browser: b, token: login.json.token, id: login.json.player.id };
    }

    console.log('roles');
    const boss = () => bossUser;
    await test('the owner grants and revokes admin; the change and its audit row are one transaction', async () => {
      const u = await newUser('Cara');
      assert.equal((await boss().browser.post('/api/admin/roles', { playerId: u.id, role: 'admin' })).status, 200);
      assert.equal((await q('SELECT role FROM players WHERE id = $1', [u.id]))[0].role, 'admin');
      assert.equal((await u.browser.get('/api/admin/overview')).status, 200);
      assert.equal((await boss().browser.post('/api/admin/roles', { playerId: u.id, role: 'user' })).status, 200);
      assert.equal((await u.browser.get('/api/admin/overview')).status, 403, 'demotion applies to the very next request');
      assert.deepEqual((await q("SELECT action FROM admin_audit_log WHERE target_id = $1 ORDER BY at", [u.id])).map((r) => r.action), ['role.grant_admin', 'role.revoke_admin']);
    });
    await test('an admin cannot manage roles; refused changes leave no audit row and no change', async () => {
      const adm = await newUser('Dan'); const other = await newUser('Eve');
      await boss().browser.post('/api/admin/roles', { playerId: adm.id, role: 'admin' });
      const before = (await q('SELECT COUNT(*)::int AS n FROM admin_audit_log'))[0].n;
      assert.equal((await adm.browser.post('/api/admin/roles', { playerId: other.id, role: 'admin' })).status, 403);
      assert.equal((await adm.browser.post('/api/admin/roles', { playerId: boss().id, role: 'user' })).status, 403);
      assert.equal((await boss().browser.post('/api/admin/roles', { playerId: boss().id, role: 'user' })).status, 400);
      assert.equal((await boss().browser.post('/api/admin/roles', { playerId: other.id, role: 'owner' })).status, 400);
      assert.equal((await q('SELECT role FROM players WHERE id = $1', [boss().id]))[0].role, 'owner');
      assert.equal((await q('SELECT role FROM players WHERE id = $1', [other.id]))[0].role, 'user');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM admin_audit_log'))[0].n, before);
    });
    await test('the store itself refuses to touch the owner row, even when called directly', async () => {
      const adm = await newUser('Fay');
      await q("UPDATE players SET role = 'admin' WHERE id = $1", [adm.id]);
      await assert.rejects(dbAdmin.setRole({ actorId: adm.id, targetId: boss().id, role: 'user' }), (e) => e instanceof policy.PolicyError);
      await assert.rejects(dbAdmin.setRole({ actorId: boss().id, targetId: boss().id, role: 'user' }), (e) => e instanceof policy.PolicyError);
      assert.equal((await q('SELECT role FROM players WHERE id = $1', [boss().id]))[0].role, 'owner');
    });
    await test('concurrent role changes by the owner are serialised and consistent', async () => {
      const u = await newUser('Gus');
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => boss().browser.post('/api/admin/roles', { playerId: u.id, role: i % 2 ? 'user' : 'admin' })));
      assert.ok(results.every((r) => r.status === 200));
      const role = (await q('SELECT role FROM players WHERE id = $1', [u.id]))[0].role;
      assert.ok(['user', 'admin'].includes(role));
      const grants = (await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE target_id = $1", [u.id]))[0].n;
      assert.ok(grants >= 1);
    });
    await test('an admin can sign an ordinary player out (their sessions are revoked) but not staff', async () => {
      const adm = await newUser('Hal'); const victim = await newUser('Ivy');
      await boss().browser.post('/api/admin/roles', { playerId: adm.id, role: 'admin' });
      assert.equal((await adm.browser.post('/api/admin/users/sign-out', { playerId: boss().id })).status, 403);
      assert.equal((await adm.browser.post('/api/admin/users/sign-out', { playerId: victim.id })).status, 200);
      assert.equal((await victim.browser.get('/api/auth/session')).json.authenticated, false);
    });
    await test('user search escapes wildcards and never returns e-mail addresses', async () => {
      const r = await boss().browser.get('/api/admin/users?q=%25');
      assert.equal(r.status, 200);
      assert.equal(r.json.users.length, 0, '"%" is a literal, not "match everything"');
      const all = await boss().browser.get('/api/admin/users');
      assert.ok(all.json.users.length > 3 && all.json.users.every((u) => !('email' in u)));
    });

    console.log('owner protection');
    await test('the owner account cannot be deleted by accident', async () => {
      const r = await boss().browser.post('/api/me/delete-account', { password: PW });
      assert.equal(r.status, 409);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM players WHERE role = 'owner'"))[0].n, 1);
    });

    console.log('announcements');
    await test('a one-day announcement is live, expires by the database clock, and the ANNOUNCEMENT variable still works', async () => {
      const g = new Browser(srv.port); await g.csrf();
      assert.equal((await g.get('/api/games')).json.announcement, 'Legacy banner');
      const c = await boss().browser.post('/api/admin/announcements', { message: 'Maintenance tonight', durationHours: 24 });
      assert.equal(c.status, 201);
      assert.deepEqual((await g.get('/api/announcements')).json.announcements.map((a) => a.message), ['Maintenance tonight']);
      await q('UPDATE announcements SET starts_at = NOW() - INTERVAL \'2 hours\', ends_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [c.json.announcement.id]);
      assert.deepEqual((await g.get('/api/announcements')).json.announcements, [], 'expired');
    });
    await test('a scheduled announcement is hidden until its start', async () => {
      const g = new Browser(srv.port); await g.csrf();
      const start = new Date(Date.now() + 3600e3).toISOString();
      const c = await boss().browser.post('/api/admin/announcements', { message: 'Later', startsAt: start, durationHours: 2 });
      assert.equal(c.json.announcement.status, 'scheduled');
      assert.deepEqual((await g.get('/api/announcements')).json.announcements, []);
      await q("UPDATE announcements SET starts_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [c.json.announcement.id]);
      await boss().browser.post('/api/admin/announcements/update', { id: c.json.announcement.id, message: 'Later (now live)' }); // drops the cache
      assert.deepEqual((await g.get('/api/announcements')).json.announcements.map((a) => a.message), ['Later (now live)']);
      await boss().browser.post('/api/admin/announcements/end', { id: c.json.announcement.id });
    });
    await test('PostgreSQL: a revision changes only with a real change; a dismissal records the revision seen and survives an unchanged save', async () => {
      // the home page shows three banners: end what earlier tests left running so this one is visible
      for (const x of (await boss().browser.get('/api/admin/announcements')).json.items) if (x.status === 'live') await boss().browser.post('/api/admin/announcements/end', { id: x.id });
      const u = await newUser('Rev');
      const c = await boss().browser.post('/api/admin/announcements', { message: 'Rev test', audience: 'signed_in', durationHours: 5 });
      const id = c.json.announcement.id;
      const rev = async () => (await q('SELECT revision FROM announcements WHERE id = $1', [id]))[0].revision;
      assert.equal(await rev(), 1);
      await boss().browser.post('/api/admin/announcements/update', { id, message: 'Rev test' });
      assert.equal(await rev(), 1, 'the same values are not a change');
      assert.equal((await u.browser.post('/api/announcements/dismiss', { id, revision: 1 })).status, 200);
      assert.ok(!(await u.browser.get('/api/announcements')).json.announcements.some((a) => a.id === id), 'hidden at revision 1');
      await boss().browser.post('/api/admin/announcements/update', { id, message: 'Rev test', level: 'warning' });
      assert.equal(await rev(), 2);
      assert.ok((await u.browser.get('/api/announcements')).json.announcements.some((a) => a.id === id), 'a level change shows it again');
      assert.equal((await u.browser.post('/api/announcements/dismiss', { id, revision: 2 })).status, 200);
      assert.equal((await q('SELECT dismissed_revision FROM announcement_dismissals WHERE player_id = $1 AND announcement_id = $2', [u.id, id]))[0].dismissed_revision, 2);
      assert.equal((await u.browser.post('/api/announcements/dismiss', { id, revision: 0 })).status, 400, 'a revision must be a positive whole number');
    });
    await test('targeting and dismissal hold across logins (another device): the dismissal is stored on the account', async () => {
      const u = await newUser('Jo');
      const c = await boss().browser.post('/api/admin/announcements', { message: 'Members only', audience: 'signed_in', durationHours: 5 });
      const g = new Browser(srv.port); await g.csrf();
      assert.ok(!(await g.get('/api/announcements')).json.announcements.some((a) => a.message === 'Members only'), 'guests do not see it');
      assert.ok((await u.browser.get('/api/announcements')).json.announcements.some((a) => a.message === 'Members only'));
      assert.equal((await u.browser.post('/api/announcements/dismiss', { id: c.json.announcement.id })).status, 200);
      const device2 = new Browser(srv.port); await device2.csrf();
      await device2.must('/api/auth/login', { email: u.email, password: PW }); // a second login = another device
      assert.ok(!(await device2.get('/api/announcements')).json.announcements.some((a) => a.message === 'Members only'));
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM announcement_dismissals WHERE player_id = $1', [u.id]))[0].n, 1);
      await boss().browser.post('/api/admin/announcements/update', { id: c.json.announcement.id, message: 'Members only v2' });
      assert.ok((await device2.get('/api/announcements')).json.announcements.some((a) => a.message === 'Members only v2'), 'a changed text shows again');
      await boss().browser.post('/api/admin/announcements/end', { id: c.json.announcement.id });
    });
    await test('the database refuses an announcement that ends before it starts', async () => {
      await assert.rejects(q("INSERT INTO announcements (message, starts_at, ends_at) VALUES ('x', NOW(), NOW() - INTERVAL '1 hour')"), (e) => e.code === '23514');
    });

    console.log('feedback');
    await test('feedback is stored, triaged by staff, and keeps no account link after the account is deleted', async () => {
      const u = await newUser('Kit');
      assert.equal((await u.browser.post('/api/feedback', { category: 'idea', message: 'More games' })).status, 201);
      const item = (await boss().browser.get('/api/admin/feedback?status=new')).json.items.find((i) => i.message === 'More games');
      assert.equal(item.username, (await u.browser.get('/api/auth/session')).json.player.username);
      assert.equal((await boss().browser.post('/api/admin/feedback/status', { id: item.id, status: 'resolved' })).status, 200);
      assert.equal((await u.browser.post('/api/me/delete-account', { password: PW })).status, 200);
      const row = (await q('SELECT player_id FROM feedback WHERE id = $1', [item.id]))[0];
      assert.equal(row.player_id, null, 'the message stays, the link to the person is gone');
    });

    console.log('analytics storage');
    await test('counters are upserted and summed; active accounts are stored only as a keyed hash', async () => {
      await dbAdmin.addCounters([{ day: '2026-01-01', metric: 'session', dim: '', count: 3 }, { day: '2026-01-01', metric: 'game_finished', dim: 'poker', count: 1 }]);
      await dbAdmin.addCounters([{ day: '2026-01-01', metric: 'session', dim: '', count: 4 }]);
      assert.equal((await q("SELECT total::int AS n FROM analytics_daily WHERE day = '2026-01-01' AND metric = 'session'"))[0].n, 7);
      const p = await newUser('Lee');
      await dbAdmin.addActive([{ day: '2026-01-01', playerId: p.id }, { day: '2026-01-01', playerId: p.id }]);
      const rows = await q("SELECT actor FROM analytics_active WHERE day = '2026-01-01'");
      assert.equal(rows.length, 1);
      assert.ok(rows[0].actor.trim().length === 32 && rows[0].actor.trim() !== p.id && !p.id.includes(rows[0].actor.trim()), 'a hash, not the id');
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_active WHERE actor = $1", [p.id]))[0].n, 0);
    });
    await test('deleting an account removes its activity hash rows; the daily counters (no personal data) stay', async () => {
      const p = await newUser('Max');
      await dbAdmin.addActive([{ day: '2026-01-02', playerId: p.id }]);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_active WHERE day = '2026-01-02'"))[0].n, 1);
      await dbAdmin.forgetActor(p.id);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_active WHERE day = '2026-01-02'"))[0].n, 0);
      assert.ok((await q("SELECT COUNT(*)::int AS n FROM analytics_daily"))[0].n >= 2);
    });
    await test('an analytics write still in flight when its account is deleted: the deletion waits for it, and no hash survives', async () => {
      const dbAccount = require('../db/account');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const p = await newUser('Pia');
      const day = '2026-01-03';
      const hold = await t.client();
      await hold.query('BEGIN');
      // The write stalls at its INSERT (after it has read the account), like a write whose timeout fired while it was still open.
      await hold.query('LOCK TABLE analytics_active IN ACCESS EXCLUSIVE MODE');
      const write = dbAdmin.addActive([{ day, playerId: p.id }]);
      for (let i = 0; i < 100; i++) { // wait until the write is actually stalled at the INSERT
        if ((await q("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'INSERT INTO analytics_active%'"))[0].n > 0) break;
        await sleep(50);
      }
      const deletion = dbAccount.deleteAccount(p.id, PW).then(() => 'deleted');
      // deleteAccount hashes the password first, so wait until its row lock is actually queued behind the write
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await q("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM players WHERE id = $1 FOR UPDATE%'"))[0].n > 0;
        if (!waiting) await sleep(50);
      }
      await hold.query('COMMIT'); // release the write: it finishes, and only then can the deletion go ahead
      await write;
      await deletion;
      await dbAdmin.forgetActor(p.id); // what the server runs right after the deletion returns
      assert.ok(waiting, 'the deletion must queue behind the in-flight write, not run past it');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM analytics_active WHERE day = $1', [day]))[0].n, 0, 'no hash of the deleted account remains');
      await hold.end();
    });
    await test('a keyed analytics batch that reaches an account already deleted stores nothing, also when it is retried', async () => {
      const dbAccount = require('../db/account');
      const p = await newUser('Roz');
      await dbAccount.deleteAccount(p.id, PW);
      const key = '66666666-7777-4888-8999-aaaaaaaaaaaa';
      const row = [{ day: '2026-01-04', playerId: p.id }];
      await dbAdmin.addActive(row, key);
      await dbAdmin.addActive(row, key); // the same batch again after a timeout
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_active WHERE day = '2026-01-04'"))[0].n, 0);
    });
    await test('an account id in upper case is stored under the same hash, counted once, and forgotten by its lowercase form', async () => {
      const p = await newUser('Upa');
      await dbAdmin.addActive([{ day: '2026-01-07', playerId: p.id.toUpperCase() }, { day: '2026-01-07', playerId: p.id }]);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_active WHERE day = '2026-01-07'"))[0].n, 1);
      await dbAdmin.forgetActor(p.id);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_active WHERE day = '2026-01-07'"))[0].n, 0);
    });
    await test('a batch sent again with the same key is applied once, and a different key is applied', async () => {
      const key = '11111111-2222-4333-8444-555555555555';
      const row = [{ day: '2026-03-01', metric: 'session', dim: 'retry', count: 5 }];
      await dbAdmin.addCounters(row, key);
      await dbAdmin.addCounters(row, key); // the same batch, retried after a timeout whose outcome was unknown
      assert.equal(Number((await q("SELECT total FROM analytics_daily WHERE day = '2026-03-01' AND dim = 'retry'"))[0].total), 5, 'counted once');
      await dbAdmin.addCounters(row, '11111111-2222-4333-8444-666666666666');
      assert.equal(Number((await q("SELECT total FROM analytics_daily WHERE day = '2026-03-01' AND dim = 'retry'"))[0].total), 10, 'a new batch is counted');
      await assert.rejects(dbAdmin.addCounters(row, 'not-a-key'), /not valid/);
    });
    await test('retention: old rows are purged by the documented periods, recent rows stay', async () => {
      await q("INSERT INTO analytics_daily (day, metric, dim, total) VALUES (CURRENT_DATE - 500, 'session', 'old', 1), (CURRENT_DATE - 5, 'session', 'recent', 1)");
      await q("INSERT INTO analytics_active (day, actor) VALUES (CURRENT_DATE - 40, repeat('b', 32)), (CURRENT_DATE - 2, repeat('c', 32))");
      await q("INSERT INTO admin_audit_log (at, action) VALUES (NOW() - INTERVAL '400 days', 'old.one'), (NOW() - INTERVAL '1 day', 'recent.one')");
      await q("INSERT INTO feedback (message, created_at) VALUES ('ancient', NOW() - INTERVAL '200 days'), ('fresh', NOW())");
      await q("INSERT INTO announcements (message, starts_at, ends_at) VALUES ('stale', NOW() - INTERVAL '120 days', NOW() - INTERVAL '100 days')");
      const out = await dbAdmin.purge();
      assert.ok(out.daily >= 1 && out.active >= 1 && out.audit >= 1 && out.feedback >= 1 && out.announcements >= 1, JSON.stringify(out));
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_daily WHERE dim = 'old'"))[0].n, 0);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM analytics_daily WHERE dim = 'recent'"))[0].n, 1);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'recent.one'"))[0].n, 1);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM feedback WHERE message = 'fresh'"))[0].n, 1);
      // retention runs from the real end: an early end counts, not the scheduled one
      await q("INSERT INTO announcements (message, starts_at, ends_at, ended_at) VALUES ('ended long ago', NOW() - INTERVAL '150 days', NOW() + INTERVAL '200 days', NOW() - INTERVAL '120 days')");
      await q("INSERT INTO announcements (message, starts_at, ends_at, ended_at) VALUES ('ended today', NOW() - INTERVAL '1 day', NOW() + INTERVAL '200 days', NOW())");
      await dbAdmin.purge();
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM announcements WHERE message = 'ended long ago'"))[0].n, 0, 'removed 90 days after the early end');
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM announcements WHERE message = 'ended today'"))[0].n, 1, 'kept: ended today');
    });
    await test('the overview reads the counters and active hashes', async () => {
      const r = await boss().browser.get('/api/admin/overview?days=30');
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.json.labels) && r.json.labels.length === 30);
      assert.ok(r.json.accounts.registered >= 1);
      assert.equal((await boss().browser.get('/api/admin/health')).json.db.ok, true);
    });
    await test('real traffic is counted: registrations and logins reach the table when the server shuts down (final flush)', async () => {
      await newUser('Ned');
      await srv.close();
      srv = null;
      const rows = await q("SELECT metric, SUM(total)::int AS n FROM analytics_daily WHERE day = CURRENT_DATE GROUP BY metric");
      const n = (m) => (rows.find((r) => r.metric === m) || { n: 0 }).n;
      assert.ok(n('registration') >= 1 && n('login') >= 1, JSON.stringify(rows));
    });

    console.log(`${passed} admin PostgreSQL checks passed`);
  } finally {
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL admin.pg', e); process.exit(1); });
