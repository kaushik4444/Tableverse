'use strict';
// Background database reads must follow use: nothing runs while nobody is connected (so Neon can autosuspend), the first
// connection after a quiet spell reads at once when the snapshot is stale, and reads never overlap.
const assert = require('node:assert/strict');
const { createIdlePoller } = require('../lib/idlePoller');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

/** A clock and an interval that the test drives by hand. */
function fakeTime() {
  let t = 0; const timers = new Map(); let next = 1;
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms, at: t + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance: async (ms) => {
      const end = t + ms;
      for (;;) {
        let due = null;
        for (const [id, x] of timers) if (x.at <= end && (!due || x.at < due.x.at)) due = { id, x };
        if (!due) break;
        t = due.x.at; due.x.at += due.x.ms; due.x.fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
    timers: () => timers.size,
  };
}
const MIN = 60 * 1000;

(async () => {
  await test('idle for a whole day: not one read, however many ticks pass', async () => {
    const time = fakeTime(); let reads = 0;
    const poller = createIdlePoller({ run: async () => { reads++; }, everyMs: 15 * MIN, staleMs: 5 * MIN, active: () => false, ...time });
    poller.markFresh(); poller.start();
    await time.advance(24 * 60 * MIN);
    assert.equal(reads, 0);
  });

  await test('while somebody is connected it reads on every tick, and stops again when they leave', async () => {
    const time = fakeTime(); let reads = 0; let connected = true;
    const poller = createIdlePoller({ run: async () => { reads++; }, everyMs: 15 * MIN, staleMs: 5 * MIN, active: () => connected, ...time });
    poller.markFresh(); poller.start();
    await time.advance(60 * MIN);
    assert.equal(reads, 4, 'one read per 15 minutes for an hour (was one per 15 seconds: 240)');
    connected = false;
    await time.advance(60 * MIN);
    assert.equal(reads, 4, 'nobody connected: no reads');
  });

  await test('the first connection after a quiet spell reads at once; a fresh snapshot is left alone', async () => {
    const time = fakeTime(); let reads = 0;
    const poller = createIdlePoller({ run: async () => { reads++; }, everyMs: 15 * MIN, staleMs: 5 * MIN, active: () => false, ...time });
    poller.markFresh(); poller.start();
    await time.advance(2 * MIN);
    await poller.touch();
    assert.equal(reads, 0, 'two minutes old: not stale');
    await time.advance(4 * MIN);
    await poller.touch();
    assert.equal(reads, 1, 'six minutes old: read now');
    await poller.touch();
    assert.equal(reads, 1, 'a second connection straight after does not read again');
  });

  await test('reads do not overlap, a failing read does not stop the timer, and stop() ends it', async () => {
    const time = fakeTime(); let reads = 0; let release; let fail = true;
    const gate = new Promise((r) => { release = r; });
    const poller = createIdlePoller({
      run: async () => { reads++; if (reads === 1) await gate; if (fail && reads === 2) throw new Error('database down'); },
      everyMs: MIN, staleMs: 0, active: () => true, ...time,
    });
    poller.start();
    const first = poller.touch();
    const second = poller.touch();
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 1, 'a second caller joins the read that is running');
    release(); await Promise.all([first, second]);
    await time.advance(MIN); // read 2 fails
    await time.advance(MIN); // read 3 still happens
    assert.equal(reads, 3);
    poller.stop();
    assert.equal(time.timers(), 0);
    await time.advance(10 * MIN);
    assert.equal(reads, 3);
  });

  console.log(`\n${passed} passed`);
})();
