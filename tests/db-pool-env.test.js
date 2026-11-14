'use strict';
// Guards for the local-database safety rule: db/pool.js must not read .env.local, and the local migrate command must run
// its managed-host check before it loads the pool. Source-level checks, so no file or database is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('  ok  ' + name); };

test('db/pool.js reads only .env, never .env.local', () => {
  const pool = read('db/pool.js');
  const m = pool.match(/const candidates = \[([^\]]*)\]/);
  assert.ok(m, 'the candidate file list is present');
  assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean), ['.env']);
});

test('dev:migrate runs the managed-host check before the database module is loaded', () => {
  const script = read('scripts/dev-migrate.js');
  const check = script.indexOf('assertSafeDevEnv(process.env)');
  const load = script.indexOf("require('../db/pool')");
  assert.ok(check > 0, 'the check is called');
  assert.ok(load > check, 'the pool is loaded only after the check');
});

test('npm run dev:migrate is wired to the checked script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['dev:migrate'], 'node scripts/dev-migrate.js');
});

console.log(`${passed} db pool env checks passed`);
