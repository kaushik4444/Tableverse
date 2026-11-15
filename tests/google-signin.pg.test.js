'use strict';
require('./helpers/env');
// Sign in with Google on a REAL PostgreSQL (throw-away database from tests/helpers/testdb.js) through the running server.
// Google's keys are replaced by a local key pair, so no network is used. Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Browser, registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');
const { createVerifier } = require('../lib/googleAuth');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const CLIENT = 'test-client.apps.googleusercontent.com';
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken({ sub, email, nonce, ...over }) {
  const t = Math.floor(Date.now() / 1000);
  const signed = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub, email, email_verified: true, name: 'Gina Google', nonce, iat: t, exp: t + 3600, ...over });
  return signed + '.' + crypto.sign('RSA-SHA256', Buffer.from(signed), pair.privateKey).toString('base64url');
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-googlespool-'));
  process.env.MATCH_SPOOL_DIR = spool;
  try {
    process.env.DATABASE_URL = t.url;
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    const dbPool = require('../db/pool');
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const verifier = createVerifier({ clientId: CLIENT, fetchJwks: async () => ({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1' }] }) });
    const srv = await start({ port: 0, trustProxy: false, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: { log() {}, warn() {}, error() {} }, googleVerifier: verifier });
    assert.equal(srv.database.mode, 'postgres');
    let n = 0;
    /** A browser that has asked for the config, like the page does, and so holds the nonce that ties tokens to it. */
    const page = async () => { const b = new Browser(srv.port); const c = (await b.get('/api/auth/google/config')).json; return { b, nonce: c.nonce, config: c }; };
    const cred = (p, who, over = {}) => idToken({ sub: who.sub, email: who.email, nonce: p.nonce, ...over });
    const person = () => { n++; return { sub: 'g-sub-' + n + '-' + crypto.randomBytes(4).toString('hex'), email: `gina${n}.${crypto.randomBytes(3).toString('hex')}@example.com` }; };

    await test('the config says it is on, gives the client id and a nonce, and sets the CSRF cookie', async () => {
      const p = await page();
      assert.equal(p.config.enabled, true); assert.equal(p.config.clientId, CLIENT); assert.match(p.config.nonce, /^[0-9a-f]{64}$/);
      assert.ok(p.b.cookies.has('ct_csrf'));
    });

    await test('a new Google person must choose a username first: nothing is created and no session is started', async () => {
      const p = await page(); const who = person();
      const r = await p.b.post('/api/auth/google', { credential: cred(p, who) });
      assert.equal(r.status, 200); assert.equal(r.json.needsSignup, true); assert.equal(r.json.email, who.email);
      assert.ok(!p.b.cookies.has('ct_session'));
      assert.equal((await q('SELECT count(*)::int AS n FROM auth_identities WHERE provider_user_id = $1', [who.sub]))[0].n, 0);
    });

    let first; let firstWho;
    await test('completing sign-up needs the adult confirmation and a valid free username, then creates a verified account and a session', async () => {
      const p = await page(); const who = person();
      const bad1 = await p.b.post('/api/auth/google/complete', { credential: cred(p, who), username: 'gina_g', adultConfirmed: false });
      assert.equal(bad1.status, 400);
      const bad2 = await p.b.post('/api/auth/google/complete', { credential: cred(p, who), username: 'No Good!', adultConfirmed: true });
      assert.equal(bad2.status, 400);
      const ok = await p.b.post('/api/auth/google/complete', { credential: cred(p, who), username: `gina_${n}`, displayName: 'Gina', adultConfirmed: true });
      assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.ok(p.b.cookies.has('ct_session'));
      const row = (await q('SELECT p.adult_confirmed_at, p.is_anonymous, i.provider, i.email, i.email_verified_at, i.password_hash FROM players p JOIN auth_identities i ON i.player_id = p.id WHERE i.provider_user_id = $1', [who.sub]))[0];
      assert.equal(row.provider, 'google'); assert.equal(row.email, who.email); assert.ok(row.email_verified_at); assert.ok(row.adult_confirmed_at); assert.equal(row.is_anonymous, false); assert.equal(row.password_hash, null);
      const s = (await p.b.get('/api/auth/session')).json;
      assert.equal(s.authenticated, true); assert.equal(s.player.username, `gina_${n}`);
      first = p; firstWho = who;
    });

    await test('a taken username is refused with the same message as email sign-up', async () => {
      const p = await page(); const who = person();
      const r = await p.b.post('/api/auth/google/complete', { credential: cred(p, who), username: `gina_${n - 1}`, adultConfirmed: true });
      assert.equal(r.status, 400); assert.match(r.json.error, /already taken/);
      assert.equal((await q('SELECT count(*)::int AS n FROM auth_identities WHERE provider_user_id = $1', [who.sub]))[0].n, 0);
    });

    await test('the same Google account signs in directly next time, and the older session is ended', async () => {
      const p = await page();
      const r = await p.b.post('/api/auth/google', { credential: cred(p, firstWho) });
      assert.equal(r.status, 200); assert.ok(!r.json.needsSignup); assert.equal(r.json.player.username, (await q('SELECT username FROM players p JOIN auth_identities i ON i.player_id = p.id WHERE i.provider_user_id = $1', [firstWho.sub]))[0].username);
      assert.ok(p.b.cookies.has('ct_session'));
      assert.equal((await first.b.get('/api/auth/session')).json.authenticated, false, 'one active session: the earlier one is gone');
      assert.equal((await p.b.get('/api/auth/session')).json.authenticated, true);
    });

    await test('a Google address that already has an email account is refused, never linked, and nothing is created', async () => {
      const email = `owner${Date.now()}@example.com`;
      await registerAndVerify(srv.port, { email, username: 'owner_pw', password: 'TestPass123!', displayName: 'Owner' });
      const p = await page(); const who = { sub: 'g-sub-attacker', email };
      const r = await p.b.post('/api/auth/google', { credential: cred(p, who) });
      assert.equal(r.status, 409); assert.match(r.json.error, /already has a Tableverse account/);
      const c = await p.b.post('/api/auth/google/complete', { credential: cred(p, who), username: 'would_be', adultConfirmed: true });
      assert.equal(c.status, 409);
      assert.ok(!p.b.cookies.has('ct_session'));
      assert.equal((await q("SELECT count(*)::int AS n FROM auth_identities WHERE provider = 'google' AND provider_user_id = 'g-sub-attacker'"))[0].n, 0);
      assert.equal((await q("SELECT count(*)::int AS n FROM players WHERE username = 'would_be'"))[0].n, 0);
    });

    await test('tokens that are bound to another browser, expired, for another app or with an unverified email are refused', async () => {
      const p = await page(); const other = await page(); const who = person();
      assert.equal((await p.b.post('/api/auth/google', { credential: idToken({ ...who, nonce: other.nonce }) })).status, 401, 'a token minted for another browser');
      assert.equal((await p.b.post('/api/auth/google', { credential: cred(p, who, { exp: Math.floor(Date.now() / 1000) - 3600 }) })).status, 401, 'expired');
      assert.equal((await p.b.post('/api/auth/google', { credential: cred(p, who, { aud: 'another-app' }) })).status, 401, 'another app');
      assert.equal((await p.b.post('/api/auth/google', { credential: cred(p, who, { email_verified: false }) })).status, 401, 'unverified email');
      assert.equal((await p.b.post('/api/auth/google', { credential: 'garbage' })).status, 401);
      assert.equal((await p.b.post('/api/auth/google', {}, { csrf: false })).status, 403, 'no CSRF header');
      assert.ok(!p.b.cookies.has('ct_session'));
    });

    await test('a suspended Google account cannot sign in', async () => {
      const p = await page();
      await q('UPDATE players SET suspended_at = NOW() WHERE id = (SELECT player_id FROM auth_identities WHERE provider_user_id = $1)', [firstWho.sub]);
      const r = await p.b.post('/api/auth/google', { credential: cred(p, firstWho) });
      assert.equal(r.status, 403); assert.ok(!p.b.cookies.has('ct_session'));
    });

    await test('a Google-only account has no password: the email login and password reset do nothing for it', async () => {
      const b = new Browser(srv.port); await b.csrf();
      assert.equal((await b.post('/api/auth/login', { email: firstWho.email, password: 'TestPass123!' })).status, 401);
      const r = await b.post('/api/auth/forgot-password', { email: firstWho.email });
      assert.equal(r.status, 200);
      assert.equal((await q("SELECT count(*)::int AS n FROM auth_email_tokens WHERE purpose = 'password_reset' AND LOWER(email) = LOWER($1)", [firstWho.email]))[0].n, 0, 'no reset token is issued');
    });

    await test('two sign-ups racing for one Google account end with one account and no server error', async () => {
      const who = person(); const a = await page(); const b = await page();
      const [r1, r2] = await Promise.all([
        a.b.post('/api/auth/google/complete', { credential: cred(a, who), username: `race_a${n}`, adultConfirmed: true }),
        b.b.post('/api/auth/google/complete', { credential: cred(b, who), username: `race_b${n}`, adultConfirmed: true }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409], JSON.stringify([r1.json, r2.json]));
      assert.equal((await q('SELECT count(*)::int AS n FROM auth_identities WHERE provider_user_id = $1', [who.sub]))[0].n, 1);
    });

    await srv.close();
    await dbPool.close();
    console.log(`\n${passed} Google sign-in tests passed`);
  } finally {
    fs.rmSync(spool, { recursive: true, force: true });
    await t.drop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
