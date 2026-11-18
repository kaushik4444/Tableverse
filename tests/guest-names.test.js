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

  await test('international names, digits, underscores and hyphens survive cleaning', () => {
    assert.equal(n.cleanGuestName('  Zoë 李_٧-9  '), 'Zoë 李_٧-9');
    for (const raw of [null, '', '!!!', '🎲', '\u0000\u007f']) assert.equal(n.cleanGuestName(raw), 'Guest');
    assert.equal(n.cleanGuestName('x'.repeat(19) + ' y'), 'x'.repeat(19), 'trim a space at the truncation boundary');
  });

  await test('collision checks receive the cleaned name and stop at the first free suffix', async () => {
    const checked = [];
    const name = await n.pickGuestName('  ' + 'x'.repeat(30) + '  ', async (candidate) => {
      checked.push(candidate);
      return checked.length < 4;
    });
    assert.equal(checked[0], 'x'.repeat(20));
    assert.equal(checked.length, 4);
    for (const candidate of checked.slice(1)) assert.match(candidate, /^x{16}[1-9][0-9]{3}$/);
    assert.equal(name, checked[3]);
  });

  await test('collision exhaustion has a bounded number of lookups and a six-digit fallback', async () => {
    let calls = 0;
    const name = await n.pickGuestName('x'.repeat(30), async () => { calls++; return true; });
    assert.equal(calls, 7, 'one base lookup and six suffix attempts');
    assert.match(name, /^x{14}[1-9][0-9]{3}[1-9][0-9]$/);
  });

  await test('a failed availability lookup rejects instead of issuing an unchecked name', async () => {
    const error = new Error('lookup unavailable');
    for (const failAt of [1, 2]) {
      let calls = 0;
      await assert.rejects(n.pickGuestName('Sam', async () => {
        if (++calls === failAt) throw error;
        return true;
      }), (actual) => actual === error);
      assert.equal(calls, failAt);
    }
    assert.equal(await n.pickGuestName(), 'Guest', 'the default lookup accepts the fallback name');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
