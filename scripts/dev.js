#!/usr/bin/env node
'use strict';
/**
 * `npm run dev`: starts the server for local development.
 *  - loads .env.local (git-ignored) without overriding variables already set in the shell
 *  - refuses NODE_ENV=production and any database that is not on this machine
 *  - makes e-mail verification optional unless you say otherwise, so no mail service is needed
 * See docs/LOCAL_DEVELOPMENT.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseEnvFile, assertSafeDevEnv, devDefaults } = require('../lib/devEnv');

const root = path.join(__dirname, '..');
const env = { ...process.env };
try {
  const file = parseEnvFile(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
  for (const [k, v] of Object.entries(file)) if (env[k] === undefined) env[k] = v;
} catch (e) { if (e.code !== 'ENOENT') { console.error('Could not read .env.local:', e.message); process.exit(1); } }
for (const [k, v] of Object.entries(devDefaults(env))) if (env[k] === undefined || env[k] === '') env[k] = v;
env.NODE_ENV = env.NODE_ENV || 'development';

try {
  const url = assertSafeDevEnv(env);
  if (url) console.log(`[dev] database: ${url.hostname}:${url.port || 5432}${url.pathname} (local)`);
  else console.log('[dev] no DATABASE_URL: guest play works, but e-mail accounts need a local PostgreSQL. See docs/LOCAL_DEVELOPMENT.md.');
} catch (e) { console.error('[dev] ' + e.message); process.exit(1); }
console.log(`[dev] e-mail verification required: ${env.REQUIRE_EMAIL_VERIFICATION}   http://localhost:${env.PORT || 3000}`);

const child = spawn(process.execPath, [path.join(root, 'server.js')], { stdio: 'inherit', env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code === null ? 1 : code));
