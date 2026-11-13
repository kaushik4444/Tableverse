#!/usr/bin/env node
'use strict';
/**
 * `npm run dev:migrate`: applies the database migrations to the LOCAL development database named in .env.local.
 *
 * It uses the same checks as `npm run dev` and `npm run dev:seed`: it refuses NODE_ENV=production and any managed or
 * non-local database. Plain `npm run migrate` does not read .env.local (db/pool.js reads only .env), so use this command
 * for local work. See docs/LOCAL_DEVELOPMENT.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseEnvFile, assertSafeDevEnv, devDefaults, DevEnvError } = require('../lib/devEnv');

(async () => {
  const env = { ...process.env };
  try {
    const file = parseEnvFile(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8'));
    for (const [k, v] of Object.entries(file)) if (env[k] === undefined) env[k] = v;
  } catch (e) {
    if (e.code === 'ENOENT') throw new DevEnvError('No .env.local found. Copy .env.local.example to .env.local first (docs/LOCAL_DEVELOPMENT.md).');
    throw e;
  }
  for (const [k, v] of Object.entries(devDefaults(env))) if (env[k] === undefined || env[k] === '') env[k] = v;
  env.NODE_ENV = env.NODE_ENV || 'development';
  Object.assign(process.env, env); // db/pool reads DATABASE_URL from process.env
  process.env.TABLEVERSE_SKIP_DOTENV = '1'; // db/pool must not read any file: only the environment checked below is used
  assertSafeDevEnv(process.env); // before anything connects

  const db = require('../db/pool');
  const { migrate } = require('../db/migrate');
  const result = await migrate();
  const applied = result && result.applied ? result.applied : [];
  console.log(applied.length ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Database is up to date. No migrations to apply.');
  await db.close();
})().catch((e) => { console.error(e instanceof DevEnvError ? 'Error: ' + e.message : e); process.exit(1); });
