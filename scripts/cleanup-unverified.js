#!/usr/bin/env node
'use strict';
/**
 * Remove accounts that were never verified, after 30 days (db/unverifiedCleanup.js).
 *
 *   DATABASE_URL='postgres://…' node scripts/cleanup-unverified.js            # dry run: counts only, deletes nothing
 *   DATABASE_URL='postgres://…' node scripts/cleanup-unverified.js --execute  # deletes, in batches
 *   node scripts/cleanup-unverified.js --days 45                              # a different retention period (1–365)
 *
 * Read docs/DATA_CLEANUP.md before running it against a real database. Nothing schedules this script.
 * Prints counts only; no e-mail address, name or account id is printed.
 */
const { cleanUnverified, DEFAULT_DAYS } = require('../db/unverifiedCleanup');

const usage = (message) => Object.assign(new Error(message), { usage: true });

function parseArgs(argv) {
  const out = { execute: false, days: DEFAULT_DAYS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') out.execute = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--days') {
      const v = argv[++i];
      if (!/^\d{1,3}$/.test(String(v || '')) || Number(v) < 1 || Number(v) > 365) throw usage('--days needs a whole number from 1 to 365');
      out.days = Number(v);
    } else throw usage('unknown option (see --help)'); // the argument itself is not echoed: it may be a pasted secret
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/cleanup-unverified.js [--days N] [--execute]\nWithout --execute nothing is deleted.');
    return 0;
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set. Nothing was done.'); return 2; }
  const pool = require('../db/pool');
  if (!pool.hasDatabase()) { console.error('No database is configured. Nothing was done.'); return 2; }
  try {
    const { createLogger } = require('../lib/log');
    const log = createLogger({ component: 'cleanup' });
    const r = await cleanUnverified({ days: args.days, execute: args.execute, log });
    if (r.dryRun) {
      console.log(`Dry run. ${r.candidates} unverified account(s) older than ${args.days} days would be removed. Nothing was deleted.`);
      console.log('Run again with --execute to delete them.');
    } else {
      console.log(`Removed ${r.deleted} unverified account(s) older than ${args.days} days, in ${r.batches} batch(es).`);
    }
    return 0;
  } finally {
    await pool.close();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    if (e && e.usage) { console.error(e.message); process.exitCode = 2; return; }
    console.error(`cleanup failed: ${e && e.code ? e.code : 'error'}`); // driver text can carry the database URL; only the code is printed
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
