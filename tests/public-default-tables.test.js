'use strict';
// New tables are public by default (Phase 3). Covers the server rule, the Create table button in the page, and what a
// second player sees in the open-tables list. Runs without PostgreSQL (guest players, in-memory tables).
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { visibilityForNewTable } = require('../lib/roomAccess');
const { start } = require('../server');

let passed = 0;
const done = (name) => { passed += 1; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 5000) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`);
    await wait(20);
  }
}

// 1. The rule itself
assert.equal(visibilityForNewTable(undefined), 'public', 'omitted is public');
assert.equal(visibilityForNewTable(null), 'public', 'null is public');
assert.equal(visibilityForNewTable(''), 'public', 'an empty value is public');
assert.equal(visibilityForNewTable('public'), 'public', 'explicit public');
assert.equal(visibilityForNewTable('private'), 'private', 'explicit private');
assert.equal(visibilityForNewTable('PUBLIC'), 'private', 'an unknown value fails closed to private');
assert.equal(visibilityForNewTable('everyone'), 'private', 'an unknown value fails closed to private');
done('the server rule: omitted and public are public; private and unknown values are private');

// 2. The Create table button in the page
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const createLine = app.split('\n').find((line) => line.includes("t: 'create'"));
assert.ok(createLine, 'the Create table action sends a create message');
assert.match(createLine, /visibility: 'public'/, 'the button asks for a public table');
assert.doesNotMatch(createLine, /visibility: 'private'/, 'the button no longer creates private tables');
done('the Create table button asks for a public table');

// 3. Over the socket: what the server stores, and what another player sees in the open-tables list
async function guest(port, name) {
  const c = { msgs: [], room: null, tables: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`) };
  c.send = (message) => c.ws.send(JSON.stringify(message));
  c.wait = (predicate, label) => until(() => predicate(c), label);
  c.ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    c.msgs.push(message);
    if (message.t === 'state') c.room = message.room;
    if (message.t === 'tables') c.tables = message.tables || [];
  });
  await new Promise((resolve, reject) => { c.ws.once('open', resolve); c.ws.once('error', reject); });
  c.send({ t: 'hello', name });
  await c.wait((x) => x.msgs.some((m) => m.t === 'welcome'), `${name} welcome`);
  return c;
}

(async () => {
  const app2 = await start({ port: 0, botDelay: [0, 3], autoAdvanceMs: 20, absentMs: 150, maxMsgsPerSec: Infinity, trickPauseMs: 0, forcedMs: 0 });
  const { port } = app2;
  const clients = [];
  try {
    const host = await guest(port, 'Host');
    clients.push(host);
    host.send({ t: 'create', gameId: 'wizard' }); // no visibility field at all
    await host.wait((x) => x.room && x.room.status === 'lobby', 'table created without a visibility field');
    assert.equal(host.room.visibility, 'public', 'a table created without a visibility is public');
    const publicCode = host.room.code;

    const viewer = await guest(port, 'Viewer');
    clients.push(viewer);
    await viewer.wait(() => viewer.tables.some((t) => t.code === publicCode), 'the public table is in the open-tables list');
    done('a table created without a visibility is public and is listed for other players');

    host.send({ t: 'create', gameId: 'wizard', visibility: 'private' });
    await host.wait((x) => x.room && x.room.code !== publicCode, 'second table');
    assert.equal(host.room.visibility, 'private', 'an explicit private request is private');
    const privateCode = host.room.code;
    await wait(80);
    assert.equal(viewer.tables.some((t) => t.code === privateCode), false, 'a private table is not in the open-tables list');
    done('an explicit private table stays private and out of the open-tables list');

    host.send({ t: 'create', gameId: 'wizard', visibility: 'PUBLIC' });
    await host.wait((x) => x.room && x.room.code !== privateCode, 'third table');
    assert.equal(host.room.visibility, 'private', 'an unknown visibility value does not make a table public');
    done('an unknown visibility value falls back to private');
  } finally {
    for (const c of clients) c.ws.close();
    await app2.close();
  }
  console.log(`${passed} public-default checks passed`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
