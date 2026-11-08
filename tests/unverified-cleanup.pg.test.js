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
  } finally {
    await t.drop();
  }
  console.log(`\n${passed} unverified-cleanup PostgreSQL tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
