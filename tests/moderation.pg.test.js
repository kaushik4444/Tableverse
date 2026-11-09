'use strict';
require('./helpers/env');
// Chat blocks and reports on a REAL PostgreSQL, through the running server over WebSockets (throw-away database from
// tests/helpers/testdb.js). Runs only with TEST_DATABASE_URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const { Browser, registerAndVerify } = require('./helpers/auth');
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A WebSocket that authenticates with the session cookie only, as a browser does. */
function socket(port, cookie) {
  const c = { msgs: [], closed: null, room: null, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } }) };
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'hello' })));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'state') c.room = m.room;
  });
  c.ws.on('close', (code) => { c.closed = code; });
  c.ws.on('error', () => {});
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.welcome = () => c.msgs.find((m) => m.t === 'welcome');
  c.texts = () => c.msgs.filter((m) => m.t === 'chat').map((m) => m.m.text);
  c.messageOf = (text) => { const hit = c.msgs.find((m) => m.t === 'chat' && m.m.text === text); return hit && hit.m; };
  c.notices = () => c.msgs.filter((m) => m.t === 'notice').map((m) => m.text);
  c.errors = () => c.msgs.filter((m) => m.t === 'error').map((m) => m.message);
  c.lastChatlog = () => c.msgs.filter((m) => m.t === 'chatlog').pop();
  return c;
}

(async () => {
  const t = await testdb.create(); // exits (SKIPPED) when PostgreSQL tests are not configured
  let srv = null;
  let sa = null;
  let sb = null;
  let sc = null;
  try {
    process.env.DATABASE_URL = t.url;
    const dbAccount = require('../db/account');
    const dbModeration = require('../db/moderation');
    const { start } = require('../server');
    const x = await t.client();
    const q = async (sql, params) => (await x.query(sql, params)).rows;

    const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchRetryDelays: [20, 40, 80], matchLog: quiet() };
    srv = await start(fast);
    let seq = 1;
    const newUser = async (tag) => {
      const email = `${tag.toLowerCase()}.mod.${seq++}@test.local`;
      const username = `${tag.toLowerCase()}mod${seq}`.slice(0, 24);
      const u = await registerAndVerify(srv.port, { email, username, displayName: tag, password: PW });
      const me = (await u.browser.get('/api/auth/session')).json.player;
      return { ...u, email, id: me.id, cookie: u.browser.cookieHeader };
    };
    // Chat is rate limited per player (500 ms), so each message waits its turn.
    const say = async (s, text) => { await sleep(600); s.send({ t: 'chat', text }); };
    const CHAT_GAP = 600;
    const REPORT_GAP = 3100; // per-socket report cooldown
    const BLOCK_GAP = 1100; // per-socket block cooldown

    const A = await newUser('Alpha');
    const B = await newUser('Beta');
    const C = await newUser('Gamma');
    sa = socket(srv.port, A.cookie);
    sb = socket(srv.port, B.cookie); // replaced when B reconnects
    sc = socket(srv.port, C.cookie);
    await until(() => sa.welcome() && sb.welcome() && sc.welcome(), 'welcome');
    sa.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    const code = (await until(() => sa.room, 'table')).code;
    sb.send({ t: 'join', code });
    sc.send({ t: 'join', code });
    await until(() => sb.room && sc.room, 'others at the table');
    sa.send({ t: 'start' });
    await until(() => sa.room && sa.room.status === 'playing', 'game running before chat block checks');

    console.log('chat moderation');

    await test('table chat reaches everyone at the table, each message with a server-issued id', async () => {
      await say(sa, 'hello from alpha');
      await until(() => sb.texts().includes('hello from alpha') && sc.texts().includes('hello from alpha'), 'delivery');
      const m = sb.messageOf('hello from alpha');
      assert.match(m.mid, UUID, 'the message carries a random id for reports');
      assert.equal(m.id, A.id, 'the author is the sender account');
    });

    await test('blocking hides that account chat from the blocker only, and the history shows the change at once', async () => {
      sb.send({ t: 'block', id: A.id });
      await until(() => sb.notices().some((n) => /Blocked/.test(n)), 'block confirmation');
      const history = await until(() => sb.lastChatlog(), 'history after block');
      assert.equal(history.messages.some((m) => !m.sys && m.id === A.id), false, 'history after a block has no messages from the blocked account');
      // A block during a running game does not remove the seated player: they keep the seat until the game ends.
      assert.ok(sa.room.members.some((m) => m.id === A.id && !m.bot), 'the blocked player keeps their seat in the running game');
      await say(sa, 'after block from alpha');
      await until(() => sc.texts().includes('after block from alpha'), 'other viewer gets it');
      assert.equal(sb.texts().includes('after block from alpha'), false, 'the blocker never receives it');
      await say(sb, 'beta still speaks');
      await until(() => sa.texts().includes('beta still speaks'), 'the block is one way');
      const rows = await q('SELECT 1 FROM player_blocks WHERE blocker_id = $1 AND blocked_id = $2', [B.id, A.id]);
      assert.equal(rows.length, 1, 'the block is stored');
    });

    await test('the block still applies after a reconnect: the rejoined socket gets a history without the blocked account', async () => {
      sb.ws.close();
      const again = socket(srv.port, B.cookie);
      await until(() => again.welcome(), 'reconnect welcome');
      await until(() => again.room, 'table state after reconnect');
      const history = await until(() => again.lastChatlog(), 'history after reconnect');
      assert.equal(history.messages.some((m) => !m.sys && m.id === A.id), false, 'the reconnected history still hides the blocked account');
      await say(sa, 'alpha after reconnect');
      await until(() => sc.texts().includes('alpha after reconnect'), 'other viewer gets it');
      await sleep(100);
      assert.equal(again.texts().includes('alpha after reconnect'), false, 'the reconnected socket does not receive it');
      sb = again; // the rest of the tests use the reconnected socket
    });

    await test('a blocked pair can share a table: a player who left can take the seat back, and the table stays listed', async () => {
      sb.send({ t: 'leave' });
      await until(() => sa.room && sa.room.members.some((m) => m.id === B.id && m.bot), 'B leaves and a bot takes over');
      // The directory update is broadcast asynchronously, so wait for it rather than reading the last message at once.
      await until(() => {
        const l = sb.msgs.filter((m) => m.t === 'tables').pop();
        return l && l.tables.some((table) => table.code === code);
      }, 'the table stays in the directory for the blocker');
      const before = sb.errors().length;
      sb.send({ t: 'join', code });
      await until(() => sa.room && sa.room.members.some((m) => m.id === B.id && !m.bot), 'B takes the seat back');
      assert.equal(sb.errors().length, before, 'the blocker is not refused');
    });

    await test('an unblock lets the player rejoin and see the account again', async () => {
      sb.send({ t: 'unblock', id: A.id });
      await until(() => sb.notices().some((n) => /Unblocked/.test(n)), 'unblock confirmation');
      await until(() => {
        const listing = sb.msgs.filter((m) => m.t === 'tables').pop();
        return listing && listing.tables.some((table) => table.code === code);
      }, 'table returns to directory after unblock');
      sb.send({ t: 'join', code });
      await until(() => sa.room && sa.room.members.some((m) => m.id === B.id && !m.bot), 'B rejoins after unblock');
      await say(sa, 'alpha is back');
      await until(() => sb.texts().includes('alpha is back'), 'chat returns after unblock');
      assert.equal((await q('SELECT 1 FROM player_blocks WHERE blocker_id = $1 AND blocked_id = $2', [B.id, A.id])).length, 0, 'the block row is removed');
    });

    // Regression: the blocked list changed only after the database write returned, so a message from that author sent
    // meanwhile was delivered. The block is held here on a table lock while the author speaks.
    await test('a message sent while a block is still being saved is not delivered to the blocker', async () => {
      const { Client } = require('pg');
      await sleep(BLOCK_GAP);
      const lock = new Client({ connectionString: t.url });
      await lock.connect();
      try {
        await lock.query('BEGIN');
        await lock.query('LOCK TABLE player_blocks IN ACCESS EXCLUSIVE MODE');
        sb.send({ t: 'block', id: A.id });
        await until(async () => (await lock.query("SELECT count(*)::int AS n FROM pg_locks WHERE relation = 'player_blocks'::regclass AND NOT granted")).rows[0].n > 0, 'block waiting on the database');
        await say(sa, 'sent while the block is being saved');
        await sleep(500);
        await lock.query('COMMIT');
        await until(() => sb.notices().some((n) => /Blocked/.test(n)), 'block saved');
        assert.equal(sb.texts().includes('sent while the block is being saved'), false, 'a blocked author message was delivered');
        sb.send({ t: 'unblock', id: A.id }); // back to the state the next tests expect
        await until(() => sb.notices().includes('Unblocked.'), 'unblock confirmation');
      } finally {
        await lock.query('ROLLBACK').catch(() => {});
        await lock.end().catch(() => {});
      }
    });

    await test('a second block queued behind a stalled write hides its target immediately', async () => {
      const { Client } = require('pg');
      await sleep(BLOCK_GAP);
      const lock = new Client({ connectionString: t.url });
      await lock.connect();
      try {
        await lock.query('BEGIN');
        await lock.query('LOCK TABLE player_blocks IN ACCESS EXCLUSIVE MODE');
        sb.send({ t: 'block', id: A.id });
        await until(async () => (await lock.query("SELECT count(*)::int AS n FROM pg_locks WHERE relation = 'player_blocks'::regclass AND NOT granted")).rows[0].n > 0, 'first block waiting');
        // Reconnect while the first socket's moderation write is still pending. The old socket's message queue is
        // waiting on that write, but the new socket can submit another block for the same shared player record.
        const oldSocket = sb;
        oldSocket.ws.close();
        await until(() => oldSocket.closed !== null, 'old socket closed');
        const reopened = socket(srv.port, B.cookie);
        await until(() => reopened.welcome(), 'reconnected blocker welcome');
        await until(() => reopened.room, 'reconnected blocker table');
        sb = reopened;
        const blockedBefore = sb.notices().filter((n) => /Blocked/.test(n)).length;
        await sleep(BLOCK_GAP + 100);
        sb.send({ t: 'block', id: C.id });
        await say(sc, 'message while second block is queued');
        await sleep(300);
        assert.equal(sb.texts().includes('message while second block is queued'), false, 'the queued target is hidden before its database write starts');
        await lock.query('COMMIT');
        await until(() => sb.notices().filter((n) => /Blocked/.test(n)).length >= blockedBefore + 2, 'both blocks saved');
        assert.equal((await q('SELECT COUNT(*)::int AS n FROM player_blocks WHERE blocker_id = $1 AND blocked_id = $2', [B.id, C.id]))[0].n, 1);
        const beforeUnblocks = sb.notices().filter((n) => n === 'Unblocked.').length;
        await sleep(BLOCK_GAP);
        sb.send({ t: 'unblock', id: A.id });
        await until(() => sb.notices().filter((n) => n === 'Unblocked.').length === beforeUnblocks + 1, 'first target unblocked');
        const slowBefore = sb.errors().filter((e) => e === 'Slow down a little').length;
        sb.send({ t: 'unblock', id: C.id });
        await until(() => sb.errors().filter((e) => e === 'Slow down a little').length > slowBefore, 'rapid second unblock is rate limited');
        assert.equal((await q('SELECT COUNT(*)::int AS n FROM player_blocks WHERE blocker_id = $1 AND blocked_id = $2', [B.id, C.id]))[0].n, 1, 'rate-limited unblock leaves the row intact');
        await sleep(BLOCK_GAP + 100);
        sb.send({ t: 'unblock', id: C.id });
        await until(() => sb.notices().filter((n) => n === 'Unblocked.').length === beforeUnblocks + 2, 'second target unblocked');
      } finally {
        await lock.query('ROLLBACK').catch(() => {});
        await lock.end().catch(() => {});
      }
    });

    await test('a no-op unblock does not query the database or resend chat history', async () => {
      const original = dbModeration.removeBlock;
      let calls = 0;
      dbModeration.removeBlock = async (...args) => { calls++; return original(...args); };
      try {
        const before = sb.msgs.filter((m) => m.t === 'chatlog').length;
        for (let i = 0; i < 5; i++) sb.send({ t: 'unblock', id: A.id });
        await sleep(300);
        assert.equal(calls, 0, 'an account that is not blocked causes no DELETE');
        assert.equal(sb.msgs.filter((m) => m.t === 'chatlog').length, before, 'no-op does not resend history');
      } finally {
        dbModeration.removeBlock = original;
      }
    });

    await test('blocking yourself, a malformed id, or an unknown account is refused without a block', async () => {
      sb.send({ t: 'block', id: B.id });
      await until(() => sb.errors().includes('You cannot block yourself.'), 'self block refused');
      sb.send({ t: 'block', id: 'bob' });
      await until(() => sb.errors().includes('That player could not be found.'), 'malformed id refused');
      await sleep(BLOCK_GAP);
      sb.send({ t: 'block', id: crypto.randomUUID() });
      await until(() => sb.errors().includes('That player could not be found.'), 'unknown account refused');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM player_blocks WHERE blocker_id = $1', [B.id]))[0].n, 0);
    });

    await test('a report stores the server copy of the message, and a second report of the same message is not stored twice', async () => {
      const message = sb.messageOf('hello from alpha') || sc.messageOf('hello from alpha');
      assert.ok(message, 'the message is in memory');
      sc.send({ t: 'report', messageId: message.mid, reason: 'spam', details: 'keeps\u0000 repeating ads', text: 'forged text', id: B.id });
      await until(() => sc.notices().some((n) => /Thanks/.test(n)), 'report confirmation');
      const rows = await q('SELECT reporter_id, reported_id, reported_display_name, room_code, message_id::text AS mid, message_text, reason, details FROM chat_reports WHERE reporter_id = $1', [C.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].reported_id, A.id, 'the author comes from the server, not from the client');
      assert.equal(rows[0].reported_display_name, 'Alpha', 'the reported-name snapshot comes from the database, not the client');
      assert.equal(rows[0].message_text, 'hello from alpha', 'the text comes from the server copy');
      assert.equal(rows[0].room_code, code);
      assert.equal(rows[0].mid, message.mid);
      assert.equal(rows[0].reason, 'spam');
      assert.equal(rows[0].details, 'keeps repeating ads', 'details are cleaned');

      await sleep(REPORT_GAP);
      sc.send({ t: 'report', messageId: message.mid, reason: 'spam' });
      await until(() => sc.notices().some((n) => /already reported/.test(n)), 'duplicate answered');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = $1', [C.id]))[0].n, 1, 'still one row');
    });

    await test('reports are validated: a reason must be known, the message must exist, and you cannot report yourself', async () => {
      const message = sc.messageOf('hello from alpha');
      sc.send({ t: 'report', messageId: message.mid, reason: 'because' });
      await until(() => sc.errors().includes('Choose a reason for the report.'), 'unknown reason refused');
      // a well-formed report spends the per-socket cooldown even when its message is unknown, so wait it out first
      await sleep(REPORT_GAP);
      sc.send({ t: 'report', messageId: crypto.randomUUID(), reason: 'spam' });
      await until(() => sc.errors().includes('That message is no longer available to report.'), 'unknown message refused');
      await sleep(REPORT_GAP);
      const own = sa.messageOf('alpha is back');
      sa.send({ t: 'report', messageId: own.mid, reason: 'other' });
      await until(() => sa.errors().includes('You cannot report your own message.'), 'self report refused');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = $1', [A.id]))[0].n, 0);
    });

    await test('the daily report cap is enforced by the database for each reporter', async () => {
      // fill today's allowance directly (20 reports), then a real report must be refused
      const existing = (await q('SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = $1', [C.id]))[0].n;
      for (let i = existing; i < 20; i++) {
        await q(
          'INSERT INTO chat_reports (reporter_id, reported_id, reported_display_name, room_code, message_id, message_text, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [C.id, A.id, 'Alpha', code, crypto.randomUUID(), 'filler ' + i, 'spam']
        );
      }
      const fresh = sa.messageOf('alpha is back');
      await sleep(REPORT_GAP);
      sc.send({ t: 'report', messageId: fresh.mid, reason: 'harassment' });
      await until(() => sc.errors().some((e) => /many reports today/.test(e)), 'cap refused');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = $1', [C.id]))[0].n, 20, 'no report beyond the cap');
    });

    await test('deleting an account retains reports about it with a display-name snapshot, but removes reports it made', async () => {
      await dbAccount.deleteAccount(A.id, PW);
      const retained = await q('SELECT reported_id, reported_display_name, message_text FROM chat_reports WHERE reporter_id = $1 ORDER BY created_at', [C.id]);
      assert.equal(retained.length, 20, 'all reports by the surviving reporter remain');
      assert.ok(retained.every((r) => r.reported_id === null), 'the deleted account UUID is cleared');
      assert.ok(retained.every((r) => r.reported_display_name === 'Alpha'), 'the display-name snapshot remains');
      assert.ok(retained.some((r) => r.message_text === 'hello from alpha'), 'the original report text remains');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_id = $1', [A.id]))[0].n, 0, 'reports made by the deleted reporter cascade away');
      assert.equal((await q('SELECT COUNT(*)::int AS n FROM player_blocks WHERE blocked_id = $1 OR blocker_id = $1', [A.id]))[0].n, 0);
    });

    console.log(`${passed} chat moderation checks passed`);
  } finally {
    // Close every socket and the server even when a check failed, so the process always exits.
    for (const s of [sa, sb, sc]) if (s) s.ws.close();
    if (srv) await srv.close();
    await t.drop();
  }
})().catch((e) => { console.error('FAIL moderation', e); process.exit(1); });
