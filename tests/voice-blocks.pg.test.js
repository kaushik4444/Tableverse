'use strict';
require('./helpers/env');
// Blocks and table voice on a REAL PostgreSQL, through the running server over WebSockets (throw-away database from
// tests/helpers/testdb.js). A block in either direction keeps the pair out of each other's voice list; a signal between
// them is refused as "not in voice"; unblocking offers voice again; a third person is unaffected. Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 30000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(25); }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';

function socket(port, cookie) {
  const c = { msgs: [], room: null, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } }) };
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'hello' })));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'state') c.room = m.room;
  });
  c.ws.on('error', () => {});
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.lastVoice = () => { const v = c.msgs.filter((m) => m.t === 'voice').pop(); return v ? v.ids.map((x) => x.id).sort() : null; };
  c.errors = () => c.msgs.filter((m) => m.t === 'error').map((m) => m.message);
  c.rtcFrom = (id) => c.msgs.filter((m) => m.t === 'rtc' && m.from === id).length;
  c.notices = () => c.msgs.filter((m) => m.t === 'notice').map((m) => m.text);
  return c;
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  let srv = null;
  const sockets = [];
  try {
    process.env.DATABASE_URL = t.url;
    const { start } = require('../server');
    srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet() });
    let seq = 1;
    const newUser = async (tag) => {
      const n = seq++;
      const u = await registerAndVerify(srv.port, { email: `${tag.toLowerCase()}.vb.${n}@test.local`, username: `${tag.toLowerCase()}vb${n}`.slice(0, 24), displayName: tag, password: PW });
      const me = (await u.browser.get('/api/auth/session')).json.player;
      const s = socket(srv.port, u.browser.cookieHeader);
      sockets.push(s);
      await until(() => s.msgs.some((m) => m.t === 'welcome'), tag + ' welcome');
      return { id: me.id, s, cookie: u.browser.cookieHeader };
    };
    const A = await newUser('Ava'); const B = await newUser('Ben'); const C = await newUser('Cy');

    A.s.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    const code = await until(() => A.s.room && A.s.room.code, 'table');
    for (const u of [B, C]) { u.s.send({ t: 'join', code, spectate: false }); await until(() => u.s.room && u.s.room.code === code, 'joined'); }
    for (const u of [A, B, C]) { u.s.send({ t: 'voice', on: true }); }
    await until(() => A.s.lastVoice() && A.s.lastVoice().length === 3 && B.s.lastVoice() && B.s.lastVoice().length === 3, 'everyone in voice');
    A.s.send({ t: 'start' });
    await until(() => A.s.room && A.s.room.status === 'playing', 'the game is running');

    await test('before any block, everyone at the table is in voice for everyone', async () => {
      assert.deepEqual(A.s.lastVoice(), [A.id, B.id, C.id].sort());
      assert.deepEqual(B.s.lastVoice(), [A.id, B.id, C.id].sort());
    });

    await sleep(1200); // block cooldown
    A.s.send({ t: 'block', id: B.id });
    await until(() => A.s.notices().some((x) => /hidden from your table chat and table voice/.test(x)), 'block accepted');

    await test('after A blocks B, neither of them is offered the other in voice', async () => {
      await until(() => A.s.lastVoice() && !A.s.lastVoice().includes(B.id), 'A stops seeing B');
      await until(() => B.s.lastVoice() && !B.s.lastVoice().includes(A.id), 'B stops seeing A');
      assert.ok(A.s.lastVoice().includes(C.id), 'A still hears C');
      assert.ok(B.s.lastVoice().includes(C.id), 'B still hears C');
      assert.ok(C.s.lastVoice().includes(A.id) && C.s.lastVoice().includes(B.id), 'C is unaffected by the pair');
    });

    await test('a signal between a blocked pair is refused with the generic "not in voice" answer', async () => {
      const before = B.s.rtcFrom(A.id);
      A.s.send({ t: 'rtc', to: B.id, data: { kind: 'offer', sdp: 'v=0' } });
      await until(() => A.s.errors().includes('Not in voice'), 'refusal');
      await sleep(150);
      assert.equal(B.s.rtcFrom(A.id), before, 'B receives nothing from A');
    });

    // Reactions are only accepted after the game starts.

    await test('a reaction from B does not reach A; C still sees it', async () => {
      const toA = A.s.msgs.filter((m) => m.t === 'emote').length;
      const toC = C.s.msgs.filter((m) => m.t === 'emote').length;
      B.s.send({ t: 'emote', e: '👏' });
      await until(() => C.s.msgs.filter((m) => m.t === 'emote').length > toC, 'C sees the reaction');
      await sleep(150);
      assert.equal(A.s.msgs.filter((m) => m.t === 'emote').length, toA, 'A sees nothing from B');
    });

    await test('a signal from C still reaches A and B (only the blocked pair is cut)', async () => {
      const before = A.s.rtcFrom(C.id);
      C.s.send({ t: 'rtc', to: A.id, data: { kind: 'offer', sdp: 'v=0' } });
      await until(() => A.s.rtcFrom(C.id) > before, 'C reaches A');
    });

    await sleep(1200);
    A.s.send({ t: 'unblock', id: B.id });
    await until(() => A.s.lastVoice() && A.s.lastVoice().includes(B.id), 'voice offered again after unblock');

    await test('unblocking offers the pair voice again', async () => {
      await until(() => B.s.lastVoice() && B.s.lastVoice().includes(A.id), 'B sees A again');
      assert.ok(A.s.lastVoice().includes(B.id));
    });

    const D = await newUser('Dee'); const E = await newUser('Eli');
    D.s.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    const secondCode = await until(() => D.s.room && D.s.room.code, 'second table');
    E.s.send({ t: 'join', code: secondCode, spectate: false });
    await until(() => D.s.room && D.s.room.members.some((m) => m.id === E.id), 'E joins second table');

    await sleep(1200);
    D.s.send({ t: 'block', id: E.id });
    await until(() => D.s.room && !D.s.room.members.some((m) => m.id === E.id), 'blocked lobby member is removed');
    await test('blocking someone in a lobby removes them and prevents rejoining the same table', async () => {
      const before = E.s.errors().length;
      E.s.send({ t: 'join', code: secondCode, spectate: false });
      await until(() => E.s.errors().length > before, 'blocked lobby rejoin refused');
      assert.ok(!D.s.room.members.some((m) => m.id === E.id));
    });

    await sleep(1200);
    D.s.send({ t: 'unblock', id: E.id });
    await until(() => D.s.notices().includes('Unblocked.'), 'unblock completed');
    E.s.send({ t: 'join', code: secondCode, spectate: false });
    await until(() => D.s.room && D.s.room.members.some((m) => m.id === E.id), 'E rejoins after unblock');

    D.s.send({ t: 'start' });
    await until(() => D.s.room && D.s.room.status === 'playing', 'second game starts');
    await sleep(1200);
    D.s.send({ t: 'block', id: E.id });
    await until(() => E.s.notices().some((x) => /finish this game/.test(x)), 'active-game block notice');
    await test('a blocked seated player can finish the running game but cannot rejoin after leaving', async () => {
      assert.ok(D.s.room.members.some((m) => m.id === E.id), 'the current game keeps the blocked player seated');
      E.s.ws.close();
      await until(() => E.s.ws.readyState === WebSocket.CLOSED, 'old blocked socket closes');
      const E2 = socket(srv.port, E.cookie);
      sockets.push(E2);
      await until(() => E2.msgs.some((m) => m.t === 'welcome'), 'blocked player reconnects');
      await until(() => D.s.room.members.some((m) => m.id === E.id && m.bot), 'bot takes over the blocked seat on reconnect');
      await until(() => E2.notices().some((x) => /no longer share that table/.test(x)), 'blocked reconnect notice');
      const before = E2.errors().length;
      E2.send({ t: 'join', code: secondCode, spectate: false });
      await until(() => E2.errors().length > before, 'blocked rejoin refused');
      assert.ok(D.s.room.members.some((m) => m.id === E.id && m.bot), 'the blocked player cannot take the seat back');
    });
  } finally {
    for (const s of sockets) { try { s.ws.close(); } catch { /* closed */ } }
    if (srv) await srv.close();
    await t.drop();
  }
  console.log(`\n${passed} voice-block PostgreSQL tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
