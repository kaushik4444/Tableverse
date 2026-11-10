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
    const activeSessions = async (playerId) => (await q('SELECT COUNT(*)::int AS n FROM auth_sessions WHERE player_id = $1 AND revoked_at IS NULL AND expires_at > NOW()', [playerId]))[0].n;
    const ageSessions = (playerId) => q("UPDATE auth_sessions SET created_at = NOW() - INTERVAL '1 minute' WHERE player_id = $1", [playerId]);

    await test('a session started from a trusted device is linked to that device', async () => {
      const u = await newUser('Link');
      await login(u.email, true);
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM auth_sessions s JOIN auth_devices d ON d.id = s.device_id WHERE s.player_id = $1', [u.id]))[0].n, 1);
    });
    await test('logging out from a stale tab ends a session that a restore started from the same device', async () => {
      const u = await newUser('StaleOut');
      const b1 = await login(u.email, true);
      const device = b1.cookies.get('ct_device');
      await ageSessions(u.id);
      const restored = await restoreOn(device);
      assert.equal((await restored.get('/api/auth/session')).json.authenticated, true, 'the restore signs in');
      // b1 still holds its old, retired session cookie and the same device
      assert.equal((await b1.post('/api/auth/logout', {})).ok, true);
      assert.equal((await restored.get('/api/auth/session')).json.authenticated, false, 'the restored session ended with its device');
      assert.equal(await activeSessions(u.id), 0);
    });
    await test('two tabs of one browser restoring at the same moment both get a session, one live session remains, and each tab recovers', async () => {
      const u = await newUser('TwoTabs');
      const b1 = await login(u.email, true);
      const device = b1.cookies.get('ct_device');
      await ageSessions(u.id);
      const tabA = await restoreOn(device);
      const tabB = await restoreOn(device);
      const [ra, rb] = await Promise.all([tabA.get('/api/auth/session'), tabB.get('/api/auth/session')]);
      assert.equal(ra.json.authenticated, true, 'tab A is signed in by its own response');
      assert.equal(rb.json.authenticated, true, 'tab B is signed in by its own response');
      assert.equal(ra.json.player.id, u.id);
      assert.equal(await activeSessions(u.id), 1, 'one live session for the account');
      // whichever tab lost the race has a refused cookie; its next request restores again from the device
      assert.equal((await tabA.get('/api/auth/session')).json.authenticated, true, 'tab A recovers');
      assert.equal((await tabB.get('/api/auth/session')).json.authenticated, true, 'tab B recovers');
      assert.equal(await activeSessions(u.id), 1);
    });
    await test('a second restore of the same device replaces the first session, and the first tab recovers on its next request', async () => {
      const u = await newUser('Second');
      const b1 = await login(u.email, true);
      const device = b1.cookies.get('ct_device');
      await ageSessions(u.id);
      const first = await restoreOn(device);
      assert.equal((await first.get('/api/auth/session')).json.authenticated, true);
      const second = await restoreOn(device);
      assert.equal((await second.get('/api/auth/session')).json.authenticated, true);
      assert.equal(await activeSessions(u.id), 1, 'the first session was retired');
      assert.equal((await first.get('/api/auth/session')).json.authenticated, true, 'the first tab restores again from the device');
      assert.equal(await activeSessions(u.id), 1);
    });
    await test('replaying a device token after a password reset does not end a fresh login on another browser', async () => {
      const u = await newUser('Stale');
      const b1 = await login(u.email, true);
      const oldDevice = b1.cookies.get('ct_device');
      const anon = new Browser(srv.port); await anon.csrf();
      const asked = await anon.post('/api/auth/forgot-password', { email: u.email });
      assert.equal((await anon.post('/api/auth/reset-password', { token: asked.json.debug.resetToken, newPassword: 'StaleReset123!' })).ok, true);
      const fresh = new Browser(srv.port); await fresh.csrf();
      assert.equal((await fresh.post('/api/auth/login', { email: u.email, password: 'StaleReset123!', rememberDevice: true })).ok, true);
      // the stale browser replays its old device and session, and signs out
      const stale = await restoreOn(oldDevice);
      assert.equal((await stale.get('/api/auth/session')).json.authenticated, false, 'the old device no longer signs in');
      assert.equal((await stale.post('/api/auth/logout', {})).ok, true);
      assert.equal((await fresh.get('/api/auth/session')).json.authenticated, true, 'the fresh login is untouched');
    });
    await test('a shared browser that signs into another account ends the first account\'s session from the device it replaces', async () => {
      const a = await newUser('ShareA');
      const b = await newUser('ShareB');
      const aBrowser = await login(a.email, true);
      const aDevice = aBrowser.cookies.get('ct_device');
      assert.equal((await aBrowser.get('/api/auth/session')).json.authenticated, true);
      const shared = new Browser(srv.port);
      shared.cookies.set('ct_device', aDevice);
      await shared.csrf();
      assert.equal((await shared.post('/api/auth/login', { email: b.email, password: PW, rememberDevice: true })).ok, true);
      assert.equal((await aBrowser.get('/api/auth/session')).json.authenticated, false, 'the first account\'s session from the replaced device ended');
      assert.equal((await shared.get('/api/auth/session')).json.player.id, b.id, 'the second account is signed in');
    });
    await test('sign out everywhere from a stale tab still ends the account\'s trusted devices', async () => {
      const u = await newUser('StaleAll');
      const b1 = await login(u.email, true);
      const device = b1.cookies.get('ct_device');
      await ageSessions(u.id);
      const restored = await restoreOn(device); // another tab restores: b1's session is retired
      assert.equal((await restored.get('/api/auth/session')).json.authenticated, true);
      assert.equal((await b1.post('/api/auth/logout-all', {})).ok, true);
      assert.equal((await (await restoreOn(device)).get('/api/auth/session')).json.authenticated, false, 'the device no longer signs in');
      assert.equal(await activeSessions(u.id), 0, 'no session is left');
    });
    await test('an expired trusted device signs nobody in', async () => {
      const u = await newUser('Expired');
      const b1 = await login(u.email, true);
      const device = b1.cookies.get('ct_device');
      await q("UPDATE auth_devices SET expires_at = NOW() - INTERVAL '1 minute' WHERE player_id = $1", [u.id]);
      assert.equal((await (await restoreOn(device)).get('/api/auth/session')).json.authenticated, false);
    });
    await test('a restore renews the device for another 30 days (sliding expiry)', async () => {
      const u = await newUser('Slide');
      const b1 = await login(u.email, true);
      const device = b1.cookies.get('ct_device');
      await q("UPDATE auth_devices SET expires_at = NOW() + INTERVAL '1 day' WHERE player_id = $1", [u.id]);
      await ageSessions(u.id);
      assert.equal((await (await restoreOn(device)).get('/api/auth/session')).json.authenticated, true);
      assert.equal((await q("SELECT expires_at > NOW() + INTERVAL '20 days' AS renewed FROM auth_devices WHERE player_id = $1", [u.id]))[0].renewed, true);
    });
    console.log(`${passed} device-trust checks passed`);
  } finally {
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL devices.pg', e); process.exit(1); });
