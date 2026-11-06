'use strict';
// Backup script: connection handling, output rules, failure behaviour and (with TEST_DATABASE_URL) a real dump and verification.
require('./helpers/env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pgEnvFromUrl, checkOutPath, backup, verifyArchive, createPrivateExclusive } = require('../scripts/db-backup');
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
  await test('a URL host parameter selects the Unix socket and does not force TLS', async () => {
    const env = pgEnvFromUrl('postgres://u:p@localhost/app?host=%2Fvar%2Frun%2Fpostgresql');
    assert.equal(env.PGHOST, '/var/run/postgresql');
    assert.equal(env.PGSSLMODE, undefined);
  });

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

  // Regression: libpq reads a database name with `=` or a postgres:// prefix as a connection string, so it could point
  // pg_restore at another server (and past the production check). Such names are refused before any tool runs.
  await test('a database name the PostgreSQL tools would read as a connection string is refused', async () => {
    for (const bad of [
      'postgres://u:Sup3rSecretPw@127.0.0.1:5432/tv%3Dhost%3Devil',
      'postgres://u:Sup3rSecretPw@127.0.0.1:5432/postgres:%2F%2Fother%2Fdb',
      'postgres://u:Sup3rSecretPw@127.0.0.1:5432/host=other',
    ]) {
      let message = '';
      try { pgEnvFromUrl(bad); } catch (e) { message = e.message; }
      assert.match(message, /connection string/, `expected a refusal for ${bad}`);
      assert.ok(!message.includes('Sup3rSecretPw'), message);
    }
    assert.equal(pgEnvFromUrl('postgres://u:p@127.0.0.1:5432/tv_test_restore_abc123').PGDATABASE, 'tv_test_restore_abc123');
  });

  // ---- output path rules
  await test('the backup must be a .dump file outside the repository and must not overwrite', async () => {
    const repoFile = path.join(__dirname, '..', 'backups', 'x.dump');
    assert.throws(() => checkOutPath(repoFile), /inside the repository/);
    assert.throws(() => checkOutPath(path.join(scratch, 'x.sql')), /must end in \.dump/);
    assert.throws(() => checkOutPath(path.join(scratch, 'missing-folder', 'x.dump')), /folder .* does not exist/);
    fs.writeFileSync(path.join(scratch, 'taken.dump'), '');
    assert.throws(() => checkOutPath(path.join(scratch, 'taken.dump')), /refusing to overwrite/);
    assert.equal(checkOutPath(path.join(scratch, 'fresh.dump')), path.join(fs.realpathSync(scratch), 'fresh.dump'));
  });

  // Regression: path.resolve() does not follow a symlinked folder, so a link pointing into the checkout used to pass.
  await test('a symlinked folder that leads into the repository is refused, and the canonical path is returned otherwise', async () => {
    const repoLink = path.join(scratch, 'looks-external');
    fs.symlinkSync(path.join(__dirname, '..'), repoLink, 'dir');
    assert.throws(() => checkOutPath(path.join(repoLink, 'x.dump')), /inside the repository/);
    assert.throws(() => checkOutPath(path.join(repoLink, 'deeper', 'x.dump')), /folder .* does not exist|inside the repository/);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-outside-'));
    const outsideLink = path.join(scratch, 'backups-link');
    fs.symlinkSync(outside, outsideLink, 'dir');
    try {
      assert.equal(checkOutPath(path.join(outsideLink, 'ok.dump')), path.join(fs.realpathSync(outside), 'ok.dump'));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // Regression: a dangling symlink at the destination is not "absent", and writing through it could land in the repo.
  await test('a dangling symlink at the destination name counts as taken and is not followed', async () => {
    const target = path.join(__dirname, '..', 'dangling-target.dump');
    const link = path.join(scratch, 'dangling.dump');
    fs.symlinkSync(target, link);
    assert.throws(() => checkOutPath(link), /refusing to overwrite/);
    assert.ok(!fs.existsSync(target), 'nothing was created at the link target');
  });

  await test('a backup into a symlinked folder inside the repository writes nothing and refuses before pg_dump runs', async () => {
    const repoLink = path.join(scratch, 'into-repo');
    fs.symlinkSync(path.join(__dirname, '..'), repoLink, 'dir');
    await assert.rejects(backup({ url: 'postgres://u:Sup3rSecretPw@127.0.0.1:1/tv', out: path.join(repoLink, 'refused.dump') }), /inside the repository/);
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'refused.dump')));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'refused.dump.partial')));
  });

  await test('failed checksum initialization removes only the file this invocation created', async () => {
    const file = path.join(scratch, 'init-failure.partial');
    const originalWrite = fs.writeSync;
    fs.writeSync = () => { const err = new Error('simulated disk full'); err.code = 'ENOSPC'; throw err; };
    try {
      assert.throws(() => createPrivateExclusive(file, 'checksum'), /simulated disk full/);
      assert.ok(!fs.existsSync(file), 'the incomplete file is removed');
    } finally {
      fs.writeSync = originalWrite;
    }
  });

  // ---- reservation, concurrency and cleanup, with stand-in pg_dump / pg_restore (no database needed).
  // The database name in the URL selects the stand-in's behaviour: ok, slow (sleeps), fail (writes, then exits 4).
  const fakeDir = path.join(scratch, 'fake-tools');
  fs.mkdirSync(fakeDir);
  const script = (name, body) => {
    const p = path.join(fakeDir, name);
    fs.writeFileSync(p, '#!/bin/sh\n' + body, { mode: 0o755 });
    return p;
  };
  const fakeDump = script('pg_dump', `file=""
while [ $# -gt 0 ]; do if [ "$1" = "--file" ]; then file="$2"; fi; shift; done
# the reservation must already be private before anything is written
[ "$(stat -c %a "$file")" = "600" ] || exit 3
case "$PGDATABASE" in
  slow) sleep 0.4 ;;
  fail) printf partial > "$file"; echo "simulated failure" >&2; exit 4 ;;
esac
printf 'PGDMP fake archive' > "$file"
`);
  const fakeRestore = script('pg_restore', `echo "; fake archive"
echo "1; 1259 1 TABLE public schema_migrations tv"
echo "2; 1259 2 TABLE public players tv"
`);
  const fakeUrl = (db) => `postgres://tv_app:Sup3rSecretPw@127.0.0.1:5432/${db}`;
  const fake = (db) => ({ url: fakeUrl(db), pgDump: fakeDump, pgRestore: fakeRestore });
  const leftovers = (out) => [out + '.partial', out + '.sha256.partial'].filter((f) => fs.existsSync(f));

  await test('the working file is private from creation, even under a permissive umask', async () => {
    const out = path.join(scratch, 'umask.dump');
    const before = process.umask(0o000);
    try { await backup({ ...fake('ok'), out }); } finally { process.umask(before); }
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    assert.equal(fs.statSync(out + '.sha256').mode & 0o777, 0o600);
    assert.deepEqual(leftovers(out), []);
  });

  await test('a run that cannot reserve its partial file leaves another run\'s file untouched', async () => {
    const out = path.join(scratch, 'foreign.dump');
    fs.writeFileSync(out + '.partial', 'the other run is still writing', { mode: 0o600 });
    await assert.rejects(backup({ ...fake('ok'), out }), /another backup is writing/);
    assert.equal(fs.readFileSync(out + '.partial', 'utf8'), 'the other run is still writing');
    assert.ok(!fs.existsSync(out));
  });

  await test('a run that reserved its partial file but cannot stage its checksum leaves a foreign checksum file untouched', async () => {
    const out = path.join(scratch, 'foreign-sum.dump');
    fs.writeFileSync(out + '.sha256.partial', 'foreign checksum', { mode: 0o600 });
    await assert.rejects(backup({ ...fake('ok'), out }), /another backup is writing/);
    assert.equal(fs.readFileSync(out + '.sha256.partial', 'utf8'), 'foreign checksum');
    assert.ok(!fs.existsSync(out) && !fs.existsSync(out + '.partial'));
  });

  await test('a failed dump removes its own files and publishes nothing', async () => {
    const out = path.join(scratch, 'failing.dump');
    await assert.rejects(backup({ ...fake('fail'), out }), /pg_dump failed/);
    for (const f of [out, out + '.sha256', out + '.sha256.partial', out + '.partial']) assert.ok(!fs.existsSync(f), f);
  });

  await test('two runs aimed at the same destination: one publishes, the other is refused and removes nothing', async () => {
    const out = path.join(scratch, 'shared.dump');
    const results = await Promise.allSettled([backup({ ...fake('slow'), out }), backup({ ...fake('slow'), out })]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.reason && r.reason.message)));
    assert.equal(lost.length, 1);
    assert.match(lost[0].reason.message, /another backup is writing/);
    const check = await verifyArchive(out, { pgRestore: fakeRestore });
    assert.equal(check.sha256, won[0].value.sha256);
    assert.equal(check.checksumChecked, true);
    assert.deepEqual(leftovers(out), []);
  });

  await test('inspection (--verify) may read a dump without a checksum, but a malformed checksum file is always refused', async () => {
    const out = path.join(scratch, 'inspect.dump');
    await backup({ ...fake('ok'), out });
    fs.rmSync(out + '.sha256');
    const plain = await verifyArchive(out, { pgRestore: fakeRestore });
    assert.equal(plain.checksumChecked, false);
    fs.writeFileSync(out + '.sha256', 'garbage\n');
    await assert.rejects(verifyArchive(out, { pgRestore: fakeRestore }), /malformed/);
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
