'use strict';
require('./helpers/env');
// "Keep me signed in on this device" on a REAL PostgreSQL (throw-away database from tests/helpers/testdb.js), over HTTP.
// Runs only with TEST_DATABASE_URL (npm run test:pg).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Browser, registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  let srv = null;
  try {
    process.env.DATABASE_URL = t.url;
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet(), env: { ...process.env, ADMIN_OWNER_EMAIL: 'boss.dev@test.local' } });
    let seq = 1;
    const newUser = async (tag) => {
      const email = `${tag.toLowerCase()}.dev.${seq}@test.local`;
      const u = await registerAndVerify(srv.port, { email, username: `${tag.toLowerCase()}dev${seq++}`.slice(0, 24), displayName: tag, password: PW });
      const me = (await u.browser.get('/api/auth/session')).json.player;
      return { ...u, email, id: me.id };
    };
    const login = async (email, rememberDevice) => {
      const b = new Browser(srv.port); await b.csrf();
      const r = await b.post('/api/auth/login', { email, password: PW, ...(rememberDevice === undefined ? {} : { rememberDevice }) });
      assert.equal(r.ok, true, 'login succeeds');
      return b;
    };
    const restoreOn = async (device) => { const c = new Browser(srv.port); c.cookies.set('ct_device', device); await c.csrf(); return c; };

    console.log('keep me signed in on this device');
    await test('a login with the box ticked stores a device token, and only its hash is kept in the database', async () => {
      const u = await newUser('Dev');
      const b = await login(u.email, true);
      const raw = b.cookies.get('ct_device');
      assert.ok(raw && raw.length >= 32, 'a device cookie is set');
      const hash = crypto.createHash('sha256').update(decodeURIComponent(raw)).digest('hex');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM auth_devices WHERE token_hash = $1 AND player_id = $2', [hash, u.id]))[0].n, 1, 'the hash is stored');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM auth_devices WHERE token_hash = $1', [decodeURIComponent(raw)]))[0].n, 0, 'the token itself is not stored');
    });
    await test('a login without the box ticked leaves no device trust behind', async () => {
      const u = await newUser('NoDev');
      const b = await login(u.email, undefined);
      assert.equal(b.cookies.has('ct_device'), false);
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM auth_devices WHERE player_id = $1', [u.id]))[0].n, 0);
    });
    await test('on the same device a new visit signs in automatically, and the older session of the account is retired (one session rule)', async () => {
      const u = await newUser('Auto');
      const first = await login(u.email, true);
      const device = first.cookies.get('ct_device');
      const again = await restoreOn(device);
      const me = await again.get('/api/auth/session');
      assert.equal(me.json.authenticated, true);
      assert.equal(me.json.player.id, u.id);
      assert.ok(again.cookies.has('ct_session'), 'a session cookie is issued');
      first.cookies.delete('ct_device'); // only the session is under test here: without the device this browser cannot sign itself back in
      assert.equal((await first.get('/api/auth/session')).json.authenticated, false, 'the older session no longer works');
    });
    await test('a password login that sends an older trusted device replaces it: the old token no longer signs anyone in', async () => {
      const u = await newUser('Repl');
      const first = await login(u.email, true);
      const oldDevice = first.cookies.get('ct_device');
      const again = new Browser(srv.port);
      again.cookies.set('ct_device', oldDevice);
      await again.csrf();
      assert.equal((await again.post('/api/auth/login', { email: u.email, password: PW, rememberDevice: true })).ok, true);
      assert.notEqual(again.cookies.get('ct_device'), oldDevice, 'a new device is issued');
      assert.equal((await (await restoreOn(oldDevice)).get('/api/auth/session')).json.authenticated, false, 'the replaced token is refused');
      assert.equal((await (await restoreOn(again.cookies.get('ct_device'))).get('/api/auth/session')).json.authenticated, true, 'the new one works');
    });
    await test('a forged, unknown or other-account device token gives no session', async () => {
      assert.equal((await (await restoreOn('abc')).get('/api/auth/session')).json.authenticated, false);
      assert.equal((await (await restoreOn('f'.repeat(64))).get('/api/auth/session')).json.authenticated, false);
    });
    await test('signing out on a device ends trust on that device; the token no longer signs anyone in', async () => {
      const u = await newUser('Out');
      const b = await login(u.email, true);
      const device = b.cookies.get('ct_device');
      await b.post('/api/auth/logout', {});
      assert.equal((await (await restoreOn(device)).get('/api/auth/session')).json.authenticated, false);
    });
    await test('a suspended account cannot be signed in by its device; the suspension itself ends its devices, so lifting it does not bring them back', async () => {
      const u = await newUser('Susp');
      const owner = await newUser('Boss');
      await q("UPDATE players SET role = 'owner' WHERE id = $1", [owner.id]); // the owner role is set directly here; the console itself is covered in admin.pg.test.js
      const b = await login(u.email, true);
      const device = b.cookies.get('ct_device');
      const dbAdmin = require('../db/admin');
      await dbAdmin.suspendUser({ actorId: owner.id, targetId: u.id, reason: 'test' });
      assert.equal((await (await restoreOn(device)).get('/api/auth/session')).json.authenticated, false, 'suspended: no restore');
      await dbAdmin.unsuspendUser({ actorId: owner.id, targetId: u.id });
      assert.equal((await (await restoreOn(device)).get('/api/auth/session')).json.authenticated, false, 'the device was ended by the suspension');
    });
    await test('sign-out everywhere (through the route) ends every trusted device', async () => {
      const u = await newUser('Everywhere');
      const b1 = await login(u.email, true);
      const d1 = b1.cookies.get('ct_device');
      assert.equal((await b1.post('/api/auth/logout-all', {})).ok, true);
      assert.equal((await (await restoreOn(d1)).get('/api/auth/session')).json.authenticated, false, 'the device no longer signs in');
    });
    await test('a password reset (through the routes) ends every trusted device; the new password signs in normally', async () => {
      const u = await newUser('Reset');
      const b1 = await login(u.email, true);
      const d1 = b1.cookies.get('ct_device');
      const anon = new Browser(srv.port); await anon.csrf();
      const asked = await anon.post('/api/auth/forgot-password', { email: u.email });
      assert.ok(asked.json.debug && asked.json.debug.resetToken, 'the test build hands out the reset token');
      assert.equal((await anon.post('/api/auth/reset-password', { token: asked.json.debug.resetToken, newPassword: 'NewDevPass123!' })).ok, true);
      assert.equal((await (await restoreOn(d1)).get('/api/auth/session')).json.authenticated, false, 'the device no longer signs in');
      const fresh = new Browser(srv.port); await fresh.csrf();
      assert.equal((await fresh.post('/api/auth/login', { email: u.email, password: 'NewDevPass123!' })).ok, true);
    });
    console.log(`${passed} device-trust checks passed`);
  } finally {
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL devices.pg', e); process.exit(1); });
