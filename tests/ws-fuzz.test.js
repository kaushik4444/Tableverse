'use strict';
// Network fuzzing: every message type the server understands is sent with random, malformed and hostile payloads while a
// real game runs. The server must stay up, must not log an internal "handler error" (a bug that only a client could trigger),
// and must still serve a normal table afterwards.
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL ws-fuzz test timed out'); process.exit(1); }, 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(10); }
}
// message types come from the handler table in server.js, so a new handler is fuzzed automatically
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const body = src.slice(src.indexOf('const handlers = {'));
const TYPES = [...new Set([...body.matchAll(/^    (?:async )?([a-zA-Z]+)\(p(?:, msg)?\) \{/gm)].map((m) => m[1]))];
assert.ok(TYPES.length >= 15, 'found the handler names (' + TYPES.length + ')');

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WEIRD = [null, undefined, true, false, 0, -1, 1e308, NaN, '', 'x', 'A'.repeat(500), '__proto__', 'constructor', [], [1, 2], {}, { a: { b: {} } }, { type: 'play' }, { type: 'roll' }, { type: 'ready' }, { type: 'bid', amount: -1 },
  { type: 'ask', rank: 'A', target: 'nobody' }, { __proto__: { polluted: 1 } }, 'ABCDEF', 'public', 'private', 'wizard', 'gofish', ['<script>'], { toString: 1 }, 7, 'me'];
const KEYS = ['gameId', 'code', 'visibility', 'seats', 'text', 'action', 'options', 'key', 'value', 'id', 'name', 'avatar', 'to', 'target', 'emote', 'friendId', 'playerId', 'bot', 'on', 'type', 'seat', 'token'];

(async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, maxQueuedMessages: 100000 });
  try {
    const mk = async (name) => {
      const u = await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@test.local`, displayName: name, password: 'TestPass123!' });
      const c = { room: null, ws: new WebSocket(`ws://127.0.0.1:${srv.port}/ws`), closed: false };
      c.send = (m) => { if (c.ws.readyState === 1) c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
      c.ws.on('open', () => c.send({ t: 'hello', token: u.token }));
      c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'welcome') c.id = m.id; if (m.t === 'state') c.room = m.room; if (m.t === 'left') c.room = null; });
      c.ws.on('close', () => { c.closed = true; });
      await until(() => c.id, name + ' welcome');
      return c;
    };
    const host = await mk('Host'); const guest = await mk('Guest'); const fuzzer = await mk('Fuzzer');
    host.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    await until(() => host.room, 'table');
    guest.send({ t: 'join', code: host.room.code });
    fuzzer.send({ t: 'join', code: host.room.code });
    await until(() => fuzzer.room, 'fuzzer seated');
    host.send({ t: 'start' });
    await until(() => host.room.status === 'playing' || host.room.status === 'finished', 'running');

    let sent = 0;
    for (let i = 0; i < 4000 && !fuzzer.closed; i++) {
      const t = rnd() < 0.9 ? pick(TYPES) : pick([...WEIRD, ...TYPES]);
      const m = { t };
      const n = Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) m[pick(KEYS)] = pick(WEIRD);
      // never let the fuzzer destroy the table the others are using: skip messages that target host powers on someone else's behalf
      if (['leave', 'logout', 'deleteAccount'].includes(t) && rnd() < 0.7) continue;
      fuzzer.send(rnd() < 0.03 ? '{"t":' + JSON.stringify(t) + ',' : m); // 3% truncated JSON
      sent++;
      if (i % 200 === 0) await sleep(5);
    }
    await sleep(300);
    const internal = errors.filter((e) => /handler error|uncaught|unhandled|TypeError|ReferenceError|Cannot read/.test(e));
    assert.deepEqual(internal.slice(0, 3), [], `${sent} hostile messages produced internal errors`);
    assert.equal(Object.prototype.polluted, undefined, 'the prototype was not polluted');
    // the server still serves a normal table
    const other = await mk('Normal');
    other.send({ t: 'create', gameId: 'gofish', visibility: 'public' });
    await until(() => other.room, 'normal table after the fuzz');
    assert.ok(!host.closed && !guest.closed, 'other players kept their connections');
    console.log(`  ok  ${sent} hostile messages over ${TYPES.length} message types: no internal error, no crash, others unaffected`);
  } catch (e) { console.error = origError; console.error('FAIL', e.stack); process.exitCode = 1; }
  console.error = origError;
  await srv.close();
  clearTimeout(guard);
  process.exit(process.exitCode || 0);
})();
