'use strict';
// VOICE_ENABLED: table voice is off unless the value is exactly "true". While off, the welcome says so, no ICE list
// (and so no TURN login) is handed out, and voice and setup messages are refused. Checked on the real server.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify, sessionSocket } = require('./helpers/auth');
const V = require('../lib/voiceRelay');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL voice flag test timed out'); process.exit(1); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 6000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}
let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed++; console.log('  ok  ' + name); }, (e) => { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; });
}

function client(port, token) {
  const c = { id: null, welcome: null, room: null, errors: [], voice: null, rtc: 0, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.welcome = m; }
    if (m.t === 'state') c.room = m.room;
    if (m.t === 'error') c.errors.push(m.message);
    if (m.t === 'voice') c.voice = m.ids;
    if (m.t === 'rtc') c.rtc++;
  });
  return c;
}

async function run(label, env, body) {
  const srv = await start({ port: 0, trustProxy: false, env, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: { log() {}, warn() {}, error() {} } });
  const all = [];
  try {
    const mk = async (name) => {
      const u = await registerAndVerify(srv.port, { email: `${label}-${name.toLowerCase()}@test.local`, displayName: name, password: 'TestPass123!' });
      const c = client(srv.port, u.token); all.push(c);
      await until(() => c.id, name + ' welcome');
      return c;
    };
    const host = await mk('Hosty');
    await body(host, mk);
  } finally {
    for (const c of all) try { c.ws.terminate(); } catch { /* closed */ }
    await srv.close();
  }
}

(async () => {
  await test('VOICE_ENABLED is on only for the exact value "true"', () => {
    assert.equal(V.voiceEnabled({}), false, 'unset is off');
    for (const v of ['', 'false', '1', 'yes', 'TRUE', ' true']) assert.equal(V.voiceEnabled({ VOICE_ENABLED: v }), false, `"${v}" is off`);
    assert.equal(V.voiceEnabled({ VOICE_ENABLED: 'true' }), true, '"true" is on');
  });

  // Build the env without VOICE_ENABLED so the default (off) is what gets tested, whatever the developer's shell has.
  const { VOICE_ENABLED: _ignored, ...baseEnv } = process.env;
  void _ignored;

  await run('off', baseEnv, async (host) => {
    await test('with the flag unset, the welcome says voice is off and hands out no ICE servers', async () => {
      assert.equal(host.welcome.voiceEnabled, false);
      assert.deepEqual(host.welcome.ice, []);
      assert.equal(host.welcome.turnStatus, 'off');
      assert.equal(host.welcome.iceExpiresAt, null);
    });

    await test('with the flag off, joining voice is refused and nobody is listed in voice', async () => {
      host.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      await until(() => host.room, 'table created');
      host.send({ t: 'voice', on: true, muted: false });
      await until(() => host.errors.length, 'voice refusal');
      assert.match(host.errors.at(-1), /not available/);
      assert.ok(!host.voice || !host.voice.some((v) => v.id === host.id), 'not listed in voice');
    });

    await test('with the flag off, setup messages are refused', async () => {
      host.send({ t: 'rtc', to: 'someone', data: { kind: 'offer', sdp: 'v=0' } });
      await until(() => host.errors.length >= 2, 'rtc refusal');
      assert.match(host.errors.at(-1), /not available/);
      assert.equal(host.rtc, 0);
    });
  });

  await run('on', { ...baseEnv, VOICE_ENABLED: 'true' }, async (host) => {
    await test('with VOICE_ENABLED=true, the welcome says voice is on and carries ICE servers', async () => {
      assert.equal(host.welcome.voiceEnabled, true);
      assert.ok(Array.isArray(host.welcome.ice) && host.welcome.ice.length >= 1, 'ICE servers present');
    });

    await test('with the flag on, a seated player can join voice', async () => {
      host.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      await until(() => host.room, 'table created');
      host.send({ t: 'voice', on: true, muted: false });
      await until(() => host.voice && host.voice.some((v) => v.id === host.id), 'listed in voice');
    });
  });

  console.log(`\n${passed} voice flag tests passed`);
  clearTimeout(guard);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
