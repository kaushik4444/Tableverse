'use strict';
// Visit-length buckets and the hour-of-day shift behind the "When people open the site" chart. The SQL runs in tests/admin.pg.test.js.
const assert = require('node:assert/strict');
const { lengthBucket, METRICS, createAnalytics } = require('../lib/analytics');
const { shiftHours, zoneOffsetMinutes, LENGTHS } = require('../db/sessionStats');
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed += 1; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n' + (e && e.stack)); process.exitCode = 1; } };
const hours = (map) => { const a = Array(24).fill(0); for (const [h, v] of Object.entries(map)) a[h] = v; return a; };

(async () => {
  await test('visits under three seconds are not counted; the others fall into their bucket at the edges', () => {
    assert.equal(lengthBucket(0), null); assert.equal(lengthBucket(2.9), null); assert.equal(lengthBucket(NaN), null);
    assert.deepEqual([3, 59.9, 60, 299, 300, 899, 900, 3599, 3600, 86400].map(lengthBucket), ['lt1m', 'lt1m', '1_5m', '1_5m', '5_15m', '5_15m', '15_60m', '15_60m', 'gt60m', 'gt60m']);
    assert.deepEqual(LENGTHS.map((l) => l[0]), ['lt1m', '1_5m', '5_15m', '15_60m', 'gt60m'], 'every bucket has a label');
  });
  await test('the zone offset follows daylight saving: Germany is +1 in winter and +2 in summer, India is +5:30 all year', () => {
    assert.equal(zoneOffsetMinutes('UTC'), 0);
    assert.equal(zoneOffsetMinutes('Europe/Berlin', new Date('2026-11-12T12:00:00Z')), 60);
    assert.equal(zoneOffsetMinutes('Europe/Berlin', new Date('2026-07-12T12:00:00Z')), 120);
    assert.equal(zoneOffsetMinutes('Asia/Kolkata', new Date('2026-11-12T12:00:00Z')), 330);
  });
  await test('shifting whole hours moves them round midnight, and keeps the total', () => {
    assert.deepEqual(shiftHours(hours({ 19: 10 }), 60), hours({ 20: 10 }));
    assert.deepEqual(shiftHours(hours({ 23: 4 }), 60), hours({ 0: 4 }), 'wraps past midnight');
    assert.deepEqual(shiftHours(hours({ 0: 4 }), -60), hours({ 23: 4 }), 'and back');
  });
  await test('India\'s half hour splits each UTC hour evenly over two local hours', () => {
    const out = shiftHours(hours({ 10: 10 }), 330);
    assert.equal(out[15], 5); assert.equal(out[16], 5); assert.equal(out.reduce((a, b) => a + b, 0), 10);
  });
  await test('the server may count the two new metrics, and an unknown one is still ignored', async () => {
    assert.ok(METRICS.includes('session_hour') && METRICS.includes('session_len'));
    const rows = []; const a = createAnalytics({ store: { addCounters: async (r) => { rows.push(...r); }, addActive: async () => {} }, log: { warn() {}, error() {}, log() {} } });
    a.track('session_hour', '19'); a.track('session_len', '5_15m'); a.track('nonsense', 'x'); await a.flush(); await a.close();
    const dims = rows.map((r) => r.metric + ':' + r.dim).sort();
    assert.deepEqual(dims.filter((d) => !d.startsWith('nonsense')), ['session_hour:19', 'session_len:5_15m']);
    assert.ok(!dims.some((d) => d.startsWith('nonsense')));
  });
  console.log(`${passed} session statistics tests passed`);
})();
