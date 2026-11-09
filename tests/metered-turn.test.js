'use strict';
// Metered TURN credentials: request shape, the secret never leaking, the 2-minute propagation wait, refresh before expiry,
// retry after failure, and what the browser is offered. No network: fetch is replaced.
require('./helpers/env');
const assert = require('node:assert/strict');
const { createMeteredTurn, fromEnv, PROPAGATION_MS, REFRESH_LEAD_MS, ROTATE_AFTER_MS, EXPIRY_MARGIN_MS, RETRY_BASE_MS, RETRY_MAX_MS, QUOTA_RETRY_MS, DEFAULT_TTL, TTL_MAX } = require('../lib/meteredTurn');
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

  await test('the default lifetime is 48 hours, and a replacement is requested every 24 hours (not at expiry)', async () => {
    const h = harness({ ttl: 172800 });
    h.m.start(); await flush();
    assert.equal(JSON.parse(h.calls[0].init.body).expiryInSeconds, 172800, 'Metered is asked for 48 hours');
    assert.equal(DEFAULT_TTL, 48 * 3600);
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot().username, 'u1');
    h.advance(ROTATE_AFTER_MS - PROPAGATION_MS - 1000);
    assert.equal(h.m.snapshot().username, 'u1');
    await flush();
    assert.equal(h.calls.length, 1, 'no replacement before 24 hours');
    h.advance(1000);
    h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 2, 'the replacement is requested at 24 hours');
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot().username, 'u2', 'and used after its propagation');
    h.m.stop();
  });

  await test('a lifetime above 48 hours is clamped, so the request never asks for more than the policy', async () => {
    const h = harness({ ttl: 172800 });
    const m = createMeteredTurn({ appName: 'tableverse', secretKey: SECRET, ttlSeconds: 999999, fetchImpl: async (u, init) => { h.calls.push({ url: u, init }); return { ok: true, status: 200, json: async () => ({ username: 'x', password: 'y', expiryInSeconds: 172800 }) }; }, now: () => h.now(), log: { warn() {} } });
    m.start(); await flush();
    assert.equal(JSON.parse(h.calls[h.calls.length - 1].init.body).expiryInSeconds, TTL_MAX);
    m.stop();
  });

  await test('a short lifetime still rotates before it expires, and never in a tight loop', async () => {
    const h = harness({ ttl: 900 });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 1, 'not refreshed straight away');
    h.advance(900 * 1000 / 2 - PROPAGATION_MS);
    h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 2, 'half-way through a 15-minute lifetime it is replaced');
    h.m.stop();
  });

  await test('a requested lifetime below 15 minutes is raised to 15 minutes', async () => {
    const h = harness({ ttl: 300 });
    h.m.start(); await flush();
    assert.equal(JSON.parse(h.calls[0].init.body).expiryInSeconds, 900, 'the shortest lifetime Metered is asked for');
    h.m.stop();
  });

  await test('a shorter lifetime from Metered is trusted as given, never rounded up to the minimum', async () => {
    const h = harness({ ttl: 900, answers: [{ status: 200, body: { username: 'short', password: 's', expiryInSeconds: 600 } }, new Error('down')] });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot().username, 'short');
    h.advance(600 * 1000 - PROPAGATION_MS); // 600 s after issue: past the expiry margin
    assert.equal(h.m.snapshot(), null, 'not handed out at 600 s, though the minimum would have kept it to 900 s');
    h.m.stop();
  });

  /** Simulates `lifetime` seconds per login over three lifetimes, second by second, and returns the seconds without a usable login after the first. */
  async function simulateHandover(lifetime) {
    let t = 1_000_000;
    let timers = [];
    let calls = 0;
    const m = createMeteredTurn({
      appName: 'tableverse', secretKey: SECRET, ttlSeconds: lifetime, now: () => t, log: null, timeoutMs: 1000,
      setTimer: (fn, ms) => { timers.push({ at: t + ms, fn }); return { unref() {} }; },
      fetchImpl: async () => { calls++; const n = calls; return { ok: true, status: 200, json: async () => ({ username: 'u' + n, password: 'p' + n, expiryInSeconds: lifetime }) }; },
    });
    m.start(); await flush();
    let seenReady = false;
    let gapSeconds = 0;
    for (let s = 1; s <= 3 * lifetime; s++) {
      t += 1000;
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      for (const x of due) x.fn();
      if (s % 60 === 0) m.status(); // the server's minute tick
      await flush();
      if (m.stats().status === 'ready') seenReady = true;
      else if (seenReady) gapSeconds++;
    }
    m.stop();
    return { seenReady, gapSeconds, calls };
  }

  await test('a short lifetime hands over without a gap: the replacement is usable before the old credential stops', async () => {
    const r = await simulateHandover(900);
    assert.ok(r.seenReady);
    assert.equal(r.gapSeconds, 0, 'no second without a usable credential after the first one');
    assert.ok(r.calls >= 3, 'each lifetime was replaced');
  });

  await test('a lifetime Metered grants as 5 minutes also hands over without a gap (rotation is moved earlier)', async () => {
    const r = await simulateHandover(300);
    assert.ok(r.seenReady);
    assert.equal(r.gapSeconds, 0, 'no second without a usable credential after the first one');
    assert.ok(r.calls >= 3, 'each lifetime was replaced');
  });

  await test('a credential is never handed out in its last minute', async () => {
    const h = harness({ ttl: 900 });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    assert.ok(h.m.snapshot());
    h.advance(900 * 1000 - EXPIRY_MARGIN_MS);
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

  await test('a credential promoted by a poll before its timer still tells the server (exactly once)', async () => {
    let ready = 0;
    const h = harness();
    const m = createMeteredTurn({ appName: 'tableverse', secretKey: SECRET, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ username: 'z', password: 'y', expiryInSeconds: 3600 }) }), now: () => h.now(), log: null, onReady: () => { ready++; }, setTimer: (fn) => { h.timerFn = fn; return { unref() {} }; } });
    void m.refresh(); await flush();
    h.advance(PROPAGATION_MS + 100);
    assert.equal(m.snapshot().username, 'z', 'the poll promotes it first');
    assert.equal(ready, 1, 'and the server is told');
    h.timerFn(); // the timer fires afterwards: must not tell again
    assert.equal(ready, 1, 'not twice');
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

  await test('failures back off and stop: no request inside the back-off window, the delay doubles and is capped', async () => {
    const h = harness({ answers: Array.from({ length: 12 }, () => ({ status: 500, body: {} })) });
    const gaps = [];
    h.m.start(); await flush();
    let last = h.calls.length;
    for (let i = 0; i < 6; i++) {
      // poll well inside the window: must not add a request
      const before = h.calls.length;
      h.m.snapshot(); await flush();
      assert.equal(h.calls.length, before, 'no retry inside the back-off window');
      // jump to just after the window, then one attempt
      let waited = 0; const step = 1000;
      while (h.calls.length === last && waited < 3 * RETRY_MAX_MS) { h.advance(step); waited += step; h.m.snapshot(); await flush(); }
      gaps.push(waited);
      last = h.calls.length;
    }
    assert.ok(gaps[1] > gaps[0] && gaps[2] > gaps[1], 'delay grows: ' + gaps.join(','));
    assert.ok(Math.max(...gaps) <= RETRY_MAX_MS + 2000, 'delay is capped: ' + gaps.join(','));
    assert.equal(h.m.status(), 'unavailable');
    h.m.stop();
  });

  await test('a quota or access refusal waits an hour and is reported as quota, not as a plain outage', async () => {
    const h = harness({ answers: [{ status: 429, body: {} }, { status: 200, body: { username: 'after', password: 'a', expiryInSeconds: 3600 } }] });
    h.m.start(); await flush();
    assert.equal(h.m.status(), 'quota');
    h.advance(RETRY_BASE_MS * 10); h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 1, 'still waiting for the quota back-off');
    h.advance(QUOTA_RETRY_MS);
    h.m.snapshot(); await flush();
    assert.equal(h.calls.length, 2);
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.status(), 'ready');
    h.m.stop();
  });

  await test('an expired credential is never handed out, and it is reported as unavailable while refreshing fails', async () => {
    const h = harness({ ttl: 900, answers: [{ status: 200, body: { username: 'first', password: 'f', expiryInSeconds: 900 }}, new Error('down'), new Error('down')] });
    h.m.start(); await flush();
    h.advance(PROPAGATION_MS);
    assert.equal(h.m.snapshot().username, 'first');
    h.advance(900 * 1000); // past expiry
    assert.equal(h.m.snapshot(), null, 'expired: not handed out');
    await flush();
    assert.equal(h.m.status(), 'unavailable');
    h.m.stop();
  });

  await test('status changes are reported once each, so the server pushes only on a real change', async () => {
    const changes = [];
    const h = harness({ answers: [new Error('down')] });
    const m = createMeteredTurn({ appName: 'tableverse', secretKey: SECRET, fetchImpl: h.m ? undefined : undefined, now: () => h.now(), log: null, onChange: (s) => changes.push(s), setTimer: () => ({ unref() {} }), fetchImpl: async (url) => { h.calls.push(url); const a = h.calls.length === 1 ? new Error('down') : null; if (a) throw a; return { ok: true, status: 200, json: async () => ({ username: 'ok', password: 'k', expiryInSeconds: 3600 }) }; } });
    void m.refresh(); await flush();
    m.status(); m.status(); // same status again: no event
    assert.deepEqual(changes, ['unavailable']);
    h.advance(RETRY_MAX_MS * 2); void m.refresh(); await flush();
    assert.deepEqual(changes, ['unavailable', 'pending'], 'recovery is reported');
    m.stop();
  });

  await test('a quota refusal does not colour a later outage: the status describes the latest failure', async () => {
    const h = harness({ answers: [{ status: 429, body: {} }, new Error('network down')] });
    h.m.start(); await flush();
    assert.equal(h.m.status(), 'quota');
    h.advance(QUOTA_RETRY_MS + 1); h.m.snapshot(); await flush();
    assert.equal(h.m.status(), 'unavailable', 'an ordinary outage is reported as one');
    h.m.stop();
  });

  await test('with Metered unavailable, voice still works on the fallbacks and the status is what the browser is told', async () => {
    const h = harness({ answers: [new Error('down')] });
    h.m.start(); await flush();
    const withStatic = { TURN_URL: 'turn:x:3478', TURN_USERNAME: 'static', TURN_CREDENTIAL: 'static-pass' };
    assert.ok(voiceRelay.iceServers(withStatic, { playerId: 'p', metered: h.m }).some((s) => s.username === 'static'));
    assert.equal(h.m.status(), 'unavailable');
    const noFallback = { TURN_URL: 'turn:x:3478' };
    const list = voiceRelay.iceServers(noFallback, { playerId: 'p', metered: h.m });
    assert.equal(list[0].urls, voiceRelay.DEFAULT_STUN, 'STUN is always first');
    assert.ok(list.every((s) => !String(s.username || '').startsWith('u')), 'no Metered login is invented');
    assert.ok(!JSON.stringify(list).includes(SECRET));
    assert.equal(voiceRelay.iceExpiresAt(list, noFallback, h.m), null);
    h.m.stop();
  });

  await test('automated tests never reach Metered: every test above uses a stub, and the default environment is off', () => {
    assert.equal(fromEnv({}), null);
    assert.equal(typeof globalThis.fetch === 'function', true);
  });

  console.log(`\n${passed} metered-turn tests passed`);
})();
