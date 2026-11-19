'use strict';
require('./helpers/env');
// The home-menu order on a REAL PostgreSQL (throw-away database from tests/helpers/testdb.js): staff may set it, a plain player
// may not, a repeat of the same order is not audited, and the saved positions come back through listGameFlags.
// Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const testdb = require('./helpers/testdb');
const games = require('../games');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  try {
    process.env.DATABASE_URL = t.url;
    const dbAdmin = require('../db/admin');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;
    const staff = (await q(`INSERT INTO players (username, display_name, role) VALUES ('ordadmin', 'Admin', 'admin') RETURNING id`))[0].id;
    const player = (await q(`INSERT INTO players (username, display_name) VALUES ('ordplayer', 'Player') RETURNING id`))[0].id;
    const ids = games.list().map((g) => g.id);
    const reversed = ids.slice().reverse();

    console.log('game order');
    await test('staff save a full order; the positions come back from the database', async () => {
      await dbAdmin.setGameOrder({ actorId: staff, order: reversed });
      const rows = await dbAdmin.listGameFlags();
      const pos = new Map(rows.map((r) => [r.game_id, r.sort_order]));
      assert.equal(pos.get(reversed[0]), 0);
      assert.equal(pos.get(reversed[reversed.length - 1]), reversed.length - 1);
      const row = rows.find((r) => r.game_id === reversed[0]);
      assert.equal(row.access, 'on', 'a row made only for the order keeps the game open');
      assert.equal(row.enabled, true);
    });

    await test('the same order again is not audited a second time', async () => {
      const before = (await q(`SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'game.order'`))[0].n;
      await dbAdmin.setGameOrder({ actorId: staff, order: reversed });
      const after = (await q(`SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = 'game.order'`))[0].n;
      assert.equal(after, before);
    });

    await test('a change is audited with the actor and the new order', async () => {
      await dbAdmin.setGameOrder({ actorId: staff, order: ids });
      const row = (await q(`SELECT actor_id, detail FROM admin_audit_log WHERE action = 'game.order' ORDER BY id DESC LIMIT 1`))[0];
      assert.equal(row.actor_id, staff);
      assert.deepEqual(row.detail.order, ids);
    });

    await test('a player who is not staff cannot change the order', async () => {
      await assert.rejects(dbAdmin.setGameOrder({ actorId: player, order: reversed }), (e) => e.status === 403 || /Admin access/.test(e.message));
    });

    await test('an existing game switch keeps its access when the order changes', async () => {
      await dbAdmin.setGameFlag({ actorId: staff, gameId: ids[0], access: 'owner' });
      await dbAdmin.setGameOrder({ actorId: staff, order: reversed });
      const row = (await dbAdmin.listGameFlags()).find((r) => r.game_id === ids[0]);
      assert.equal(row.access, 'owner');
      assert.equal(row.enabled, false);
    });
  } finally {
    await t.drop();
  }
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
