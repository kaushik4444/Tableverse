#!/usr/bin/env node
'use strict';
/**
 * Independent PostgreSQL backup with pg_dump (custom format), independent of Neon's own backups.
 *
 *   DATABASE_URL='postgres://…' node scripts/db-backup.js --out /secure/place/tableverse-2026-11-06.dump
 *   node scripts/db-backup.js --verify /secure/place/tableverse-2026-11-06.dump
 *
 * Safety rules (see docs/OPERATIONS_RUNBOOK.md, "Backups"):
 *  - The connection string is never placed on a command line. Its parts go to pg_dump through environment variables,
 *    so `ps` and shell history never show the password.
 *  - Output goes to `<name>.partial` first. It becomes `<name>` only after the archive lists correctly, so a failed run
 *    never leaves a file that looks like a good backup.
 *  - Refuses an output path inside this repository, a name without `.dump`, and any existing file.
 *  - Writes a SHA-256 checksum next to the dump; --verify checks the checksum and the archive's table of contents.
 *  - Read-only against the database. Nothing is scheduled and nothing is uploaded anywhere.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { redactText } = require('../lib/log');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Split a postgres:// URL into the PG* environment variables pg_dump and pg_restore read. Throws without echoing the URL. */
function pgEnvFromUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { throw new Error('DATABASE_URL is missing or is not a valid URL'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('DATABASE_URL must start with postgres://');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(u.username);
  if (!host) throw new Error('DATABASE_URL has no host');
  if (!database) throw new Error('DATABASE_URL has no database name');
  if (!user) throw new Error('DATABASE_URL has no user name');
  const env = {
    PGHOST: host,
    PGPORT: u.port || '5432',
    PGUSER: user,
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: database,
  };
  // Never talk to a remote server without TLS, even when the URL forgot sslmode (Neon's URL already has it).
  const sslmode = u.searchParams.get('sslmode') || (LOCAL_HOSTS.has(host) ? null : 'require');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** The dump destination: a `.dump` name, outside the repository, not yet taken, in a folder that exists. */
function checkOutPath(out) {
  if (!out) throw new Error('pass --out <file>.dump');
  const abs = path.resolve(String(out));
  if (!abs.endsWith('.dump')) throw new Error('the backup file name must end in .dump');
  if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + path.sep)) {
    throw new Error('refusing to write a backup inside the repository (backups must never be committed)');
  }
  if (fs.existsSync(abs)) throw new Error('refusing to overwrite an existing file: ' + path.basename(abs));
  if (!fs.existsSync(path.dirname(abs))) throw new Error('the folder for the backup does not exist');
  return abs;
}

function run(cmd, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`${cmd} could not be started (${err.code || 'error'}); is PostgreSQL client tooling installed?`)));
    child.on('close', (code) => resolve({ code, stdout, stderr: redactText(stderr.trim()).slice(0, 800) }));
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/** Lists the archive's table of contents (no database connection) and checks it holds the Tableverse schema. */
async function listArchive(file, { pgRestore = 'pg_restore' } = {}) {
  const res = await run(pgRestore, ['--list', file], {});
  if (res.code !== 0) throw new Error(`the archive is not readable (pg_restore exit ${res.code}): ${res.stderr}`);
  const entries = res.stdout.split('\n').filter((l) => l && !l.startsWith(';'));
  const tables = entries.filter((l) => /\sTABLE\s+public\s/.test(l)).length;
  const hasMigrations = entries.some((l) => /\sTABLE\s+public\s+schema_migrations\b/.test(l));
  return { entries: entries.length, tables, hasMigrations };
}

/** Runs pg_dump into `<out>.partial`, verifies it, and only then moves it to `<out>` with a checksum beside it. */
async function backup({ url, out, pgDump = 'pg_dump', pgRestore = 'pg_restore' }) {
  const env = pgEnvFromUrl(url);
  const dest = checkOutPath(out);
  const partial = dest + '.partial';
  try {
    const dump = await run(pgDump, ['--format=custom', '--no-owner', '--no-acl', '--file', partial], env);
    if (dump.code !== 0) throw new Error(`pg_dump failed (exit ${dump.code}): ${dump.stderr || 'no details'}`);
    const info = await listArchive(partial, { pgRestore });
    if (!info.hasMigrations) throw new Error('the dump has no schema_migrations table: this is not the Tableverse database');
    fs.chmodSync(partial, 0o600);
    const sha256 = await sha256File(partial);
    const bytes = fs.statSync(partial).size;
    fs.renameSync(partial, dest);
    fs.writeFileSync(dest + '.sha256', `${sha256}  ${path.basename(dest)}\n`, { mode: 0o600 });
    return { file: dest, bytes, sha256, ...info };
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
}

/** Confirms an existing dump: checksum (when a .sha256 file sits beside it) and a readable archive with the right tables. */
async function verifyArchive(file, { pgRestore = 'pg_restore' } = {}) {
  const abs = path.resolve(String(file || ''));
  if (!abs.endsWith('.dump') || !fs.existsSync(abs)) throw new Error('pass the path of an existing .dump file');
  const sha256 = await sha256File(abs);
  const sumFile = abs + '.sha256';
  if (fs.existsSync(sumFile)) {
    const expected = fs.readFileSync(sumFile, 'utf8').split(/\s+/)[0];
    if (expected !== sha256) throw new Error('checksum mismatch: the file changed after it was written');
  }
  const info = await listArchive(abs, { pgRestore });
  if (!info.hasMigrations) throw new Error('the archive has no schema_migrations table');
  return { file: abs, bytes: fs.statSync(abs).size, sha256, checksumChecked: fs.existsSync(sumFile), ...info };
}

function parseArgs(argv) {
  const args = { out: null, verify: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--verify') args.verify = argv[++i];
    else throw new Error(`unknown argument: ${argv[i].startsWith('--') ? argv[i] : '(value)'}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.verify) {
    const r = await verifyArchive(args.verify);
    console.log(`verified: ${path.basename(r.file)} bytes=${r.bytes} tables=${r.tables} entries=${r.entries} sha256=${r.sha256} checksum_file=${r.checksumChecked ? 'matched' : 'absent'}`);
    return 0;
  }
  const r = await backup({ url: env.DATABASE_URL, out: args.out });
  console.log(`backup written: ${path.basename(r.file)} bytes=${r.bytes} tables=${r.tables} entries=${r.entries} sha256=${r.sha256}`);
  console.log('store the file and its .sha256 outside this repository, Neon and Render (see docs/OPERATIONS_RUNBOOK.md).');
  return 0;
}

module.exports = { pgEnvFromUrl, checkOutPath, backup, verifyArchive, listArchive, parseArgs };

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // Messages are built without the URL; anything from pg_dump's stderr is scrubbed before printing.
      console.error('backup failed: ' + redactText(err.message));
      process.exit(1);
    },
  );
}
