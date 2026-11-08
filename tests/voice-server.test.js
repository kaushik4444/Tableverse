'use strict';
// Table voice on the real server (in-memory mode, no database): who is in voice, setup messages reach only the person
// they are for, leaving or dropping ends voice, spectators cannot talk, and the browsers are told which ICE servers to use.
require('./helpers/env');
const { sessionSocket } = require('./helpers/auth');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL voice server test timed out'); process.exit(1); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 6000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function client(port, token) {
  const c = { room: null, errors: [], voice: [], rtc: [], ice: null, iceReplies: [], blockLists: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.ice = m.ice; }
    if (m.t === 'state') c.room = m.room;
    if (m.t === 'error') c.errors.push(m.message);
    if (m.t === 'voice') c.voice = m.ids;
    if (m.t === 'rtc') c.rtc.push(m);
    if (m.t === 'ice') c.iceReplies.push(m);
    if (m.t === 'blocks') c.blockLists.push(m.blocks);
    if (m.t === 'left') c.room = null;
  });
  c.inVoice = () => c.voice.map((v) => v.id).sort();
  return c;
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: { log() {}, warn() {}, error() {} } });
  const all = [];
  const mk = async (name) => {
    const u = await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@test.local`, displayName: name, password: 'TestPass123!' });
    const c = client(srv.port, u.token); all.push(c);
    await until(() => c.id, name + ' welcome');
    return c;
  };
  try {
    const host = await mk('Hosty'); const ann = await mk('Ann'); const bea = await mk('Bea'); const spec = await mk('Spec');
    host.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    await until(() => host.room && host.room.members.some((m) => m.id === host.id), 'table created');
    const code = host.room.code;
    for (const [c, s] of [[ann, false], [bea, false], [spec, true]]) { c.send({ t: 'join', code, spectate: s }); await until(() => c.room && c.room.code === code, 'joined'); }

    await test('the browser is told which ICE servers to use', async () => {
      assert.ok(Array.isArray(host.ice) && host.ice.length >= 1 && host.ice[0].urls, 'welcome carries ice servers');
    });

    await test('a browser can ask again for ICE servers, and an immediate second ask is ignored', async () => {
      const before = ann.iceReplies.length;
      ann.send({ t: 'ice' });
      await until(() => ann.iceReplies.length > before, 'ice reply');
      assert.deepEqual(ann.iceReplies[before].ice, ann.ice, 'the same list as the welcome (no expiry in this test setup)');
      assert.equal(ann.iceReplies[before].iceExpiresAt, null);
      ann.send({ t: 'ice' });
      await sleep(150);
      assert.equal(ann.iceReplies.length, before + 1, 'a second request straight away gets no answer');
    });

    await test('without a database there are no blocks to list, and the list request is answered', async () => {
      ann.send({ t: 'blocks' });
      await until(() => ann.blockLists.length > 0, 'blocks reply');
      assert.deepEqual(ann.blockLists[0], []);
    });

    await test('joining voice tells everyone at the table, spectators included', async () => {
      host.send({ t: 'voice', on: true });
      ann.send({ t: 'voice', on: true, muted: true });
      await until(() => spec.inVoice().length === 2, 'spectator sees the list');
      assert.deepEqual(spec.inVoice(), [ann.id, host.id].sort());
      assert.equal(spec.voice.find((v) => v.id === ann.id).muted, true);
      assert.equal(spec.voice.find((v) => v.id === host.id).muted, false);
    });

    await test('a spectator cannot talk', async () => {
      spec.send({ t: 'voice', on: true });
      await until(() => spec.errors.some((e) => /seat/i.test(e)), 'refused');
      assert.equal(spec.inVoice().includes(spec.id), false);
    });

    await test('setup messages reach only the person they are for, with the sender filled in by the server', async () => {
      host.send({ t: 'rtc', to: ann.id, data: { kind: 'offer', sdp: 'v=0 test' } });
      await until(() => ann.rtc.length === 1, 'ann got the offer');
      assert.deepEqual(ann.rtc[0], { t: 'rtc', from: host.id, data: { kind: 'offer', sdp: 'v=0 test' } });
      host.send({ t: 'rtc', to: ann.id, data: { kind: 'offer', sdp: 'x', from: bea.id } });
      await sleep(80);
      assert.equal(bea.rtc.length, 0, 'bea saw nothing');
      assert.equal(spec.rtc.length, 0, 'the spectator saw nothing');
    });

    await test('nobody can send setup messages to someone who is not in voice', async () => {
      host.send({ t: 'rtc', to: bea.id, data: { kind: 'offer', sdp: 'v=0' } });
      await until(() => host.errors.some((e) => /Not in voice/.test(e)), 'refused');
      assert.equal(bea.rtc.length, 0);
    });

    await test('leaving voice, leaving the table and dropping the connection all end voice', async () => {
      bea.send({ t: 'voice', on: true });
      await until(() => host.inVoice().includes(bea.id), 'bea in');
      bea.send({ t: 'voice', on: false });
      await until(() => !host.inVoice().includes(bea.id), 'bea out');
      ann.send({ t: 'leave' });
      await until(() => !host.inVoice().includes(ann.id), 'ann out after leaving the table');
      host.send({ t: 'voice', on: true });
      bea.send({ t: 'join', code, spectate: false }); await until(() => bea.room && bea.room.code === code, 'bea back');
      bea.send({ t: 'voice', on: true });
      await until(() => host.inVoice().includes(bea.id), 'bea in again');
      bea.ws.terminate();
      await until(() => !host.inVoice().includes(bea.id), 'bea out after the connection dropped');
    });

    await test('a burst of setup messages is not treated as flooding', async () => {
      const dee = await mk('Dee');
      dee.send({ t: 'join', code, spectate: false }); await until(() => dee.room && dee.room.code === code, 'dee joined');
      dee.send({ t: 'voice', on: true }); await until(() => host.inVoice().includes(dee.id), 'dee in');
      for (let i = 0; i < 60; i++) host.send({ t: 'rtc', to: dee.id, data: { kind: 'ice', candidate: { candidate: 'candidate:' + i, sdpMid: '0', sdpMLineIndex: 0 } } });
      await until(() => dee.rtc.length === 60, 'all 60 arrived');
      assert.equal(host.ws.readyState, WebSocket.OPEN, 'the sender is still connected');
    });

    await test('kicking a player frees their voice slot at once, tells the table, and stops their signalling both ways', async () => {
      const eveUser = await registerAndVerify(srv.port, { email: 'eve.kick@test.local', displayName: 'Eve', password: 'TestPass123!' });
      const eve = client(srv.port, eveUser.token); all.push(eve);
      await until(() => eve.id, 'eve welcome');
      eve.send({ t: 'join', code, spectate: false }); await until(() => eve.room && eve.room.code === code, 'eve joined');
      eve.send({ t: 'voice', on: true }); await until(() => host.inVoice().includes(eve.id), 'eve in voice');

      host.send({ t: 'kick', id: eve.id });
      await until(() => eve.room === null, 'eve removed from the table');
      await until(() => !host.inVoice().includes(eve.id) && !ann.inVoice().includes(eve.id) && !spec.inVoice().includes(eve.id), 'the table is told eve left voice');

      const hostErrors = host.errors.length;
      host.send({ t: 'rtc', to: eve.id, data: { kind: 'offer', sdp: 'v=0 after kick' } });
      await until(() => host.errors.length > hostErrors && /Not in voice/.test(host.errors[host.errors.length - 1]), 'host signal refused');
      // a kicked player has no table any more, so their setup message is dropped before it can be relayed
      eve.send({ t: 'rtc', to: host.id, data: { kind: 'answer', sdp: 'v=0 kicked' } });
      await sleep(80);
      assert.equal(host.rtc.some((m) => m.from === eve.id), false, 'the kicked player cannot signal the host');
      assert.equal(eve.rtc.length, 0, 'the kicked player receives no signalling');

      // reconnecting with the same session does not put them back in voice
      const eveAgain = client(srv.port, eveUser.token); all.push(eveAgain);
      await until(() => eveAgain.id, 'eve reconnected');
      assert.equal(eveAgain.room, null, 'reconnecting does not put them back at the table');
      eveAgain.send({ t: 'voice', on: true });
      await sleep(80);
      assert.equal(host.inVoice().includes(eve.id), false, 'still out of voice after reconnecting');
      assert.equal(eveAgain.inVoice().includes(eveAgain.id), false, 'the reconnected player is not in the voice list');
      host.send({ t: 'rtc', to: eveAgain.id, data: { kind: 'offer', sdp: 'v=0 reconnect' } });
      await sleep(80);
      assert.equal(eveAgain.rtc.length, 0, 'a reconnected, kicked player receives no signalling');
    });

    console.log(`\n${passed} voice server tests passed`);
  } finally {
    clearTimeout(guard);
    for (const c of all) try { c.ws.terminate(); } catch { /* closed */ }
    await srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
