'use strict';
require('./helpers/env');
// The local development account workflow (lib/devSeed.js, scripts/dev-seed.js) on a REAL PostgreSQL (throw-away database), then a real
// login over HTTP and the owner's access to the admin console. Runs only with TEST_DATABASE_URL (npm run test:pg).
const assert = require('node:assert/strict');
const { Browser } = require('./helpers/auth');
const testdb = require('./helpers/testdb');
const policy = require('../public/password-policy');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const t = await testdb.create();
  let srv = null;
  try {
    process.env.DATABASE_URL = t.url;
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    delete process.env.EMAIL_PROVIDER; // no mail service is needed locally
    const db = require('../db/pool');
    const { migrate } = require('../db/migrate');
    const { hashPassword } = require('../db/auth');
    const { seedAccount } = require('../lib/devSeed');
    const { DevEnvError } = require('../lib/devEnv');
    await migrate();
    const deps = { db, hashPassword, env: { ...process.env, NODE_ENV: 'development' } };
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;

    const { start } = require('../server');
    srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 6000 });

    const login = async (email, password) => new Browser(srv.port).post('/api/auth/login', { email, password });

    let first;
    await test('a seeded account gets a generated password that meets the rule, and is verified and adult-confirmed', async () => {
      first = await seedAccount({ email: 'Dev.One@Local.Test', username: 'devone' }, deps);
      assert.equal(first.created, true); assert.equal(first.role, 'user'); assert.equal(first.email, 'dev.one@local.test');
      assert.equal(policy.check(first.password), null);
      const row = (await q("SELECT p.adult_confirmed_at, i.email_verified_at, i.password_hash FROM players p JOIN auth_identities i ON i.player_id = p.id WHERE p.username = 'devone'"))[0];
      assert.ok(row.adult_confirmed_at && row.email_verified_at);
      assert.ok(row.password_hash.startsWith('$argon2'), 'stored as an Argon2 hash, never the password');
      assert.ok(!JSON.stringify(await q('SELECT * FROM auth_identities')).includes(first.password), 'the password is nowhere in the table');
    });
    await test('the seeded account logs in through the real login route without any mail service', async () => {
      const ok = await login('dev.one@local.test', first.password);
      assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.ok, true);
      assert.equal((await login('dev.one@local.test', 'Wrong-Passw0rd!')).status, 401);
    });
    await test('seeding again keeps the account and its password; --reset-password makes a new one and the old one stops working', async () => {
      const again = await seedAccount({ email: 'dev.one@local.test', username: 'devone' }, deps);
      assert.equal(again.created, false); assert.equal(again.password, null);
      assert.equal((await login('dev.one@local.test', first.password)).status, 200);
      const reset = await seedAccount({ email: 'dev.one@local.test', username: 'devone', resetPassword: true }, deps);
      assert.notEqual(reset.password, first.password);
      assert.equal((await login('dev.one@local.test', first.password)).status, 401);
      assert.equal((await login('dev.one@local.test', reset.password)).status, 200);
    });
    await test('--owner makes the account the local owner, who can open the admin console; only one owner is possible', async () => {
      const own = await seedAccount({ email: 'boss@local.test', username: 'localboss', owner: true }, deps);
      assert.equal(own.role, 'owner');
      const b = new Browser(srv.port);
      assert.equal((await b.post('/api/auth/login', { email: 'boss@local.test', password: own.password })).status, 200);
      assert.equal((await b.get('/api/admin/overview?days=7')).status, 200, 'the owner sees the console');
      const plain = new Browser(srv.port);
      await plain.post('/api/auth/login', { email: 'dev.one@local.test', password: (await seedAccount({ email: 'dev.one@local.test', username: 'devone', resetPassword: true }, deps)).password });
      assert.equal((await plain.get('/api/admin/overview?days=7')).status, 403, 'an ordinary account does not');
      await assert.rejects(seedAccount({ email: 'second@local.test', username: 'second', owner: true }, deps), (e) => e instanceof DevEnvError && /already has an owner/.test(e.message));
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM players WHERE role = 'owner'"))[0].n, 1);
    });
    await test('it refuses production, a managed database host, bad input and a taken username', async () => {
      await assert.rejects(seedAccount({ email: 'p@local.test', username: 'prodtry' }, { ...deps, env: { ...deps.env, NODE_ENV: 'production' } }), /NODE_ENV=production/);
      await assert.rejects(seedAccount({ email: 'p@local.test', username: 'prodtry' }, { ...deps, env: { ...deps.env, DATABASE_URL: 'postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db' } }), /managed/);
      await assert.rejects(seedAccount({ email: 'nope', username: 'okname' }, deps), /valid --email/);
      await assert.rejects(seedAccount({ email: 'z@local.test', username: 'Bad Name!' }, deps), /--username/);
      await assert.rejects(seedAccount({ email: 'z@local.test', username: 'devone' }, deps), /already used/);
      await assert.rejects(seedAccount({ email: 'z@local.test', username: 'zzz', password: 'weak' }, deps), /needs/);
      assert.equal((await q("SELECT COUNT(*)::int AS n FROM players WHERE username IN ('prodtry','zzz')"))[0].n, 0, 'nothing was created by a refused call');
    });
    console.log(`${passed} local development account checks passed`);
  } finally {
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL dev-seed.pg', e); process.exit(1); });
