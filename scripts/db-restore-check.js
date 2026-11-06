#!/usr/bin/env node
'use strict';
/**
 * Restore test: restores a Tableverse dump into an EMPTY, separate database and checks what came back.
 *
 *   RESTORE_TEST_DATABASE_URL='postgres://…/tableverse_restore_test' node scripts/db-restore-check.js --dump /secure/tableverse.dump
 *
 * The target must be a database you created for this test (a Neon branch, or a local database). The script refuses:
 *  - a target that is the production database (same host, port and name as DATABASE_URL, if it is set),
 *  - a target that already has tables (it never overwrites anything),
 *  - a dump whose checksum or archive table of contents is wrong (verified before anything is written).
 * It reads DATABASE_URL only to compare it with the target. It prints counts and checks, never rows or personal data.
 * See docs/OPERATIONS_RUNBOOK.md, "Restore test".
 */
const fs = require('node:fs');
const path = require('node:path');
const { pgEnvFromUrl, verifyArchive, runCommand } = require('./db-backup');
const { redactText } = require('../lib/log');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const COUNTED_TABLES = ['players', 'auth_identities', 'matches', 'match_participants', 'friendships'];
// Fixed queries only: no user input is ever put into SQL here.
const ORPHAN_CHECKS = {
  match_participants_without_match: 'SELECT count(*) FROM match_participants mp WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = mp.match_id)',
  auth_identities_without_player: 'SELECT count(*) FROM auth_identities a WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = a.player_id)',
};
const UNVALIDATED_FK = "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated";
const TABLE_COUNT = "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')";

function sameDatabase(a, b) {
  return a.PGHOST.toLowerCase() === b.PGHOST.toLowerCase() && a.PGPORT === b.PGPORT && a.PGDATABASE === b.PGDATABASE;
}

async function query(env, sql) {
  const r = await runCommand('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], env);
  if (r.code !== 0) throw new Error('a check query failed: ' + redactText(r.stderr || 'no details'));
  return r.stdout.trim();
}

function expectedMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/** Restores `dump` into `target` and returns a report. Throws (before writing) when a safety rule is broken. */
async function restoreCheck({ dump, target, production = null, pgRestore = 'pg_restore' }) {
  if (!target) throw new Error('set RESTORE_TEST_DATABASE_URL to an empty database created for this test');
  const targetEnv = pgEnvFromUrl(target);
  if (production) {
    const prodEnv = pgEnvFromUrl(production);
    if (sameDatabase(targetEnv, prodEnv)) throw new Error('refusing: the restore target is the production database (same host, port and name as DATABASE_URL)');
  }
  await verifyArchive(dump, { pgRestore }); // checksum and table of contents, before anything is written

  const tables = Number(await query(targetEnv, TABLE_COUNT));
  if (tables !== 0) throw new Error('refusing: the target database is not empty; use a new, empty database for the restore test');

  const restore = await runCommand(pgRestore, ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', targetEnv.PGDATABASE, dump], targetEnv);
  if (restore.code !== 0) throw new Error(`pg_restore failed (exit ${restore.code}): ${restore.stderr || 'no details'}`);

  const applied = (await query(targetEnv, 'SELECT version FROM schema_migrations ORDER BY version')).split('\n').filter(Boolean);
  const expected = expectedMigrations();
  const missing = expected.filter((m) => !applied.includes(m));
  const unexpected = applied.filter((m) => !expected.includes(m));

  const counts = {};
  for (const t of COUNTED_TABLES) counts[t] = Number(await query(targetEnv, `SELECT count(*) FROM ${t}`));

  const orphans = {};
  for (const [name, sql] of Object.entries(ORPHAN_CHECKS)) orphans[name] = Number(await query(targetEnv, sql));
  const unvalidatedForeignKeys = Number(await query(targetEnv, UNVALIDATED_FK));

  const ok = missing.length === 0 && unexpected.length === 0 && unvalidatedForeignKeys === 0 && Object.values(orphans).every((n) => n === 0);
  return {
    ok,
    database: targetEnv.PGDATABASE,
    restored: true,
    migrations: { applied: applied.length, expected: expected.length, missing, unexpected },
    counts,
    orphans,
    unvalidatedForeignKeys,
  };
}

function parseArgs(argv) {
  const args = { dump: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dump') args.dump = argv[++i];
    else throw new Error(`unknown argument: ${argv[i].startsWith('--') ? argv[i] : '(value)'}`);
  }
  if (!args.dump) throw new Error('pass --dump <file>.dump');
  return args;
}

module.exports = { restoreCheck, sameDatabase, parseArgs, expectedMigrations, COUNTED_TABLES };

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const report = await restoreCheck({
      dump: path.resolve(args.dump),
      target: process.env.RESTORE_TEST_DATABASE_URL,
      production: process.env.DATABASE_URL || null,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  })().catch((err) => {
    console.error('restore check failed: ' + redactText(err.message));
    process.exit(1);
  });
}
