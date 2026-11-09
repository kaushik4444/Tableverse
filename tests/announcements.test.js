'use strict';
// Announcements: validation, 1-day banners, scheduling, expiry, targeting, early end, and dismissal that follows the account.
// Pure rules first, then the HTTP routes on the in-memory store with a controllable clock.
const assert = require('node:assert/strict');
const ann = require('../lib/announcements');
const { start } = require('./helpers/adminHarness');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const H = 3600 * 1000;
const T0 = Date.parse('2026-11-08T10:00:00Z');
const at = (ms) => new Date(T0 + ms);

(async () => {
  console.log('rules');
  await test('a one-day announcement starts now and ends 24 hours later', () => {
    const f = ann.parseInput({ message: 'Maintenance tonight', durationHours: 24 }, at(0));
    assert.equal(f.startsAt.getTime(), T0);
    assert.equal(f.endsAt.getTime(), T0 + 24 * H);
    assert.deepEqual([f.level, f.audience], ['info', 'all']);
  });
  await test('a scheduled announcement keeps its own start; the duration counts from it', () => {
    const f = ann.parseInput({ message: 'Soon', startsAt: at(2 * H).toISOString(), durationHours: 24 }, at(0));
    assert.equal(f.endsAt.getTime() - f.startsAt.getTime(), 24 * H);
  });
  await test('mistakes are refused: empty, too long, past end, end before start, no end, too long a run, unknown level or audience, bad dates', () => {
    const bad = (b) => assert.throws(() => ann.parseInput(b, at(0)), ann.AnnouncementError, JSON.stringify(b).slice(0, 80));
    bad({ message: '', durationHours: 1 });
    bad({ message: '   <>  ', durationHours: 1 });
    bad({ message: 'x'.repeat(201), durationHours: 1 });
    bad({ message: 'x', endsAt: at(-H).toISOString() });
    bad({ message: 'x', startsAt: at(5 * H).toISOString(), endsAt: at(2 * H).toISOString() });
    bad({ message: 'x' });
    bad({ message: 'x', durationHours: 0 });
    bad({ message: 'x', durationHours: -3 });
    bad({ message: 'x', durationHours: 24 * 91 });
    bad({ message: 'x', durationHours: 1, level: 'critical' });
    bad({ message: 'x', durationHours: 1, audience: 'everyone' });
    bad({ message: 'x', durationHours: 1, startsAt: 'not a date' });
    bad({ message: 'x', durationHours: 1, startsAt: at(24 * 200 * H).toISOString() });
    bad({ message: 'x', endsAt: {} });
  });
  await test('the text is cleaned: control characters and angle brackets removed, spaces collapsed', () => {
    assert.equal(ann.parseInput({ message: ' Hello\u0000  <b>world</b>\n ', durationHours: 1 }, at(0)).message, 'Hello b world /b');
  });
  await test('status: scheduled, live, expired and ended', () => {
    const row = (o) => ({ starts_at: at(0), ends_at: at(2 * H), ended_at: null, ...o });
    assert.equal(ann.statusOf(row({}), at(-1)), 'scheduled');
    assert.equal(ann.statusOf(row({}), at(1)), 'live');
    assert.equal(ann.statusOf(row({}), at(2 * H)), 'expired', 'the end instant itself is already expired');
    assert.equal(ann.statusOf(row({ ended_at: at(H) }), at(H + 1)), 'ended');
  });
  await test('audience matching', () => {
    const m = ann.audienceMatches;
    assert.deepEqual(['all', 'signed_in', 'guests', 'admins'].map((a) => m(a, { signedIn: false, isAdmin: false })), [true, false, true, false]);
    assert.deepEqual(['all', 'signed_in', 'guests', 'admins'].map((a) => m(a, { signedIn: true, isAdmin: false })), [true, true, false, false]);
    assert.deepEqual(['all', 'signed_in', 'guests', 'admins'].map((a) => m(a, { signedIn: true, isAdmin: true })), [true, true, false, true]);
    assert.equal(m('bogus', { signedIn: true, isAdmin: true }), false);
  });
  await test('a viewer sees at most three live banners, warnings first', () => {
    const mk = (i, level) => ({ id: 'a' + i, message: 'm' + i, level, audience: 'all', starts_at: at(-i * H), ends_at: at(H), ended_at: null });
    const out = ann.forViewer([mk(1, 'success'), mk(2, 'info'), mk(3, 'warning'), mk(4, 'info'), mk(5, 'warning')], {}, at(0));
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((a) => a.level), ['warning', 'warning', 'info']);
  });

  await test('a banner dismissed at its current revision is hidden; a later revision shows again', () => {
    const row = { id: 'x', message: 'm', level: 'info', audience: 'all', starts_at: at(-H), ends_at: at(H), ended_at: null, revision: 2 };
    assert.equal(ann.forViewer([row], {}, at(0), new Map([['x', 2]])).length, 0);
    assert.equal(ann.forViewer([row], {}, at(0), new Map([['x', 1]])).length, 1, 'dismissed an older revision');
    assert.equal(ann.forViewer([row], {}, at(0))[0].revision, 2);
  });

  await test('a dismissal of revision N hides N and any older (cached) revision; a newer revision shows', () => {
    const base = { id: 'x', message: 'm', level: 'info', audience: 'all', starts_at: at(-H), ends_at: at(H), ended_at: null };
    const stale = { ...base, revision: 1 }; const current = { ...base, revision: 2 }; const newer = { ...base, revision: 3 };
    const seen2 = new Map([['x', 2]]);
    assert.equal(ann.forViewer([stale], {}, at(0), seen2).length, 0, 'an older cached copy stays hidden');
    assert.equal(ann.forViewer([current], {}, at(0), seen2).length, 0, 'the dismissed revision stays hidden');
    assert.equal(ann.forViewer([newer], {}, at(0), seen2).length, 1, 'a newer revision shows');
    assert.equal(ann.forViewer([stale], {}, at(0), new Map([['x', 1]])).length, 0);
  });

  console.log('over HTTP');
  const clock = { t: T0 };
  const s = await start({ clock });
  try {
    const admin = await s.login({ role: 'admin' });
    const user = await s.login({});
    const guest = await s.guest();
    const ids = async (b) => (await b.get('/api/announcements')).json.announcements.map((a) => a.message);
    const tick = (ms) => { clock.t += ms; s.store.listLiveAnnouncements(); };
    // the route keeps a 15 second shared cache; creating or ending an announcement drops it, and time passing is checked per request
    const create = async (body) => { const r = await admin.b.post('/api/admin/announcements', body); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.announcement; };

    await test('a one-day announcement is visible now and gone after 24 hours, with no action by anyone', async () => {
      await create({ message: 'One day only', durationHours: 24 });
      assert.deepEqual(await ids(guest), ['One day only']);
      tick(23 * H + 59 * 60 * 1000);
      assert.deepEqual(await ids(guest), ['One day only']);
      tick(2 * 60 * 1000);
      assert.deepEqual(await ids(guest), [], 'expired exactly on time, even though the live list was cached');
      assert.deepEqual(await ids(user.b), []);
    });
    await test('a scheduled announcement stays hidden until its start and then appears', async () => {
      const start = new Date(clock.t + 3 * H).toISOString();
      const a = await create({ message: 'Opening night', startsAt: start, durationHours: 2 });
      assert.equal(a.status, 'scheduled');
      assert.deepEqual(await ids(guest), []);
      tick(3 * H + 20000); // past the start and past the 15 s cache
      assert.deepEqual(await ids(guest), ['Opening night']);
      tick(2 * H);
      assert.deepEqual(await ids(guest), []);
    });
    await test('targeting: signed-in, guests and admins see different banners', async () => {
      for (const audience of ['signed_in', 'guests', 'admins']) await create({ message: 'for ' + audience, audience, durationHours: 1 });
      assert.deepEqual(await ids(guest), ['for guests']);
      assert.deepEqual((await ids(user.b)).sort(), ['for signed_in']);
      assert.deepEqual((await ids(admin.b)).sort(), ['for admins', 'for signed_in']);
    });
    await test('the audience is decided by the server from the session, not by anything the client sends', async () => {
      const r = await guest.get('/api/announcements?audience=admins&signedIn=1&isAdmin=true', { headers: { 'x-audience': 'admins' } });
      assert.deepEqual(r.json.announcements.map((a) => a.message), ['for guests']);
      assert.equal(r.json.signedIn, false);
    });
    await test('an admin can end a banner early; it disappears for everyone straight away', async () => {
      const a = await create({ message: 'Oops wrong text', durationHours: 5 });
      assert.ok((await ids(guest)).includes('Oops wrong text'));
      assert.equal((await admin.b.post('/api/admin/announcements/end', { id: a.id })).status, 200);
      assert.ok(!(await ids(guest)).includes('Oops wrong text'));
      assert.equal((await admin.b.post('/api/admin/announcements/end', { id: a.id })).status, 404, 'a second end is refused');
      const list = (await admin.b.get('/api/admin/announcements')).json.items;
      assert.equal(list.find((x) => x.id === a.id).status, 'ended');
    });
    await test('dismissal follows the account to another device, and a changed text shows again', async () => {
      const a = await create({ message: 'Dismiss me', audience: 'signed_in', durationHours: 5 });
      const phone = user.b;
      const laptop = await s.otherDevice(user.token);
      assert.ok((await ids(phone)).includes('Dismiss me') && (await ids(laptop)).includes('Dismiss me'));
      assert.equal((await phone.post('/api/announcements/dismiss', { id: a.id })).status, 200);
      assert.ok(!(await ids(laptop)).includes('Dismiss me'), 'dismissed on the phone, gone on the laptop');
      assert.ok(!(await ids(phone)).includes('Dismiss me'));
      const other = await s.login({});
      assert.ok((await ids(other.b)).includes('Dismiss me'), 'other accounts still see it');
      assert.equal((await admin.b.post('/api/admin/announcements/update', { id: a.id, message: 'Dismiss me (updated)' })).status, 200);
      assert.ok((await ids(laptop)).includes('Dismiss me (updated)'), 'a new text is a new message');
    });
    // the home page shows at most three banners: end what earlier tests left running, so each case sees only its own banner
    const clearLive = async () => { for (const x of (await admin.b.get('/api/admin/announcements')).json.items) if (x.status === 'live') await admin.b.post('/api/admin/announcements/end', { id: x.id }); };
    await test('an edit of level, audience or schedule shows a dismissed banner again; saving the same values does not', async () => {
      await clearLive();
      const a = await create({ message: 'Revision me', audience: 'signed_in', durationHours: 5 });
      assert.equal((await user.b.post('/api/announcements/dismiss', { id: a.id })).status, 200);
      assert.ok(!(await ids(user.b)).includes('Revision me'));
      assert.equal((await admin.b.post('/api/admin/announcements/update', { id: a.id, message: 'Revision me', level: 'info', audience: 'signed_in' })).status, 200);
      assert.ok(!(await ids(user.b)).includes('Revision me'), 'the same values are not a change');
      assert.equal((await admin.b.post('/api/admin/announcements/update', { id: a.id, level: 'warning' })).status, 200);
      assert.ok((await ids(user.b)).includes('Revision me'), 'a level change is a new revision');
    });
    await test('restoring an old text is a change too: it shows again', async () => {
      await clearLive();
      const a = await create({ message: 'Text A', audience: 'signed_in', durationHours: 5 });
      await user.b.post('/api/announcements/dismiss', { id: a.id });
      await admin.b.post('/api/admin/announcements/update', { id: a.id, message: 'Text B' });
      assert.ok((await ids(user.b)).includes('Text B'));
      await user.b.post('/api/announcements/dismiss', { id: a.id });
      await admin.b.post('/api/admin/announcements/update', { id: a.id, message: 'Text A' });
      assert.ok((await ids(user.b)).includes('Text A'), 'back to the old text is a new revision');
    });
    await test('a dismissal of an older revision that arrives after an edit does not hide the new text; a newer dismissal is never lowered', async () => {
      await clearLive();
      const a = await create({ message: 'Race A', audience: 'signed_in', durationHours: 5 });
      await admin.b.post('/api/admin/announcements/update', { id: a.id, message: 'Race B' });
      assert.equal((await user.b.post('/api/announcements/dismiss', { id: a.id, revision: 1 })).status, 200);
      assert.ok((await ids(user.b)).includes('Race B'), 'the player dismissed revision 1, not the new text');
      await user.b.post('/api/announcements/dismiss', { id: a.id, revision: 2 });
      assert.ok(!(await ids(user.b)).includes('Race B'));
      await user.b.post('/api/announcements/dismiss', { id: a.id, revision: 1 });
      assert.ok(!(await ids(user.b)).includes('Race B'), 'an older dismissal does not reopen it');
    });
    await test('a revision that is not a positive whole number is refused', async () => {
      await clearLive();
      const a = await create({ message: 'Bad revision', audience: 'signed_in', durationHours: 5 });
      for (const revision of [0, -1, 1.5, 'x', 2147483648, 1e30]) assert.equal((await user.b.post('/api/announcements/dismiss', { id: a.id, revision })).status, 400, String(revision));
    });
    await test('guests cannot dismiss on the server (their browser remembers it); unknown ids are harmless', async () => {
      assert.equal((await guest.post('/api/announcements/dismiss', { id: 'p_00000000-0000-4000-8000-000000000009' })).status, 401);
      const r = await user.b.post('/api/announcements/dismiss', { id: 'p_00000000-0000-4000-8000-000000000009' });
      assert.equal(r.json.dismissed, false);
    });
    await test('finished announcements cannot be edited; editing a live one works', async () => {
      const a = await create({ message: 'Editable', durationHours: 5 });
      const e = await admin.b.post('/api/admin/announcements/update', { id: a.id, level: 'warning', durationHours: 10 });
      assert.equal(e.status, 200);
      assert.equal(e.json.announcement.level, 'warning');
      await admin.b.post('/api/admin/announcements/end', { id: a.id });
      assert.equal((await admin.b.post('/api/admin/announcements/update', { id: a.id, message: 'again' })).status, 409);
    });
    await test('invalid forms are refused with 400 and nothing is stored', async () => {
      const before = s.store.anns.length;
      for (const body of [{ message: 'x' }, { message: '', durationHours: 1 }, { message: 'x', durationHours: 24 * 400 }, { message: 'x', endsAt: new Date(clock.t - H).toISOString() }]) {
        assert.equal((await admin.b.post('/api/admin/announcements', body)).status, 400, JSON.stringify(body));
      }
      assert.equal(s.store.anns.length, before);
    });
    await test('a store failure while loading banners is a clean error, not a crash, and recovers', async () => {
      const b = await start({ clock });
      try {
        const g = await b.guest();
        b.store.failWith(new Error('db down'));
        assert.equal((await g.get('/api/announcements')).status, 500);
        assert.equal((await g.get('/api/announcements')).status, 200);
      } finally { await b.close(); }
    });
    await test('without a database the public endpoint answers with an empty list (the ANNOUNCEMENT variable still works separately)', async () => {
      const { createAdminRoutes } = require('../lib/adminRoutes');
      const sent = [];
      const r = createAdminRoutes({ store: null, ctx: { limit: async () => [], requestIp: () => 'x', readSessionToken: () => null, sendJson: (res, c, b) => sent.push([c, b]), readJsonBody: async () => ({}), sessionInfo: async () => null, AuthError: Error } }).routes;
      await r['GET /api/announcements']({ url: '/api/announcements', headers: {} }, {});
      assert.deepEqual(sent[0], [200, { ok: true, announcements: [] }]);
    });
  } finally { await s.close(); }

  console.log('edits and windows');
  const NOW = new Date('2026-11-09T10:00:00Z');
  await test('an edit that sends only the end time never moves the start (nothing is filled in for it)', async () => {
    const edit = ann.parseInput({ endsAt: '2026-11-10T10:00:00Z' }, NOW, { partial: true });
    assert.equal('startsAt' in edit, false);
    assert.equal(edit.endsAt.toISOString(), '2026-11-10T10:00:00.000Z');
  });
  await test('an edit with a duration is applied by the store to the merged start, so the banner is not re-timed to now', async () => {
    assert.deepEqual(Object.keys(ann.parseInput({ durationHours: 2 }, NOW, { partial: true })), ['durationHours']);
  });
  await test('a new banner with one day takes the end from its start, and a duration is refused when it is not a number', async () => {
    const row = ann.parseInput({ message: 'Maintenance', durationHours: 24 }, NOW);
    assert.equal(row.startsAt.toISOString(), NOW.toISOString());
    assert.equal(row.endsAt.getTime() - row.startsAt.getTime(), 24 * H);
    assert.throws(() => ann.parseInput({ message: 'x', durationHours: true }, NOW), ann.AnnouncementError);
    assert.throws(() => ann.parseInput({ message: 'x', startsAt: {}, durationHours: 1 }, NOW), ann.AnnouncementError);
  });
  await test('checkWindow refuses an end that is not after the start, a past end, and a run longer than the limit', () => {
    const s = new Date(NOW.getTime() + H);
    assert.throws(() => ann.checkWindow(s, s, NOW), /after the start/);
    assert.throws(() => ann.checkWindow(new Date(NOW.getTime() - 2 * H), new Date(NOW.getTime() - H), NOW), /already passed/);
    assert.throws(() => ann.checkWindow(s, new Date(s.getTime() + (ann.MAX_DURATION_DAYS + 1) * 24 * H), NOW), /at most/);
    assert.doesNotThrow(() => ann.checkWindow(s, new Date(s.getTime() + H), NOW));
  });

  await test('over HTTP, changing only the end keeps the start (the store merges the stored row first)', async () => {
    const clock2 = { t: T0 };
    const h = await start({ clock: clock2 });
    try {
      const admin = await h.login({ role: 'admin' });
      const created = await admin.b.post('/api/admin/announcements', { message: 'Window', startsAt: new Date(T0 + H).toISOString(), durationHours: 2 });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      const { id, starts_at: startsBefore } = created.json.announcement;
      const r = await admin.b.post('/api/admin/announcements/update', { id, endsAt: new Date(T0 + 5 * H).toISOString() });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(new Date(r.json.announcement.starts_at).getTime(), new Date(startsBefore).getTime(), 'the start is unchanged');
      assert.equal(new Date(r.json.announcement.ends_at).getTime(), T0 + 5 * H);
    } finally { await h.close(); }
  });

  console.log(`\n${passed} announcement tests passed`);
})();
