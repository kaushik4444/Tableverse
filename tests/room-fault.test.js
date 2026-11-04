'use strict';
// A bug in one game must not crash the server or the other tables: automatic (bot) play that throws is retried and then
// closes only that table.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const games = require('../games');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL room-fault test timed out'); process.exit(1); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 8000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}
function client(port, token) {
  const c = { room: null, notices: [], left: 0, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello', token }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.id = m.id;
    if (m.t === 'state') c.room = m.room;
    if (m.t === 'notice') c.notices.push(m.text);
    if (m.t === 'left') { c.room = null; c.left++; }
  });
  return c;
}

(async () => {
  // wizard's bots throw; every other game is untouched
  const realGet = games.get;
  games.get = (id) => {
    const def = realGet(id);
    if (!def || id !== 'wizard') return def;
    return { ...def, create: (...args) => { const g = def.create(...args); return { ...g, botAction: () => { throw new Error('boom (test)'); } }; } };
  };
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity });
  try {
    const mk = async (name) => {
      const u = await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@test.local`, displayName: name, password: 'TestPass123!' });
      const c = client(srv.port, u.token);
      await until(() => c.id, name + ' welcome');
      return c;
    };
    const a = await mk('Faulty'); const b = await mk('Healthy');
    // a table whose bots throw: it is closed, the server survives
    a.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    await until(() => a.room, 'wizard table');
    a.send({ t: 'start' });
    await until(() => a.left > 0 || a.notices.some((n) => /hit an error/.test(n)), 'faulty table closed', 15000);
    assert.ok(a.notices.some((n) => /hit an error/.test(n)), 'the player is told why the table closed');
    assert.ok(errors.some((e) => /automatic play failed \(3\/3\)/.test(e)), 'three failures are logged before the table is closed');
    // the server is still serving: another table plays normally
    b.send({ t: 'create', gameId: 'gofish', visibility: 'public' });
    await until(() => b.room, 'gofish table');
    b.send({ t: 'start' });
    await until(() => b.room && b.room.status === 'playing', 'healthy game running');
    console.log('  ok  a throwing game closes only its own table; the server keeps serving others');
    // an unexpected error inside an HTTP route answers 500 at once instead of hanging the request
    const realList = games.list; games.list = () => { throw new Error('boom (http test)'); };
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/games`);
    games.list = realList;
    assert.equal(res.status, 500);
    assert.ok(Date.now() - t0 < 2000, 'the answer is immediate, not a timeout');
    assert.ok(errors.some((e) => /\[http\] GET \/api\/games failed/.test(e)), 'the failure is logged');
    console.log('  ok  an unexpected error in an HTTP route answers 500 immediately and is logged');
  } catch (e) { console.error = origError; console.error('FAIL', e.stack); process.exitCode = 1; }
  console.error = origError;
  await srv.close();
  clearTimeout(guard);
})();
