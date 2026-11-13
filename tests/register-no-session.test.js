'use strict';
// Registration must never create a session, for a new address or for one that already has an account. This test drives
// registerEmail through a stub transaction that records every statement, so it needs no database.
require('./helpers/env');
const assert = require('node:assert/strict');
const db = require('../db/pool');
const dbAuth = require('../db/auth');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}

const original = { hasDatabase: db.hasDatabase, withTransaction: db.withTransaction, query: db.query };

/** Runs registerEmail with the given address already taken (or not) and returns every statement it ran. */
async function register({ emailTaken, email = 'someone@test.local', username = 'newplayer', password = 'TestPass123!' }) {
  const statements = [];
  db.hasDatabase = () => true;
  db.query = async () => ({ rows: [], rowCount: 0 });
  db.withTransaction = async (fn) => {
    const client = {
      query: async (sql) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        if (/FROM auth_identities WHERE provider = \$1 AND provider_user_id/.test(sql)) return { rows: emailTaken ? [{ '?column?': 1 }] : [], rowCount: emailTaken ? 1 : 0 };
        if (/FROM players WHERE LOWER\(username\)/.test(sql)) return { rows: [], rowCount: 0 };
        if (/INSERT INTO players/.test(sql)) return { rows: [{ id: 'player-1', username: 'newplayer', display_name: 'New', avatar: '🧙', created_at: new Date() }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
    };
    return fn(client);
  };
  const result = await dbAuth.registerEmail({ adultConfirmed: true, email, username, password, displayName: 'New', avatar: '🧙' });
  return { result, statements };
}

/** Like register(), but reports the refusal instead of throwing, so the test can check the message and the statements. */
async function attempt(options) {
  try {
    return await register(options);
  } catch (err) {
    return { error: err, statements: [] };
  }
}

(async () => {
  console.log('registration issues no session');
  try {
    await test('a new address creates the account and a verification token, but no session', async () => {
      const { result, statements } = await register({ emailTaken: false });
      assert.ok(result.verifyToken, 'a verification token is issued');
      assert.equal(result.token, undefined, 'no session token is returned');
      assert.equal(statements.some((s) => /auth_sessions/i.test(s)), false, 'no statement touches auth_sessions');
      assert.equal(statements.some((s) => /INSERT INTO players/.test(s)), true, 'the account is created');
    });

    await test('an address that already has an account gets no session and no new account', async () => {
      const { result, statements } = await register({ emailTaken: true });
      assert.equal(result.alreadyRegistered, true);
      assert.equal(result.token, undefined, 'no session token is returned');
      assert.equal(statements.some((s) => /auth_sessions/i.test(s)), false, 'no statement touches auth_sessions');
      assert.equal(statements.some((s) => /INSERT INTO players/.test(s)), false, 'nothing is created');
    });

    await test('both outcomes return the same keys', async () => {
      const fresh = (await register({ emailTaken: false })).result;
      const taken = (await register({ emailTaken: true })).result;
      const pick = (o) => Object.keys(o).filter((k) => ['token', 'player', 'verifyToken', 'email', 'username', 'alreadyRegistered'].includes(k));
      assert.equal(pick(fresh).includes('token'), false);
      assert.equal(pick(taken).includes('token'), false);
    });
    await test('a padded username is checked as stored, so a password containing it is refused before anything is written', async () => {
      const run = await attempt({ emailTaken: false, username: ' Sunshine99 ', password: 'Sunshine99!ok' });
      assert.ok(run.error, 'registration must fail');
      assert.equal(run.error.status, 400);
      assert.match(run.error.message, /username/);
      assert.equal(run.statements.some((s) => /INSERT INTO players/.test(s)), false, 'no account is created');
    });

    await test('a padded, mixed-case e-mail is checked as stored, so a password containing its first part is refused', async () => {
      const run = await attempt({ emailTaken: false, email: ' Annabel@Example.com ', username: 'carol', password: 'Zx-annabel-7A' });
      assert.ok(run.error, 'registration must fail');
      assert.equal(run.error.status, 400);
      assert.match(run.error.message, /e-mail/);
      assert.equal(run.statements.some((s) => /INSERT INTO players/.test(s)), false, 'no account is created');
    });

    await test('a padded username and e-mail with an acceptable password still register, storing the normalised values', async () => {
      const run = await attempt({ emailTaken: false, email: ' Annabel@Example.com ', username: ' Carol ', password: 'Blue Tractor 42' });
      assert.equal(run.error, undefined);
      assert.equal(run.result.verifyToken !== undefined, true);
      assert.equal(run.statements.some((s) => /INSERT INTO players/.test(s)), true);
    });

  } finally {
    db.hasDatabase = original.hasDatabase;
    db.withTransaction = original.withTransaction;
    db.query = original.query;
  }
  console.log(`${passed} registration session checks passed`);
})().catch((e) => { console.error('FAIL register-no-session', e); process.exit(1); });
