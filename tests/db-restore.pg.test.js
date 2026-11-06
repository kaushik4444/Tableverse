'use strict';
// Recovery rehearsal on throw-away databases: migrate a source, dump it, restore into an empty target, check the result,
// and confirm the restore check refuses the cases that could hurt production or overwrite data.
require('./helpers/env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pgEnvFromUrl, backup } = require('../scripts/db-backup');
const { restoreCheck, expectedMigrations } = require('../scripts/db-restore-check');
const { assertSafe } = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;

(async () => {
  const base = process.env.TEST_DATABASE_URL;
  const absentTool = ['psql', 'pg_dump', 'pg_restore'].find((c) => !have(c));
  const missing = !base ? 'TEST_DATABASE_URL is not set' : absentTool ? `${absentTool} is not installed` : null;
  if (missing) {
    if (process.argv.includes('--require')) { console.error('FAIL  recovery rehearsal required but ' + missing); process.exit(1); }
    console.log('SKIPPED  recovery rehearsal: ' + missing);
    return;
  }
  assertSafe(base);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-restore-test-'));
  const run = (url, sql) => {
    const r = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: { PATH: process.env.PATH, ...pgEnvFromUrl(url) }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').split('\n')[0].replace(/postgres:\/\/\S+/g, '[url]'));
    return r.stdout.trim();
  };
  const runFile = (url, file) => {
    const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { env: { PATH: process.env.PATH, ...pgEnvFromUrl(url) }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('migration SQL failed: ' + path.basename(file));
  };
  const withDb = (suffix) => Object.assign(new URL(base), { pathname: '/tv_test_restore_' + suffix + '_' + crypto.randomBytes(4).toString('hex') });
  const maintenance = Object.assign(new URL(base), { pathname: '/postgres' }).toString();
  const created = [];
  const createDb = (u) => { run(maintenance, `CREATE DATABASE ${u.pathname.slice(1)}`); created.push(u.pathname.slice(1)); return u.toString(); };

  try {
    // Source: the real migrations applied in order, plus a few rows of synthetic data.
    const source = createDb(withDb('src'));
    const migrations = path.join(__dirname, '..', 'db', 'migrations');
    for (const f of expectedMigrations()) runFile(source, path.join(migrations, f));
    run(source, `INSERT INTO schema_migrations (version) SELECT unnest(ARRAY[${expectedMigrations().map((f) => `'${f}'`).join(',')}]) ON CONFLICT DO NOTHING;
      INSERT INTO players (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Synthetic One'), ('22222222-2222-2222-2222-222222222222', 'Synthetic Two');
      INSERT INTO auth_identities (player_id, provider, provider_user_id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'local', 'synthetic-one', 'synthetic-one@example.invalid');
      INSERT INTO matches (id, room_code, game_id, seats) VALUES ('33333333-3333-3333-3333-333333333333', 'ABCD', 'gofish', 2);
      INSERT INTO match_participants (match_id, player_id, player_name, seat) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Synthetic One', 0);`);

    const dump = path.join(scratch, 'rehearsal.dump');
    await backup({ url: source, out: dump });

    await test('restoring the dump into an empty database reproduces every migration and the row counts', async () => {
      const target = createDb(withDb('dst'));
      const report = await restoreCheck({ dump, target, production: null });
      assert.equal(report.ok, true, JSON.stringify(report));
      assert.deepEqual(report.migrations.missing, []);
      assert.deepEqual(report.migrations.unexpected, []);
      assert.deepEqual(report.counts, { players: 2, auth_identities: 1, matches: 1, match_participants: 1, friendships: 0 });
      assert.deepEqual(report.orphans, { match_participants_without_match: 0, auth_identities_without_player: 0 });
      assert.equal(report.unvalidatedForeignKeys, 0);
    });

    await test('the restore check refuses a target that already holds tables (nothing is overwritten)', async () => {
      const target = createDb(withDb('busy'));
      run(target, 'CREATE TABLE keep_me (id INT)');
      await assert.rejects(restoreCheck({ dump, target, production: null }), /not empty/);
      assert.equal(run(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"), '1');
    });

    await test('the restore check refuses a target that is the production database', async () => {
      const target = createDb(withDb('prod'));
      await assert.rejects(restoreCheck({ dump, target, production: target }), /production database/);
      assert.equal(run(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"), '0');
    });

    await test('a dump whose bytes changed is refused before anything is written to the target', async () => {
      const tampered = path.join(scratch, 'tampered.dump');
      fs.copyFileSync(dump, tampered);
      fs.copyFileSync(dump + '.sha256', tampered + '.sha256');
      fs.appendFileSync(tampered, 'x');
      const target = createDb(withDb('tamper'));
      await assert.rejects(restoreCheck({ dump: tampered, target, production: null }), /checksum mismatch/);
      assert.equal(run(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"), '0');
    });
  } finally {
    for (const name of created) {
      try { run(maintenance, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } catch { /* best effort: names are unique */ }
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`\n${passed} recovery rehearsal tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
