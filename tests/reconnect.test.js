'use strict';
// Reconnect behaviour on the real server (memory mode): a second connection with the same identity replaces the first,
// a reconnecting player gets the current state of their own seat (and only theirs), and a replaced socket cannot act.
require('./helpers/env');
const { sessionSocket } = require('./helpers/auth');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL reconnect test timed out'); process.exit(1); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

function connect(port, token) {
  const c = { room: null, view: null, chats: [], closeCode: null, errors: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'state') { c.room = m.room; c.view = m.view; }
    if (m.t === 'chat') c.chats.push(m.m);
    if (m.t === 'chatlog') c.chats = c.chats.concat(m.messages);
    if (m.t === 'error') c.errors.push(m.message);
  });
  c.ws.on('close', (code) => { c.closeCode = code; });
  return c;
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, dropGraceMs: 50, maxMsgsPerSec: Infinity });
  try {
    const mk = async (name) => {
      const u = await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@test.local`, displayName: name, password: 'TestPass123!' });
      return u.token;
    };
    const tokA = await mk('Alice'); const tokB = await mk('Bob');
    let a = connect(srv.port, tokA); const b = connect(srv.port, tokB);
    await until(() => a.id && b.id, 'welcome');
    a.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    await until(() => a.room, 'table');
    b.send({ t: 'join', code: a.room.code });
    await until(() => b.room, 'bob joined');
    a.send({ t: 'start' });
    await until(() => a.view && a.view.me >= 0 && b.view && b.view.me >= 0, 'game started');
    const seatA = a.view.me;

    await test('a second connection with the same identity replaces the first (close 4000), the seat is kept', async () => {
      const a2 = connect(srv.port, tokA);
      await until(() => a2.view && a2.view.me >= 0, 'second connection has its seat');
      assert.equal(a2.view.me, seatA, 'same seat');
      await until(() => a.closeCode === 4000, 'first socket replaced');
      // the replaced socket is dead: nothing it sends can act for the player
      const before = JSON.stringify(a2.view);
      try { a.send({ t: 'chat', text: 'ghost' }); } catch { /* closed */ }
      await sleep(100);
      assert.ok(!a2.chats.some((m) => m.text === 'ghost'), 'a replaced socket cannot chat');
      assert.ok(before.length > 0);
      a = a2;
    });

    await test('a reconnecting player gets their own seat and nobody else\'s hand', async () => {
      a.ws.close();
      await until(() => a.closeCode !== null, 'dropped');
      const a3 = connect(srv.port, tokA);
      await until(() => a3.view && a3.view.me === seatA, 'state after reconnect');
      assert.equal(a3.room.status, 'playing');
      for (const [j, p] of (a3.view.players || []).entries()) if (j !== seatA) assert.ok(!Array.isArray(p.hand), `seat ${j}'s hand is not sent to seat ${seatA}`);
      a = a3;
    });

    await test('a dropped player is announced once and "reconnected" once, not on every message', async () => {
      a.ws.close();
      await until(() => b.chats.some((m) => m.sys && /lost connection/.test(m.text)), 'drop announced');
      const a4 = connect(srv.port, tokA);
      await until(() => a4.view && a4.view.me === seatA, 'back');
      await until(() => b.chats.some((m) => m.sys && /reconnected/.test(m.text)), 'reconnect announced');
      a4.send({ t: 'chat', text: 'hi' }); await sleep(700); a4.send({ t: 'chat', text: 'hi2' }); await sleep(200);
      assert.equal(b.chats.filter((m) => m.sys && /Alice reconnected/.test(m.text)).length, 1);
      a = a4;
    });

    await test('hello flooding with the same token leaves exactly one live socket for the player', async () => {
      const socks = Array.from({ length: 6 }, () => connect(srv.port, tokA));
      await sleep(600);
      const live = socks.filter((s) => s.ws.readyState === 1);
      assert.equal(live.length, 1, `only one of six simultaneous connections stays open (${live.length})`);
      assert.ok(live[0].view && live[0].view.me === seatA, 'and it owns the seat');
      for (const s of socks) s.ws.close();
    });
    await test('a seat is marked "stand-in" while a bot plays for someone who left, and cleared when they rejoin', async () => {
      await sleep(100);
      a = connect(srv.port, tokA); // the earlier connections were replaced by the flood test
      await until(() => a.room && a.view && a.view.me === seatA, 'Alice is back');
      assert.ok(!a.room.members.some((m) => m.standIn), 'nobody is a stand-in yet');
      b.send({ t: 'leave' });
      await until(() => a.room && a.room.members.some((m) => m.id === b.id && m.standIn), 'Bob is marked as played by a bot');
      assert.equal(a.room.members.find((m) => m.id === b.id).bot, true);
      b.send({ t: 'join', code: a.room.code });
      await until(() => a.room.members.find((m) => m.id === b.id && !m.standIn && !m.bot), 'mark cleared after Bob rejoins');
    });
    console.log(`${passed} reconnect tests passed`);
  } catch (e) { console.error('FAIL', e.stack); process.exitCode = 1; }
  await srv.close();
  clearTimeout(guard);
  process.exit(process.exitCode || 0);
})();
