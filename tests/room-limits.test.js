'use strict';
// One account must not be able to fill the server with abandoned tables: leaving a running game parks it for a
// comeback (10 minutes), but a player only ever has ONE such parked table.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL room-limits test timed out'); process.exit(1); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 5000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(5); }
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, maxMsgsPerSec: Infinity, botDelay: [5000, 6000], absentMs: 600000 });
  try {
    const u = await registerAndVerify(srv.port, { email: 'loop@test.local', displayName: 'Looper', password: 'TestPass123!' });
    const tables = async () => (await (await fetch(`http://127.0.0.1:${srv.port}/api/games`)).json()).tables;
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    let room = null; let left = 0;
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'state') room = m.room; if (m.t === 'left') { room = null; left++; } });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'hello', token: u.token }));
    await sleep(30);
    const codes = new Set();
    for (let i = 0; i < 12; i++) {
      const l0 = left;
      ws.send(JSON.stringify({ t: 'create', gameId: 'wizard', visibility: 'public' }));
      await until(() => room, 'table ' + i);
      codes.add(room.code);
      ws.send(JSON.stringify({ t: 'start' }));
      await until(() => room && room.status === 'playing', 'started ' + i);
      ws.send(JSON.stringify({ t: 'leave' }));
      await until(() => left > l0, 'left ' + i);
    }
    assert.equal(codes.size, 12, 'twelve different tables were created');
    const open = await tables();
    assert.ok(open.length <= 1, `after 12 create/start/leave loops at most one parked table remains (found ${open.length})`);
    console.log('  ok  a create/start/leave loop leaves at most one parked table per account');
    ws.close();
  } catch (e) { console.error('FAIL', e.stack); process.exitCode = 1; }
  clearTimeout(guard);
  await srv.close();
  process.exit(process.exitCode || 0);
})();
