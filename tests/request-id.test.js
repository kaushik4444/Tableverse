'use strict';
// Every HTTP response carries X-Request-Id, a caller's plain ID is echoed, and an unsafe one is replaced.
require('./helpers/env');
const assert = require('node:assert/strict');
const { start } = require('../server');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, log: { log() {}, warn() {}, error() {} }, matchLog: { log() {}, warn() {}, error() {} } });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    await test('a response without a request ID gets a generated one', async () => {
      const r = await fetch(`${base}/healthz`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('x-request-id') || '', /^[0-9a-f]{8}-[0-9a-f]{4}-/);
    });
    await test('a plain caller-supplied request ID is echoed back', async () => {
      const r = await fetch(`${base}/readyz`, { headers: { 'X-Request-Id': 'trace-20260106-abc' } });
      assert.equal(r.headers.get('x-request-id'), 'trace-20260106-abc');
    });
    await test('an unsafe request ID is replaced rather than echoed', async () => {
      const r = await fetch(`${base}/healthz`, { headers: { 'X-Request-Id': 'a b' } });
      assert.notEqual(r.headers.get('x-request-id'), 'a b');
      assert.match(r.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
    });
  } finally { await srv.close(); }
  console.log(`\n${passed} request-id tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
