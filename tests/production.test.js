'use strict';
// Production configuration: startup must fail loudly instead of running on the wrong database, plus the abuse limits.
require('./helpers/env'); // first: NODE_ENV=test, no .env loading, no DATABASE_URL (memory-mode test)
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { prepareDatabase } = require('../db/startup');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');
const { enqueueSocketMessage, createBoundedSerialQueue, sendBounded } = require('../lib/wsLimits');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = { log() {}, warn() {} };
const fakeDb = (o = {}) => ({ driverMissing: () => false, ping: async () => {}, ...o });
const rejects = (p, re) => assert.rejects(p, (e) => re.test(e.message));

(async () => {
  console.log('database startup');
  await test('production without DATABASE_URL refuses to start', async () => {
    await rejects(prepareDatabase({ env: { NODE_ENV: 'production' }, db: fakeDb(), log: quiet }), /DATABASE_URL is required/);
  });
  await test('development and tests without DATABASE_URL use the in-memory store', async () => {
    assert.deepEqual(await prepareDatabase({ env: {}, db: fakeDb(), log: quiet }), { mode: 'memory' });
    assert.deepEqual(await prepareDatabase({ env: { NODE_ENV: 'test' }, db: fakeDb(), log: quiet }), { mode: 'memory' });
  });
  await test('DATABASE_URL set but the pg driver missing: fatal in production, a warning in development', async () => {
    const db = fakeDb({ driverMissing: () => true });
    await rejects(prepareDatabase({ env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }, db, log: quiet }), /"pg" package is not installed/);
    let warned = '';
    const r = await prepareDatabase({ env: { DATABASE_URL: 'postgres://x' }, db, log: { log() {}, warn: (m) => (warned = m) } });
    assert.equal(r.mode, 'memory');
    assert.match(warned, /pg/);
  });
  await test('an unreachable database is fatal (it is checked before accepting users)', async () => {
    const db = fakeDb({ ping: async () => { throw new Error('ECONNREFUSED'); } });
    let migrated = false;
    await rejects(prepareDatabase({ env: { DATABASE_URL: 'postgres://x' }, db, migrate: async () => { migrated = true; }, log: quiet }), /Cannot reach the database: ECONNREFUSED/);
    assert.equal(migrated, false, 'no migration is attempted on a dead database');
  });
  // ---- a slow first connection (Neon waking from scale-to-zero): retried, but only for connection errors and only for a bounded time
  const POOL_TIMEOUT = 'Connection terminated due to connection timeout'; // what pg reports when the 5 s connect timeout fires (no error code)
  /** A fake clock: sleeping moves time forward, so these tests take no real time. */
  const slept = [];
  const clock = () => { slept.length = 0; let t = 0; return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } }; };
  const startup = (extra) => ({ env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }, log: quiet, ...extra });
  await test('production: a connect timeout is retried with a growing delay and the server then starts', async () => {
    const c = clock(); let pings = 0; const order = [];
    const db = fakeDb({ ping: async () => { pings++; if (pings < 3) throw new Error(POOL_TIMEOUT); } });
    const r = await prepareDatabase(startup({ db, now: c.now, sleep: c.sleep, migrate: async () => { order.push('migrate'); return { applied: [] }; } }));
    assert.deepEqual(r, { mode: 'postgres' });
    assert.equal(pings, 3);
    assert.deepEqual(slept, [1000, 2000]);
    assert.deepEqual(order, ['migrate'], 'migrations run once, after the database answered');
  });
  await test('production: a database that never answers fails after a bounded time, migrations are never attempted, and there is no memory fallback', async () => {
    const c = clock(); let pings = 0; let migrated = false;
    const db = fakeDb({ ping: async () => { pings++; throw new Error(POOL_TIMEOUT); } });
    await rejects(prepareDatabase(startup({ db, now: c.now, sleep: c.sleep, migrate: async () => { migrated = true; } })), /Cannot reach the database: Connection terminated due to connection timeout \(after 8 attempts\)/);
    assert.equal(pings, 8, '1+2+4+8+8+8+8 s of waiting, then the next 8 s would pass the 45 s limit');
    assert.ok(slept.reduce((a, b) => a + b, 0) <= 45000, 'the total wait stays inside the limit');
    assert.equal(migrated, false);
  });
  await test('production: an error that retrying cannot fix fails at once (wrong password, unknown database, bad host)', async () => {
    for (const err of [Object.assign(new Error('password authentication failed for user "u"'), { code: '28P01' }), Object.assign(new Error('getaddrinfo ENOTFOUND h'), { code: 'ENOTFOUND' }), new Error('database "x" does not exist')]) {
      const c = clock(); let pings = 0;
      const db = fakeDb({ ping: async () => { pings++; throw err; } });
      await rejects(prepareDatabase(startup({ db, now: c.now, sleep: c.sleep })), /Cannot reach the database: /);
      assert.equal(pings, 1, err.message);
      assert.deepEqual(slept, []);
    }
  });
  await test('production: connection errors that carry a code are retried too (the pool classifier is used when the pool provides it)', async () => {
    const c = clock(); let pings = 0;
    const db = fakeDb({ isTransientConnectionError: (e) => e.code === 'ECONNRESET', ping: async () => { pings++; if (pings === 1) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); } });
    assert.deepEqual(await prepareDatabase(startup({ db, now: c.now, sleep: c.sleep, migrate: async () => ({ applied: [] }) })), { mode: 'postgres' });
    assert.equal(pings, 2);
  });
  await test('production: coded authentication and unknown-database errors are never retried because of misleading messages', async () => {
    for (const err of [
      Object.assign(new Error('role rejected: connection terminated'), { code: '28P01' }),
      Object.assign(new Error('database name contains connection timeout'), { code: '3D000' }),
    ]) {
      const c = clock(); let pings = 0;
      const db = fakeDb({
        isTransientConnectionError: () => false,
        ping: async () => { pings++; throw err; },
      });
      await rejects(prepareDatabase(startup({ db, now: c.now, sleep: c.sleep })), /Cannot reach the database/);
      assert.equal(pings, 1, err.message);
      assert.deepEqual(slept, [], 'a coded non-transient error must not enter the retry delay');
    }
  });
  await test('production: a ping that never settles is bounded by the remaining startup deadline', async () => {
    let migrated = false;
    const started = Date.now();
    const db = fakeDb({ ping: () => new Promise(() => {}) });
    await rejects(prepareDatabase(startup({
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', DB_STARTUP_WAIT_MS: '30' },
      db,
      migrate: async () => { migrated = true; },
    })), /Cannot reach the database: database ping exceeded the startup retry window/);
    assert.ok(Date.now() - started < 1000, 'startup must not wait indefinitely for an in-flight ping');
    assert.equal(migrated, false, 'migrations must not run after a timed-out ping');
  });
  await test('outside production nothing is retried by default (a developer without a database gets the answer at once); DB_STARTUP_WAIT_MS can opt in or switch it off', async () => {
    const attempts = async (env) => { const c = clock(); let pings = 0; const db = fakeDb({ ping: async () => { pings++; throw new Error(POOL_TIMEOUT); } });
      await rejects(prepareDatabase({ env: { DATABASE_URL: 'postgres://x', ...env }, db, log: quiet, now: c.now, sleep: c.sleep }), /Cannot reach the database/); return pings; };
    assert.equal(await attempts({ NODE_ENV: 'development' }), 1);
    assert.equal(await attempts({ NODE_ENV: 'production', DB_STARTUP_WAIT_MS: '0' }), 1, '0 switches the wait off in production');
    assert.equal(await attempts({ NODE_ENV: 'development', DB_STARTUP_WAIT_MS: '3000' }), 2, 'the 1 s + 2 s backoffs consume the full 3 s budget; no third ping starts');
  });
  await test('DB_STARTUP_WAIT_MS is capped at two minutes and an invalid value falls back to the default', () => {
    const { startupWaitMs } = require('../db/startup');
    assert.equal(startupWaitMs({ NODE_ENV: 'production', DB_STARTUP_WAIT_MS: '9999999' }), 120000);
    assert.equal(startupWaitMs({ NODE_ENV: 'production', DB_STARTUP_WAIT_MS: 'abc' }), 45000);
    assert.equal(startupWaitMs({ NODE_ENV: 'production', DB_STARTUP_WAIT_MS: '-5' }), 45000);
    assert.equal(startupWaitMs({ NODE_ENV: 'production' }), 45000);
    assert.equal(startupWaitMs({ NODE_ENV: 'test' }), 0);
  });
  await test('a retry never logs the connection string (only the driver message and the attempt number)', async () => {
    const c = clock(); const lines = []; let pings = 0;
    const db = fakeDb({ ping: async () => { pings++; if (pings === 1) throw new Error(POOL_TIMEOUT); } });
    await prepareDatabase(startup({ db, now: c.now, sleep: c.sleep, migrate: async () => ({ applied: [] }), env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://user:SECRET@host/db' }, log: { log: (m) => lines.push(m), warn: (m) => lines.push(m) } }));
    assert.ok(lines.length >= 2 && lines.every((l) => !/SECRET|postgres:\/\//.test(l)), lines.join(' | '));
  });
  await test('a failing migration is fatal, in production and in development', async () => {
    const migrate = async () => { throw new Error('syntax error at or near "CREAT"'); };
    for (const NODE_ENV of ['production', 'development']) {
      await rejects(prepareDatabase({ env: { NODE_ENV, DATABASE_URL: 'postgres://x' }, db: fakeDb(), migrate, log: quiet }), /Database migration failed: syntax error/);
    }
  });
  await test('a reachable database with good migrations starts in postgres mode, pinging before migrating', async () => {
    const order = [];
    const r = await prepareDatabase({
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' },
      db: fakeDb({ ping: async () => order.push('ping') }),
      migrate: async () => { order.push('migrate'); return { applied: ['001_init.sql'] }; },
      log: quiet,
    });
    assert.deepEqual(r, { mode: 'postgres' });
    assert.deepEqual(order, ['ping', 'migrate']);
  });
  await test('start() rejects and never listens when the database is not acceptable', async () => {
    await rejects(start({ port: 0, database: { prepare: async () => { throw new Error('Database migration failed: boom'); } } }), /migration failed/);
  });
  await test('node server.js exits with a non-zero status in production without DATABASE_URL', () => {
    const env = { ...process.env, NODE_ENV: 'production', PORT: '0' };
    delete env.DATABASE_URL;
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, encoding: 'utf8', timeout: 15000, cwd: path.join(__dirname, '..') });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /DATABASE_URL is required/);
    assert.doesNotMatch(r.stdout, /running on/);
  });

  console.log('abuse limits');
  const base = { port: 0, trustProxy: false, database: { prepare: async () => ({ mode: 'memory' }) } };
  // token: the session the browser would hold; it is sent as the ct_session cookie on the upgrade request
  const connect = (srv, headers, token) => new Promise((resolve) => {
    const cookie = token ? { cookie: `ct_session=${encodeURIComponent(token)}` } : {};
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { ...headers, ...cookie } });
    const o = { ws, closed: null, msgs: [] };
    ws.on('message', (d) => o.msgs.push(JSON.parse(d)));
    ws.on('close', (code) => (o.closed = code));
    ws.on('error', (e) => (o.error = e.message));
    ws.on('open', () => resolve(o));
    ws.on('unexpected-response', (_, res) => { o.error = 'HTTP ' + res.statusCode; resolve(o); });
    ws.on('error', () => resolve(o));
  });
  const hello = (o, extra = {}) => o.ws.send(JSON.stringify({ t: 'hello', ...extra }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await test('per-socket WebSocket queue rejects overload and recovers after success and failure', async () => {
    const ws = { queueDepth: 0, queue: Promise.resolve(), closed: null, close(code, reason) { this.closed = { code, reason }; } };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    assert.equal(enqueueSocketMessage(ws, () => gate, 1), true);
    await Promise.resolve();
    assert.equal(ws.queueDepth, 1);
    assert.equal(enqueueSocketMessage(ws, async () => {}, 1), false);
    assert.deepEqual(ws.closed, { code: 1013, reason: 'server busy' });
    release();
    await ws.queue;
    assert.equal(ws.queueDepth, 0);
    assert.equal(enqueueSocketMessage(ws, async () => { throw new Error('expected handler failure'); }, 1), true);
    await ws.queue;
    assert.equal(ws.queueDepth, 0);
    assert.equal(enqueueSocketMessage(ws, async () => {}, 1), true);
    await ws.queue;
    assert.equal(ws.queueDepth, 0);
  });

  await test('global hello queue rejects overload and recovers after a failed authentication task', async () => {
    const queue = createBoundedSerialQueue(1);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = queue.enqueue(() => gate);
    assert.equal(queue.depth, 1);
    let rejected = false;
    assert.equal(await queue.enqueue(async () => 'should not run', () => { rejected = true; }), false);
    assert.equal(rejected, true);
    release();
    await first;
    assert.equal(queue.depth, 0);
    await assert.rejects(queue.enqueue(async () => { throw new Error('expected auth failure'); }), /expected auth failure/);
    assert.equal(queue.depth, 0);
    assert.equal(await queue.enqueue(async () => 'recovered'), 'recovered');
  });

  await test('slow WebSocket consumers are terminated before another outbound message is queued', () => {
    let terminated = false;
    const slow = { readyState: 1, bufferedAmount: 1025, terminate() { terminated = true; }, send() { throw new Error('must not send'); } };
    assert.equal(sendBounded(slow, { t: 'test' }, 1024), false);
    assert.equal(terminated, true);
    let sent = null;
    const healthy = { readyState: 1, bufferedAmount: 0, send(raw, cb) { sent = JSON.parse(raw); cb(null); }, terminate() { throw new Error('healthy socket terminated'); } };
    assert.equal(sendBounded(healthy, { t: 'ok' }, 1024), true);
    assert.deepEqual(sent, { t: 'ok' });
  });

  let seq = 1;
  const auth = async (srv, name = 'T') => {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const email = `${base}.${seq++}@test.local`;
    const username = `${base.slice(0, 16)}${seq}`;
    return registerAndVerify(srv.port, { email, username, displayName: name, password: 'TestPass123!' });
  };

  await test('a WebSocket from another website (foreign Origin) is refused; the site itself is allowed', async () => {
    const srv = await start(base);
    const evil = await connect(srv, { Origin: 'http://evil.example' });
    assert.match(evil.error || '', /403|401|400/);
    const session = await auth(srv, 'Origin OK');
    const good = await connect(srv, { Origin: `http://127.0.0.1:${srv.port}` }, session.token);
    hello(good); await wait(150);
    assert.ok(good.msgs.some((m) => m.t === 'welcome'));
    good.ws.close(); await srv.close();
  });

  await test('too many open sockets from one address are closed', async () => {
    const srv = await start({ ...base, maxSocketsPerIp: 2 });
    const a = await connect(srv); const b = await connect(srv); const c = await connect(srv);
    await wait(150);
    assert.equal(c.closed, 1013);
    assert.equal(a.closed, null);
    a.ws.close(); b.ws.close(); await srv.close();
  });

  await test('authenticated sessions can connect and invalid/missing tokens are rejected', async () => {
    const srv = await start({ ...base, maxNewAccountsPerIp: 2 });
    const one = await auth(srv, 'Auth One');
    const two = await auth(srv, 'Auth Two');

    const a = await connect(srv, undefined, one.token); hello(a); await wait(150);
    const b = await connect(srv, undefined, two.token); hello(b); await wait(150);
    assert.ok(a.msgs.some((m) => m.t === 'welcome'));
    assert.ok(b.msgs.some((m) => m.t === 'welcome'));

    const missing = await connect(srv); hello(missing); await wait(150);
    assert.equal(missing.closed, 1008);
    assert.ok(missing.msgs.some((m) => m.t === 'authRequired'));

    const bad = await connect(srv, undefined, 'bad-token'); hello(bad); await wait(150);
    assert.equal(bad.closed, 1008);
    assert.ok(bad.msgs.some((m) => m.t === 'authRequired'));

    a.ws.close(); b.ws.close(); await srv.close();
  });

  await test('sessions from many addresses can connect when authenticated', async () => {
    const srv = await start({ ...base, trustProxy: true, maxNewAccountsPerMin: 3, maxNewAccountsPerIp: 1000 });
    let welcomed = 0;
    for (let i = 0; i < 5; i++) {
      const s = await auth(srv, `Flood ${i}`);
      const c = await connect(srv, { 'X-Forwarded-For': `10.0.0.${i}` }, s.token);
      hello(c); await wait(120);
      if (c.msgs.some((m) => m.t === 'welcome')) welcomed++;
      c.ws.close();
    }
    assert.equal(welcomed, 5);
    await srv.close();
  });

  await test('health, readiness, static and error responses carry security headers; voice microphone is same-origin only; HSTS is production-only', async () => {
    let srv;
    let prod;
    try {
      srv = await start(base);
      const r = await fetch(`http://127.0.0.1:${srv.port}/readyz`);
      assert.equal(r.status, 200);
      const home = await fetch(`http://127.0.0.1:${srv.port}/`);
      const health = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
      const missing = await fetch(`http://127.0.0.1:${srv.port}/missing`);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(health.headers.get('cache-control'), 'no-store');
      for (const response of [r, home, health, missing]) {
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.match(response.headers.get('content-security-policy') || '', /object-src 'none'/);
        assert.match(response.headers.get('content-security-policy') || '', /base-uri 'self'/);
        // Voice chat needs the site's microphone, but must not grant camera or geolocation access.
        assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
        assert.equal(response.headers.get('strict-transport-security'), null);
      }
      await srv.close();
      srv = null;

      prod = await start({ ...base, env: { NODE_ENV: 'production' } });
      const secure = await fetch(`http://127.0.0.1:${prod.port}/`);
      assert.match(secure.headers.get('strict-transport-security'), /max-age/);
    } finally {
      // Always release listening sockets, even when a security-header assertion fails.
      if (srv) await srv.close();
      if (prod) await prod.close();
    }
  });

  console.log(`\n${passed} production tests passed`);
})();
