'use strict';
// The admin Logs tab reads a bounded in-memory buffer of redacted log lines. No database needed.
const assert = require('node:assert/strict');
const { createLogBuffer } = require('../lib/logBuffer');
const { createLogger } = require('../lib/log');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

test('the buffer keeps only the newest lines and says how many it dropped', () => {
  const b = createLogBuffer(3);
  for (let i = 1; i <= 5; i++) b.push({ level: 'info', component: 'app', event: 'e' + i });
  const r = b.list({ limit: 10 });
  assert.deepEqual(r.items.map((e) => e.event), ['e5', 'e4', 'e3'], 'newest first, bounded');
  assert.equal(r.held, 3);
  assert.equal(r.dropped, 2);
  assert.equal(r.capacity, 3);
});

test('filters: level and component are exact, event is a substring; unknown levels are ignored', () => {
  const b = createLogBuffer(50);
  b.push({ level: 'error', component: 'db', event: 'db.pool_error' });
  b.push({ level: 'warn', component: 'db', event: 'db.slow' });
  b.push({ level: 'error', component: 'ws', event: 'ws.error' });
  assert.deepEqual(b.list({ level: 'error' }).items.map((e) => e.event), ['ws.error', 'db.pool_error']);
  assert.deepEqual(b.list({ component: 'db' }).items.map((e) => e.event), ['db.slow', 'db.pool_error']);
  assert.deepEqual(b.list({ event: 'pool' }).items.map((e) => e.event), ['db.pool_error']);
  assert.equal(b.list({ level: 'debug' }).items.length, 3, 'an unknown level filter is ignored, not an error');
});

test('limits are bounded: at least 1, at most 200, default 100', () => {
  const b = createLogBuffer(500);
  for (let i = 0; i < 300; i++) b.push({ level: 'info', component: 'app', event: 'x' });
  assert.equal(b.list({ limit: 0 }).items.length, 100, 'zero or junk falls back to the default');
  assert.equal(b.list({ limit: -5 }).items.length, 1, 'a negative limit is clamped to at least 1');
  assert.equal(b.list({ limit: 'abc' }).items.length, 100);
  assert.equal(b.list({ limit: 9999 }).items.length, 200);
});

test('a secret passed to a log call never reaches the buffer (the buffer holds the redacted line)', () => {
  const b = createLogBuffer(10);
  const log = createLogger({ component: 'test', write() {}, sink: b });
  log.error('auth.failed', { password: 'hunter2', note: 'token=abc123def456', err: new Error('connect failed for postgres://u:p4ss@db/x') });
  const text = JSON.stringify(b.list({}).items);
  assert.ok(!text.includes('hunter2'), 'password masked');
  assert.ok(!text.includes('abc123def456'), 'token masked');
  assert.ok(!text.includes('p4ss'), 'connection string masked');
  assert.equal(b.list({}).items[0].event, 'auth.failed');
});

test('a sink that throws never breaks the log call', () => {
  const written = [];
  const log = createLogger({ component: 'test', write: (lvl, line) => written.push(line), sink: { push() { throw new Error('full'); } } });
  log.info('ok.event', { n: 1 });
  assert.equal(written.length, 1, 'the line still went to the writer');
});

console.log(`  ${passed} log buffer checks passed`);
