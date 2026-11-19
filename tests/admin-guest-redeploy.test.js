'use strict';
// Admin console routes for the guest switches (staff) and the Render redeploy (owner only).
// Runs on the in-memory store behind the real route dispatcher (tests/helpers/adminHarness.js). The SQL is in admin.pg.test.js.
const assert = require('node:assert/strict');
const { start } = require('./helpers/adminHarness');
const { createMemoryAdminStore } = require('./helpers/memoryAdminStore');
const guestFeatures = require('../lib/guestFeatures');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

/** A stand-in for lib/renderDeploy.js: records each call and answers with `answer`. */
function fakeDeploy(answer = { ok: true }) {
  const calls = [];
  return { calls, configured: true, redeploy: async () => { calls.push(Date.now()); return typeof answer === 'function' ? answer() : answer; } };
}

(async () => {
  const flags = new Map();
  const audit = [];
  const base = createMemoryAdminStore({ now: () => new Date(), env: { NODE_ENV: 'test' } });
  base.listGuestFeatures = async () => [...flags].map(([feature, v]) => ({ feature, enabled: v.enabled, updated_at: v.at, updated_by: v.by }));
  base.setGuestFeature = async ({ actorId, feature, enabled }) => { flags.set(feature, { enabled, at: new Date().toISOString(), by: actorId }); };
  base.recordAudit = async (row) => { audit.push(row); };

  const deploy = fakeDeploy();
  const s = await start({ store: base, renderDeploy: deploy });
  try {
    const user = await s.login();
    const admin = await s.login({ role: 'admin' });
    const owner = await s.login({ role: 'owner' });

    console.log('Guest switches (staff)');
    await test('guest switches are for staff only; a player gets 403 on both reads and writes', async () => {
      assert.equal((await user.b.get('/api/admin/guest-features')).status, 403);
      assert.equal((await user.b.post('/api/admin/guest-features', { feature: 'rejoin', enabled: true })).status, 403);
      assert.equal(flags.size, 0, 'nothing stored');
    });
    await test('an admin sees every switch, all locked by default', async () => {
      const r = await admin.b.get('/api/admin/guest-features');
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.features.map((f) => f.key), ['private_tables', 'rejoin', 'profiles', 'blocking', 'reports']);
      assert.ok(r.json.features.every((f) => f.enabled === false && f.updatedAt === null));
    });
    await test('an admin can open a switch; it takes effect at once and is read back', async () => {
      const r = await admin.b.post('/api/admin/guest-features', { feature: 'private_tables', enabled: true });
      assert.equal(r.status, 200);
      assert.equal(guestFeatures.allowed('private_tables'), true, 'live in this process');
      const back = await admin.b.get('/api/admin/guest-features');
      assert.equal(back.json.features.find((f) => f.key === 'private_tables').enabled, true);
      assert.equal(flags.get('private_tables').by, admin.id, 'stored with who changed it');
    });
    await test('an unknown key and a non-boolean value are refused and change nothing', async () => {
      assert.equal((await admin.b.post('/api/admin/guest-features', { feature: 'friends', enabled: true })).status, 400, 'friends are account-only');
      assert.equal((await admin.b.post('/api/admin/guest-features', { feature: 'rejoin', enabled: 'yes' })).status, 400);
      assert.equal(flags.has('friends'), false);
      assert.equal(flags.get('rejoin'), undefined);
      assert.equal(guestFeatures.allowed('rejoin'), false);
    });
    await test('an owner can also change a switch, and locking it again works', async () => {
      assert.equal((await owner.b.post('/api/admin/guest-features', { feature: 'private_tables', enabled: false })).status, 200);
      assert.equal(guestFeatures.allowed('private_tables'), false);
    });

    console.log('Render redeploy (owner only)');
    await test('only the owner can redeploy; an admin is refused and nothing is called', async () => {
      const before = deploy.calls.length;
      assert.equal((await admin.b.post('/api/admin/render/redeploy', { confirm: 'REDEPLOY' })).status, 403);
      assert.equal((await user.b.post('/api/admin/render/redeploy', { confirm: 'REDEPLOY' })).status, 403);
      assert.equal(deploy.calls.length, before);
    });
    await test('the owner must type REDEPLOY exactly; a missing or wrong word is refused and nothing is called', async () => {
      const before = deploy.calls.length;
      assert.equal((await owner.b.post('/api/admin/render/redeploy', {})).status, 400);
      assert.equal((await owner.b.post('/api/admin/render/redeploy', { confirm: 'redeploy' })).status, 400);
      assert.equal(deploy.calls.length, before);
    });
    await test('the owner with the word gets 202, the request is made once, and the redeploy is audited', async () => {
      const r = await owner.b.post('/api/admin/render/redeploy', { confirm: 'REDEPLOY' });
      assert.equal(r.status, 202);
      assert.equal(r.json.ok, true);
      assert.equal(deploy.calls.length, 1);
      const row = audit.find((a) => a.action === 'render.redeploy');
      assert.ok(row, 'audit row written');
      assert.equal(row.actorId, owner.id);
      assert.deepEqual(row.detail, { ok: true, status: 202 });
    });
    await test('a Render refusal is passed on by status, with no Render text, and the failure is audited', async () => {
      deploy.redeploy = async () => ({ ok: false, status: 502, error: 'Render answered with HTTP 401. Check that the API key can deploy this service.' });
      const r = await owner.b.post('/api/admin/render/redeploy', { confirm: 'REDEPLOY' });
      assert.equal(r.status, 502);
      assert.match(r.json.error, /HTTP 401/);
      assert.equal(audit.filter((a) => a.action === 'render.redeploy').at(-1).detail.ok, false);
    });
    await test('during the cooldown the owner is told to wait, with the time to wait', async () => {
      deploy.redeploy = async () => ({ ok: false, status: 429, error: 'A redeploy was asked for a few minutes ago. Wait before asking again.', retryAfterMs: 120000 });
      const r = await owner.b.post('/api/admin/render/redeploy', { confirm: 'REDEPLOY' });
      assert.equal(r.status, 429);
      assert.equal(r.json.retryAfterMs, 120000);
    });
    await test('without the Render settings the owner gets 503 and is told it is not set up', async () => {
      const bare = await start({ store: base, renderDeploy: null });
      try {
        const o = await bare.login({ role: 'owner' });
        const r = await o.b.post('/api/admin/render/redeploy', { confirm: 'REDEPLOY' });
        assert.equal(r.status, 503);
        assert.match(r.json.error, /not set up/);
      } finally { await bare.close(); }
    });
  } finally {
    await s.close();
    guestFeatures.setOne('private_tables', false);
  }
  console.log(`\n${passed} admin guest and redeploy tests passed`);
})();
