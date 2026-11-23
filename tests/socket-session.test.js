'use strict';
require('./helpers/env');
// Open WebSockets and their sessions, in memory mode: a revoked or signed-out session ends its socket, a message sent after
// sign-out is not acted on, a revoked player leaves voice at once, and a healthy session stays open across checks.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const db = require('../db/pool');
const dbPlayers = require('../db/players');
const dbAuth = require('../db/auth');
const dbModeration = require('../db/moderation');
const dbAccount = require('../db/account');
const { start } = require('../server');
const { Browser, sessionSocket } = require('./helpers/auth');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 4000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(10); }
}
const quiet = () => ({ log() {}, warn() {}, error() {} });

function socketFor(port, token) {
  const c = { msgs: [], closed: null, id: null, room: null, voice: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.inVoice = () => c.voice.map((v) => v.id);
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'state') c.room = m.room;
    if (m.t === 'voice') c.voice = m.ids;
  });
  c.ws.on('close', (code) => { c.closed = code; });
  c.welcomed = () => c.msgs.some((m) => m.t === 'welcome');
  return c;
}
const newPlayer = (name) => dbPlayers.createAnonymousPlayer({ displayName: name, avatar: '🧙' });

(async () => {
  if (db.hasDatabase()) { console.log('socket session (memory) checks skipped: DATABASE_URL is set'); return; }
  const fast = { port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), sessionCheckMs: 40, idleSessionCheckMs: 40 };
  const srv = await start({ ...fast, env: { ...process.env, RL_LOGOUT_IP_LIMIT: '1000', VOICE_ENABLED: 'true' } });
  // test-only: registered-player behaviour in memory mode (see helpers/openGuestFeatures.js)
  require('./helpers/openGuestFeatures')();
  const open = [];
  try {
    await test('an open socket ends within a check interval after its session is revoked, with 4001 and a notice', async () => {
      const { rawToken } = await newPlayer('Revoked');
      const s = socketFor(srv.port, rawToken); open.push(s);
      await until(() => s.welcomed(), 'welcome');
      assert.equal(await dbAuth.revokeSession(rawToken), true);
      await until(() => s.closed !== null, 'the socket closes', 2000);
      assert.equal(s.closed, 4001);
      assert.ok(s.msgs.some((m) => m.t === 'authRequired'), 'the player is told the session ended');
    });

    await test('a socket opened with a revoked session is refused at hello', async () => {
      const { rawToken } = await newPlayer('Gone');
      await dbAuth.revokeSession(rawToken);
      const s = socketFor(srv.port, rawToken); open.push(s);
      await until(() => s.closed !== null, 'refused', 2000);
      assert.equal(s.closed, 1008);
      assert.equal(s.welcomed(), false);
    });

    // Regression: the token was cached in memory by an earlier connection, so a reconnect after revocation used to skip the check.
    await test('a reconnect with a token cached before its session was revoked is refused at hello', async () => {
      const { rawToken } = await newPlayer('Cached');
      const first = socketFor(srv.port, rawToken); open.push(first);
      await until(() => first.welcomed(), 'first welcome');
      first.ws.terminate();
      await until(() => first.ws.readyState === WebSocket.CLOSED, 'first socket closed', 1000);
      assert.equal(dbPlayers.revokeMemoryToken(rawToken), true);
      const again = socketFor(srv.port, rawToken); open.push(again);
      await until(() => again.closed !== null, 'the reconnect is refused', 2000);
      assert.equal(again.closed, 1008);
      assert.equal(again.welcomed(), false);
      assert.ok(again.msgs.some((m) => m.t === 'authRequired'), 'the player is told to log in again');
    });

    await test('sign-out ends the socket at once, and a message sent after sign-out is not acted on', async () => {
      const host = await newPlayer('Host');
      const guest = await newPlayer('Guest');
      const h = socketFor(srv.port, host.rawToken); open.push(h);
      const g = socketFor(srv.port, guest.rawToken); open.push(g);
      await until(() => h.welcomed() && g.welcomed(), 'welcomes');
      h.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      const code = await until(() => h.room && h.room.code, 'table');
      g.send({ t: 'join', code, spectate: false });
      await until(() => g.room && g.room.code === code, 'guest seated');
      g.send({ t: 'voice', on: true });
      await until(() => h.inVoice().includes(g.id), 'guest in voice');

      const b = new Browser(srv.port);
      await b.csrf();
      b.cookies.set('ct_session', guest.rawToken);
      const out = await b.post('/api/auth/logout', {});
      assert.equal(out.status, 200);
      // the revocation happened before the answer: the socket is already marked, so nothing sent after it is acted on
      await until(() => g.closed === 4001, 'the guest socket closes with 4001', 1000);
      assert.equal(h.inVoice().includes(g.id), false, 'the signed-out player is not in voice');
    });

    // The in-flight case: a command sent while the socket is still open waits behind a paused handler. Sign-out lands
    // during that wait, and the command must be discarded when the handler is released, not run for the signed-out player.
    await test('a command queued behind a paused handler is discarded when its session is signed out first', async () => {
      const host = await newPlayer('Host3');
      const guest = await newPlayer('Guest3');
      const h = socketFor(srv.port, host.rawToken); open.push(h);
      const g = socketFor(srv.port, guest.rawToken); open.push(g);
      await until(() => h.welcomed() && g.welcomed(), 'welcomes');
      h.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      const code = await until(() => h.room && h.room.code, 'table');
      g.send({ t: 'join', code, spectate: false });
      await until(() => g.room && g.room.code === code, 'guest seated');

      // Hold the guest's block inside its database turn: addBlock does not finish until the gate opens.
      const realAddBlock = dbModeration.addBlock;
      let release;
      const gate = new Promise((r) => { release = r; });
      let entered = false;
      dbModeration.addBlock = async () => { entered = true; await gate; return {}; };
      try {
        g.send({ t: 'block', id: '00000000-0000-4000-8000-000000000001' });
        await until(() => entered, 'the block is paused in its database turn');
        g.send({ t: 'voice', on: true }); // queued behind the paused block while the socket is open
        const b = new Browser(srv.port);
        await b.csrf();
        b.cookies.set('ct_session', guest.rawToken);
        const out = await b.post('/api/auth/logout', {});
        assert.equal(out.status, 200);
        await until(() => g.closed === 4001, 'the guest socket closes with 4001', 1000);
        release();
        await sleep(120);
        assert.equal(h.inVoice().includes(g.id), false, 'the queued voice command was discarded, not acted on');
      } finally {
        dbModeration.addBlock = realAddBlock;
        release();
      }
    });

    // The profile page waits for a block or unblock answer to release its "Saving…" lock. A failure before the write (the name
    // lookup) must give the operation-specific message the page recognises, not the generic one it ignores.
    await test('a block or unblock that fails before its write is answered with its own failure message', async () => {
      const { rawToken } = await newPlayer('Looker');
      const s = socketFor(srv.port, rawToken); open.push(s);
      await until(() => s.welcomed(), 'welcome');
      const real = dbAccount.idForUsername;
      dbAccount.idForUsername = async () => { throw new Error('lookup down'); };
      try {
        s.send({ t: 'block', username: 'someone_else' });
        await until(() => s.msgs.some((m) => m.t === 'error' && /^Could not save that block\. Your profile has been checked again\.$/.test(m.message || m.text || '')), 'the block failure message');
        s.send({ t: 'unblock', username: 'someone_else' });
        await until(() => s.msgs.some((m) => m.t === 'error' && /^Could not save that unblock\./.test(m.message || m.text || '')), 'the unblock failure message');
        assert.equal(s.msgs.some((m) => m.t === 'error' && /Something went wrong/.test(m.message || m.text || '')), false, 'no generic error was sent for these two');
      } finally { dbAccount.idForUsername = real; }
    });

    await test('a revoked player leaves voice at once and the table is told', async () => {
      const host = await newPlayer('Host2');
      const guest = await newPlayer('Guest2');
      const h = socketFor(srv.port, host.rawToken); open.push(h);
      const g = socketFor(srv.port, guest.rawToken); open.push(g);
      await until(() => h.welcomed() && g.welcomed(), 'welcomes');
      h.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      const code = await until(() => h.room && h.room.code, 'table');
      g.send({ t: 'join', code, spectate: false });
      await until(() => g.room && g.room.code === code, 'guest seated');
      g.send({ t: 'voice', on: true });
      await until(() => h.inVoice().includes(g.id), 'guest in voice');
      await dbAuth.revokeSession(guest.rawToken);
      await until(() => !h.inVoice().includes(g.id), 'the table no longer lists the revoked player in voice', 2000);
    });

    await test('a healthy session stays open across many checks', async () => {
      const { rawToken } = await newPlayer('Healthy');
      const s = socketFor(srv.port, rawToken); open.push(s);
      await until(() => s.welcomed(), 'welcome');
      await sleep(400); // about ten check intervals
      assert.equal(s.closed, null, 'still open');
      assert.equal(s.ws.readyState, WebSocket.OPEN);
    });
  } finally {
    for (const s of open) { try { s.ws.terminate(); } catch { /* closed */ } }
    await srv.close();
  }

  // Neon cannot autosuspend while open sockets ask it a question every minute. A socket nobody is using is checked only by a long
  // backstop; a socket in use is still checked, and the first message after a quiet spell is checked before it is acted on.
  const slow = await start({ ...fast, sessionCheckMs: 40, idleSessionCheckMs: 600000, env: { ...process.env, RL_LOGOUT_IP_LIMIT: '1000', VOICE_ENABLED: 'true' } });
  const open2 = [];
  const realAuth = dbPlayers.authenticateToken;
  let lookups = 0;
  dbPlayers.authenticateToken = (...args) => { lookups++; return realAuth.apply(dbPlayers, args); };
  try {
    await test('an idle socket does not ask the database about its session, however many check intervals pass', async () => {
      const { rawToken } = await newPlayer('Quiet');
      const s = socketFor(slow.port, rawToken); open2.push(s);
      await until(() => s.welcomed(), 'welcome');
      await sleep(100); // let the hello's own lookup finish
      const before = lookups;
      await sleep(400); // about ten check intervals
      assert.equal(lookups, before, 'no session lookups while the socket is idle');
      assert.equal(s.closed, null, 'and it stays open');
    });

    await test('the first message after a quiet spell checks the session before acting: a healthy one goes through, a revoked one is closed', async () => {
      const ok = await newPlayer('Back');
      const s = socketFor(slow.port, ok.rawToken); open2.push(s);
      await until(() => s.welcomed(), 'welcome');
      await sleep(120);
      const before = lookups;
      s.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      await until(() => s.room && s.room.code, 'the table is created');
      assert.ok(lookups > before, 'the session was checked before the message was served');

      const gone = await newPlayer('Gone2');
      const r = socketFor(slow.port, gone.rawToken); open2.push(r);
      await until(() => r.welcomed(), 'welcome');
      assert.equal(await dbAuth.revokeSession(gone.rawToken), true);
      await sleep(120); // longer than sessionCheckMs, shorter than the idle backstop: nothing has noticed yet
      assert.equal(r.closed, null);
      r.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      await until(() => r.closed !== null, 'the revoked socket is closed by its next message', 2000);
      assert.equal(r.closed, 4001);
      assert.equal(r.room, null, 'and the message was not acted on');
    });
  } finally {
    dbPlayers.authenticateToken = realAuth;
    for (const s of open2) { try { s.ws.terminate(); } catch { /* closed */ } }
    await slow.close();
  }
  console.log(`${passed} socket session checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
