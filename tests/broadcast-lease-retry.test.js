'use strict';
// A broadcast another run still holds (an unexpired lease) is not sent twice, and the run reports when that lease ends so the
// server can try again then. Without a held lease, nothing is scheduled.
const assert = require('node:assert/strict');
const { createBroadcastWorker } = require('../lib/broadcast');
const { leaseDelayFrom } = require('../db/broadcast');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

function store(overrides = {}) {
  return {
    claimNext: async () => null,
    leaseRetryMs: async () => null,
    ...overrides,
  };
}

(async () => {
  await test('nothing to send and no lease held: idle with no retry', async () => {
    const w = createBroadcastWorker({ store: store(), deliver: async () => {}, logger: { error() {} } });
    assert.deepEqual(await w.runOnce(), { idle: true, retryInMs: null });
  });

  await test('a lease held by another run: idle, and the time it ends is reported', async () => {
    const w = createBroadcastWorker({ store: store({ leaseRetryMs: async () => 240000 }), deliver: async () => {}, logger: { error() {} } });
    assert.deepEqual(await w.runOnce(), { idle: true, retryInMs: 240000 });
  });

  await test('a store without leaseRetryMs still works (older stores): no retry time', async () => {
    const s = store(); delete s.leaseRetryMs;
    const w = createBroadcastWorker({ store: s, deliver: async () => {}, logger: { error() {} } });
    assert.deepEqual(await w.runOnce(), { idle: true, retryInMs: null });
  });

  await test('an empty table (no lease at all) gives no delay: a NULL minimum is not turned into a retry at 0', async () => {
    assert.equal(leaseDelayFrom({ ms: null }), null);
    assert.equal(leaseDelayFrom({ ms: undefined }), null);
    assert.equal(leaseDelayFrom(undefined), null);
  });

  await test('a held lease gives its remaining time (the database may return a numeric string); an expired one is 0', async () => {
    assert.equal(leaseDelayFrom({ ms: '240000.5' }), 240000.5);
    assert.equal(leaseDelayFrom({ ms: -10 }), 0);
  });

  console.log(`\n${passed} passed`);
})();
