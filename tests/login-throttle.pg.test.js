'use strict';
require('./helpers/env');
// Login throttling on a REAL PostgreSQL through the running server: only failed attempts count, concurrent guesses cannot
// get past the limit, the per-account limit is per address, the IP limit aggregates, and password recovery is not blocked.
// Runs only with TEST_DATABASE_URL (see tests/helpers/testdb.js).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Browser, registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-login-throttle-'));
  process.env.MATCH_SPOOL_DIR = spool;
  try {
    process.env.DATABASE_URL = t.url;
    const dbPool = require('../db/pool');
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet() };
    let seq = 1;
    const addr = () => `throttle.${seq++}@test.local`;
    const serverWith = (env) => start({ ...fast, env: { ...process.env, ...env } });
    const login = async (b, email, password) => (await b.post('/api/auth/login', { email, password })).status;

    await test('successful logins are not counted: they never use up the allowance', async () => {
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '3', RL_LOGIN_IP_LIMIT: '1000' });
      try {
        const email = addr();
        await registerAndVerify(srv.port, { email, password: PW, displayName: 'Ok' });
        const b = new Browser(srv.port); await b.csrf();
        const codes = [];
        for (let i = 0; i < 6; i++) codes.push(await login(b, email, PW));
        assert.deepEqual(codes, [200, 200, 200, 200, 200, 200], 'six good logins in a row are all allowed');
        const rows = await q("SELECT count FROM auth_rate_limits WHERE scope = 'auth:login:emailip' AND key LIKE $1", [hash(email) + ':%']);
        assert.ok(rows.every((r) => r.count === 0), 'the successful attempts were given back: ' + JSON.stringify(rows));
      } finally { await srv.close(); }
    });

    await test('failed attempts are counted, and once the limit is reached even the correct password is refused', async () => {
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '3', RL_LOGIN_IP_LIMIT: '1000' });
      try {
        const email = addr();
        await registerAndVerify(srv.port, { email, password: PW, displayName: 'Guess' });
        const b = new Browser(srv.port); await b.csrf();
        const codes = [];
        for (let i = 0; i < 4; i++) codes.push(await login(b, email, 'wrong-password'));
        assert.deepEqual(codes, [401, 401, 401, 429]);
        assert.equal(await login(b, email, PW), 429, 'the owner is held back too, for this address');
      } finally { await srv.close(); }
    });

    await test('concurrent guesses cannot get past the limit together', async () => {
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '3', RL_LOGIN_IP_LIMIT: '1000' });
      try {
        const email = addr();
        await registerAndVerify(srv.port, { email, password: PW, displayName: 'Racer' });
        const browsers = await Promise.all(Array.from({ length: 10 }, async () => { const b = new Browser(srv.port); await b.csrf(); return b; }));
        const codes = await Promise.all(browsers.map((b) => login(b, email, 'wrong-password')));
        assert.equal(codes.filter((c) => c === 401).length, 3, 'exactly the limit gets a password check: ' + codes.join(','));
        assert.equal(codes.filter((c) => c === 429).length, 7);
      } finally { await srv.close(); }
    });

    await test('the per-account limit is per address: guesses against one account do not lock out other accounts', async () => {
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '3', RL_LOGIN_IP_LIMIT: '1000' });
      try {
        const locked = addr();
        const other = addr();
        await registerAndVerify(srv.port, { email: locked, password: PW, displayName: 'Locked' });
        await registerAndVerify(srv.port, { email: other, password: PW, displayName: 'Other' });
        const b = new Browser(srv.port); await b.csrf();
        for (let i = 0; i < 4; i++) await login(b, locked, 'wrong-password');
        assert.equal(await login(b, other, PW), 200, 'a different account still signs in');
      } finally { await srv.close(); }
    });

    await test('the IP limit aggregates failed attempts across accounts', async () => {
      await q("DELETE FROM auth_rate_limits WHERE scope = 'auth:login:ip'"); // earlier tests in this file used the same address; start from zero
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '100', RL_LOGIN_IP_LIMIT: '5' });
      try {
        const b = new Browser(srv.port); await b.csrf();
        const codes = [];
        for (let i = 0; i < 6; i++) codes.push(await login(b, addr(), 'wrong-password'));
        assert.deepEqual(codes, [401, 401, 401, 401, 401, 429], 'six different accounts from one address: the sixth is refused');
      } finally { await srv.close(); }
    });

    await test('password recovery and resend are separate from login: a locked login does not block them', async () => {
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '3', RL_LOGIN_IP_LIMIT: '1000' });
      try {
        const email = addr();
        await registerAndVerify(srv.port, { email, password: PW, displayName: 'Recover' });
        const b = new Browser(srv.port); await b.csrf();
        for (let i = 0; i < 4; i++) await login(b, email, 'wrong-password');
        assert.equal(await login(b, email, PW), 429);
        assert.equal((await b.post('/api/auth/forgot-password', { email })).status, 200, 'forgot-password still answers');
        assert.equal((await b.post('/api/auth/resend-verification', { email })).status, 200, 'resend still answers');
      } finally { await srv.close(); }
    });

    await test('a wrong password and an unknown address get the same answer, so the login route reveals nothing', async () => {
      const srv = await serverWith({ RL_LOGIN_EMAIL_LIMIT: '100', RL_LOGIN_IP_LIMIT: '1000' });
      try {
        const known = addr();
        await registerAndVerify(srv.port, { email: known, password: PW, displayName: 'Known' });
        const b = new Browser(srv.port); await b.csrf();
        const wrong = await b.post('/api/auth/login', { email: known, password: 'wrong-password' });
        const unknown = await b.post('/api/auth/login', { email: addr(), password: 'wrong-password' });
        assert.equal(wrong.status, 401);
        assert.equal(unknown.status, 401);
        assert.equal(wrong.json.error, unknown.json.error);
      } finally { await srv.close(); }
    });

    await dbPool.close();
    console.log(`\n${passed} login throttling tests passed`);
  } finally {
    fs.rmSync(spool, { recursive: true, force: true });
    await t.drop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
