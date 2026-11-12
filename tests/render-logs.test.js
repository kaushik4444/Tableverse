'use strict';
require('./helpers/env');
// Render history for the owner's Logs tab: request shape, masking, caching and failures, with a fake fetch (no network).
const assert = require('node:assert/strict');
const { createRenderLogs, guessLevel } = require('../lib/renderLogs');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const KEY = 'rnd_test_key_1234567890';
const ENV = { RENDER_API_KEY: KEY, RENDER_SERVICE_ID: 'srv-abc123', RENDER_OWNER_ID: 'tea-xyz789' };
const fixedNow = () => Date.parse('2026-11-10T10:00:00Z');
function fakeFetch(body, status = 200) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (status === 'throw') throw new Error('socket hang up');
    return { ok: status === 200, status, json: async () => body };
  };
  return { fn, calls };
}

console.log('render history (Stage 20.8)');
(async () => {
  await test('without all three settings it answers "not configured" and calls nothing', async () => {
    const f = fakeFetch({});
    for (const env of [{}, { ...ENV, RENDER_OWNER_ID: '' }, { ...ENV, RENDER_SERVICE_ID: '' }]) {
      const out = await createRenderLogs({ env, fetchImpl: f.fn, now: fixedNow }).recent();
      assert.deepEqual(out, { configured: false, items: [] });
    }
    assert.equal(f.calls.length, 0);
  });

  await test('lines come back newest first even when Render answers oldest first', async () => {
    const f = fakeFetch({ logs: [{ timestamp: '2026-11-10T09:00:00Z', message: 'a' }, { timestamp: '2026-11-10T09:30:00Z', message: 'b' }, { timestamp: '2026-11-10T09:10:00Z', message: 'c' }] });
    const out = await createRenderLogs({ env: ENV, fetchImpl: f.fn, now: fixedNow }).recent();
    assert.deepEqual(out.items.map((i) => i.text), ['b', 'c', 'a']);
  });

  await test('the request names the owner and the service, reads backwards over the last 24 hours, and sends the key only in the header', async () => {
    const f = fakeFetch({ logs: [] });
    await createRenderLogs({ env: ENV, fetchImpl: f.fn, now: fixedNow }).recent({ text: 'error', limit: 20 });
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://api.render.com/v1/logs');
    assert.equal(u.searchParams.get('ownerId'), 'tea-xyz789');
    assert.equal(u.searchParams.get('resource'), 'srv-abc123');
    assert.equal(u.searchParams.get('direction'), 'backward');
    assert.equal(u.searchParams.get('limit'), '20');
    assert.equal(u.searchParams.get('text'), 'error');
    assert.equal(u.searchParams.get('endTime'), '2026-11-10T10:00:00.000Z');
    assert.equal(u.searchParams.get('startTime'), '2026-11-09T10:00:00.000Z');
    assert.ok(!f.calls[0].url.includes(KEY), 'the key is not in the URL');
    assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer ' + KEY);
  });

  await test('lines are masked like the in-app logs, get a level from labels or the words, and the key never appears in the answer', async () => {
    const f = fakeFetch({ logs: [
      { timestamp: '2026-11-10T09:00:00Z', message: 'connect postgres://app:hunter2@db.example/x failed', labels: [{ name: 'type', value: 'app' }] },
      { timestamp: '2026-11-10T09:01:00Z', message: 'Authorization: Bearer abc.def.ghi123 used', labels: [{ name: 'level', value: 'WARN' }] },
      { timestamp: '2026-11-10T09:02:00Z', message: 'plain request served' },
      { timestamp: '2026-11-10T09:03:00Z', message: 'config echoed rnd_9f8e7d6c5b4a3210zz and the key ' + KEY },
    ], hasMore: true });
    const out = await createRenderLogs({ env: ENV, fetchImpl: f.fn, now: fixedNow }).recent();
    assert.equal(out.items.length, 4);
    assert.ok(!JSON.stringify(out).includes('9f8e7d6c5b4a3210zz'), 'a bare Render-style key is masked too');
    assert.ok(!JSON.stringify(out).includes('hunter2') && !JSON.stringify(out).includes('abc.def.ghi123'), 'secrets are masked');
    assert.equal(out.items[0].level, 'error', 'failed is an error');
    assert.equal(out.items[0].source, 'app');
    assert.equal(out.items[1].level, 'warn', 'a label wins and is lowercased');
    assert.equal(out.items[2].level, 'info');
    assert.equal(out.hasMore, true);
    assert.ok(!JSON.stringify(out).includes(KEY));
    assert.equal(guessLevel('all good'), 'info');
  });

  await test('answers are kept for 30 seconds per filter, so reloading does not call Render again', async () => {
    const f = fakeFetch({ logs: [] });
    let t = fixedNow();
    const r = createRenderLogs({ env: ENV, fetchImpl: f.fn, now: () => t });
    await r.recent(); await r.recent();
    assert.equal(f.calls.length, 1);
    await r.recent({ text: 'other' });
    assert.equal(f.calls.length, 2, 'a different filter is a new request');
    t += 31000;
    await r.recent();
    assert.equal(f.calls.length, 3, 'after 30 seconds it asks again');
  });

  await test('a refused key or a silent Render gives a short message with no body, no key and no stack', async () => {
    const refused = await createRenderLogs({ env: ENV, fetchImpl: fakeFetch({ message: 'bad token ' + KEY }, 401).fn, now: fixedNow }).recent();
    assert.match(refused.error, /HTTP 401/);
    assert.ok(!JSON.stringify(refused).includes(KEY));
    const down = await createRenderLogs({ env: ENV, fetchImpl: fakeFetch({}, 'throw').fn, now: fixedNow }).recent();
    assert.match(down.error, /did not answer/);
    assert.ok(!JSON.stringify(down).includes(KEY) && !JSON.stringify(down).includes('socket hang up'));
  });

  console.log(`\n${passed} render history tests passed`);
})();
