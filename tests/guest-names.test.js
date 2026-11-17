'use strict';
const assert = require('node:assert/strict');
const n = require('../lib/guestNames');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }

(async () => {
  await test('a name is trimmed, cleaned and capped; empty becomes "Guest"', () => {
    assert.equal(n.cleanGuestName('  Anna   Lee  '), 'Anna Lee');
    assert.equal(n.cleanGuestName('<script>x</script>'), 'scriptxscript');
    assert.equal(n.cleanGuestName('a\u0000b\u0007c'), 'abc');
    assert.equal(n.cleanGuestName('   '), 'Guest');
    assert.equal(n.cleanGuestName(undefined), 'Guest');
    assert.equal(n.cleanGuestName('x'.repeat(50)).length, n.MAX_LEN);
  });

  await test('a free name is used as it is, case-insensitive checks are the caller\'s job', async () => {
    assert.equal(await n.pickGuestName('Sam', async () => false), 'Sam');
  });

  await test('a taken name gets a random four-digit number at the end', async () => {
    const taken = new Set(['sam']);
    const got = await n.pickGuestName('Sam', async (c) => taken.has(c.toLowerCase()));
    assert.match(got, /^Sam\d{4}$/);
  });

  await test('the suffix is never so long that the name goes over the cap', async () => {
    const long = 'x'.repeat(20);
    const got = await n.pickGuestName(long, async (c) => c.startsWith(long.slice(0, 5)) && c.length <= 20 && c !== '' && !/\d{4}$/.test(c));
    assert.ok(got.length <= n.MAX_LEN, got);
  });

  await test('when every try is taken, a longer random tail is still returned', async () => {
    const got = await n.pickGuestName('Sam', async () => true);
    assert.ok(got.length <= n.MAX_LEN && got.startsWith('Sam'), got);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
