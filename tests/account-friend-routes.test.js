'use strict';
require('./helpers/env');
// Account and friends routes in memory mode (no PostgreSQL): every route that needs an account refuses a visitor with 401,
// and every POST refuses a request without the CSRF token. The authenticated paths are covered by the PostgreSQL tests.
const assert = require('node:assert/strict');
const db = require('../db/pool');
const { start } = require('../server');
const { Browser } = require('./helpers/auth');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet() };

// routes that need a signed-in account: GET ones and POST ones
const GET_ACCOUNT = ['/api/me/profile', '/api/me/history?page=1', '/api/me/recent', '/api/me/friends', '/api/me/friends/search?q=bo', '/api/me/friend-requests', '/api/me/table-invitations'];
const POST_ACCOUNT = [
  ['/api/me/recent/clear', {}],
  ['/api/me/delete-account', { password: 'x' }],
  ['/api/me/display-name', { displayName: 'Bo' }],
  ['/api/me/country', { country: 'DE' }],
  ['/api/me/avatar', { avatar: '🦊' }],
  ['/api/me/friend-requests', { username: 'bo' }],
  ['/api/me/friend-requests/accept', { username: 'bo' }],
  ['/api/me/friends/remove', { username: 'bo' }],
  ['/api/me/table-invitations', { username: 'bo', code: 'ABCDEF' }],
];

(async () => {
  if (db.hasDatabase()) { console.log('account and friends route (memory) checks skipped: DATABASE_URL is set'); return; }
  const srv = await start({ ...fast, env: { ...process.env } });
  try {
    for (const path of GET_ACCOUNT) {
      await test(`GET ${path.split('?')[0]} refuses a visitor with 401`, async () => {
        const r = await new Browser(srv.port).get(path);
        assert.equal(r.status, 401, `expected 401, got ${r.status}`);
        assert.equal(r.json.ok, false);
      });
    }
    for (const [path, body] of POST_ACCOUNT) {
      await test(`POST ${path} refuses a visitor with 401`, async () => {
        const b = new Browser(srv.port);
        await b.get('/api/auth/csrf'); // a real browser has the CSRF cookie, so only the account check can refuse it
        const r = await b.post(path, body);
        assert.equal(r.status, 401, `expected 401, got ${r.status}`);
      });
      await test(`POST ${path} without the CSRF header is refused`, async () => {
        // the CSRF cookie is present, so only the missing header can cause the 403
        const b = new Browser(srv.port);
        await b.get('/api/auth/csrf');
        const r = await b.post(path, body, { csrf: false });
        assert.equal(r.status, 403, `expected the CSRF refusal (403), got ${r.status}`);
      });
    }
    await test('a bad JSON body on a POST is refused, not a server error', async () => {
      // a real visitor with a valid CSRF cookie and header, so the request reaches the JSON parser
      const b = new Browser(srv.port);
      await b.get('/api/auth/csrf');
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: b.cookieHeader, 'x-csrf-token': b.cookies.get('ct_csrf') }, body: '{not json' });
      assert.ok(res.status >= 400 && res.status < 500, `expected a client error, got ${res.status}`);
    });
    await test('an unknown account route is 404, not a crash', async () => {
      const r = await new Browser(srv.port).get('/api/me/does-not-exist');
      assert.equal(r.status, 404);
    });
  } finally { await srv.close(); }
  console.log(`account and friends routes: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
