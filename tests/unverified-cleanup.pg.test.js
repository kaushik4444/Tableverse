'use strict';
require('./helpers/env');
// The 30-day unverified-account cleanup on a REAL PostgreSQL (throw-away database from tests/helpers/testdb.js).
// Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const DAY = 24 * 60 * 60 * 1000;

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  process.env.DATABASE_URL = t.url; // only now: db/pool reads it when it is first required, and env.js removed it
  try {
    await require('../db/migrate').migrate();
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const cleanup = require('../db/unverifiedCleanup');

    // Account fixtures are written directly: the cleanup is about the rows, not the registration route.
    let seq = 0;
    async function account({ name, ageDays, verified = false, email = true }) {
      seq++;
      const [p] = await q(
        `INSERT INTO players (display_name, username, is_anonymous, created_at) VALUES ($1, $2, $3, NOW() - ($4 || ' days')::interval) RETURNING id`,
        [name, `u${seq}_${name.toLowerCase()}`.slice(0, 24), !email, String(ageDays)],
      );
      if (email) {
        await q(
          `INSERT INTO auth_identities (player_id, provider, provider_user_id, email, password_hash, email_verified_at) VALUES ($1, 'email', $2, $3, NULL, ${verified ? 'NOW()' : 'NULL'})`,
          [p.id, `${name.toLowerCase()}${seq}@test.local`, `${name.toLowerCase()}${seq}@test.local`],
        );
      }
      return p.id;
    }
    const oldUnverified = await account({ name: 'Old', ageDays: 31 });
    const oldVerified = await account({ name: 'Verified', ageDays: 90, verified: true });
    const freshUnverified = await account({ name: 'Fresh', ageDays: 5 });
    const oldGuest = await account({ name: 'Guest', ageDays: 90, email: false });
    const justInside = await account({ name: 'Edge', ageDays: 29 });
    const count = async () => (await q('SELECT COUNT(*)::int AS n FROM players'))[0].n;
    const before = await count();

    await test('a dry run counts the unverified accounts older than 30 days and deletes nothing', async () => {
      const r = await cleanup.cleanUnverified({ days: 30, execute: false });
      assert.deepEqual(r, { dryRun: true, candidates: 1, deleted: 0, batches: 0 });
      assert.equal(await count(), before);
    });

    await test('the 30-day rule counts only what it should: not guests, not verified, not recent', async () => {
      assert.equal(await cleanup.countUnverified({ days: 30 }), 1);
      assert.equal(await cleanup.countUnverified({ days: 4 }), 3, 'a shorter period also takes the 5- and 29-day-old unverified accounts');
    });

    await test('the execute run removes exactly the old unverified account and its own rows', async () => {
      const r = await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.equal(r.dryRun, false);
      assert.equal(r.deleted, 1);
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [oldUnverified])).length, 0, 'the account is gone');
      assert.equal((await q('SELECT 1 FROM auth_identities WHERE player_id = $1', [oldUnverified])).length, 0, 'its login rows cascade');
      for (const keep of [oldVerified, freshUnverified, oldGuest, justInside]) {
        assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [keep])).length, 1, 'kept');
      }
    });

    await test('a second run finds nothing left to remove', async () => {
      const r = await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.equal(r.deleted, 0);
      assert.equal(await count(), before - 1);
    });

    await test('the operator script refuses without a database and runs a dry run by default', async () => {
      const script = path.join(__dirname, '..', 'scripts', 'cleanup-unverified.js');
      const run = (args, env) => new Promise((resolve) => {
        execFile(process.execPath, [script, ...args], { env: { ...process.env, ...env }, timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
      });
      const r = await run([], { DATABASE_URL: t.url });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /Dry run\. 0 unverified account\(s\) older than 30 days would be removed/);
      assert.equal(await count(), before - 1, 'still nothing deleted');
      const none = await run([], { DATABASE_URL: '' });
      assert.equal(none.code, 2);
    });

    await test('an old account whose only login is not e-mail is outside the cleanup', async () => {
      const id = await account({ name: 'Local', ageDays: 60, email: false });
      await q(
        `INSERT INTO auth_identities (player_id, provider, provider_user_id, email, password_hash, email_verified_at) VALUES ($1, 'local', $2, $3, NULL, NULL)`,
        [id, `local-${seq}`, `local${seq}@test.local`],
      );
      assert.equal(await cleanup.countUnverified({ days: 30 }), 0, 'a local login with no e-mail login is not a candidate');
      const r = await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.equal(r.deleted, 0);
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [id])).length, 1, 'kept');
    });

    await test('a removed account keeps its match rows, with its name removed', async () => {
      const id = await account({ name: 'Played', ageDays: 45 });
      const [m] = await q(`INSERT INTO matches (room_code, game_id, seats) VALUES ('TST1', 'wizard', 2) RETURNING id`);
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat) VALUES ($1, $2, 'Played', 0)`, [m.id, id]);
      const r = await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.equal(r.deleted, 1);
      const [row] = await q('SELECT player_id, player_name FROM match_participants WHERE match_id = $1', [m.id]);
      assert.equal(row.player_id, null, 'the link to the account is cleared');
      assert.equal(row.player_name, require('../db/matches').DELETED_NAME, 'the name goes with the account');
    });

    await test('an unverified e-mail login does not expose an account that has a verified login of another provider', async () => {
      const id = await account({ name: 'Mixed', ageDays: 60 });
      await q(
        `INSERT INTO auth_identities (player_id, provider, provider_user_id, email, password_hash, email_verified_at) VALUES ($1, 'local', $2, $3, NULL, NOW())`,
        [id, `mixed-local-${seq}`, `mixed-local-${seq}@test.local`],
      );
      const [m] = await q(`INSERT INTO matches (room_code, game_id, seats) VALUES ('TST2', 'wizard', 2) RETURNING id`);
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat) VALUES ($1, $2, 'Mixed', 0)`, [m.id, id]);
      assert.equal(await cleanup.countUnverified({ days: 30 }), 0, 'a verified login of any provider protects the account (dry run)');
      const r = await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.equal(r.deleted, 0, 'and the execute run keeps it');
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [id])).length, 1, 'kept');
      const [row] = await q('SELECT player_id, player_name FROM match_participants WHERE match_id = $1', [m.id]);
      assert.equal(row.player_id, id, 'its match attribution is untouched');
      assert.equal(row.player_name, 'Mixed');
    });

    // ---- roles, cascades, the dry run's privileges (added with the read-only dry run)
    const pool = require('../db/pool');
    const cutoff = cleanup.cutoffFor(new Date(), 30);
    const candidateSql = `SELECT p.id FROM players p WHERE ${cleanup.CANDIDATE}`;
    const isCandidate = async (id) => (await x.query(candidateSql + ' AND p.id = $2', [cutoff, id])).rowCount === 1;

    await test('administrators and owners are never candidates, even unverified and older than 30 days', async () => {
      const adm = await account({ name: 'Adm', ageDays: 60 });
      const own = await account({ name: 'Own', ageDays: 60 });
      const plain = await account({ name: 'Plain', ageDays: 60 });
      await q("UPDATE players SET role = 'admin' WHERE id = $1", [adm]);
      await q("UPDATE players SET role = 'owner' WHERE id = $1", [own]);
      assert.equal(await isCandidate(adm), false, 'an admin is excluded');
      assert.equal(await isCandidate(own), false, 'the owner is excluded');
      assert.equal(await isCandidate(plain), true, 'a plain unverified account is still a candidate');
      await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [adm])).length, 1, 'the admin is kept by an execute run');
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [own])).length, 1, 'the owner is kept by an execute run');
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [plain])).length, 0, 'the plain account is removed');
    });

    await test('deleting an account removes its own links in both directions: friends, requests, invitations, blocks, reports, dismissals, sessions, recent tables; the other account and match history stay', async () => {
      const keep = await account({ name: 'Keep', ageDays: 200, verified: true });
      const gone = await account({ name: 'Gone', ageDays: 40 });
      const [lo, hi] = [gone, keep].sort();
      await q('INSERT INTO friendships (player_a_id, player_b_id) VALUES ($1, $2)', [lo, hi]);
      await q("INSERT INTO friend_requests (requester_id, recipient_id) VALUES ($1, $2)", [gone, keep]);
      await q("INSERT INTO private_table_invitations (inviter_id, invitee_id, game_id, room_code, expires_at) VALUES ($1, $2, 'wizard', 'ABCDEF', NOW() + INTERVAL '1 day')", [gone, keep]);
      await q("INSERT INTO private_table_invitations (inviter_id, invitee_id, game_id, room_code, expires_at) VALUES ($1, $2, 'wizard', 'BCDEFG', NOW() + INTERVAL '1 day')", [keep, gone]);
      await q('INSERT INTO player_blocks (blocker_id, blocked_id) VALUES ($1, $2), ($2, $1)', [gone, keep]);
      await q("INSERT INTO chat_reports (reporter_id, reported_id, room_code, message_id, message_text, reason) VALUES ($1, $2, 'ABCDEF', gen_random_uuid(), 'x', 'spam'), ($2, $1, 'ABCDEF', gen_random_uuid(), 'y', 'spam')", [keep, gone]);
      const [ann] = await q("INSERT INTO announcements (message, ends_at) VALUES ('Dismissed', NOW() + INTERVAL '1 day') RETURNING id");
      await q('INSERT INTO announcement_dismissals (player_id, announcement_id, dismissed_revision) VALUES ($1, $2, 1)', [gone, ann.id]);
      await q("INSERT INTO auth_sessions (player_id, token_hash) VALUES ($1, repeat('a', 64))", [gone]);
      await q("INSERT INTO player_recent_tables (player_id, room_code, game_id) VALUES ($1, 'ABCDEF', 'wizard')", [gone]);
      const [m] = await q(`INSERT INTO matches (room_code, game_id, seats) VALUES ('TST2', 'wizard', 2) RETURNING id`);
      await q(`INSERT INTO match_participants (match_id, player_id, player_name, seat) VALUES ($1, $2, 'Gone', 0)`, [m.id, gone]);

      const r = await cleanup.cleanUnverified({ days: 30, execute: true });
      assert.ok(r.deleted >= 1);
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [gone])).length, 0, 'the account is removed');
      assert.equal((await q('SELECT 1 FROM players WHERE id = $1', [keep])).length, 1, 'the other account stays');
      const count = async (sql) => (await q(sql, [gone, keep]))[0].n;
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM friendships WHERE player_a_id = ANY($1::uuid[]) OR player_b_id = ANY($1::uuid[])'), 0, 'friendships gone');
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM friend_requests WHERE requester_id = ANY($1::uuid[]) OR recipient_id = ANY($1::uuid[])'), 0, 'friend requests gone');
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM private_table_invitations WHERE inviter_id = ANY($1::uuid[]) OR invitee_id = ANY($1::uuid[])'), 0, 'invitations gone in both directions');
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM player_blocks WHERE blocker_id = ANY($1::uuid[]) OR blocked_id = ANY($1::uuid[])'), 0, 'blocks gone in both directions');
      // Documented behaviour: a report is deleted with either account it names (migration 010, ON DELETE CASCADE on both keys).
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = ANY($1::uuid[]) OR reported_id = ANY($1::uuid[])'), 0, 'reports in both directions gone (cascade)');
      assert.equal((await q('SELECT 1 FROM announcement_dismissals WHERE player_id = $1', [gone])).length, 0, 'dismissals gone');
      assert.equal((await q('SELECT 1 FROM auth_sessions WHERE player_id = $1', [gone])).length, 0, 'sessions gone');
      assert.equal((await q('SELECT 1 FROM player_recent_tables WHERE player_id = $1', [gone])).length, 0, 'recent tables gone');
      assert.equal((await q('SELECT 1 FROM announcements WHERE id = $1', [ann.id])).length, 1, 'the announcement itself stays');
      const [row] = await q('SELECT player_id, player_name FROM match_participants WHERE match_id = $1', [m.id]);
      assert.equal(row.player_id, null);
      assert.equal(row.player_name, require('../db/matches').DELETED_NAME);
    });

    await test('every foreign key to players either cascades or clears on delete, so none can block a cleanup', async () => {
      const rows = await q(`SELECT conrelid::regclass::text AS tbl, array_agg(DISTINCT confdeltype::text ORDER BY confdeltype::text) AS acts
                              FROM pg_constraint WHERE contype = 'f' AND confrelid = 'players'::regclass GROUP BY 1 ORDER BY 1`);
      const actual = Object.fromEntries(rows.map((r) => [r.tbl, r.acts]));
      assert.deepEqual(actual, {
        admin_audit_log: ['n'],
        announcement_dismissals: ['c'],
        announcements: ['n'],
        auth_email_tokens: ['c'],
        auth_identities: ['c'],
        auth_sessions: ['c'],
        chat_reports: ['c'],
        feedback: ['n'],
        friend_requests: ['c'],
        friendships: ['c'],
        match_participants: ['n'],
        player_blocks: ['c'],
        player_recent_tables: ['c'],
        private_table_invitations: ['c'],
      }, 'c = CASCADE, n = SET NULL; a new reference must be classified here and in docs/DATA_CLEANUP.md');
    });

    await test('the dry run refuses a role that can write and issues no UPDATE, DELETE, INSERT or TRUNCATE', async () => {
      const real = pool.withTransaction;
      const seen = [];
      pool.withTransaction = (fn) => real((c) => {
        const query = c.query.bind(c);
        c.query = (sql, ...rest) => { seen.push(String(sql)); return query(sql, ...rest); };
        return fn(c);
      });
      try {
        const before = (await q('SELECT COUNT(*)::int AS n FROM players'))[0].n;
        // the test connection is a superuser, which can write: the dry run must refuse before it counts anything
        await assert.rejects(cleanup.cleanUnverified({ days: 30, execute: false }), (e) => e.code === 'READONLY_ROLE_REQUIRED');
        assert.equal((await q('SELECT COUNT(*)::int AS n FROM players'))[0].n, before, 'nothing was deleted');
      } finally {
        pool.withTransaction = real;
      }
      assert.ok(seen.length > 0, 'the check ran');
      for (const sql of seen) assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE|INSERT|TRUNCATE|ALTER|DROP|CREATE)\b/i, sql);
    });

    await test('a SELECT-only role passes the guard and counts the candidates; a write is refused by the role and by a read-only transaction', async () => {
      const name = `cleanup_ro_${Date.now().toString(36)}`;
      const password = `pw_${Math.random().toString(36).slice(2)}`;
      const dbName = (await q('SELECT current_database() AS d'))[0].d;
      const ident = (v) => `"${String(v).replace(/"/g, '""')}"`;
      await x.query(`CREATE ROLE ${ident(name)} LOGIN PASSWORD '${password}'`);
      await x.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(name)}`);
      await x.query(`GRANT USAGE ON SCHEMA public TO ${ident(name)}`);
      await x.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ident(name)}`);
      const { Client } = require('pg');
      const u = new URL(t.url);
      u.username = name; u.password = password;
      const ro = new Client({ connectionString: u.toString() });
      await ro.connect();
      try {
        await ro.query('BEGIN');
        await ro.query('SET TRANSACTION READ ONLY');
        await cleanup.assertCannotWrite(ro); // resolves: the role has no write privilege
        const n = await cleanup.countCandidates(ro, cutoff);
        await ro.query('COMMIT');
        assert.equal(n, (await q(`SELECT COUNT(*)::int AS n FROM players p WHERE ${cleanup.CANDIDATE}`, [cutoff]))[0].n, 'the same count as the owner sees');
        await assert.rejects(ro.query('DELETE FROM players WHERE false'), (e) => e.code === '42501', 'the role cannot delete');
        await assert.rejects(ro.query("UPDATE players SET display_name = display_name WHERE false"), (e) => e.code === '42501', 'the role cannot update');
        // the server-side backstop: even the owner cannot write inside a READ ONLY transaction
        await x.query('BEGIN');
        await x.query('SET TRANSACTION READ ONLY');
        await assert.rejects(x.query('DELETE FROM players WHERE false'), (e) => e.code === '25006', 'a read-only transaction refuses a DELETE');
        await x.query('ROLLBACK');
      } finally {
        await ro.end().catch(() => {});
        await x.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ident(name)}`);
        await x.query(`REVOKE USAGE ON SCHEMA public FROM ${ident(name)}`);
        await x.query(`REVOKE CONNECT ON DATABASE ${ident(dbName)} FROM ${ident(name)}`);
        await x.query(`DROP ROLE ${ident(name)}`);
      }
    });
  } finally {
    await t.drop();
  }
  console.log(`\n${passed} unverified-cleanup PostgreSQL tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
