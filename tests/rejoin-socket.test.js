'use strict';
// Rejoin grace period on the real server (memory mode, short grace): a seat is taken back inside the window; after the
// window the player is a spectator (no hand, no moves for the bot-held seat), and leaving again changes nothing.
require('./helpers/env');
const { sessionSocket } = require('./helpers/auth');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const GRACE_MS = 400;
const guard = setTimeout(() => { console.error('FAIL rejoin socket test timed out'); process.exit(1); }, 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}

function connect(port, token) {
  const c = { room: null, view: null, rejoin: [], chats: [], errors: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.rejoin = m.rejoin || []; }
    if (m.t === 'state') { c.room = m.room; c.view = m.view; }
    if (m.t === 'tables') c.rejoin = m.rejoin || [];
    if (m.t === 'chat') c.chats.push(m.m);
    if (m.t === 'chatlog') c.chats = c.chats.concat(m.messages);
    if (m.t === 'error') c.errors.push(m.message);
  });
  return c;
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, dropGraceMs: 50, maxMsgsPerSec: Infinity, rejoinGraceMs: GRACE_MS });
  try {
    const mk = async (name) => (await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@rejoin.test.local`, displayName: name, password: 'TestPass123!' })).token;
    const a = connect(srv.port, await mk('Ann')); const b = connect(srv.port, await mk('Ben'));
    await until(() => a.id && b.id, 'welcome');
    a.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    await until(() => a.room, 'table');
    b.send({ t: 'join', code: a.room.code });
    await until(() => b.room, 'ben joined');
    a.send({ t: 'start' });
    await until(() => a.view && a.view.me >= 0 && b.view && b.view.me >= 0, 'game started');
    const seatA = a.view.me;
    const code = a.room.code;
    const noHands = (view) => view && view.me === -1
      && (!Array.isArray(view.hand) || view.hand.length === 0)
      && (!Array.isArray(view.foresight) || view.foresight.length === 0)
      && (view.players || []).every((p) => !Array.isArray(p.hand));

    // 1. leave and come back inside the window: the same seat, and the leave is forgiven
    const t0 = Date.now();
    a.send({ t: 'leave' });
    await until(() => b.chats.some((m) => m.sys && /left the game/.test(m.text)), 'a left');
    a.view = null; // only a view received after the join counts
    a.send({ t: 'join', code });
    await until(() => a.view && a.view.me === seatA && a.chats.some((m) => m.sys && /took the seat/.test(m.text)), 'seat taken back inside the window');
    assert.equal(a.room.status, 'playing', 'the game still runs');

    // 2. Leaving again does not restart the original deadline, which also refreshes the open home screen at expiry.
    a.view = null;
    a.send({ t: 'leave' });
    await until(() => a.rejoin.some((r) => r.code === code && r.canReclaim), 'rejoin remains available before original deadline');
    await until(() => Date.now() >= t0 + GRACE_MS && a.rejoin.some((r) => r.code === code && !r.canReclaim), 'home screen refreshed when original deadline expires');

    // 3. Returning after that deadline is a spectator: no private state, no seat actions, and no new forfeits.
    a.view = null;
    a.send({ t: 'join', code });
    await until(() => a.view && a.view.me === -1 && a.room.spectators.some((s) => s.id === a.id), 'late return is registered as a spectator');
    assert.ok(a.room.members.some((m) => m.id === a.id && m.bot), 'the bot retains the former seat');
    await until(() => b.room.spectators.some((s) => s.id === a.id), 'other players see the late return as a spectator');
    assert.ok(noHands(a.view), 'a spectator never receives a hand');
    assert.equal(a.room.status, 'playing', 'the game keeps running for the bot-held seat');
    a.errors = [];
    a.send({ t: 'act', action: { type: 'bid', amount: 0 } });
    await until(() => a.errors.length > 0, 'the move is refused');
    assert.ok(a.errors.some((e) => /watching/.test(e)), 'a spectator cannot move for the bot-held seat');
    assert.ok(noHands(a.view), 'still no hand after a refused move');

    // 4. leaving again as a spectator changes nothing: the game is not abandoned for the player who stayed
    a.send({ t: 'leave' });
    await until(() => b.room.spectators.every((s) => s.id !== a.id), 'spectator stopped watching');
    assert.equal(b.room.status, 'playing', 'the game is not abandoned');
    assert.ok(!b.chats.some((m) => m.sys && /abandon/i.test(m.text)), 'nobody is told the game was abandoned');
    assert.ok(b.room.members.some((m) => m.id === a.id && m.bot), 'leaving as a spectator does not take the bot-held seat');
    console.log('  ok  rejoin socket: inside the window, after it, and leaving again as a spectator');
    console.log('\n1 passed, 0 failed');
  } catch (e) {
    console.error('FAIL  rejoin socket\n' + e.stack);
    process.exitCode = 1;
  } finally {
    clearTimeout(guard);
    await srv.close();
    process.exit(process.exitCode || 0);
  }
})();
