'use strict';
// Password reset must change exactly one identity row. If it changes none, the whole transaction rolls back: the reset
// link is not spent, sessions are not revoked, and the user is told to ask for a new link. Uses a stub client that
// mirrors db.withTransaction (BEGIN, COMMIT on success, ROLLBACK on throw), so no database is needed.
require('./helpers/env');
const assert = require('node:assert/strict');
const db = require('../db/pool');
const dbAuth = require('../db/auth');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const original = { hasDatabase: db.hasDatabase, withTransaction: db.withTransaction };

/** Runs resetPassword against a scripted client. identityRowCount is what the identity UPDATE reports. */
async function runReset(identityRowCount) {
  const statements = [];
  const outcome = { committed: false, rolledBack: false };
  db.hasDatabase = () => true;
  db.withTransaction = async (fn) => {
    const client = {
      query: async (sql) => {
        const head = sql.trim().split(/\s+/).slice(0, 2).join(' ');
        statements.push(head);
        if (/UPDATE auth_email_tokens/.test(sql)) return { rows: [{ player_id: 'player-1', email: 'user@example.test' }], rowCount: 1 };
        if (/UPDATE auth_identities/.test(sql)) return { rows: [], rowCount: identityRowCount };
        return { rows: [], rowCount: 1 };
      },
    };
    try {
      const result = await fn(client);
      outcome.committed = true;
      return result;
    } catch (err) {
      outcome.rolledBack = true;
      throw err;
    }
  };
  try {
    const result = await dbAuth.resetPassword({ token: 'a-reset-token-for-tests', newPassword: 'NewPass123!' });
    return { result, statements, outcome };
  } catch (err) {
    return { error: err, statements, outcome };
  }
}

(async () => {
  console.log('password reset identity check');

  await test('an identity row that did not change rejects the reset and rolls everything back', async () => {
    const run = await runReset(0);
    assert.ok(run.error, 'resetPassword must fail');
    assert.match(run.error.message, /can no longer be used/);
    assert.equal(run.error.status, 400);
    assert.equal(run.outcome.rolledBack, true, 'the transaction must roll back');
    assert.equal(run.outcome.committed, false, 'nothing may be committed');
  });

  await test('a failed identity update never revokes sessions', async () => {
    const run = await runReset(0);
    assert.ok(run.statements.some((s) => s === 'UPDATE auth_identities'), 'the identity update was attempted');
    assert.equal(run.statements.some((s) => s === 'UPDATE auth_sessions'), false, 'sessions must not be revoked');
  });

  await test('exactly one identity row changing succeeds and revokes sessions', async () => {
    const run = await runReset(1);
    assert.equal(run.error, undefined);
    assert.deepEqual(run.result, { ok: true, playerId: 'player-1' });
    assert.equal(run.outcome.committed, true);
    assert.equal(run.statements.includes('UPDATE auth_sessions'), true);
  });

  await test('more than one identity row changing is also refused', async () => {
    const run = await runReset(2);
    assert.ok(run.error, 'two rows is not the single account the token was issued for');
    assert.equal(run.outcome.rolledBack, true);
  });

  db.hasDatabase = original.hasDatabase;
  db.withTransaction = original.withTransaction;
  console.log(`${passed} reset identity checks passed`);
})();
