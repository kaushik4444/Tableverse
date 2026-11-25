'use strict';
require('./helpers/env');
// Game trials for guests on a REAL PostgreSQL (throw-away database from tests/helpers/testdb.js). A device gets `limit` plays
// of a game; a start that would take any guest seat over the limit counts nothing; each game counts on its own; and a
// device's count is found through its hashed trial key. Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  try {
    process.env.DATABASE_URL = t.url;
    await require('../db/migrate').migrate();
    const trials = require('../db/guestTrials');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const guest = async (name, key) => (await q(`INSERT INTO players (username, display_name, is_anonymous, guest_trial_key) VALUES (NULL, $1, TRUE, $2) RETURNING id`, [name, key]))[0].id;
    const deviceA = trials.hashTrialKey('cookie-a');
    const deviceB = trials.hashTrialKey('cookie-b');
    const count = async (key, game) => (await q('SELECT plays FROM guest_game_trials WHERE trial_key = $1 AND game_id = $2', [key, game]))[0]?.plays ?? 0;

    console.log('guest game trials');
    await test('the hash is stable and never the raw cookie', () => {
      assert.equal(trials.hashTrialKey('cookie-a'), deviceA);
      assert.notEqual(deviceA, 'cookie-a');
      assert.match(deviceA, /^[0-9a-f]{64}$/);
    });
    await test('a device gets its plays up to the limit, and the next start is refused', async () => {
      for (let i = 1; i <= 3; i++) assert.deepEqual(await trials.reservePlays({ gameId: 'chess', limit: 3, trialKeys: [deviceA] }), { ok: true });
      assert.equal(await count(deviceA, 'chess'), 3);
      assert.deepEqual(await trials.reservePlays({ gameId: 'chess', limit: 3, trialKeys: [deviceA] }), { ok: false, trialKey: deviceA });
      assert.equal(await count(deviceA, 'chess'), 3, 'a refused start counts nothing');
    });
    await test('one guest at the limit refuses the whole start, and the other guests are not counted', async () => {
      const r = await trials.reservePlays({ gameId: 'chess', limit: 3, trialKeys: [deviceB, deviceA] });
      assert.deepEqual(r, { ok: false, trialKey: deviceA });
      assert.equal(await count(deviceB, 'chess'), 0, 'the device with room was rolled back too');
    });
    await test('each game has its own count', async () => {
      assert.deepEqual(await trials.reservePlays({ gameId: 'ludo', limit: 3, trialKeys: [deviceA] }), { ok: true });
      assert.equal(await count(deviceA, 'ludo'), 1);
    });
    await test('a limit must be a whole number from 1 to 9', async () => {
      await assert.rejects(() => trials.reservePlays({ gameId: 'chess', limit: 0, trialKeys: [deviceB] }));
      await assert.rejects(() => trials.reservePlays({ gameId: 'chess', limit: 10, trialKeys: [deviceB] }));
      await assert.rejects(() => trials.reservePlays({ gameId: 'chess', limit: 2.5, trialKeys: [deviceB] }));
    });
    await test('trial keys are found for guests only, and bot seats are skipped', async () => {
      const g = await guest('Keyed', deviceB);
      const registered = (await q(`INSERT INTO players (username, display_name) VALUES ('trialuser', 'Reg') RETURNING id`))[0].id;
      const found = await trials.trialKeysFor([g, registered, 'bot-seat-1']);
      assert.equal(found.get(g), deviceB);
      assert.equal(found.has(registered), false);
      assert.equal(found.size, 1);
    });
  } finally {
    await t.drop();
  }
  console.log(`${passed} guest trial tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
