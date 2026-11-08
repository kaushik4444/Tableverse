'use strict';
// The shared rate limiter in memory mode: counts, refunds of reserved attempts, concurrency and separate scopes.
// The PostgreSQL variant of the same rules is in login-throttle.pg.test.js.
require('./helpers/env');
const assert = require('node:assert/strict');
const db = require('../db/pool');
const { hitRateLimit, refundRateLimit } = require('../db/rateLimit');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  if (db.hasDatabase()) { console.log('rate limit (memory) checks skipped: DATABASE_URL is set'); return; }
  const H = 60 * 60 * 1000;
  let n = 0;
  const key = () => 'k' + (++n) + '-' + Math.random(); // a fresh counter per check

  await test('the limit is enforced: the attempt past the limit is refused', async () => {
    const k = key();
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await hitRateLimit({ scope: 's', key: k, limit: 3, windowMs: H })).allowed);
    assert.deepEqual(results, [true, true, true, false]);
  });

  await test('a refund gives back one reserved attempt, and never below zero', async () => {
    const k = key();
    for (let i = 0; i < 3; i++) await hitRateLimit({ scope: 's', key: k, limit: 3, windowMs: H });
    await refundRateLimit({ scope: 's', key: k, windowMs: H });
    assert.equal((await hitRateLimit({ scope: 's', key: k, limit: 3, windowMs: H })).allowed, true, 'the refunded attempt is free again');
    for (let i = 0; i < 10; i++) await refundRateLimit({ scope: 's', key: 'never-used-' + i, windowMs: H });
    assert.equal((await hitRateLimit({ scope: 's', key: 'never-used-0', limit: 1, windowMs: H })).allowed, true, 'refunding an empty counter does nothing');
    // a refund names the window the attempt was counted in: a refund for another window does not free a slot in this one
    const k2 = 'bucket-' + Math.random();
    const first = await hitRateLimit({ scope: 's', key: k2, limit: 1, windowMs: H });
    assert.equal(first.allowed, true);
    await refundRateLimit({ scope: 's', key: k2, windowMs: H, bucket: (first.bucket || 0) + H });
    assert.equal((await hitRateLimit({ scope: 's', key: k2, limit: 1, windowMs: H })).allowed, false, 'a refund for a different window changes nothing');
    await refundRateLimit({ scope: 's', key: k2, windowMs: H, bucket: first.bucket });
    assert.equal((await hitRateLimit({ scope: 's', key: k2, limit: 1, windowMs: H })).allowed, true, 'the refund for the counted window frees it');
  });

  await test('concurrent attempts cannot get past the limit together', async () => {
    const k = key();
    const outs = await Promise.all(Array.from({ length: 50 }, () => hitRateLimit({ scope: 's', key: k, limit: 10, windowMs: H })));
    assert.equal(outs.filter((o) => o.allowed).length, 10, 'exactly the limit is allowed, however many arrive at once');
  });

  await test('different scopes are separate counters, even for the same key', async () => {
    const k = key();
    for (let i = 0; i < 3; i++) await hitRateLimit({ scope: 'auth:login:ip', key: k, limit: 3, windowMs: H });
    assert.equal((await hitRateLimit({ scope: 'auth:login:ip', key: k, limit: 3, windowMs: H })).allowed, false);
    assert.equal((await hitRateLimit({ scope: 'auth:forgot:ip', key: k, limit: 3, windowMs: H })).allowed, true, 'password recovery is not blocked by failed logins');
  });

  await test('an invalid configuration is rejected rather than silently allowed', async () => {
    await assert.rejects(hitRateLimit({ scope: '', key: 'x', limit: 1, windowMs: H }));
    await assert.rejects(refundRateLimit({ scope: 's', key: '', windowMs: H }));
  });

  console.log(`${passed} rate limit checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
