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
  let srvB = null; // a second server instance with a 60 s announcement cache, sharing the database (the production case)
  try {
    process.env.DATABASE_URL = t.url;
    process.env.ANNOUNCEMENT_CACHE_MS = '0'; // the live-banner list is cached 15 s in production; these tests change rows directly and expect them to apply at once
    const dbAdmin = require('../db/admin');
    const policy = require('../lib/adminPolicy');
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    // the real sender, with a record of each verification mail (what it sends is unchanged)
    const mailed = [];
    const realSender = require('../lib/email').makeAuthEmailSender({ env: process.env, logger: quiet() });
    // record only: no verification mail is sent from the test (the token is what the test checks)
    const recordingSender = { ...realSender, sendVerification: async (o) => { mailed.push(o); } };
    const fast = { emailSender: recordingSender, port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet(), env: { ...process.env, ADMIN_OWNER_EMAIL: OWNER_EMAIL }, announcement: 'Legacy banner' };
    srv = await start(fast);
    let seq = 1;
    const newUser = async (tag, email) => {
      const e = email || `${tag.toLowerCase()}.adm.${seq++}@test.local`;
      const u = await registerAndVerify(srv.port, { email: e, username: `${tag.toLowerCase()}adm${seq}`.slice(0, 24), displayName: tag, password: PW });
      const me = (await u.browser.get('/api/auth/session')).json.player;
      return { ...u, email: e, id: me.id };
    };

    console.log('insights');
    await test('insights: the SQL runs on a real database and counts humans, leavers, draws, new and returning players', async () => {
      const ins = require('../db/insights');
      const a = await newUser('Ia'); const b = await newUser('Ib');
      const mk = async (game, startAgo, mins, parts) => {
        const m = (await q(`INSERT INTO matches (room_code, game_id, seats, started_at, finished_at) VALUES ('INS1', $1, $2, NOW() - ($3::int * INTERVAL '1 minute'), NOW() - (($3::int - $4::int) * INTERVAL '1 minute')) RETURNING id`, [game, parts.length, startAgo, mins]))[0].id;
        for (const [i, [pid, win, bot, left, draw]] of parts.entries()) await q('INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner, is_bot, left_early, is_draw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [m, pid, 'x', i, win, bot, left, draw]);
      };
      await mk('ludo', 60 * 24 * 2, 20, [[a.id, true, false, false, false], [b.id, false, false, true, false], [null, false, true, false, false]]);
      await mk('tictactoe', 60, 3, [[a.id, false, false, false, true], [b.id, false, false, false, true]]);
      await q("UPDATE players SET country = 'DE' WHERE id = $1", [a.id]);
      const o = await ins.insights({ days: 7, tz: 'Asia/Kolkata' });
      assert.equal(o.days, 7); assert.equal(o.zone, 'Asia/Kolkata');
      const ludo = o.games.find((g) => g.gameId === 'ludo'); const ttt = o.games.find((g) => g.gameId === 'tictactoe');
      assert.equal(ludo.matches, 1); assert.equal(ludo.humans, 2, 'the bot is not counted'); assert.equal(ludo.leftEarly, 1); assert.equal(ludo.withLeaver, 1);
      assert.equal(ttt.draws, 1);
      assert.ok(o.heat.length >= 1 && o.heat.every((c) => c.dow >= 0 && c.dow <= 6 && c.hour >= 0 && c.hour <= 23));
      assert.equal(o.playtime.players, 2);
      assert.deepEqual(o.countries, [{ country: 'DE', players: 1 }, { country: null, players: 1 }], 'one player chose Germany, one has not set a country');
      assert.equal(o.returning.daily.reduce((n, r) => n + r.newPlayers, 0), 2, 'both players were new in their first game');
      assert.equal(o.returning.daily.reduce((n, r) => n + r.returningPlayers, 0), 2, 'and both came back for the second game');
      assert.ok(o.top.length === 2 && o.top.every((r) => r.username));
      assert.equal((await ins.insights({ days: 5, tz: 'Mars/Base' })).days, 30, 'an unknown range falls back to 30 days');
      assert.equal((await ins.insights({ days: 5, tz: 'Mars/Base' })).zone, 'UTC', 'an unknown zone falls back to UTC');
    });
    await test('report queue: counts, severity, suspension, a deleted reporter, and an audit row on opening it', async () => {
      const rq = require('../db/reportQueue');
      const rep = await newUser('Rpa'); const bad = await newUser('Rpb'); const staff = await newUser('Rps');
      await q("UPDATE players SET suspended_at = NOW() WHERE id = $1", [bad.id]);
      const report = (who, reason, text) => q(`INSERT INTO chat_reports (reporter_id, reported_id, reported_display_name, room_code, message_id, message_text, reason, details)
                                               VALUES ($1, $2, 'Bad', 'RPQ1', gen_random_uuid(), $3, $4, '')`, [who, bad.id, text, reason]);
      await report(rep.id, 'threats', 'a threatening line');
      await report(staff.id, 'spam', 'a spam line');
      // one report older than the 30-day window: it counts all time but not in the recent figure
      await q(`INSERT INTO chat_reports (reporter_id, reported_id, reported_display_name, room_code, message_id, message_text, reason, details, created_at)
               VALUES ($1, $2, 'Bad', 'RPQ1', gen_random_uuid(), 'an old line', 'harassment', '', NOW() - INTERVAL '45 days')`, [rep.id, bad.id]);
      const page = await rq.listReports({ page: 1, actorId: staff.id });
      const threat = page.items.find((r) => r.reason === 'threats' && r.message === 'a threatening line');
      assert.ok(threat, 'the threat report is listed');
      assert.equal(threat.severity, 'high', 'threats are high severity');
      assert.equal(threat.reportedSuspended, true, 'the suspension is shown');
      assert.equal(threat.reportedTotal, 3, 'the account has three reports in all');
      assert.equal(threat.reportedRecent, 2, 'and two in the last 30 days (the 45-day-old report is left out)');
      assert.equal(threat.reporter, rep.player.username, 'the reporter username is shown to staff');
      assert.equal(threat.reported, bad.player.username, 'the reported username is shown');
      assert.ok(!Object.keys(threat).some((k) => /email|ip|token/i.test(k)), 'no address or token fields');
      const audit = await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'reports.view' AND actor_id = $1", [staff.id]);
      assert.equal(audit[0].n, 1, 'only the call with an actor writes a reports.view row');
    });
    await test('player directory: totals, sorting, search, per-game stats and an audit row on opening a profile (no address or token in the answer)', async () => {
      const ps = require('../db/playerStats');
      const a = await newUser('Pda'); const b = await newUser('Pdb'); const staff = await newUser('Pds');
      // key = null is a match written before results were reported (winners unknown); match_key is a UUID column
      const mk = async (game, mins, parts, key = require('node:crypto').randomUUID()) => {
        const m = (await q(`INSERT INTO matches (match_key, room_code, game_id, seats, started_at, finished_at) VALUES ($4, 'PDR1', $1, $2, NOW() - ($3::int * INTERVAL '1 minute') - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes') RETURNING id`, [game, parts.length, mins, key]))[0].id;
        for (const [i, [pid, win, bot, left, draw]] of parts.entries()) await q('INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner, is_bot, left_early, is_draw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [m, pid, 'x', i, win, bot, left, draw]);
      };
      // b left early and a bot took the seat and won: that win sits on b's row and must not count for b
      await mk('ludo', 20, [[a.id, true, false, false, false], [b.id, true, false, true, false], [null, false, true, false, false]]);
      await mk('tictactoe', 3, [[a.id, false, false, false, true], [b.id, false, false, false, true]]);
      await mk('ludo', 10, [[a.id, false, false, false, false], [b.id, true, false, false, false]]);
      // a match from before results were reported (no match key): played, but nobody's win or loss is known
      await mk('ludo', 7, [[a.id, false, false, false, false], [b.id, false, false, false, false]], null);
      const list = await ps.listPlayers({ q: 'pd', sort: 'games' });
      const ra = list.players.find((p) => p.displayName === 'Pda');
      assert.equal(ra.games, 4); assert.equal(ra.rated, 3, 'the match with no recorded result is a game played, not a rated one'); assert.equal(ra.wins, 1); assert.equal(ra.draws, 1); assert.equal(ra.leftEarly, 0);
      assert.equal(ra.minutes, 40, 'time played adds the lengths of the games the player stayed to the end of');
      const rb = list.players.find((p) => p.displayName === 'Pdb');
      assert.equal(rb.leftEarly, 1); assert.equal(rb.minutes, 20, 'the game b left early is not time played');
      assert.equal(rb.wins, 1, 'a bot win on the seat b left is not b\'s win'); assert.equal(rb.rated, 2);
      assert.ok(list.total >= 3 && list.sort === 'games');
      assert.equal((await ps.listPlayers({ q: 'zzz-no-such', sort: 'drop table players' })).total, 0);
      assert.equal((await ps.listPlayers({ sort: 'drop table players' })).sort, 'seen', 'an unknown sort falls back and never reaches the SQL');
      // a page number that is not a whole number (or is absurdly large) must never reach PostgreSQL as an invalid OFFSET
      for (const bad of ['Infinity', '1e30', 'abc', -4]) assert.equal((await ps.listPlayers({ sort: 'games', page: bad })).players.length, Math.min(25, (await ps.listPlayers({ sort: 'games' })).players.length), `page ${bad} falls back to the first page`);
      assert.equal((await ps.listPlayers({ sort: 'seen', page: '99999999' })).players.length, 0, 'a huge page is capped and simply returns no rows');
      const before = (await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'player.view'"))[0].n;
      const prof = await ps.playerProfile({ username: a.username || (await q('SELECT username FROM players WHERE id = $1', [a.id]))[0].username, actorId: staff.id });
      assert.equal(prof.totals.games, 4); assert.equal(prof.totals.rated, 3); assert.equal(prof.totals.losses, 1, 'a draw is neither a win nor a loss, and an unrecorded result is not a loss'); assert.ok(prof.totals.activeDays >= 1 && prof.totals.activeDays <= 2, 'one day (two if the test ran across midnight UTC)');
      assert.equal(prof.perGame.find((g) => g.gameId === 'ludo').games, 3); assert.equal(prof.perGame.find((g) => g.gameId === 'ludo').rated, 2);
      assert.equal(prof.recent.length, 4); assert.equal(prof.recent.filter((r) => r.unknown).length, 1, 'the match with no recorded result is marked unknown'); assert.ok(prof.recent.filter((r) => r.unknown).every((r) => !r.won && !r.draw), 'and is never shown as a win'); assert.ok(new Date(prof.recent[0].at) >= new Date(prof.recent[3].at), 'latest game first');
      assert.deepEqual(Object.keys(prof.hourly).sort(), ['Asia/Kolkata', 'Europe/Berlin', 'UTC']);
      assert.equal(prof.hourly.UTC.reduce((n, v) => n + v, 0), 4);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'player.view'"))[0].n, before + 1);
      assert.ok(!/@|token|password|hash/i.test(JSON.stringify(prof)), 'no e-mail address, token or hash in the profile');
      const profB = await ps.playerProfile({ username: (await q('SELECT username FROM players WHERE id = $1', [b.id]))[0].username });
      assert.equal(profB.totals.wins, 1, 'b\'s profile: the bot\'s win on the seat b left is not counted'); assert.equal(profB.totals.leftEarly, 1);
      assert.equal(profB.recent.find((r) => r.leftEarly).won, false, 'the left-early game is not shown as a win');
      assert.deepEqual(await ps.playerProfile({ username: 'no_such_player', actorId: staff.id }), { player: null });
    });
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
      const reg = await b.post('/api/auth/register', { adultConfirmed: true, email: OWNER_EMAIL, username: 'bossunverified', password: PW, displayName: 'Boss' });
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
    await test('sign-out is owner only: an admin is refused, the owner signs an ordinary player out and their sessions are revoked', async () => {
      const adm = await newUser('Hal'); const victim = await newUser('Ivy');
      await boss().browser.post('/api/admin/roles', { playerId: adm.id, role: 'admin' });
      assert.equal((await adm.browser.post('/api/admin/users/sign-out', { playerId: boss().id })).status, 403);
      assert.equal((await adm.browser.post('/api/admin/users/sign-out', { playerId: victim.id })).status, 403, 'sign-out is owner only');
      assert.equal((await boss().browser.post('/api/admin/users/sign-out', { playerId: victim.id })).status, 200);
      assert.equal((await victim.browser.get('/api/auth/session')).json.authenticated, false);
    });
    await test('staff resend: the mailed token verifies the targeted account; refusals send nothing', async () => {
      const staff = await newUser('Rs'); const pend = await newUser('Rp'); const plain = await newUser('Rq');
      await boss().browser.post('/api/admin/roles', { playerId: staff.id, role: 'admin' });
      await q('UPDATE auth_identities SET email_verified_at = NULL WHERE player_id = $1', [pend.id]);
      const before = mailed.length;
      const ok = await staff.browser.post('/api/admin/users/resend-verification', { playerId: pend.id });
      assert.equal(ok.status, 200);
      assert.ok(!JSON.stringify(ok.json).includes(pend.email), 'the response never carries the address');
      assert.equal(mailed.length, before + 1);
      assert.equal(mailed[mailed.length - 1].email, pend.email);
      const v = await pend.browser.post('/api/auth/verify-email', { token: mailed[mailed.length - 1].token });
      assert.equal(v.status, 200, 'the mailed token is the one that verifies this account');
      assert.ok((await q('SELECT email_verified_at FROM auth_identities WHERE player_id = $1', [pend.id]))[0].email_verified_at);
      assert.equal((await staff.browser.post('/api/admin/users/resend-verification', { playerId: pend.id })).status, 409, 'now verified: no mail');
      const noRight = await plain.browser.post('/api/admin/users/resend-verification', { playerId: pend.id });
      assert.equal(noRight.status, 403);
      assert.equal(mailed.length, before + 1, 'refused requests send nothing');
      assert.ok((await q("SELECT 1 FROM admin_audit_log WHERE action = 'user.verify_resend' AND target_id = $1", [pend.id])).length >= 1);
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
    // ---- announcement revisions against real PostgreSQL
    const clearLiveBanners = async () => { for (const x of (await boss().browser.get('/api/admin/announcements')).json.items) if (x.status === 'live') await boss().browser.post('/api/admin/announcements/end', { id: x.id }); };
    const createBanner = async (fields) => (await boss().browser.post('/api/admin/announcements', fields)).json.announcement;
    const revisionOf = async (id) => (await q('SELECT revision FROM announcements WHERE id = $1', [id]))[0].revision;
    const dismissedRevisionOf = async (uid, id) => { const r = await q('SELECT dismissed_revision FROM announcement_dismissals WHERE player_id = $1 AND announcement_id = $2', [uid, id]); return r.length ? r[0].dismissed_revision : null; };
    const shownTo = async (browser, id) => (await browser.get('/api/announcements')).json.announcements.find((a) => a.id === id) || null;
    const storedWindow = async (id) => { const r = (await q('SELECT starts_at, ends_at FROM announcements WHERE id = $1', [id]))[0]; return { startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString() }; };

    await test('PostgreSQL: a stale cached copy and a stale dismissal cannot bring back a seen revision; a future revision is capped; a newer revision shows', async () => {
      await clearLiveBanners();
      const { start: startServer } = require('../server');
      if (!srvB) srvB = await startServer({ ...fast, env: { ...process.env, ANNOUNCEMENT_CACHE_MS: '60000' } });
      const u = await newUser('Stale');
      const a = await createBanner({ message: 'Stale v1', audience: 'signed_in', durationHours: 5 });
      const instanceB = new Browser(srvB.port); instanceB.cookies = new Map(u.browser.cookies);
      assert.ok(await shownTo(instanceB, a.id), 'instance B caches revision 1 while it is current');
      // the change and the dismissal happen on instance A, which does not cache
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, message: 'Stale v2' });
      assert.equal(await revisionOf(a.id), 2);
      assert.equal((await u.browser.post('/api/announcements/dismiss', { id: a.id, revision: 2 })).status, 200);
      assert.equal(await dismissedRevisionOf(u.id, a.id), 2);
      assert.equal(await shownTo(instanceB, a.id), null, 'instance B still holds revision 1 in its cache, and the dismissed revision hides it');
      // a late dismissal of revision 1 (sent to B) does not move the record back
      assert.equal((await instanceB.post('/api/announcements/dismiss', { id: a.id, revision: 1 })).status, 200);
      assert.equal(await dismissedRevisionOf(u.id, a.id), 2, 'dismissed_revision stays 2');
      assert.equal(await shownTo(u.browser, a.id), null, 'still hidden on instance A');
      // a revision far above the current one is capped to the current revision
      assert.equal((await u.browser.post('/api/announcements/dismiss', { id: a.id, revision: 2147483647 })).status, 200);
      assert.equal(await dismissedRevisionOf(u.id, a.id), 2, 'capped to the current revision');
      // a genuinely newer revision is shown on A at once, and on B once its cache expires
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, message: 'Stale v3' });
      assert.equal(await revisionOf(a.id), 3);
      const seen = await shownTo(u.browser, a.id);
      assert.ok(seen, 'revision 3 is shown on A');
      assert.equal(seen.revision, 3);
      assert.equal(seen.message, 'Stale v3');
    });

    await test('PostgreSQL: changing the audience after a dismissal shows the banner again; saving the same audience does not', async () => {
      await clearLiveBanners();
      const u = await newUser('Aud');
      const a = await createBanner({ message: 'Audience test', audience: 'signed_in', durationHours: 5 });
      await u.browser.post('/api/announcements/dismiss', { id: a.id });
      assert.equal(await shownTo(u.browser, a.id), null);
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, audience: 'signed_in' });
      assert.equal(await revisionOf(a.id), 1, 'the same audience is not a change');
      assert.equal(await shownTo(u.browser, a.id), null, 'still dismissed');
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, audience: 'all' });
      assert.equal(await revisionOf(a.id), 2);
      assert.ok(await shownTo(u.browser, a.id), 'the audience change shows it again');
    });

    await test('PostgreSQL: moving the start time after a dismissal shows the banner again', async () => {
      await clearLiveBanners();
      const u = await newUser('Start');
      const a = await createBanner({ message: 'Start test', audience: 'signed_in', durationHours: 5 });
      await u.browser.post('/api/announcements/dismiss', { id: a.id });
      assert.equal(await shownTo(u.browser, a.id), null);
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, startsAt: new Date(Date.now() - 30 * 60e3).toISOString() });
      assert.equal(await revisionOf(a.id), 2, 'a new start time is a change');
      assert.ok(await shownTo(u.browser, a.id), 'shown again');
    });

    await test('PostgreSQL: moving the end time after a dismissal shows the banner again', async () => {
      await clearLiveBanners();
      const u = await newUser('End');
      const a = await createBanner({ message: 'End test', audience: 'signed_in', durationHours: 5 });
      await u.browser.post('/api/announcements/dismiss', { id: a.id });
      assert.equal(await shownTo(u.browser, a.id), null);
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, endsAt: new Date(Date.now() + 8 * 3600e3).toISOString() });
      assert.equal(await revisionOf(a.id), 2, 'a new end time is a change');
      assert.ok(await shownTo(u.browser, a.id), 'shown again');
    });

    await test('PostgreSQL: saving the same schedule (and text, level, audience) does not change the revision or un-hide a dismissal', async () => {
      await clearLiveBanners();
      const u = await newUser('Same');
      const a = await createBanner({ message: 'Same test', audience: 'signed_in', durationHours: 5 });
      await u.browser.post('/api/announcements/dismiss', { id: a.id });
      const w = await storedWindow(a.id);
      await boss().browser.post('/api/admin/announcements/update', { id: a.id, message: 'Same test', level: 'info', audience: 'signed_in', startsAt: w.startsAt, endsAt: w.endsAt });
      assert.equal(await revisionOf(a.id), 1, 'unchanged values keep revision 1');
      assert.equal(await dismissedRevisionOf(u.id, a.id), 1);
      assert.equal(await shownTo(u.browser, a.id), null, 'still hidden');
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
      assert.ok(Array.isArray(r.json.activeDaily) && r.json.activeDaily.length === 30 && r.json.activeDaily.every(Number.isInteger), 'one active count per day');
      assert.ok(Number.isInteger(r.json.queues.reports7d) && Number.isInteger(r.json.queues.reports_total) && Number.isInteger(r.json.queues.feedback_new), 'queue counts');
      assert.equal((await boss().browser.get('/api/admin/health')).json.db.ok, true);
    });
    console.log('suspension and lookup (Stage 20.8)');
    await test('a suspended account cannot sign in and its existing session stops working; lifting it allows sign-in again', async () => {
      const v = await newUser('Susp');
      const me = (await v.browser.get('/api/auth/session')).json.player;
      const look = await boss().browser.get('/api/admin/users/lookup?username=' + me.username);
      assert.equal(look.json.user.username, me.username);
      assert.ok(!JSON.stringify(look.json).includes(v.email), 'the lookup never shows the address');
      assert.equal((await boss().browser.post('/api/admin/users/suspend', { playerId: v.id, reason: 'test' })).status, 200);
      assert.equal((await v.browser.get('/api/auth/session')).json.player ?? null, null, 'the old session no longer identifies the player');
      const b = new Browser(srv.port); await b.csrf();
      assert.equal((await b.post('/api/auth/login', { email: v.email, password: PW })).status, 403, 'sign-in is refused');
      assert.equal((await boss().browser.post('/api/admin/users/unsuspend', { playerId: v.id })).status, 200);
      const again = new Browser(srv.port); await again.csrf();
      assert.equal((await again.post('/api/auth/login', { email: v.email, password: PW })).ok, true, 'sign-in works after the suspension is lifted');
    });
    // last: this check stops the server, so it must run after every check that needs it
    await test('real traffic is counted: registrations and logins reach the table when the server shuts down (final flush)', async () => {
      await newUser('Ned');
      await srv.close();
      srv = null;
      const rows = await q("SELECT metric, SUM(total)::int AS n FROM analytics_daily WHERE day = CURRENT_DATE GROUP BY metric");
      const n = (m) => (rows.find((r) => r.metric === m) || { n: 0 }).n;
      assert.ok(n('registration') >= 1 && n('login') >= 1, JSON.stringify(rows));
    });

    console.log('owner e-mail broadcasts (Stage 20.7)');
    const dbBroadcast = require('../db/broadcast');
    // Counts are measured before and after the rows this test adds, so other tests in this database cannot change the result.
    const tag = Math.random().toString(36).slice(2, 8); // lowercase letters and digits: a valid username
    const mk = async (suffix, { verified, optOut = false, daysAgo = 0 }) => {
      const id = (await q(
        `INSERT INTO players (username, display_name, is_anonymous, role, last_seen_at, marketing_opt_out_at)
         VALUES ($1, $1, FALSE, 'user', NOW() - ($2::int * INTERVAL '1 day'), ${optOut ? 'NOW()' : 'NULL'}) RETURNING id`,
        [`bc${tag}${suffix}`, daysAgo]
      ))[0].id;
      await q(
        `INSERT INTO auth_identities (id, player_id, provider, provider_user_id, email, email_verified_at)
         VALUES (gen_random_uuid(), $1, 'email', $2, $2, ${verified ? 'NOW()' : 'NULL'})`,
        [id, `bc${tag}${suffix}@test.local`]
      );
      return id;
    };
    const count = (audience, category) => dbBroadcast.broadcastCount({ audience, category });
    await test('the audience rules count the right accounts in PostgreSQL; promotions skip unverified and opted-out accounts', async () => {
      const before = { all: await count('all', 'account'), promo: await count('all', 'promo'), unv: await count('unverified', 'account'), idle: await count('inactive', 'account') };
      const verified = await mk('v', { verified: true });
      await mk('u', { verified: false });
      await mk('o', { verified: true, optOut: true });
      await mk('l', { verified: true, daysAgo: 40 });
      assert.equal((await count('all', 'account')) - before.all, 4);
      assert.equal((await count('all', 'promo')) - before.promo, 2, 'the verified and the lapsed one, not the opted-out one');
      assert.equal((await count('unverified', 'account')) - before.unv, 1);
      assert.equal((await count('inactive', 'account')) - before.idle, 1);
      assert.equal(await count('unverified', 'promo'), 0, 'promotional mail never reaches unverified accounts');
      assert.ok(verified);
    });
    await test('a queued send is fixed to the count the owner confirmed; a changed list is refused; the audit keeps counts, not text', async () => {
      const ownerId = (await q("SELECT id FROM players WHERE role = 'owner'"))[0].id;
      const expected = await count('all', 'account');
      await assert.rejects(dbBroadcast.queueBroadcast({ actorId: ownerId, audience: 'all', category: 'account', subject: 'S', body: 'B', expectedCount: expected + 1 }), (e) => e.status === 409);
      const id = (await dbBroadcast.queueBroadcast({ actorId: ownerId, audience: 'all', category: 'account', subject: 'Release', body: 'Secret text here', expectedCount: expected })).id;
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM email_broadcast_recipients WHERE broadcast_id = $1', [id]))[0].n, expected);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'broadcast.queue' AND detail::text NOT LIKE '%Secret%'"))[0].n >= 1, true);
      const job = await dbBroadcast.claimNext();
      assert.equal(job.id, id, 'the oldest queued send is the one claimed');
      const batch = await dbBroadcast.pendingBatch(job.id, 1000);
      assert.equal(batch.length, expected);
      assert.ok(batch.every((r) => r.email && r.unsubscribe_token), 'each recipient has an address and a token');
      for (const r of batch) await dbBroadcast.markRecipient(job.id, r.player_id, 'sent', job.owner);
      await dbBroadcast.finishBroadcast(job.id, job.owner);
      const row = (await dbBroadcast.listBroadcasts()).items.find((x) => x.id === id);
      assert.equal(row.status, 'sent');
      assert.equal(row.sent_count, expected);
      assert.ok(!('body' in row), 'the history carries no text');
    });
    await test('a finished broadcast keeps its totals when a recipient deletes the account afterwards', async () => {
      const ownerId = (await q("SELECT id FROM players WHERE role = 'owner'"))[0].id;
      const gone = await mk('gone', { verified: true });
      const expected = await count('all', 'account');
      const id = (await dbBroadcast.queueBroadcast({ actorId: ownerId, audience: 'all', category: 'account', subject: 'Totals', body: 'Body', expectedCount: expected })).id;
      const job = await dbBroadcast.claimNext();
      assert.equal(job.id, id);
      for (const r of await dbBroadcast.pendingBatch(job.id, 1000)) {
        await dbBroadcast.markRecipient(job.id, r.player_id, r.player_id === gone ? 'failed' : 'sent', job.owner);
      }
      await dbBroadcast.finishBroadcast(job.id, job.owner);
      const before = (await dbBroadcast.listBroadcasts()).items.find((x) => x.id === id);
      assert.equal(before.failed_count, 1);
      await q('DELETE FROM players WHERE id = $1', [gone]);
      const after = (await dbBroadcast.listBroadcasts()).items.find((x) => x.id === id);
      assert.equal(after.sent_count, before.sent_count, 'sent total is kept');
      assert.equal(after.failed_count, before.failed_count, 'failed total is kept');
      assert.equal(after.recipient_count, expected, 'the queued count is kept');
    });
    await test('an opt-out from a promotion link takes effect at once and is not reversed by a second visit', async () => {
      const token = (await q("SELECT unsubscribe_token::text AS t FROM players WHERE username LIKE $1 LIMIT 1", [`bc${tag}v`]))[0].t;
      const before = await count('all', 'promo');
      assert.equal(await dbBroadcast.unsubscribe(token), true);
      assert.equal(await count('all', 'promo') - before, -1);
      assert.equal(await dbBroadcast.unsubscribe(token), true, 'a second visit is harmless');
      assert.equal(await dbBroadcast.unsubscribe('00000000-0000-4000-8000-000000000000'), false, 'an unknown token changes nothing');
    });
    await test('insights: exact-day returns on day 7 and day 30, and the median length per game', async () => {
      const ins = require('../db/insights');
      const DAY = 86400000;
      const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
      const cohort = async () => (await ins.insights({ days: 7, tz: 'UTC' })).returning.cohort;
      const mk = async (player, game, at, mins) => {
        const m = (await q(`INSERT INTO matches (match_key, room_code, game_id, seats, started_at, finished_at)
                            VALUES (gen_random_uuid(), 'RET1', $1, 2, $2::timestamptz, $2::timestamptz + make_interval(mins => $3)) RETURNING id`, [game, at, mins]))[0].id;
        await q('INSERT INTO match_participants (match_id, player_id, player_name, seat, is_winner, is_bot, left_early, is_draw) VALUES ($1,$2,$3,0,false,false,false,false)', [m, player, 'x']);
      };
      const before = await cohort();
      const dee = await newUser('Rda'); const aya = await newUser('Rdb'); const bob = await newUser('Rdc'); const cyra = await newUser('Rdd');
      // first game 9 days ago, back the next day: in the D1 and D7 cohort
      await mk(dee.id, 'ludo', ago(9), 15); await mk(dee.id, 'ludo', ago(8), 15);
      // first game 33 days ago, back exactly on day 7 (26 days ago) and exactly on day 30 (3 days ago)
      await mk(aya.id, 'ludo', ago(33), 15); await mk(aya.id, 'ludo', ago(26), 15); await mk(aya.id, 'ludo', ago(3), 15);
      // first game 33 days ago, back only the next day: in the D30 cohort, not an exact-day return
      await mk(bob.id, 'ludo', ago(33), 15); await mk(bob.id, 'ludo', ago(32), 15);
      // first game 35 days ago, back exactly on day 30 (5 days ago)
      await mk(cyra.id, 'ludo', ago(35), 15); await mk(cyra.id, 'ludo', ago(5), 15);
      const after = await cohort();
      const delta = (k) => after[k] - before[k];
      assert.equal(delta('size'), 1, 'one new player in the D1 and D7 cohort');
      assert.equal(delta('d1'), 1, 'and that player came back the next day');
      assert.equal(delta('d7'), 1, 'and within the week');
      assert.equal(delta('d7Exact'), 0, 'but not on exactly day 7');
      assert.equal(delta('size30'), 3, 'three new players in the D30 cohort');
      assert.equal(delta('d30Exact'), 2, 'two of them came back on exactly day 30');
      // median of the lengths 10, 15, 15, 20, 60 is 15; the average is 24
      const lengths = [[dee.id, 10], [aya.id, 20], [bob.id, 60], [cyra.id, 15], [aya.id, 15]];
      for (const [i, [player, mins]] of lengths.entries()) await mk(player, 'medianprobe', ago(1 + i * 0.1), mins);
      const game = (await ins.insights({ days: 7, tz: 'UTC' })).games.find((g) => g.gameId === 'medianprobe');
      assert.equal(game.matches, 5);
      assert.equal(game.medianMinutes, 15, 'the median is 15 minutes');
      assert.equal(game.avgMinutes, 24, 'and the average is 24');
    });
    console.log(`${passed} admin PostgreSQL checks passed`);
  } finally {
    if (srvB) await srvB.close();
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL admin.pg', e); process.exit(1); });
