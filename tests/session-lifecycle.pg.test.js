'use strict';
require('./helpers/env');
// Session lifecycle on a REAL PostgreSQL: the password-reset/login race, legacy sessions without an expiry, malformed
// tokens that never reach the database, and the single active session. Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { registerAndVerify, sessionSocket } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  try {
    process.env.DATABASE_URL = t.url;
    const dbPool = require('../db/pool');
    const dbAuth = require('../db/auth');
    const dbPlayers = require('../db/players');
    const argon2 = require('@node-rs/argon2');
    const { start } = require('../server');
    const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), sessionCheckMs: 50 });
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    let seq = 1;
    const addr = () => `lifecycle.${seq++}@test.local`;
    const activeSessions = async (playerId) => (await q('SELECT count(*)::int AS n FROM auth_sessions WHERE player_id = $1 AND revoked_at IS NULL', [playerId]))[0].n;
    const playerIdOf = async (email) => (await q("SELECT player_id FROM auth_identities WHERE provider = 'email' AND provider_user_id = $1", [email]))[0].player_id;

    try {
      await test('a malformed token never reaches the database', async () => {
        const real = dbPool.query;
        let calls = 0;
        dbPool.query = (...args) => { calls += 1; return real.apply(dbPool, args); };
        try {
          assert.equal(await dbPlayers.authenticateToken("x' OR '1'='1"), null);
          assert.equal(await dbPlayers.authenticateToken('a'.repeat(63)), null);
          assert.equal(await dbAuth.readSessionFromCookie('short'), null);
          assert.equal(await dbAuth.revokeSession('short'), false);
          assert.equal((await dbAuth.sessionInfo('short')).authenticated, false);
          assert.equal(calls, 0, 'no query was made for any malformed token');
        } finally { dbPool.query = real; }
      });

      await test('a legacy session without an expiry date is not accepted', async () => {
        const email = addr();
        const { player } = await registerAndVerify(srv.port, { email, password: PW, displayName: 'Legacy' });
        const legacy = 'c'.repeat(64);
        await x.query('INSERT INTO auth_sessions (player_id, token_hash, expires_at) VALUES ($1, $2, NULL)', [player.id, crypto.createHash('sha256').update(legacy).digest('hex')]);
        assert.equal(await dbPlayers.authenticateToken(legacy), null, 'an unlimited session is refused');
        assert.equal(await dbAuth.readSessionFromCookie(legacy), null);
      });

      await test('a password reset that commits during a login cannot be followed by a session for the old password', async () => {
        const email = addr();
        await registerAndVerify(srv.port, { email, password: PW, displayName: 'Race' });
        const id = await playerIdOf(email);
        const holder = await t.client(); // holds the account lock, as a password reset does, while the login checks its password
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [id]);
        const login = dbAuth.loginEmail({ email, password: PW }); // verifies the old password, then waits for the lock
        await sleep(400);
        const newHash = await argon2.hash('NewPass123!');
        await holder.query('UPDATE auth_identities SET password_hash = $1 WHERE player_id = $2', [newHash, id]);
        await holder.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [id]);
        await holder.query('COMMIT');
        await holder.end();
        await assert.rejects(login, /invalid email or password/i, 'the login re-checks the password under the lock');
        assert.equal(await activeSessions(id), 0, 'no session was issued for the old password');
        await dbAuth.loginEmail({ email, password: 'NewPass123!' });
      });

      await test('signing in again keeps exactly one active session per account', async () => {
        const email = addr();
        await registerAndVerify(srv.port, { email, password: PW, displayName: 'One' });
        const id = await playerIdOf(email);
        await dbAuth.loginEmail({ email, password: PW });
        await dbAuth.loginEmail({ email, password: PW });
        assert.equal(await activeSessions(id), 1);
      });

      await test('an expired session ends its open socket on the next check', async () => {
        const email = addr();
        const { token } = await registerAndVerify(srv.port, { email, password: PW, displayName: 'Expiry' });
        const msgs = [];
        let closed = null;
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, sessionSocket(token));
        ws.on('open', () => ws.send(JSON.stringify({ t: 'hello' })));
        ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
        ws.on('close', (code) => { closed = code; });
        for (let i = 0; i < 200 && !msgs.some((m) => m.t === 'welcome'); i++) await sleep(10);
        assert.ok(msgs.some((m) => m.t === 'welcome'), 'connected');
        await x.query("UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1", [crypto.createHash('sha256').update(token).digest('hex')]);
        for (let i = 0; i < 200 && closed === null; i++) await sleep(10);
        assert.equal(closed, 4001, 'the socket ends with the session');
        assert.ok(msgs.some((m) => m.t === 'authRequired'));
      });

      await test('guest sessions work and expire like every other session', async () => {
        const guest = await dbPlayers.createAnonymousPlayer({ displayName: 'Guest', avatar: '🧙' });
        assert.equal((await dbPlayers.authenticateToken(guest.rawToken)).id, guest.player.id);
        const row = (await q("SELECT expires_at IS NOT NULL AS has_expiry, expires_at > NOW() + INTERVAL '29 days' AS long_lived FROM auth_sessions WHERE player_id = $1", [guest.player.id]))[0];
        assert.equal(row.has_expiry, true);
        assert.equal(row.long_lived, true, 'the default lifetime is about 30 days');
      });

      await test('the migration that revokes legacy sessions is safe to run again', async () => {
        const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '011_session_expiry_required.sql'), 'utf8');
        await x.query(sql);
        await x.query(sql);
        assert.equal((await q('SELECT count(*)::int AS n FROM auth_sessions WHERE expires_at IS NULL AND revoked_at IS NULL'))[0].n, 0);
      });
    } finally {
      await srv.close();
      await dbPool.close();
    }
    console.log(`\n${passed} PostgreSQL session lifecycle tests passed`);
  } finally {
    await t.drop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
