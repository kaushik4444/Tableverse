'use strict';
// A restart must not look like a mystery: connected players get a notice and a 1012 ("service restart") close, and
// a game that was still running is not recorded as a finished match.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL shutdown test timed out'); process.exit(1); }, 40000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}

(async () => {
  const saved = [];
  const srv = await start({ port: 0, trustProxy: false, botDelay: [5000, 6000], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, absentMs: 60000, maxMsgsPerSec: Infinity,
    matchRecord: async (rec) => { saved.push(rec); return { matchId: rec.matchKey }; } });
  try {
    const u = await registerAndVerify(srv.port, { email: 'sd@test.local', displayName: 'Sam', password: 'TestPass123!' });
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const got = { notices: [], code: null, room: null };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token: u.token })));
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'notice') got.notices.push(m.text); if (m.t === 'state') got.room = m.room; });
    ws.on('close', (code) => { got.code = code; });
    await until(() => got.room === null && ws.readyState === 1, 'connected');
    ws.send(JSON.stringify({ t: 'create', gameId: 'gofish', visibility: 'public' }));
    await until(() => got.room, 'table');
    ws.send(JSON.stringify({ t: 'start' }));
    await until(() => got.room && got.room.status === 'playing', 'game running');
    assert.match(srv.statusLine(), /^\[stats\] rooms=1 playing=1 sockets=1 players=\d+ rssMB=\d+ matches\(saved=0 pending=0 failed=0 retried=0\)$/, 'the status line reports rooms, sockets and match-queue health');
    await srv.close();
    await until(() => got.code !== null, 'socket closed');
    assert.equal(got.code, 1012, 'closed with "service restart"');
    assert.ok(got.notices.some((n) => /restarting/i.test(n) && /not kept/i.test(n)), 'players are told tables do not survive a restart');
    assert.equal(saved.length, 0, 'an unfinished game is never recorded as a finished match');
    console.log('  ok  shutdown notifies players (1012 + notice) and records no unfinished match');
  } catch (e) { console.error('FAIL', e.stack); process.exitCode = 1; }
  clearTimeout(guard);
  process.exit(process.exitCode || 0);
})();
