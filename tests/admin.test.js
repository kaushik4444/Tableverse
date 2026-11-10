'use strict';
// Admin console API: authentication, authorization, CSRF, privilege escalation, owner protection, audit log, feedback.
// Runs on the in-memory store behind the real route dispatcher (see tests/helpers/adminHarness.js). The SQL is in admin.pg.test.js.
const assert = require('node:assert/strict');
const { start } = require('./helpers/adminHarness');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const ADMIN_GETS = ['/api/admin/me', '/api/admin/overview', '/api/admin/health', '/api/admin/users', '/api/admin/feedback', '/api/admin/announcements', '/api/admin/audit', '/api/admin/logs'];
const ADMIN_POSTS = [
  ['/api/admin/roles', { playerId: 'p_00000000-0000-4000-8000-000000000001', role: 'admin' }],
  ['/api/admin/users/sign-out', { playerId: 'p_00000000-0000-4000-8000-000000000001' }],
  ['/api/admin/users/resend-verification', { playerId: 'p_00000000-0000-4000-8000-000000000001' }],
  ['/api/admin/feedback/status', { id: 'p_00000000-0000-4000-8000-000000000001', status: 'read' }],
  ['/api/admin/announcements', { message: 'x', durationHours: 1 }],
  ['/api/admin/announcements/update', { id: 'p_00000000-0000-4000-8000-000000000001', message: 'y' }],
  ['/api/admin/announcements/end', { id: 'p_00000000-0000-4000-8000-000000000001' }],
];

(async () => {
  const mail = [];
  const s = await start({ mail });
  try {
    const guest = await s.guest();
    const user = await s.login();
    const admin = await s.login({ role: 'admin' });
    const owner = await s.login({ role: 'owner' });
    const other = await s.login({ role: 'user' });
    const admin2 = await s.login({ role: 'admin' });

    console.log('anonymous and signed-in non-admin callers');
    await test('every admin GET answers 401 without a session', async () => {
      for (const p of ADMIN_GETS) assert.equal((await guest.get(p)).status, 401, p);
    });
    await test('every admin POST answers 401 without a session (CSRF present)', async () => {
      for (const [p, body] of ADMIN_POSTS) assert.equal((await guest.post(p, body)).status, 401, p);
    });
    await test('a signed-in ordinary player gets 403 from every admin endpoint except /me, which says "not an admin"', async () => {
      for (const p of ADMIN_GETS.filter((x) => x !== '/api/admin/me')) assert.equal((await user.b.get(p)).status, 403, p);
      for (const [p, body] of ADMIN_POSTS) assert.equal((await user.b.post(p, body)).status, 403, p);
      const me = await user.b.get('/api/admin/me');
      assert.equal(me.status, 200);
      assert.deepEqual([me.json.isAdmin, me.json.isOwner, me.json.role], [false, false, 'user']);
    });
    await test('a 403 reveals nothing about what exists', async () => {
      const r = await user.b.get('/api/admin/users?q=u');
      assert.deepEqual(Object.keys(r.json).sort(), ['error', 'ok']);
    });
    await test('admin rights are not taken from the request: role fields, headers and cookies are ignored', async () => {
      const spoof = { headers: { 'x-role': 'owner', 'x-admin': '1' } };
      assert.equal((await user.b.get('/api/admin/overview', spoof)).status, 403);
      user.b.cookies.set('ct_role', 'owner'); user.b.cookies.set('role', 'admin');
      assert.equal((await user.b.get('/api/admin/overview')).status, 403);
      assert.equal((await user.b.get('/api/admin/overview?role=owner&isAdmin=true')).status, 403);
      assert.equal((await user.b.post('/api/admin/announcements', { message: 'x', durationHours: 1, role: 'owner', isAdmin: true })).status, 403);
      assert.equal(s.store.anns.length, 0);
    });

    console.log('CSRF');
    await test('an admin POST without the CSRF header is refused with 403, even for the owner, and changes nothing', async () => {
      const r = await owner.b.post('/api/admin/announcements', { message: 'Hello', durationHours: 24 }, { csrf: false });
      assert.equal(r.status, 403);
      assert.match(r.json.error, /CSRF/i);
      assert.equal(s.store.anns.length, 0);
    });
    await test('a wrong CSRF token is refused for every admin POST', async () => {
      for (const [p, body] of ADMIN_POSTS) assert.equal((await owner.b.post(p, body, { headers: { 'x-csrf-token': 'f'.repeat(48) } })).status, 403, p);
      assert.equal((await owner.b.post('/api/feedback', { message: 'hi' }, { headers: { 'x-csrf-token': 'bad' } })).status, 403);
      assert.equal((await owner.b.post('/api/announcements/dismiss', { id: 'p_00000000-0000-4000-8000-000000000001' }, { csrf: false })).status, 403);
    });

    console.log('admin access');
    await test('an admin can read the console data', async () => {
      for (const p of ADMIN_GETS) assert.equal((await admin.b.get(p)).status, 200, p);
      const me = await admin.b.get('/api/admin/me');
      assert.deepEqual([me.json.isAdmin, me.json.isOwner], [true, false]);
    });
    await test('the user list never contains e-mail addresses', async () => {
      const r = await owner.b.get('/api/admin/users');
      assert.ok(r.json.users.length >= 5);
      assert.ok(r.json.users.every((u) => !('email' in u)));
    });
    await test('a role change takes effect on the next request: demotion removes access at once', async () => {
      const temp = await s.login({ role: 'admin' });
      assert.equal((await temp.b.get('/api/admin/overview')).status, 200);
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: temp.id, role: 'user' })).status, 200);
      assert.equal((await temp.b.get('/api/admin/overview')).status, 403);
    });

    console.log('privilege escalation and owner protection');
    await test('an admin cannot grant or revoke any role', async () => {
      for (const body of [{ playerId: other.id, role: 'admin' }, { playerId: admin2.id, role: 'user' }, { playerId: owner.id, role: 'user' }, { playerId: admin.id, role: 'owner' }]) {
        const r = await admin.b.post('/api/admin/roles', body);
        assert.equal(r.status, 403, JSON.stringify(body));
      }
      assert.equal(s.store.players.get(other.id).role, 'user');
      assert.equal(s.store.players.get(admin2.id).role, 'admin');
    });
    await test('a player cannot make themselves admin or owner', async () => {
      for (const role of ['admin', 'owner']) assert.equal((await user.b.post('/api/admin/roles', { playerId: user.id, role })).status, 403);
      assert.equal(s.store.players.get(user.id).role, 'user');
    });
    await test('staff can resend the verification mail of an unverified account; the address stays server-side', async () => {
      const pending = await s.login({ email: 'pending@example.com', verified: false });
      const r = await admin.b.post('/api/admin/users/resend-verification', { playerId: pending.id });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { ok: true, sent: true });
      assert.ok(!JSON.stringify(r.json).includes('pending@example.com'), 'the response never carries the address');
      assert.equal(mail.length, 1);
      assert.equal(mail[0].email, 'pending@example.com');
      assert.ok(s.store.audit.some((a) => a.action === 'user.verify_resend'));
    });
    await test('a verified account, or a player with no email, gets 409 and no mail', async () => {
      const verified = await s.login({ email: 'done@example.com', verified: true });
      const noEmail = await s.login({});
      const before = mail.length;
      assert.equal((await admin.b.post('/api/admin/users/resend-verification', { playerId: verified.id })).status, 409);
      assert.equal((await admin.b.post('/api/admin/users/resend-verification', { playerId: noEmail.id })).status, 409);
      assert.equal(mail.length, before);
    });
    await test('an ordinary player cannot trigger a verification mail', async () => {
      const pending = await s.login({ email: 'victim@example.com', verified: false });
      const before = mail.length;
      assert.equal((await user.b.post('/api/admin/users/resend-verification', { playerId: pending.id })).status, 403);
      assert.equal(mail.length, before);
    });
    await test('the owner can grant and revoke admin, and each change is audited', async () => {
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: other.id, role: 'admin' })).json.changed, true);
      assert.equal(s.store.players.get(other.id).role, 'admin');
      assert.equal((await other.b.get('/api/admin/overview')).status, 200);
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: other.id, role: 'admin' })).json.changed, false, 'repeat is a no-op');
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: other.id, role: 'user' })).status, 200);
      const actions = s.store.audit.map((a) => a.action);
      assert.ok(actions.includes('role.grant_admin') && actions.includes('role.revoke_admin'));
    });
    await test('ownership can never be granted through the API', async () => {
      for (const role of ['owner', 'superadmin', '', null, undefined, 1]) assert.equal((await owner.b.post('/api/admin/roles', { playerId: other.id, role })).status, 400, String(role));
      assert.equal([...s.store.players.values()].filter((p) => p.role === 'owner').length, 1);
    });
    await test('the owner cannot be demoted, removed or changed, not even by themselves', async () => {
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: owner.id, role: 'user' })).status, 400);
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: owner.id, role: 'admin' })).status, 400);
      assert.equal(s.store.players.get(owner.id).role, 'owner');
    });
    await test('an admin cannot sign out the owner or another admin, but can sign out an ordinary player', async () => {
      assert.equal((await admin.b.post('/api/admin/users/sign-out', { playerId: owner.id })).status, 403);
      assert.equal((await admin.b.post('/api/admin/users/sign-out', { playerId: admin2.id })).status, 403);
      assert.equal((await admin.b.post('/api/admin/users/sign-out', { playerId: user.id })).status, 200);
      assert.deepEqual(s.signedOutCalls.map((c) => c.playerId), [user.id], 'open sockets of that player are closed');
    });
    await test('the owner may sign an admin out', async () => {
      assert.equal((await owner.b.post('/api/admin/users/sign-out', { playerId: admin2.id })).status, 200);
    });
    await test('malformed target ids are rejected before the store is touched', async () => {
      for (const id of ['', 'abc', "' OR 1=1 --", 5, null, {}]) assert.equal((await owner.b.post('/api/admin/roles', { playerId: id, role: 'admin' })).status, 400);
    });
    await test('unknown accounts are 404', async () => {
      assert.equal((await owner.b.post('/api/admin/roles', { playerId: 'p_00000000-0000-4000-8000-0000000000ff', role: 'admin' })).status, 404);
    });

    console.log('owner bootstrap from server-side configuration');
    await test('bootstrap needs configuration, a verified e-mail and the absence of an owner', async () => {
      const b = await start({ env: { ADMIN_OWNER_EMAIL: 'Me@Example.com' } });
      try {
        const noOwner = () => [...b.store.players.values()].filter((p) => p.role === 'owner');
        const unverified = await b.login({ email: 'me@example.com', verified: false });
        assert.equal((await unverified.b.get('/api/admin/me')).json.isOwner, false, 'an unverified address does not qualify');
        const stranger = await b.login({ email: 'someone@example.com', verified: true });
        assert.equal((await stranger.b.get('/api/admin/me')).json.isOwner, false);
        assert.equal(noOwner().length, 0);
        const real = await b.login({ email: 'me@example.com', verified: true });
        const me = await real.b.get('/api/admin/me');
        assert.deepEqual([me.json.isOwner, me.json.role], [true, 'owner']);
        assert.equal(b.store.audit.filter((a) => a.action === 'owner.claimed').length, 1);
        // once established the account id is what counts: nobody else can ever claim, whatever e-mail they have
        const second = await b.login({ email: 'me@example.com', verified: true });
        assert.equal((await second.b.get('/api/admin/me')).json.isOwner, false);
        assert.equal(noOwner().length, 1);
      } finally { await b.close(); }
    });
    await test('without ADMIN_OWNER_* configured nobody can become owner, whatever they send', async () => {
      const b = await start({});
      try {
        const u = await b.login({ email: 'me@example.com', verified: true });
        assert.equal((await u.b.get('/api/admin/me?owner=1', { headers: { 'x-owner': '1' } })).json.isOwner, false);
        assert.equal((await u.b.post('/api/admin/roles', { playerId: u.id, role: 'owner' })).status, 403);
      } finally { await b.close(); }
    });
    await test('ADMIN_OWNER_ID is used when the e-mail setting does not match a verified account (email first, id as fallback)', async () => {
      const b = await start({ env: { ADMIN_OWNER_EMAIL: 'mail@example.com' } });
      try {
        const target = await b.login({ email: 'target@example.com', verified: true });
        const other = await b.login({ email: 'mail@example.com', verified: false });
        assert.equal((await other.b.get('/api/admin/me')).json.isOwner, false, 'an unverified address does not qualify');
        b.env.ADMIN_OWNER_ID = target.id; // the operator sets the id (server configuration)
        assert.equal((await target.b.get('/api/admin/me')).json.isOwner, true, 'the configured id claims ownership');
      } finally { await b.close(); }
    });
    await test('a verified ADMIN_OWNER_EMAIL is used first; the id is then ignored', async () => {
      const b = await start({ env: { ADMIN_OWNER_ID: '00000000-0000-4000-8000-00000000abcd', ADMIN_OWNER_EMAIL: 'mail@example.com' } });
      try {
        const viaMail = await b.login({ email: 'mail@example.com', verified: true });
        assert.equal((await viaMail.b.get('/api/admin/me')).json.isOwner, true);
        const stranger = await b.login({ email: 'x@example.com', verified: true });
        assert.equal((await stranger.b.get('/api/admin/me')).json.isOwner, false);
      } finally { await b.close(); }
    });
    console.log('audit log');
    await test('admin changes are recorded and only staff can read the log', async () => {
      assert.equal((await user.b.get('/api/admin/audit')).status, 403);
      const r = await admin.b.get('/api/admin/audit');
      assert.equal(r.status, 200);
      assert.ok(r.json.items.length > 0);
      assert.ok(r.json.items.every((a) => a.action && !('ip' in a)), 'no address is stored');
    });
    await test('there is no endpoint that edits or deletes the audit log', async () => {
      for (const m of ['POST', 'PUT', 'DELETE']) for (const p of ['/api/admin/audit', '/api/admin/audit/delete', '/api/admin/audit/clear']) {
        const r = await owner.b.request(m, p, {}, { csrf: true });
        assert.ok([404, 405].includes(r.status), `${m} ${p} -> ${r.status}`);
      }
    });

    console.log('feedback');
    await test('guests and players can send feedback; it is cleaned and categorised; staff can triage it', async () => {
      const g = await guest.post('/api/feedback', { category: 'bug', message: '  The <b>board</b>\u0000 is cut off  ' });
      assert.equal(g.status, 201);
      const p = await user.b.post('/api/feedback', { category: 'nonsense', message: 'More games please' });
      assert.equal(p.status, 201);
      const list = (await admin.b.get('/api/admin/feedback')).json.items;
      assert.equal(list[0].category, 'bug');
      assert.ok(!/[<>\u0000]/.test(list[0].message));
      assert.equal(list[1].category, 'other');
      assert.equal(list[1].player_id, user.id, 'the account is the one in the session');
      assert.equal((await admin.b.post('/api/admin/feedback/status', { id: list[0].id, status: 'resolved' })).status, 200);
      assert.equal(s.store.feedback.find((f) => f.id === list[0].id).status, 'resolved');
    });
    await test('feedback cannot be attributed to someone else', async () => {
      await guest.post('/api/feedback', { message: 'hi', playerId: owner.id, player_id: owner.id });
      assert.equal(s.store.feedback.at(-1).player_id, null);
    });
    await test('empty and oversized feedback is refused', async () => {
      assert.equal((await guest.post('/api/feedback', { message: '   ' })).status, 400);
      assert.equal((await guest.post('/api/feedback', { message: 'x'.repeat(1001) })).status, 400);
    });
    await test('feedback is rate limited per address', async () => {
      const b = await start({ env: { RL_FEEDBACK_IP_LIMIT: '2' } });
      try {
        const g = await b.guest();
        const codes = [];
        for (let i = 0; i < 4; i++) codes.push((await g.post('/api/feedback', { message: 'hello ' + i })).status);
        assert.deepEqual(codes, [201, 201, 429, 429]);
      } finally { await b.close(); }
    });

    console.log('a database fault');
    await test('a store failure is a clean 500 with no internals, and the next request works', async () => {
      s.store.failWith(Object.assign(new Error('connection to 10.0.0.5 refused'), { code: 'ECONNREFUSED' }));
      const r = await admin.b.get('/api/admin/overview'); // getRole fails first
      assert.equal(r.status, 500);
      assert.ok(!/10\.0\.0\.5|ECONNREFUSED/.test(JSON.stringify(r.json)));
      assert.equal((await admin.b.get('/api/admin/overview')).status, 200);
    });
  } finally { await s.close(); }
  console.log(`\n${passed} admin API tests passed`);
})();
