'use strict';
require('./helpers/env');
// A blocker's reconnect while the other player's block is still being written (PostgreSQL, throw-away database).
// A pending block must never remove a seated player from a running game. Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 30000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(25); }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });
const PW = 'TestPass123!';

function socket(port, cookie) {
  const c = { msgs: [], closed: null, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } }) };
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'hello' })));
  c.ws.on('message', (raw) => c.msgs.push(JSON.parse(raw)));
  c.ws.on('close', (code) => { c.closed = code; });
  c.ws.on('error', () => {});
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.welcome = () => c.msgs.find((m) => m.t === 'welcome');
  c.notices = () => c.msgs.filter((m) => m.t === 'notice').map((m) => m.text);
  c.left = () => c.msgs.some((m) => m.t === 'left');
  c.lastRoom = () => { const s = c.msgs.filter((m) => m.t === 'state').pop(); return s && s.room; };
  return c;
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  let srv = null;
  const sockets = [];
  let restore = () => {};
  try {
    process.env.DATABASE_URL = t.url;
    const dbModeration = require('../db/moderation');
    const { start } = require('../server');
    const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet() };
    srv = await start(fast);
    let seq = 1;
    const newUser = async (tag) => {
      const email = `${tag.toLowerCase()}.brc.${seq++}@test.local`;
      const u = await registerAndVerify(srv.port, { email, username: `${tag.toLowerCase()}brc${seq}`.slice(0, 24), displayName: tag, password: PW });
      const me = (await u.browser.get('/api/auth/session')).json.player;
      return { ...u, id: me.id, cookie: u.browser.cookieHeader };
    };
    const A = await newUser('Alpha');
    const B = await newUser('Beta');
    const C = await newUser('Gamma');
    const sa = socket(srv.port, A.cookie); sockets.push(sa);
    let sb = socket(srv.port, B.cookie); sockets.push(sb);
    const sc = socket(srv.port, C.cookie); sockets.push(sc);
    await until(() => sa.welcome() && sb.welcome() && sc.welcome(), 'welcome');
    sa.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    const code = (await until(() => sa.lastRoom(), 'table')).code;
    sb.send({ t: 'join', code });
    sc.send({ t: 'join', code });
    await until(() => sb.lastRoom() && sc.lastRoom(), 'others at the table');
    sa.send({ t: 'start' });
    await until(() => sa.lastRoom() && sa.lastRoom().status === 'playing', 'game running');
    const seated = (who) => sa.lastRoom().members.some((m) => m.id === who.id && !m.bot);

    await test('a seated blocker keeps the seat when reconnecting while the other player\'s block is still being written', async () => {
      // B has a COMMITTED block against C (a seated player in a running game may finish, so C keeps the seat too).
      sb.send({ t: 'block', id: C.id });
      await until(() => sb.notices().some((n) => /Blocked/.test(n)), 'B block committed');
      // C's block against B is held in the database write, so it is pending while B reconnects.
      const realAdd = dbModeration.addBlock;
      let release;
      const gate = new Promise((r) => { release = r; });
      dbModeration.addBlock = async (blockerId, blockedId) => {
        if (blockerId === C.id && blockedId === B.id) await gate;
        return realAdd(blockerId, blockedId);
      };
      restore = () => { dbModeration.addBlock = realAdd; };
      sc.send({ t: 'block', id: B.id });
      await sleep(400); // the pending reservation is in place on the server

      sb.ws.close();
      sb = socket(srv.port, B.cookie); sockets.push(sb);
      await until(() => sb.welcome(), 'B welcome after reconnect');
      await until(() => sb.closed === 4003, 'B socket closed for the pending block');
      assert.equal(sb.left(), false, 'no "left" message for B');
      assert.ok(seated(B), 'B is still seated while the block is pending');
      assert.equal(sa.lastRoom().status, 'playing', 'the game is still running');

      release();
      await until(() => sc.notices().some((n) => /Blocked/.test(n)), 'C block committed');
      await sleep(200);
      assert.ok(seated(B), 'B is still seated after the pending block committed (the running game may finish)');
      assert.equal(sa.lastRoom().status, 'playing', 'the game is still running');
      restore();
    });

    console.log(`${passed} block-reconnect checks passed`);
  } finally {
    restore();
    for (const s of sockets) s.ws.close();
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL block-reconnect', e); process.exit(1); });
