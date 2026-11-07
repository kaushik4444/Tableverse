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
      async sendVerification(m) { this.sent.push({ kind: 'verify', to: m.email, token: m.token }); },
      async sendPasswordReset(m) { this.sent.push({ kind: 'reset', to: m.email, token: m.token }); },
      async sendAccountExists(m) { this.sent.push({ kind: 'exists', to: m.email }); },
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
        assert.equal(attacker.cookies.has('ct_session'), false, 'no session for an address that already has an account');
        assert.equal(again.setCookie.some((c) => c.startsWith('ct_session=')), false, 'no ct_session Set-Cookie for a taken address');
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

      await test('registration of a free address sends a verification email and sets no session', async () => {
        const b = new Browser(srv.port); await b.csrf();
        const r = await b.post('/api/auth/register', { email: freshAddr, username: `new${Date.now() % 1000000}`, password: PW, displayName: 'New' });
        assert.equal(r.status, 201, JSON.stringify(r.json));
        assert.deepEqual(Object.keys(r.json).sort(), shapeNew, 'same keys as the taken-address answer');
        assert.equal(r.setCookie.some((c) => c.startsWith('ct_session=')), false, 'registration sets no ct_session, even for a new account');
        assert.equal(b.cookies.has('ct_session'), false);
        const mailed = mail.sent.find((m) => m.kind === 'verify' && m.to === freshAddr);
        assert.ok(mailed, 'a verification email was sent');
        // a session exists only after the email is verified and the player logs in
        await b.must('/api/auth/verify-email', { token: mailed.token });
        await b.must('/api/auth/login', { email: freshAddr, password: PW });
        assert.equal(b.cookies.has('ct_session'), true, 'login after verifying issues the session cookie');
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

      await test('auth emails still being sent are finished before a graceful shutdown; answers do not wait for them', async () => {
        // Sends block on a gate once `gated` is set, so the HTTP answer can be checked while delivery is still in progress.
        let release;
        const gate = new Promise((r) => { release = r; });
        const slowMail = {
          gated: false, verifyTokens: [], sentVerify: [], sentReset: [],
          assertReady() {},
          async sendVerification(m) { this.verifyTokens.push(m.token); if (this.gated) await gate; this.sentVerify.push(m.email); },
          async sendPasswordReset(m) { if (this.gated) await gate; this.sentReset.push(m.email); },
          async sendAccountExists() {},
        };
        const s2 = await start({
          port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01,
          absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), log: quiet(), emailSender: slowMail,
          env: { ...process.env, NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'true' },
        });
        let closing;
        try {
          const email = `drain.${Date.now()}@test.local`;
          const b2 = new Browser(s2.port); await b2.csrf();
          await b2.post('/api/auth/register', { email, username: `drain${Date.now() % 1000000}`, password: PW, displayName: 'Drain' });
          const [firstToken] = slowMail.verifyTokens;

          // Answers must come back while the send is still blocked.
          // The account is still unverified here, so resend has a verification email to send.
          slowMail.gated = true;
          const answeredWhileBlocked = (p) => Promise.race([p.then(() => 'answered'), new Promise((r) => setTimeout(() => r('hung'), 2000))]);
          assert.equal(await answeredWhileBlocked(b2.post('/api/auth/resend-verification', { email })), 'answered', 'resend answers without waiting for the send');
          await b2.must('/api/auth/verify-email', { token: firstToken });
          assert.equal(await answeredWhileBlocked(b2.post('/api/auth/forgot-password', { email })), 'answered', 'forgot-password answers without waiting for the send');
          assert.deepEqual(slowMail.sentReset, [], 'the reset send is still blocked when the answer is returned');

          // Release blocked sends during shutdown and check that both finished.
          closing = s2.close({ drainMs: 3000 });
          await new Promise((r) => setTimeout(r, 300));
          release();
          await closing;
          assert.deepEqual(slowMail.sentReset, [email], 'the reset email was finished during shutdown');
          assert.equal(slowMail.sentVerify.length, 2, 'the resend verification email was finished during shutdown');
        } finally {
          release();
          await (closing || s2.close({ drainMs: 3000 }));
        }
      });
    } finally {
      await srv.close();
    }
    console.log(`${passed} enumeration checks passed`);
  } finally {
    await t.drop();
  }
})().catch((e) => { console.error('FAIL enumeration', e); process.exit(1); });
