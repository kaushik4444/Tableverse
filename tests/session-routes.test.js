'use strict';
require('./helpers/env');
// Session routes in memory mode (no PostgreSQL): malformed tokens are refused, logout revokes, and the session and
// logout routes are rate limited per address. The PostgreSQL variant is in session-lifecycle.pg.test.js.
const assert = require('node:assert/strict');
const db = require('../db/pool');
const dbPlayers = require('../db/players');
const { start } = require('../server');
const { Browser } = require('./helpers/auth');
const { resetMemoryCountersForTests } = require('../db/rateLimit');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet() };

(async () => {
  if (db.hasDatabase()) { console.log('session route (memory) checks skipped: DATABASE_URL is set'); return; }

  await test('a malformed token is refused without a lookup, and a well-formed one is accepted', async () => {
    assert.equal(await dbPlayers.authenticateToken('abc'), null);
    assert.equal(await dbPlayers.authenticateToken("' OR 1=1 --"), null);
    assert.equal(await dbPlayers.authenticateToken('A'.repeat(64)), null, 'upper case hex is not a token we issue');
    const { rawToken, player } = await dbPlayers.createAnonymousPlayer({ displayName: 'Format', avatar: '🧙' });
    assert.equal(rawToken.length, 64);
    assert.equal((await dbPlayers.authenticateToken(rawToken)).id, player.id);
  });

  await test('the session route answers signed in for a live session and signed out after logout', async () => {
    const srv = await start({ ...fast, env: { ...process.env, RL_SESSION_IP_LIMIT: '1000', RL_LOGOUT_IP_LIMIT: '1000' } });
    try {
      const { rawToken } = await dbPlayers.createAnonymousPlayer({ displayName: 'Live', avatar: '🧙' });
      const b = new Browser(srv.port);
      await b.csrf();
      b.cookies.set('ct_session', rawToken);
      assert.equal((await b.get('/api/auth/session')).json.authenticated, true);
      assert.equal((await b.get('/api/auth/session')).json.authenticated, true, 'still signed in on the next read');
      const out = await b.post('/api/auth/logout', {});
      assert.equal(out.status, 200);
      assert.equal((await b.get('/api/auth/session')).json.authenticated, false, 'a logged out session no longer counts as signed in');
      assert.equal(await dbPlayers.authenticateToken(rawToken), null, 'and no socket can use it either');
    } finally { await srv.close(); }
  });

  await test('a malformed session cookie is treated as signed out, not as a lookup', async () => {
    const srv = await start({ ...fast, env: { ...process.env, RL_SESSION_IP_LIMIT: '1000' } });
    try {
      const b = new Browser(srv.port);
      await b.csrf();
      b.cookies.set('ct_session', 'not-hex-and-too-short');
      const r = await b.get('/api/auth/session');
      assert.equal(r.status, 200);
      assert.equal(r.json.authenticated, false);
    } finally { await srv.close(); }
  });

  await test('the session route is rate limited per address', async () => {
    resetMemoryCountersForTests();
    const srv = await start({ ...fast, env: { ...process.env, RL_SESSION_IP_LIMIT: '3' } });
    try {
      const b = new Browser(srv.port);
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await b.get('/api/auth/session')).status);
      assert.deepEqual(codes, [200, 200, 200, 429]);
      const blocked = await b.get('/api/auth/session');
      assert.ok(Number(blocked.headers.get('retry-after')) >= 1, 'the refusal says when to try again');
    } finally { await srv.close(); }
  });

  await test('logout is rate limited per address', async () => {
    resetMemoryCountersForTests();
    const srv = await start({ ...fast, env: { ...process.env, RL_LOGOUT_IP_LIMIT: '2' } });
    try {
      const b = new Browser(srv.port);
      await b.csrf();
      const codes = [];
      for (let i = 0; i < 3; i++) codes.push((await b.post('/api/auth/logout', {})).status);
      assert.deepEqual(codes, [200, 200, 429]);
    } finally { await srv.close(); }
  });

  console.log(`${passed} session route checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
