'use strict';
// Readiness must report every database state correctly, quickly and without leaking driver text.
const assert = require('node:assert/strict');
const { createReadinessCheck } = require('../lib/health');
const { createLogger } = require('../lib/log');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const SECRET_URL = 'postgres://tv_app:Sup3rSecretPw@ep-private-host.neon.tech/neondb';
const quietLog = () => { const calls = []; return { calls, info: (e, f) => calls.push(['info', e, f]), warn: (e, f) => calls.push(['warn', e, f]), error: (e, f) => calls.push(['error', e, f]) }; };

(async () => {
  await test('healthy database: 200 "ready"', async () => {
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => {} });
    assert.deepEqual(await check(), { status: 200, body: 'ready' });
  });

  await test('no database configured (memory store): 200, so local play is unaffected', async () => {
    const check = createReadinessCheck({ hasDatabase: () => false, ping: async () => { throw new Error('must not be called'); } });
    assert.deepEqual(await check(), { status: 200, body: 'ready (in-memory store)' });
  });

  await test('database refuses connections: 503 with a fixed message and no connection string', async () => {
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => { throw new Error(`connect ECONNREFUSED ${SECRET_URL}`); }, log: quietLog() });
    const r = await check();
    assert.equal(r.status, 503);
    assert.equal(r.body, 'database unavailable');
    assert.ok(!JSON.stringify(r).includes('Sup3rSecretPw'));
  });

  await test('database that never answers is reported within the timeout, not after the driver gives up', async () => {
    const check = createReadinessCheck({ hasDatabase: () => true, ping: () => new Promise(() => {}), timeoutMs: 50, log: quietLog() });
    const t0 = Date.now();
    const r = await check();
    const took = Date.now() - t0;
    assert.equal(r.status, 503);
    assert.ok(took < 1000, `took ${took} ms`);
  });

  await test('shutting down: 503 "shutting down" even when the database is fine', async () => {
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => {}, shuttingDown: () => true });
    assert.deepEqual(await check(), { status: 503, body: 'shutting down' });
  });

  await test('pending or failed match writes are reported in the body', async () => {
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => {}, queueStats: () => ({ pending: 2, failed: 1 }) });
    assert.equal((await check()).body, 'ready (matches: 2 pending, 1 failed)');
  });

  await test('an outage is logged once, and recovery is logged once', async () => {
    const log = quietLog();
    let up = false;
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => { if (!up) throw new Error('down'); }, log, cacheMs: 0 });
    await check(); await check(); await check();
    assert.deepEqual(log.calls.map((c) => c[1]), ['health.db_unreachable']);
    up = true;
    await check(); await check();
    assert.deepEqual(log.calls.map((c) => c[1]), ['health.db_unreachable', 'health.db_recovered']);
  });

  await test('the outage log written by the real logger carries the error code but not the database URL', async () => {
    const lines = [];
    const log = createLogger({ component: 'health', write: (level, line) => lines.push(line) });
    const err = Object.assign(new Error(`cannot reach ${SECRET_URL}`), { code: 'ECONNREFUSED' });
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => { throw err; }, log });
    await check();
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('ECONNREFUSED'));
    assert.ok(!lines[0].includes('Sup3rSecretPw'));
    assert.ok(lines[0].includes('health.db_unreachable'));
  });

  // Regression: /readyz is public. During an outage every request used to start its own database round trip, so a burst
  // of requests queued that many connection requests on the pool. Now one probe runs at a time and its answer is reused.
  await test('a burst of concurrent readiness requests during an outage starts exactly one database probe', async () => {
    let calls = 0;
    let release;
    const hang = new Promise((resolve) => { release = resolve; });
    const check = createReadinessCheck({ hasDatabase: () => true, ping: () => { calls++; return hang; }, timeoutMs: 50, cacheMs: 0 });
    const answers = await Promise.all(Array.from({ length: 200 }, () => check()));
    release();
    assert.equal(calls, 1, `probes started: ${calls}`);
    assert.ok(answers.every((a) => a.status === 503 && a.body === 'database unavailable'));
  });

  await test('readiness polls inside the cache window reuse the last answer instead of querying again', async () => {
    let calls = 0;
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => { calls++; }, cacheMs: 2000 });
    await check();
    await check();
    await check();
    assert.equal(calls, 1);
  });

  await test('after the cache window a readiness request probes again, so recovery is seen', async () => {
    let up = false;
    let calls = 0;
    const check = createReadinessCheck({ hasDatabase: () => true, ping: async () => { calls++; if (!up) throw new Error('down'); }, cacheMs: 20 });
    assert.equal((await check()).status, 503);
    up = true;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await check()).status, 200);
    assert.equal(calls, 2);
  });

  console.log(`\n${passed} health tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
