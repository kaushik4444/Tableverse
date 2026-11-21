'use strict';
// Ready-up and the idle penalty on the real server (memory mode, short timers):
//  1. the table waits for everybody to press Ready before the first move, and moves are refused until then;
//  2. a person who is away gets a warning on each bot turn, and after three in a row is removed (leave penalty, no rejoin).
require('./helpers/env');
const { sessionSocket, registerAndVerify } = require('./helpers/auth');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL ready server test timed out'); process.exit(1); }, 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 15000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}
function connect(port, token) {
  const c = { room: null, view: null, chats: [], errors: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
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
  return c;
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 150, dropGraceMs: 200, maxMessageBytes: 1 << 20 });
  require('./helpers/openGuestFeatures')();
  try {
    const mk = async (name) => (await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@ready.test.local`, displayName: name, password: 'TestPass123!' })).token;
    const annToken = await mk('Ann');
    const benToken = await mk('Ben');
    const a = connect(srv.port, annToken);
    const b = connect(srv.port, benToken);
    await until(() => a.id && b.id, 'welcome');

    // 1. the start gate: no move until both have pressed Ready
    a.send({ t: 'create', gameId: 'colorclash', visibility: 'public' });
    await until(() => a.room, 'table');
    b.send({ t: 'join', code: a.room.code });
    await until(() => b.room, 'ben joined');
    a.send({ t: 'start' });
    await until(() => a.view && a.view.me >= 0 && b.view && b.view.me >= 0 && a.room.gate, 'game waits for ready');
    assert.deepEqual(a.room.gate.ready, [], 'nobody is ready yet');
    const n0 = a.errors.length;
    a.send({ t: 'act', action: { type: 'draw' } });
    await until(() => a.errors.length > n0, 'move refused before ready');
    assert.match(a.errors.at(-1), /Ready/, 'the refusal says why');
    a.send({ t: 'ready' });
    await until(() => a.room.gate && a.room.gate.ready.includes(a.id), 'ann is ready');
    b.send({ t: 'ready' });
    await until(() => a.room && a.room.gate === null, 'everybody ready opens the table');
    console.log('  ok  the table waits for everybody to press Ready, and refuses moves until then');

    // 2. an absent person: a warning on each bot turn, removal on the third in a row, no rejoin
    b.ws.close(); // Ben leaves the connection: a bot plays for him when it is his turn
    const runUntilRemoved = async () => {
      await until(() => {
        if (a.view && a.view.myTurn && a.view.drawn) a.send({ t: 'act', action: { type: 'pass' } });
        else if (a.view && a.view.myTurn && a.view.canDraw) a.send({ t: 'act', action: { type: 'draw' } });
        const ben = a.room && a.room.members.find((m) => m.id === b.id);
        return ben && ben.bot;
      }, 'ben removed after three bot turns', 60000);
    };
    await runUntilRemoved();
    const warnings = a.chats.filter((m) => m.sys && /A bot played .*turn \(\d of 3\)/.test(m.text));
    assert.ok(warnings.length >= 2, `a warning on each bot turn (${warnings.length})`);
    assert.ok(a.chats.some((m) => m.sys && /removed for being away/.test(m.text)), 'the table is told who was removed');
    // no rejoin: Ben cannot take the seat back from the table list
    const back = connect(srv.port, benToken);
    await until(() => back.id, 'ben back');
    back.send({ t: 'join', code: a.room.code });
    await until(() => back.errors.length, 'join refused');
    assert.match(back.errors.at(-1), /removed/i, 'the removed person cannot come back');
    back.ws.close();
    console.log('  ok  an absent person is warned on each bot turn and removed after three in a row');
    console.log('  ok  a removed person cannot rejoin the table');
    console.log('\n3 ready server checks passed');
  } catch (e) {
    console.error('FAIL', e.stack);
    process.exitCode = 1;
  } finally {
    clearTimeout(guard);
    await srv.close();
    process.exit(process.exitCode || 0);
  }
})();
