'use strict';
// Growth counters (invite_joined, share_clicked, guest_created) end to end in memory mode, with a fake analytics store so
// what would be written to the database can be read. invite_created and guest_upgraded need PostgreSQL and are checked in
// tests/friends.pg.test.js and tests/guest-play.pg.test.js. What is and is not recorded (privacy) is in tests/analytics.test.js.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { Browser, sessionSocket } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL growth analytics test timed out'); process.exit(1); }, 90000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

const memStore = () => { const s = { counters: [], active: [], addCounters: async (rows) => { s.counters.push(...rows); }, addActive: async (rows) => { s.active.push(...rows); } }; return s; };
/** The total counted for a metric (all days), or for one dimension of it. */
const count = (store, metric, dim) => store.counters.filter((r) => r.metric === metric && (dim === undefined || r.dim === dim)).reduce((a, r) => a + r.count, 0);

function open(port, token) {
  return new Promise((resolve) => {
    const o = { msgs: [], ws: null };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token));
    o.ws = ws;
    ws.on('message', (d) => o.msgs.push(JSON.parse(d)));
    ws.on('error', () => {});
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello' })));
    setTimeout(() => resolve(o), 300);
  });
}
const say = (o, m) => o.ws.send(JSON.stringify(m));
const roomCode = (o) => { const s = [...o.msgs].reverse().find((m) => m.t === 'state' && m.room); return s && s.room.code; };
async function guestSocket(port, name) {
  const b = new Browser(port);
  await b.csrf();
  const r = await b.must('/api/auth/guest', { displayName: name });
  assert.equal(r.status, 201);
  return open(port, decodeURIComponent(b.cookies.get('ct_session')));
}

(async () => {
  const off = memStore();
  const closed = await start({ port: 0, analyticsStore: off, analyticsFlushMs: 50, env: { ...process.env, GUEST_PLAY_ENABLED: 'false' } });
  try {
    await test('a refused guest session (guest play off) is not counted', async () => {
      const b = new Browser(closed.port);
      await b.csrf();
      assert.equal((await b.post('/api/auth/guest', { displayName: 'Ann' })).status, 403);
      await wait(250);
      assert.equal(count(off, 'guest_created'), 0);
    });
  } finally { await closed.close(); }

  const store = memStore();
  const srv = await start({ port: 0, analyticsStore: store, analyticsFlushMs: 50, env: { ...process.env, GUEST_PLAY_ENABLED: 'true' } });
  const port = srv.port;
  let host = null;
  try {
    await test('guest_created: one count for each guest session made, and none for a request without the CSRF token', async () => {
      const b = new Browser(port);
      await b.csrf();
      assert.equal((await b.post('/api/auth/guest', { displayName: 'NoToken' }, { csrf: false })).status, 403);
      await wait(250);
      assert.equal(count(store, 'guest_created'), 0, 'a refused request is not counted');
      await b.must('/api/auth/guest', { displayName: 'One' });
      await b.must('/api/auth/guest', { displayName: 'Two' });
      await wait(250);
      assert.equal(count(store, 'guest_created'), 2);
    });

    host = await guestSocket(port, 'Hosty');
    say(host, { t: 'create', gameId: 'ludo' });
    await wait(300);
    const code = roomCode(host);
    assert.ok(code, 'the host has a table');

    await test('invite_joined: a join that says it came by a table link counts once, by "link"', async () => {
      const b = await guestSocket(port, 'Linky');
      say(b, { t: 'join', code, via: 'link' });
      await wait(300);
      assert.equal(roomCode(b), code, 'the guest is at the table');
      say(b, { t: 'join', code, via: 'link' }); // the same person again (a second tab, a repeated message): already here
      await wait(300);
      assert.equal(count(store, 'invite_joined', 'link'), 1, 'joining again is not another arrival');
      b.ws.close();
    });

    await test('invite_joined: spectating through a link counts, a plain join and an unknown "via" do not', async () => {
      const before = count(store, 'invite_joined');
      const watcher = await guestSocket(port, 'Watchy');
      say(watcher, { t: 'join', code, spectate: true, via: 'friend' });
      const plain = await guestSocket(port, 'Plain');
      say(plain, { t: 'join', code });
      const odd = await guestSocket(port, 'Odd');
      say(odd, { t: 'join', code, via: 'a<script>b' });
      await wait(400);
      assert.equal(count(store, 'invite_joined') - before, 1, 'only the watcher, by "friend"');
      assert.equal(count(store, 'invite_joined', 'friend'), 1);
      assert.equal(store.counters.filter((r) => r.metric === 'invite_joined').every((r) => ['link', 'friend'].includes(r.dim)), true, 'nothing the page typed is stored');
      for (const o of [watcher, plain, odd]) o.ws.close();
    });

    await test('invite_joined: a join to a table that does not exist is not counted', async () => {
      const before = count(store, 'invite_joined');
      const b = await guestSocket(port, 'Lost');
      say(b, { t: 'join', code: 'ZZZZZZ', via: 'link' });
      await wait(300);
      assert.equal(count(store, 'invite_joined'), before);
      b.ws.close();
    });

    await test('share_clicked: counted by channel, a double tap counts once, a bad channel or no table counts nothing', async () => {
      say(host, { t: 'share', channel: 'whatsapp' });
      say(host, { t: 'share', channel: 'whatsapp' }); // a double tap, straight away
      say(host, { t: 'share', channel: 'bogus' });
      say(host, { t: 'share', channel: '<b>x</b>' });
      await wait(1100);
      say(host, { t: 'share', channel: 'copy' });
      const lone = await guestSocket(port, 'Lone'); // not at a table
      say(lone, { t: 'share', channel: 'copy' });
      await wait(400);
      assert.equal(count(store, 'share_clicked', 'whatsapp'), 1);
      assert.equal(count(store, 'share_clicked', 'copy'), 1, 'only the host, who is at a table');
      assert.equal(count(store, 'share_clicked'), 2);
      lone.ws.close();
    });

    await test('the counters hold a day, a metric, a dimension and a count only (no table code, name or address)', async () => {
      for (const r of store.counters) assert.deepEqual(Object.keys(r).sort(), ['count', 'day', 'dim', 'metric']);
      const text = JSON.stringify(store.counters);
      assert.ok(!text.includes(code), 'the table code is not stored');
      assert.ok(!/Hosty|Linky|Watchy|127\.0\.0\.1/.test(text));
    });
  } finally { if (host) host.ws.close(); await srv.close(); }

  clearTimeout(guard);
  console.log(`\n${passed} passed`);
  process.exit(process.exitCode || 0);
})();
