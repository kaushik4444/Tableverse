'use strict';
require('./helpers/env');
// 29's double and redouble can be answered by either player on the answering side. With a bot as that player's partner, the
// server must not let the bot answer for the side while the connected human can still decide. In memory mode, no database.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const db = require('../db/pool');
const dbPlayers = require('../db/players');
const { start } = require('../server');
const { sessionSocket } = require('./helpers/auth');

const guard = setTimeout(() => { console.error('FAIL challenge automation test timed out'); process.exit(1); }, 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
const quiet = () => ({ log() {}, warn() {}, error() {} });

function socketFor(port, token) {
  const c = { id: null, room: null, view: null, phases: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'left') { c.room = null; c.view = null; }
    if (m.t === 'state') { c.room = m.room; c.view = m.view; if (m.view && m.view.phase) c.phases.push(m.view.phase + (m.view.myTurn ? ':mine' : '')); }
  });
  return c;
}
async function until(fn, label, ms = 4000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(5); }
}

(async () => {
  if (db.hasDatabase()) { console.log('challenge automation (memory) checks skipped: DATABASE_URL is set'); return; }
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: quiet(), sessionCheckMs: 40, env: { ...process.env } });
  const { rawToken } = await dbPlayers.createAnonymousPlayer({ displayName: 'Ann', avatar: '🧙' });
  const ann = socketFor(srv.port, rawToken);
  try {
    await until(() => ann.id, 'welcome');
    await test('a bot partner does not answer the double while the connected human can decide', async () => {
      // Who wins the bid is random: play tables until the human's side is the one asked, then check it stays open.
      let found = false;
      for (let attempt = 0; attempt < 30 && !found; attempt++) {
        ann.phases.length = 0;
        ann.send({ t: 'create', gameId: 'twentynine', visibility: 'private', options: { doubleChallenge: true } });
        await until(() => ann.room && ann.room.members.some((m) => m.id === ann.id), 'table');
        for (let i = 0; i < 3; i++) ann.send({ t: 'addBot' });
        await until(() => ann.room.members.length === 4, 'three bots');
        ann.send({ t: 'start' });
        await until(() => ann.phases.some((p) => p.startsWith('challenge') || p === 'playing' || p.startsWith('playing')), 'the auction ends', 4000);
        if (ann.phases.includes('challenge:mine')) {
          found = true;
          await sleep(400); // far longer than a bot's delay here (0 to 3 ms)
          assert.equal(ann.view.phase, 'challenge', 'the challenge is still open for the human');
          assert.equal(ann.view.myTurn, true, 'the human can still answer');
        }
        ann.send({ t: 'leave' });
        await until(() => !ann.room, 'left the table');
      }
      assert.ok(found, 'a table where the human answers the double was reached');
    });
  } finally {
    ann.ws.close(); await srv.close(); clearTimeout(guard);
    console.log(`\n${passed} challenge automation checks passed`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
