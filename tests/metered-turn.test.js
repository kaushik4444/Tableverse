'use strict';
// Metered TURN credentials: request shape, the secret never leaking, the 2-minute propagation wait, refresh before expiry,
// retry after failure, and what the browser is offered. No network: fetch is replaced.
require('./helpers/env');
const assert = require('node:assert/strict');
const { createMeteredTurn, fromEnv, PROPAGATION_MS, REFRESH_LEAD_MS, EXPIRY_MARGIN_MS } = require('../lib/meteredTurn');
const voiceRelay = require('../lib/voiceRelay');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const SECRET = 'sk_test_0123456789abcdefSECRET';
/** A fake clock and a fake Metered endpoint. `answers` is a queue of { status, body } or Error. */
function harness({ answers = [], ttl = 3600 } = {}) {
  let t = 1_000_000;
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const a = answers.length ? answers.shift() : { status: 200, body: { username: 'u' + calls.length, password: 'p' + calls.length, expiryInSeconds: ttl } };
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  };
  const log = { warn: (m) => logs.push(String(m)) };
  const m = createMeteredTurn({ appName: 'tableverse', secretKey: SECRET, ttlSeconds: ttl, fetchImpl, now: () => t, log, timeoutMs: 1000 });
  return { m, calls, logs, advance: (ms) => { t += ms; }, now: () => t };
}
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
  console.log('metered turn credentials');

  await test('the request goes to the official endpoint with the secret as a query parameter and a short expiry in the body', async () => {
    const h = harness({ ttl: 900 });
    h.m.start(); await flush();
    assert.equal(h.calls.length, 1);
    const u = new URL(h.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://tableverse.metered.live/api/v1/turn/credential');
    assert.equal(u.searchParams.get('secretKey'), SECRET);
    assert.equal(h.calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(h.calls[0].init.body), { expiryInSeconds: 900, label: 'tableverse-voice' });
    h.m.stop();
  });

  await test('the secret never appears in logs, errors or what the browser is offered', async () => {
    const h = harness({ answers: [new Error('connect failed for ' + SECRET), { status: 401, body: {} }] });
    h.m.start(); await flush();
    h.advance(31_000); h.m.refresh(); await flush();
    assert.equal(h.logs.length, 2, 'both failures are logged');
    assert.ok(h.logs.every((l) => !l.includes(SECRET)), 'no log line carries the secret');
    assert.ok(!JSON.stringify(h.m.stats()).includes(SECRET));
    h.m.stop();
  });

  await test('nothing is handed out while the new credential is still propagating (2 minutes)', async () => {
    const h = harness();
    h.m.start(); await flush();
    assert.equal(h.m.snapshot(), null, 'not yet ready');
    h.advance(PROPAGATION_MS - 1000);
    assert.equal(h.m.snapshot(), null, 'still propagating');
    h.advance(1000);
    const c = h.m.snapshot();
    assert.ok(c && c.username === 'u1' && c.password === 'p1', 'ready once propagated');
    h.m.stop();
  });

  await test('a replacement is fetched before expiry and used only after its own propagation time', async () => {
    const h = harness({ ttl: 3600 });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot().username, 'u1');
    h.advance(3600 * 1000 - PROPAGATION_MS - REFRESH_LEAD_MS); // inside the refresh lead
    assert.equal(h.m.snapshot().username, 'u1', 'the old one still serves');
    await flush();
    assert.equal(h.calls.length, 2, 'a new credential was requested in time');
    h.advance(PROPAGATION_MS / 2);
    assert.equal(h.m.snapshot().username, 'u1', 'the new one is not used before it propagates');
    h.advance(PROPAGATION_MS / 2);
    assert.equal(h.m.snapshot().username, 'u2', 'then it takes over');
    h.m.stop();
  });

  await test('a credential is never handed out in its last minute', async () => {
    const h = harness({ ttl: 300 });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    assert.ok(h.m.snapshot());
    h.advance(300 * 1000 - EXPIRY_MARGIN_MS);
    assert.equal(h.m.snapshot(), null);
    h.m.stop();
  });

  await test('a failed request is retried after a delay, not in a tight loop', async () => {
    const h = harness({ answers: [{ status: 500, body: {} }, { status: 200, body: { username: 'ok', password: 'ok', expiryInSeconds: 3600 } }] });
    h.m.start(); await flush();
    assert.equal(h.calls.length, 1);
    h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 1, 'no retry right away');
    h.advance(31_000);
    h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 2, 'retried after the delay');
    assert.equal(h.m.stats().failed, 1);
    h.m.stop();
  });

  await test('a malformed answer is rejected, not used', async () => {
    const h = harness({ answers: [{ status: 200, body: { nope: true } }] });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot(), null);
    assert.equal(h.m.stats().failed, 1);
    h.m.stop();
  });

  await test('the app name must be a plain name (it becomes a host name)', () => {
    assert.throws(() => createMeteredTurn({ appName: 'evil.com/#', secretKey: 'x' }));
    assert.throws(() => createMeteredTurn({ appName: 'ok', secretKey: '   ' }));
  });

  await test('without Metered settings the client is off', () => {
    assert.equal(fromEnv({}), null);
    assert.equal(fromEnv({ METERED_APP_NAME: 'a', METERED_SECRET_KEY: 'b' }), null, 'TURN_URL is also needed');
    assert.ok(fromEnv({ METERED_APP_NAME: 'a', METERED_SECRET_KEY: 'b', TURN_URL: 'turn:x:3478' }));
  });

  await test('the static pair is the fallback until a Metered login is ready, and is not sent once it is', async () => {
    const h = harness();
    const env = { TURN_URL: 'turn:global.relay.metered.ca:80', TURN_USERNAME: 'static', TURN_CREDENTIAL: 'static-pass' };
    h.m.start(); await flush();
    const early = voiceRelay.iceServers(env, { playerId: 'p1', metered: h.m });
    assert.ok(early.some((s) => s.username === 'static'), 'fallback while propagating: voice keeps working');
    assert.ok(!early.some((s) => s.username === 'u1'), 'no Metered login before it is ready');
    h.advance(PROPAGATION_MS);
    const ready = voiceRelay.iceServers(env, { playerId: 'p1', metered: h.m });
    const turn = ready.filter((s) => s.urls === env.TURN_URL);
    assert.equal(turn.length, 1);
    assert.deepEqual([turn[0].username, turn[0].credential], ['u1', 'p1']);
    assert.ok(!JSON.stringify(ready).includes('static'), 'the static pair is not sent once Metered is ready');
    assert.equal(voiceRelay.iceServers(env, { metered: h.m }).some((s) => s.urls === env.TURN_URL && s.username === 'u1'), false, 'not without a named player');
    assert.equal(voiceRelay.iceExpiresAt(ready, env, h.m), h.m.snapshot().expiresAt);
    h.m.stop();
  });

  await test('a waiting player is told the moment a Metered login becomes usable (no poll needed)', async () => {
    const timers = [];
    let ready = 0;
    const h = harness();
    const m = createMeteredTurn({ appName: 'tableverse', secretKey: SECRET, fetchImpl: h.m && (async () => ({ ok: true, status: 200, json: async () => ({ username: 'r', password: 'q', expiryInSeconds: 3600 }) })), now: () => h.now(), log: null, onReady: () => { ready++; }, setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } });
    void m.refresh(); await flush();
    assert.equal(timers.length, 1);
    assert.ok(timers[0].ms >= PROPAGATION_MS, 'the timer waits out the propagation time');
    h.advance(PROPAGATION_MS + 100);
    timers[0].fn();
    assert.equal(ready, 1, 'onReady fired once the credential is usable');
    assert.equal(m.snapshot().username, 'r');
    m.stop();
  });

  await test('a failed refresh does not stop voice: the fallback keeps being offered and a later success is still pushed', async () => {
    const env = { TURN_URL: 'turn:x:3478', TURN_USERNAME: 'static', TURN_CREDENTIAL: 'static-pass' };
    const h = harness({ answers: [new Error('down'), { status: 200, body: { username: 'later', password: 'l', expiryInSeconds: 3600 } }] });
    h.m.start(); await flush();
    assert.ok(voiceRelay.iceServers(env, { playerId: 'p', metered: h.m }).some((s) => s.username === 'static'));
    h.advance(31_000); h.m.refresh(); await flush();
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot().username, 'later');
    h.m.stop();
  });

  console.log(`\n${passed} metered-turn tests passed`);
})();
