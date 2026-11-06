'use strict';
// Backup script: connection handling, output rules, failure behaviour and (with TEST_DATABASE_URL) a real dump and verification.
require('./helpers/env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pgEnvFromUrl, checkOutPath, backup, verifyArchive } = require('../scripts/db-backup');
const { assertSafe } = require('./helpers/testdb');

let passed = 0;
let skipped = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-backup-test-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

(async () => {
  // ---- connection strings: parts go to PG* variables, never to a command line
  await test('a Neon-style URL with an encoded password is split into PG* variables', async () => {
    const env = pgEnvFromUrl('postgres://tv%5Fapp:p%40ss%2Fw@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require');
    assert.deepEqual(env, { PGHOST: 'ep-x.eu-central-1.aws.neon.tech', PGPORT: '5432', PGUSER: 'tv_app', PGPASSWORD: 'p@ss/w', PGDATABASE: 'neondb', PGSSLMODE: 'require' });
  });

  await test('a remote host without sslmode in the URL still requires TLS', async () => {
    assert.equal(pgEnvFromUrl('postgres://u:p@db.example.net/app').PGSSLMODE, 'require');
  });

  await test('a loopback host without sslmode is left to the client default', async () => {
    assert.equal(pgEnvFromUrl('postgres://u:p@127.0.0.1:5433/app').PGSSLMODE, undefined);
  });

  await test('bad URLs are refused without echoing them', async () => {
    for (const bad of [undefined, '', 'mysql://u:Sup3rSecretPw@h/db', 'postgres://u:Sup3rSecretPw@h/', 'postgres://:Sup3rSecretPw@h/db']) {
      let message = '';
      try { pgEnvFromUrl(bad); } catch (e) { message = e.message; }
      assert.ok(message, 'expected a refusal for ' + bad);
      assert.ok(!message.includes('Sup3rSecretPw'), message);
    }
  });

  // ---- output path rules
  await test('the backup must be a .dump file outside the repository and must not overwrite', async () => {
    const repoFile = path.join(__dirname, '..', 'backups', 'x.dump');
    assert.throws(() => checkOutPath(repoFile), /inside the repository/);
    assert.throws(() => checkOutPath(path.join(scratch, 'x.sql')), /must end in \.dump/);
    assert.throws(() => checkOutPath(path.join(scratch, 'missing-folder', 'x.dump')), /folder .* does not exist/);
    fs.writeFileSync(path.join(scratch, 'taken.dump'), '');
    assert.throws(() => checkOutPath(path.join(scratch, 'taken.dump')), /refusing to overwrite/);
    assert.equal(checkOutPath(path.join(scratch, 'fresh.dump')), path.join(scratch, 'fresh.dump'));
  });

  // ---- failure behaviour against an unreachable server (needs pg_dump, nothing else)
  if (!have('pg_dump')) {
    console.log('SKIPPED  unreachable-database and dump tests: pg_dump is not installed');
    skipped++;
  } else {
    await test('an unreachable database fails, leaves no file behind and never prints the password', async () => {
      const out = path.join(scratch, 'unreachable.dump');
      let message = '';
      try {
        await backup({ url: 'postgres://tv_app:Sup3rSecretPw@127.0.0.1:1/tv', out });
      } catch (e) { message = e.message; }
      assert.ok(message.includes('pg_dump failed'), message);
      assert.ok(!message.includes('Sup3rSecretPw'), message);
      assert.ok(!fs.existsSync(out), 'no dump file');
      assert.ok(!fs.existsSync(out + '.partial'), 'no partial file');
      assert.ok(!fs.existsSync(out + '.sha256'), 'no checksum file');
    });
  }

  // ---- full dump against a real throw-away database
  const base = process.env.TEST_DATABASE_URL;
  if (!base || !have('psql') || !have('pg_dump')) {
    const why = !base ? 'TEST_DATABASE_URL is not set' : 'psql or pg_dump is not installed';
    if (process.argv.includes('--require')) {
      console.error(`FAIL  PostgreSQL backup test required but ${why}`);
      process.exit(1);
    }
    console.log(`SKIPPED  full backup and verification against PostgreSQL: ${why}`);
    skipped++;
  } else {
    assertSafe(base); // refuses managed/production hosts, exactly as the other PostgreSQL tests do
    const name = 'tv_test_backup_' + crypto.randomBytes(5).toString('hex');
    const maintenance = Object.assign(new URL(base), { pathname: '/postgres' }).toString();
    const runSql = (url, sql) => {
      const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        env: { PATH: process.env.PATH, ...pgEnvFromUrl(url) }, encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error('psql failed: ' + (r.stderr || '').split('\n')[0].replace(/postgres:\/\/\S+/g, '[url]'));
      return r.stdout;
    };
    const url = Object.assign(new URL(base), { pathname: '/' + name }).toString();
    try {
      runSql(maintenance, `CREATE DATABASE ${name}`);
      runSql(url, `CREATE TABLE schema_migrations (version VARCHAR(64) PRIMARY KEY);
        INSERT INTO schema_migrations VALUES ('001_init.sql');
        CREATE TABLE players (id INT PRIMARY KEY, name TEXT);
        INSERT INTO players VALUES (1, 'test-player');`);

      await test('a dump is written, is private (0600), has a checksum file and lists the expected tables', async () => {
        const out = path.join(scratch, 'full.dump');
        const r = await backup({ url, out });
        assert.equal(r.file, out);
        assert.ok(r.tables >= 2, `tables=${r.tables}`);
        assert.equal(r.hasMigrations, true);
        assert.equal(fs.statSync(out).mode & 0o777, 0o600);
        assert.ok(!fs.existsSync(out + '.partial'));
        const sum = fs.readFileSync(out + '.sha256', 'utf8').split(/\s+/)[0];
        assert.equal(sum, r.sha256);
        assert.equal(sum, crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'));
      });

      await test('verification accepts the untouched dump and rejects a modified copy', async () => {
        const out = path.join(scratch, 'full.dump');
        const ok = await verifyArchive(out);
        assert.equal(ok.checksumChecked, true);
        // a copy whose bytes differ, carrying the original's checksum file
        const tampered = path.join(scratch, 'tampered.dump');
        fs.copyFileSync(out, tampered);
        fs.copyFileSync(out + '.sha256', tampered + '.sha256');
        fs.appendFileSync(tampered, 'x');
        await assert.rejects(verifyArchive(tampered), /checksum mismatch/);
      });

      await test('a file that is not a PostgreSQL archive is rejected by verification', async () => {
        const junk = path.join(scratch, 'junk.dump');
        fs.writeFileSync(junk, 'not a dump');
        await assert.rejects(verifyArchive(junk), /not readable/);
      });
    } finally {
      try { runSql(maintenance, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } catch { /* best effort; the name is unique */ }
    }
  }

  console.log(`\n${passed} backup tests passed${skipped ? `, ${skipped} skipped` : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
