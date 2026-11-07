'use strict';
require('./helpers/env');
// Account enumeration on a REAL PostgreSQL: registration, resend-verification and forgot-password answer the same way
// whether or not an address has an account. Runs only with TEST_DATABASE_URL; every run uses its own throw-away database.
const assert = require('node:assert/strict');
const { Browser } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  try {
    process.env.DATABASE_URL = t.url;
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;

    const mail = {
      sent: [],
      assertReady() {},
      async sendVerification(m) { this.sent.push({ kind: 'verify', ...m }); },
      async sendPasswordReset(m) { this.sent.push({ kind: 'reset', ...m }); },
      async sendAccountExists(m) { this.sent.push({ kind: 'exists', ...m }); },
    };
    const srv = await start({
      port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01,
      absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), log: quiet(), emailSender: mail,
      env: { ...process.env, NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'true' },
    });
    try {
      console.log('account enumeration');
      const taken = `taken.${Date.now()}@test.local`;
      const freshAddr = `fresh.${Date.now()}@test.local`;

      // a first, real account for the taken address
      const owner = new Browser(srv.port); await owner.csrf();
      const first = await owner.post('/api/auth/register', { email: taken, username: `owner${Date.now() % 1000000}`, password: PW, displayName: 'Owner' });
      assert.equal(first.status, 201, JSON.stringify(first.json));
      const shapeNew = Object.keys(first.json).sort();

      await test('registration of a taken address answers exactly like a new one, without revealing it', async () => {
        const attacker = new Browser(srv.port); await attacker.csrf();
        const again = await attacker.post('/api/auth/register', { email: taken, username: `probe${Date.now() % 1000000}`, password: PW, displayName: 'Probe' });
        assert.equal(again.status, 201, JSON.stringify(again.json));
        assert.deepEqual(Object.keys(again.json).sort(), shapeNew, 'same keys for a taken address');
        assert.equal(again.json.player, null);
        assert.equal(again.json.error, undefined);
        assert.equal(attacker.cookies.has('ct_session'), false, 'no session is issued for an address that already has an account');
        assert.equal(again.json.message, first.json.message, 'same message text');
        assert.equal(again.json.emailSent, first.json.emailSent);
        assert.ok(mail.sent.some((m) => m.kind === 'exists' && m.to === taken), 'the owner gets a notice');
      });

      await test('registration of a taken address writes nothing new', async () => {
        const before = (await q('SELECT COUNT(*)::int AS n FROM auth_identities WHERE provider_user_id = $1', [taken]))[0].n;
        const probeName = `probe2${Date.now() % 1000000}`;
        const attacker = new Browser(srv.port); await attacker.csrf();
        const r = await attacker.post('/api/auth/register', { email: taken, username: probeName, password: PW, displayName: 'Probe' });
        assert.equal(r.status, 201);
        assert.equal(before, (await q('SELECT COUNT(*)::int AS n FROM auth_identities WHERE provider_user_id = $1', [taken]))[0].n);
        assert.equal((await q('SELECT COUNT(*)::int AS n FROM players WHERE LOWER(username) = $1', [probeName]))[0].n, 0, 'no player row for the probe');
      });

      await test('registration of a free address still issues a session and a verification email', async () => {
        const b = new Browser(srv.port); await b.csrf();
        const r = await b.post('/api/auth/register', { email: freshAddr, username: `new${Date.now() % 1000000}`, password: PW, displayName: 'New' });
        assert.equal(r.status, 201, JSON.stringify(r.json));
        assert.deepEqual(Object.keys(r.json).sort(), shapeNew, 'same keys as the taken-address answer');
        assert.equal(b.cookies.has('ct_session'), true, 'a new account gets its session cookie');
        assert.ok(mail.sent.some((m) => m.kind === 'verify' && m.to === freshAddr));
      });

      const anon = async () => { const b = new Browser(srv.port); await b.csrf(); return b; };

      await test('resend-verification answers the same for a known unverified address and an unknown one', async () => {
        const unknown = `nobody.${Date.now()}@test.local`;
        const known = await (await anon()).post('/api/auth/resend-verification', { email: taken });
        const missing = await (await anon()).post('/api/auth/resend-verification', { email: unknown });
        assert.equal(known.status, 200, JSON.stringify(known.json));
        assert.equal(missing.status, 200, JSON.stringify(missing.json));
        assert.deepEqual(Object.keys(known.json).sort(), Object.keys(missing.json).sort());
        assert.equal(known.json.message, missing.json.message);
        assert.equal(mail.sent.some((m) => m.to === unknown), false, 'nothing is sent to an unknown address');
      });

      await test('forgot-password answers the same for a known unverified address and an unknown one', async () => {
        const unknown = `nobody2.${Date.now()}@test.local`;
        const known = await (await anon()).post('/api/auth/forgot-password', { email: taken });
        const missing = await (await anon()).post('/api/auth/forgot-password', { email: unknown });
        assert.equal(known.status, 200, JSON.stringify(known.json));
        assert.equal(missing.status, 200, JSON.stringify(missing.json));
        assert.deepEqual(Object.keys(known.json).sort(), Object.keys(missing.json).sort());
        assert.equal(known.json.message, missing.json.message);
        assert.equal(mail.sent.some((m) => m.kind === 'reset' && m.to === unknown), false, 'no reset mail for an unknown address');
      });
    } finally {
      await srv.close();
    }
    console.log(`${passed} enumeration checks passed`);
  } finally {
    await t.drop();
  }
})().catch((e) => { console.error('FAIL enumeration', e); process.exit(1); });
