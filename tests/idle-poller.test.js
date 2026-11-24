'use strict';
// Background database reads must follow use: nothing runs while nobody is connected (so Neon can autosuspend), the first
// connection after a quiet spell reads at once when the snapshot is stale, and reads never overlap.
const assert = require('node:assert/strict');
const { createIdlePoller, retryWithBackoff } = require('../lib/idlePoller');

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

/** The fake clock's timers repeat (for intervals); a one-shot timer removes itself the first time it fires. */
function oneShot(time) {
  return {
    now: time.now,
    setTimer: (fn, ms) => { const id = time.setTimer(() => { time.clearTimer(id); fn(); }, ms); return id; },
    clearTimer: time.clearTimer,
  };
}

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

  await test('a touch at the staleness boundary waits for the same read as a fresh touch and an active tick', async () => {
    const time = fakeTime(); let reads = 0; let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const poller = createIdlePoller({
      run: () => { reads++; return gate; }, everyMs: 2 * MIN, staleMs: MIN, active: () => true, ...time,
    });
    poller.markFresh();
    poller.start();
    await time.advance(MIN - 1);
    await poller.touch();
    assert.equal(reads, 0, 'one millisecond before the deadline is still fresh');
    await time.advance(1);
    const stale = poller.touch();
    const fresh = poller.touch();
    let finished = false;
    const both = Promise.all([stale, fresh]).then(() => { finished = true; });
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 1, 'the deadline itself triggers a read');
    await time.advance(MIN);
    assert.equal(reads, 1, 'the active timer cannot start a second read before this one finishes');
    assert.equal(finished, false);
    assert.equal(fresh, stale, 'a fresh touch still waits for the current snapshot');
    release();
    await both;
    await time.advance(2 * MIN);
    assert.equal(reads, 2, 'the active timer reads again after the pending read finishes');
  });

  await test('starting twice or restarting after stop keeps only one interval', async () => {
    const time = fakeTime(); let reads = 0;
    const poller = createIdlePoller({
      run: () => { reads++; }, everyMs: MIN, staleMs: MIN, active: () => true, ...time,
    });
    poller.start(); poller.start();
    await time.advance(MIN);
    assert.equal(reads, 1);
    poller.stop(); poller.stop();
    await time.advance(MIN);
    assert.equal(reads, 1);
    poller.start();
    await time.advance(MIN);
    assert.equal(reads, 2);
  });

  await test('connections do not flood a failing read and can retry when it goes stale', async () => {
    const time = fakeTime();
    let attempts = 0;
    const poller = createIdlePoller({
      run: () => { if (++attempts === 1) throw new Error('database down'); },
      everyMs: 15 * MIN, staleMs: 5 * MIN, active: () => false, ...time,
    });
    poller.markFresh();
    await time.advance(5 * MIN);
    await poller.touch(); // the failure must not escape to the connecting caller
    assert.equal(attempts, 1);

    await time.advance(5 * MIN - 1);
    await Promise.all([poller.touch(), poller.touch(), poller.touch()]);
    assert.equal(attempts, 1, 'new connections respect the cooldown after a failure');

    await time.advance(1);
    await poller.touch();
    assert.equal(attempts, 2, 'a connection can retry without waiting for a periodic read');
  });

  await test('a failed first read retries a bounded number of times, then stops', async () => {
    const time = fakeTime(); let tries = 0;
    const r = retryWithBackoff(async () => { tries++; return false; }, [1000, 2000], oneShot(time));
    assert.equal(await r.run(), false);
    await time.advance(1000);
    await time.advance(2000);
    await time.advance(10 * MIN);
    assert.equal(tries, 3, 'the first attempt plus two retries, then nothing');
  });

  await test('a retry that works ends the sequence; a later failure starts a fresh sequence', async () => {
    const time = fakeTime(); let tries = 0; let works = false;
    const r = retryWithBackoff(async () => { tries++; return works; }, [1000, 2000], oneShot(time));
    await r.run();
    works = true;
    await time.advance(1000);
    assert.equal(tries, 2);
    await time.advance(10 * MIN);
    assert.equal(tries, 2, 'no further attempts after success');
    works = false;
    await r.run();
    await time.advance(1000);
    assert.equal(tries, 4, 'a new failure gets the full sequence again');
  });

  await test('a throw counts as a failure; run() replaces a pending retry instead of adding one', async () => {
    const time = fakeTime(); let tries = 0;
    const r = retryWithBackoff(async () => { tries++; throw new Error('down'); }, [1000], oneShot(time));
    await r.run();
    assert.equal(time.timers(), 1);
    await r.run();
    assert.equal(time.timers(), 1, 'one pending retry, not two');
    r.stop();
    assert.equal(time.timers(), 0);
    await time.advance(10 * MIN);
    assert.equal(tries, 2);
  });

  console.log(`\n${passed} passed`);
})();
