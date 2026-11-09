'use strict';
// Analytics: privacy (what is and is not recorded), non-blocking behaviour, failure handling, bounds, and that a failing
// analytics store can never break a request.
require('./helpers/env');
const assert = require('node:assert/strict');
const { createAnalytics, cleanDim } = require('../lib/analytics');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = { warn() {}, error() {}, log() {} };
const memStore = () => {
  const s = { counters: [], active: [], addCounters: async (rows) => { s.counters.push(...rows); }, addActive: async (rows) => { s.active.push(...rows); } };
  return s;
};
const total = (rows, metric, dim = '') => rows.filter((r) => r.metric === metric && r.dim === dim).reduce((a, r) => a + r.count, 0);

(async () => {
  console.log('privacy');
  await test('only known metrics are recorded; anything else is ignored', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, log: quiet });
    a.track('registration'); a.track('password'); a.track('email'); a.track('');
    await a.flush();
    assert.deepEqual([...new Set(st.counters.map((r) => r.metric))], ['registration']);
  });
  await test('a counter row holds a day, a metric, a short sanitised dimension and a count, and nothing else', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, log: quiet });
    a.track('game_finished', 'Wizard');
    a.track('error', 'jane.doe@example.com <script> 203.0.113.9');
    await a.flush();
    for (const r of st.counters) assert.deepEqual(Object.keys(r).sort(), ['count', 'day', 'dim', 'metric']);
    assert.equal(st.counters.find((r) => r.metric === 'game_finished').dim, 'wizard');
    const err = st.counters.find((r) => r.metric === 'error').dim;
    assert.ok(err.length <= 48 && !/[@ <>]/.test(err), err);
    assert.equal(cleanDim('x'.repeat(100)).length, 48);
    assert.match(st.counters[0].day, /^\d{4}-\d\d-\d\d$/);
  });
  await test('active accounts are handed to the store once per day; the analytics module never writes them anywhere else', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, log: quiet });
    for (let i = 0; i < 5; i++) a.active('player-1');
    a.active('player-2'); a.active(null); a.active('');
    await a.flush();
    assert.equal(st.active.length, 2);
    assert.deepEqual(Object.keys(st.active[0]).sort(), ['day', 'playerId']);
    const msgs = []; // nothing about players is logged
    const b = createAnalytics({ store: memStore(), log: { warn: (m) => msgs.push(m), error: (m) => msgs.push(m), log: (m) => msgs.push(m) } });
    b.active('secret-player-id'); await b.flush();
    assert.deepEqual(msgs, []);
  });
  await test('stats() exposes counts only, never ids', async () => {
    const a = createAnalytics({ store: memStore(), log: quiet });
    a.active('secret-player-id'); a.track('session');
    assert.ok(!JSON.stringify(a.stats()).includes('secret-player-id'));
  });
  await test('ANALYTICS_ENABLED=0 (enabled: false) records and writes nothing', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, enabled: false, log: quiet });
    a.track('session'); a.active('p'); await a.flush(); await a.close();
    assert.equal(st.counters.length + st.active.length, 0);
    assert.equal(a.stats().enabled, false);
  });
  await test('without a store (memory mode) analytics is a no-op', async () => {
    const a = createAnalytics({ store: null, log: quiet });
    a.track('session'); await a.flush();
    assert.equal(a.stats().buffered, 0);
  });

  console.log('non-blocking');
  await test('track() and active() return immediately and never touch the store', async () => {
    let calls = 0;
    const a = createAnalytics({ store: { addCounters: async () => { calls++; }, addActive: async () => { calls++; } }, log: quiet });
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20000; i++) { a.track('session'); a.active('p' + (i % 100)); }
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 500, 'synchronous and cheap');
    assert.equal(calls, 0);
    await a.flush();
    assert.equal(calls, 2);
  });
  await test('counts are summed, not stored one by one', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, log: quiet });
    for (let i = 0; i < 1000; i++) a.track('session');
    await a.flush();
    assert.equal(st.counters.length, 1);
    assert.equal(st.counters[0].count, 1000);
  });
  await test('track() never throws, whatever it is given or however broken the clock is', () => {
    const a = createAnalytics({ store: memStore(), log: quiet, now: () => { throw new Error('clock'); } });
    assert.doesNotThrow(() => { a.track('session'); a.active('p'); a.track(undefined); a.track({}, {}); });
    assert.ok(a.stats().dropped >= 1);
  });

  console.log('failures');
  await test('a failing store: nothing throws, counts are kept and delivered once the store recovers, none counted twice', async () => {
    const st = memStore(); let fail = true;
    const store = { addCounters: async (r) => { if (fail) throw Object.assign(new Error('connection refused at 10.0.0.1'), { code: 'ECONNREFUSED' }); return st.addCounters(r); }, addActive: st.addActive };
    const a = createAnalytics({ store, log: quiet });
    a.track('game_finished', 'poker'); a.track('game_finished', 'poker'); a.active('p1');
    await assert.doesNotReject(a.flush());
    assert.equal(a.stats().failures, 1);
    assert.equal(a.stats().lastErrorCode, 'ECONNREFUSED');
    assert.ok(!JSON.stringify(a.stats()).includes('10.0.0.1'), 'the error text is not kept');
    a.track('game_finished', 'poker'); // still accepting while the store is down
    fail = false;
    await a.flush();
    assert.equal(total(st.counters, 'game_finished', 'poker'), 3);
    assert.equal(st.active.length, 1);
    await a.flush();
    assert.equal(total(st.counters, 'game_finished', 'poker'), 3, 'a third flush adds nothing');
  });
  await test('if only the active write fails, the counters are not written twice on retry', async () => {
    const st = memStore(); let failActive = true;
    const store = { addCounters: st.addCounters, addActive: async (r) => { if (failActive) throw new Error('x'); return st.addActive(r); } };
    const a = createAnalytics({ store, log: quiet });
    a.track('session'); a.active('p1');
    await a.flush();
    failActive = false;
    await a.flush();
    assert.equal(total(st.counters, 'session'), 1);
    assert.equal(st.active.length, 1);
  });
  await test('a store that hangs cannot hold anything up: the write times out, flush resolves, close() returns quickly', async () => {
    const store = { addCounters: () => new Promise(() => {}), addActive: () => new Promise(() => {}) };
    const a = createAnalytics({ store, log: quiet, writeTimeoutMs: 30 });
    a.track('session');
    const t0 = Date.now();
    await a.flush();
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(a.stats().failures, 1);
    assert.equal(a.stats().lastErrorCode, 'TIMEOUT');
    const b = createAnalytics({ store, log: quiet, writeTimeoutMs: 60000 });
    b.track('session');
    const t1 = Date.now();
    await b.close(50);
    assert.ok(Date.now() - t1 < 1000, 'shutdown is never delayed by analytics');
  });
  await test('a throwing logger cannot break the failure path', async () => {
    const a = createAnalytics({ store: { addCounters: async () => { throw new Error('x'); }, addActive: async () => {} }, log: { warn() { throw new Error('log'); }, error() { throw new Error('log'); } } });
    a.track('session');
    await assert.doesNotReject(a.flush());
  });
  await test('the buffer is bounded: past the limit new keys are dropped and counted, existing keys still grow', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, maxKeys: 3, maxActive: 2, log: quiet });
    for (const d of ['a', 'b', 'c', 'd', 'e']) a.track('game_finished', d);
    a.track('game_finished', 'a');
    a.active('p1'); a.active('p2'); a.active('p3');
    assert.equal(a.stats().buffered, 3);
    assert.equal(a.stats().dropped, 3);
    await a.flush();
    assert.equal(total(st.counters, 'game_finished', 'a'), 2);
    assert.equal(st.active.length, 2);
  });
  await test('overlapping flushes share one write', async () => {
    let writes = 0;
    const a = createAnalytics({ store: { addCounters: async () => { writes++; await new Promise((r) => setTimeout(r, 20)); }, addActive: async () => {} }, log: quiet });
    a.track('session');
    await Promise.all([a.flush(), a.flush(), a.flush()]);
    assert.equal(writes, 1);
  });
  await test('the timer flushes in the background and stops on close', async () => {
    const st = memStore(); const a = createAnalytics({ store: st, flushMs: 20, log: quiet });
    a.start(); a.track('session');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(total(st.counters, 'session'), 1);
    await a.close();
    a.track('session');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(total(st.counters, 'session'), 1, 'no timer after close');
  });

  console.log('a broken analytics store does not break requests');
  await test('feedback and announcement requests still succeed while analytics cannot write', async () => {
    const { start } = require('./helpers/adminHarness');
    const bad = createAnalytics({ store: { addCounters: async () => { throw new Error('down'); }, addActive: async () => { throw new Error('down'); } }, log: quiet });
    const s = await start({ analytics: bad });
    try {
      const g = await s.guest();
      const r = await g.post('/api/feedback', { message: 'works' });
      assert.equal(r.status, 201);
      await bad.flush();
      assert.equal((await g.get('/api/announcements')).status, 200);
      assert.equal((await g.post('/api/feedback', { message: 'still works' })).status, 201);
      const admin = await s.login({ role: 'admin' });
      const health = await admin.b.get('/api/admin/health');
      assert.equal(health.status, 200);
      assert.equal(health.json.analytics.failures, 1, 'the console shows that analytics is failing');
    } finally { await s.close(); }
  });

  console.log('timeouts');
  await test('a write that times out is never saved twice: its counts are dropped and counted, not put back', async () => {
    const landed = [];
    let calls = 0;
    const store = {
      addCounters: async (rows) => { calls++; if (calls === 1) await new Promise((r) => setTimeout(r, 60)); landed.push(...rows); }, // the slow write still lands
      addActive: async () => {},
    };
    const a = createAnalytics({ store, log: quiet, writeTimeoutMs: 10 });
    a.track('session');
    await a.flush(); // gives up after 10 ms
    await new Promise((r) => setTimeout(r, 90));
    await a.flush(); // nothing left to send: the first counts must not come back
    assert.equal(total(landed, 'session'), 1, 'counted exactly once');
    assert.equal(a.stats().dropped, 1, 'the uncertain count is reported as dropped');
  });
  await test('a failed (not timed-out) write is put back and saved on the next flush', async () => {
    const landed = [];
    let calls = 0;
    const store = {
      addCounters: async (rows) => { calls++; if (calls === 1) throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); landed.push(...rows); },
      addActive: async () => {},
    };
    const a = createAnalytics({ store, log: quiet });
    a.track('session'); a.track('session');
    await a.flush();
    await a.flush();
    assert.equal(total(landed, 'session'), 2);
  });

  console.log(`\n${passed} analytics tests passed`);
})();
