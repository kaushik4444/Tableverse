#!/usr/bin/env node
'use strict';
/**
 * `npm run dev:seed -- --email me@local.test --username me [--owner] [--reset-password] [--name "My Name"]`
 * Creates a verified local test account with a generated password (printed once) and optionally makes it the local owner
 * (admin console). Runs the migrations first. Local PostgreSQL only; see docs/LOCAL_DEVELOPMENT.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseEnvFile, assertSafeDevEnv, DevEnvError } = require('../lib/devEnv');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

(async () => {
  const env = { ...process.env };
  try {
    const file = parseEnvFile(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8'));
    for (const [k, v] of Object.entries(file)) if (env[k] === undefined) env[k] = v;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  Object.assign(process.env, env); // db/pool reads DATABASE_URL from process.env
  assertSafeDevEnv(process.env); // before anything connects
  if (flag('--help') || !val('--email') || !val('--username')) {
    console.log('usage: npm run dev:seed -- --email me@local.test --username me [--owner] [--reset-password] [--name "My Name"]');
    process.exit(flag('--help') ? 0 : 2);
  }
  const db = require('../db/pool');
  const { migrate } = require('../db/migrate');
  const { hashPassword } = require('../db/auth');
  const { seedAccount } = require('../lib/devSeed');
  await migrate();
  const r = await seedAccount({ email: val('--email'), username: val('--username'), displayName: val('--name'), owner: flag('--owner'), resetPassword: flag('--reset-password') }, { db, hashPassword, env: process.env });
  console.log('');
  console.log(r.created ? 'Created local test account' : 'Local test account already exists');
  console.log(`  e-mail:    ${r.email}`);
  console.log(`  username:  ${r.username}`);
  console.log(`  role:      ${r.role}`);
  console.log(r.password ? `  password:  ${r.password}   (shown once; it is not stored anywhere readable)` : '  password:  unchanged (add --reset-password to generate a new one)');
  if (r.role === 'owner') console.log('  admin:     http://localhost:3000/admin.html (log in first)');
  await db.close();
})().catch((e) => { console.error(e instanceof DevEnvError ? 'Error: ' + e.message : e); process.exit(1); });
