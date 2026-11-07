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
  const c = { room: null, errors: [], voice: [], rtc: [], ice: null, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.ice = m.ice; }
    if (m.t === 'state') c.room = m.room;
    if (m.t === 'error') c.errors.push(m.message);
    if (m.t === 'voice') c.voice = m.ids;
    if (m.t === 'rtc') c.rtc.push(m);
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

    console.log(`\n${passed} voice server tests passed`);
  } finally {
    clearTimeout(guard);
    for (const c of all) try { c.ws.terminate(); } catch { /* closed */ }
    await srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
