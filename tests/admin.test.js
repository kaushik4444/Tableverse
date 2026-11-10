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
    await test('refused requests do not use up the resend quota of an allowed one', async () => {
      // its own server with the real per-account limit (3), so four refusals would exhaust it if they counted
      const s3 = await start({ env: { RL_ADMIN_RESEND_LIMIT: '3' } });
      try {
        const admin3 = await s3.login({ role: 'admin' });
        const owner3 = await s3.login({ role: 'owner' });
        const peer = await s3.login({ role: 'admin', email: 'peer-admin@example.com', verified: false });
        for (let i = 0; i < 4; i++) assert.equal((await admin3.b.post('/api/admin/users/resend-verification', { playerId: peer.id })).status, 403);
        assert.equal((await owner3.b.post('/api/admin/users/resend-verification', { playerId: peer.id })).status, 200);
      } finally { await s3.close(); }
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

    console.log('owner e-mail broadcasts (Stage 20.7)');
    const { createBroadcastWorker } = require('../lib/broadcast');
    const bmail = [];
    const sb = await start({ broadcastMail: bmail }); // its own store and mail, so the counts below are exact
    const bOwner = await sb.login({ role: 'owner', email: 'owner@b.test', verified: true });
    const bAdmin = await sb.login({ role: 'admin', email: 'staff@b.test', verified: true });
    const bVer = await sb.login({ email: 'verified@b.test', verified: true });
    const bUnver = await sb.login({ email: 'pending@b.test', verified: false });
    const bOpted = await sb.login({ email: 'opted@b.test', verified: true });
    const bOld = await sb.login({ email: 'lapsed@b.test', verified: true });
    const bGuest = await sb.login({});
    sb.store.players.get(bOld.id).last_seen = new Date(sb.clock.t - 40 * 24 * 3600 * 1000);
    sb.store.players.get(bVer.id).last_seen = new Date(sb.clock.t - 1 * 24 * 3600 * 1000);
    const preview = (audience, category) => bOwner.b.get(`/api/admin/broadcasts/preview?audience=${audience}&category=${category}`);
    const sendBody = (over = {}) => ({ audience: 'all', category: 'account', subject: 'Hello', body: 'A line', expectedCount: 0, ...over });
    const worker = (deliver) => createBroadcastWorker({
      store: sb.store, makeUnsubscribeUrl: (t) => 'https://app.test/api/email/unsubscribe?token=' + t, pauseMs: 0, logger: { error() {} }, deliver,
    });

    await test('the broadcast tools are refused to admins, players and guests (403 / 401)', async () => {
      assert.equal((await bAdmin.b.get('/api/admin/broadcasts')).status, 403);
      assert.equal((await bAdmin.b.get('/api/admin/broadcasts/preview?audience=all&category=account')).status, 403);
      assert.equal((await bAdmin.b.post('/api/admin/broadcasts', sendBody())).status, 403);
      assert.equal((await bVer.b.post('/api/admin/broadcasts', sendBody())).status, 403);
      assert.equal((await (await sb.guest()).get('/api/admin/broadcasts')).status, 401, 'anonymous');
      assert.equal((await bGuest.b.get('/api/admin/broadcasts')).status, 403, 'a signed-in player with no e-mail is still a player');
      assert.equal(sb.queued.count, 0);
    });
    await test('the preview counts exactly the accounts each audience reaches, and never returns an address', async () => {
      const count = async (a, c) => { const r = await preview(a, c); assert.equal(r.status, 200); assert.ok(!JSON.stringify(r.json).includes('@b.test')); return r.json.count; };
      // accounts with an address: owner, admin, verified, pending (unverified), opted (verified), lapsed (verified, inactive); the guest has none
      assert.equal(await count('all', 'account'), 6);
      assert.equal(await count('verified', 'account'), 5);
      assert.equal(await count('unverified', 'account'), 1);
      assert.equal(await count('admins', 'account'), 2);
      assert.equal(await count('players', 'account'), 4);
      assert.equal(await count('inactive', 'account'), 1);
      assert.equal(await count('all', 'promo'), 5, 'promotions skip unverified accounts');
    });
    await test('promotional mail is never offered to unverified accounts (400), in the preview and in a send', async () => {
      assert.equal((await preview('unverified', 'promo')).status, 400);
      assert.equal((await bOwner.b.post('/api/admin/broadcasts', sendBody({ audience: 'unverified', category: 'promo', expectedCount: 1 }))).status, 400);
      assert.equal(sb.queued.count, 0);
    });
    await test('a send is refused (409) when the list changed since the owner looked at the count, and nothing is queued', async () => {
      const r = await bOwner.b.post('/api/admin/broadcasts', sendBody({ expectedCount: 4 }));
      assert.equal(r.status, 409);
      assert.match(r.json.error, /recipients, not 4/);
      assert.equal(sb.store.broadcasts.length, 0);
    });
    await test('an owner send is queued with its recipients fixed; the audit row keeps counts, never the message text', async () => {
      const r = await bOwner.b.post('/api/admin/broadcasts', sendBody({ expectedCount: 6, body: 'Secret launch text' }));
      assert.equal(r.status, 200);
      assert.equal(r.json.recipientCount, 6);
      assert.equal(sb.queued.count, 1, 'the sender is woken straight away');
      const row = sb.store.broadcasts[0];
      assert.equal(row.status, 'queued');
      assert.equal(sb.store.broadcastRecipients.get(row.id).size, 6);
      const entry = sb.store.audit.find((a) => a.action === 'broadcast.queue');
      assert.ok(entry && entry.detail.recipients === 6 && entry.detail.audience === 'all');
      assert.ok(!JSON.stringify(sb.store.audit).includes('Secret launch text'), 'the audit never keeps the message');
    });
    await test('an opt-out is honoured at once for promotions; the unsubscribe link needs no login and is answered the same for any token', async () => {
      sb.store.players.get(bOpted.id).unsubscribe_token = '11111111-2222-4333-8444-555555555555';
      const page = await fetch(`http://127.0.0.1:${sb.port}/api/email/unsubscribe?token=11111111-2222-4333-8444-555555555555`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /You are unsubscribed/);
      assert.equal(sb.store.players.get(bOpted.id).opted_out, true);
      assert.equal((await preview('all', 'promo')).json.count, 4, 'promotions now skip the opted-out account');
      assert.equal((await preview('all', 'account')).json.count, 6, 'account mail is not affected by promotions opt-out');
      for (const tok of ['nope', '00000000-0000-4000-8000-000000000000', '1%27%20OR%201%3D1']) {
        const r = await fetch(`http://127.0.0.1:${sb.port}/api/email/unsubscribe?token=${encodeURIComponent(tok)}`);
        assert.equal(r.status, 200, tok);
        assert.match(await r.text(), /You are unsubscribed/);
      }
    });
    await test('the sender delivers each recipient once, reads opt-outs at send time, and finishes the broadcast', async () => {
      const sent = [];
      sb.store.players.get(bOld.id).opted_out = true; // after queuing: account mail still goes, it is not promotional
      const out = await worker(async (m) => sent.push(m)).runOnce();
      assert.equal(out.done, true);
      const row = sb.store.broadcasts[0];
      assert.equal(row.status, 'sent');
      assert.equal(row.sent_count, 6);
      assert.equal(sent.length, 6, 'one delivery per recipient');
      assert.equal(new Set(sent.map((m) => m.idempotencyKey)).size, 6, 'each delivery has its own idempotency key');
      assert.ok(sent.every((m) => m.category === 'account' && m.unsubscribeUrl === null), 'account mail carries no unsubscribe link');
      assert.equal((await worker(async () => {}).runOnce()).idle, true, 'nothing left to send, and nothing is sent twice');
    });
    await test('a promotional send skips unverified and opted-out recipients, links every mail to unsubscribe and escapes the text', async () => {
      const r = await bOwner.b.post('/api/admin/broadcasts', sendBody({ category: 'promo', subject: 'Diwali offer', body: 'Lamps <3 & sweets', expectedCount: 3 }));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const sent = [];
      await worker(async (m) => sent.push(m)).runOnce();
      assert.deepEqual(sent.map((m) => m.to).sort(), ['owner@b.test', 'staff@b.test', 'verified@b.test']);
      assert.ok(sent.every((m) => m.unsubscribeUrl && m.html.includes(m.unsubscribeUrl) && m.text.includes(m.unsubscribeUrl)), 'every promo mail has the link');
      assert.ok(sent.every((m) => m.html.includes('Lamps &lt;3 &amp; sweets') && !m.html.includes('<3')), 'the owner text is escaped');
    });
    await test('a failed delivery is recorded as failed and the rest of the broadcast still goes out', async () => {
      const r = await bOwner.b.post('/api/admin/broadcasts', sendBody({ subject: 'Release', body: 'New version', expectedCount: 6 }));
      assert.equal(r.status, 200);
      let calls = 0;
      await worker(async (m) => { calls++; if (m.to === 'verified@b.test') throw new Error('provider 503'); }).runOnce();
      const row = sb.store.broadcasts[sb.store.broadcasts.length - 1];
      assert.equal(row.status, 'sent');
      assert.equal(row.failed_count, 1);
      assert.equal(calls, 6);
    });
    await test('the broadcast history is owner-only and carries no message text', async () => {
      const r = await bOwner.b.get('/api/admin/broadcasts');
      assert.equal(r.status, 200);
      assert.equal(r.json.items.length, 3);
      assert.ok(r.json.items.every((x) => !('body' in x)));
      assert.equal((await bAdmin.b.get('/api/admin/broadcasts')).status, 403);
    });
    await sb.close();
  } finally { await s.close(); }
  console.log(`\n${passed} admin API tests passed`);
})();
