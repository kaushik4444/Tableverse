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
    await test('plays can be read without counting them', async () => {
      assert.equal(await trials.playsOf(deviceA, 'chess'), 3);
      assert.equal(await trials.playsOf(deviceA, 'chess'), 3, 'reading changes nothing');
      assert.equal(await trials.playsOf(deviceB, 'nothing-yet'), 0, 'a device with no plays has 0');
    });
    await test('a play given back is counted again, and a cancelled start can be undone', async () => {
      const before = await trials.playsOf(deviceA, 'chess');
      await trials.releasePlays({ gameId: 'chess', trialKeys: [deviceA] });
      assert.equal(await trials.playsOf(deviceA, 'chess'), before - 1);
      assert.deepEqual(await trials.reservePlays({ gameId: 'chess', limit: 3, trialKeys: [deviceA] }), { ok: true }, 'the play can be used again');
      assert.equal(await trials.playsOf(deviceA, 'chess'), before);
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
    await test('a guest who registers is no longer counted by device', async () => {
      const upgraded = await guest('Upgraded', deviceB);
      await q('UPDATE players SET is_anonymous = FALSE WHERE id = $1', [upgraded]);
      assert.equal((await trials.trialKeysFor([upgraded])).has(upgraded), false);
    });
    await test('the owner sets a per-game guest limit: a repeat is not audited, and the limit can be removed', async () => {
      const admin = require('../db/admin');
      const owner = (await q(`INSERT INTO players (username, display_name) VALUES ('trialowner', 'Owner') RETURNING id`))[0].id;
      const row = async () => (await q('SELECT guest_trial_limit, access FROM game_flags WHERE game_id = $1', ['ludo']))[0];
      const audits = async () => (await q("SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'game.trial_limit'"))[0].n;
      await admin.setGameTrialLimit({ actorId: owner, gameId: 'ludo', limit: 3 });
      assert.equal((await row()).guest_trial_limit, 3);
      assert.equal((await row()).access, 'on', 'a new row keeps the game open to everybody');
      const before = await audits();
      await admin.setGameTrialLimit({ actorId: owner, gameId: 'ludo', limit: 3 });
      assert.equal(await audits(), before, 'a repeat changes nothing and is not audited');
      await admin.setGameTrialLimit({ actorId: owner, gameId: 'ludo', limit: null });
      assert.equal((await row()).guest_trial_limit, null);
      assert.equal(await audits(), before + 1, 'the change is audited once');
    });
  } finally {
    await t.drop();
  }
  console.log(`${passed} guest trial tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
