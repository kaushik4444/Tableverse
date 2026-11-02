'use strict';
// Host tools on the real server (in-memory mode, no database): hand the table to someone else, remove players/spectators/bots
// from the lobby, and keep removed people out of that table only.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL host tools test timed out'); process.exit(1); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 6000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(15); }
}
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function client(port, token) {
  const c = { room: null, errors: [], chats: [], notices: [], left: 0, tables: null, ws: new WebSocket(`ws://127.0.0.1:${port}/ws`) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.on('open', () => c.send({ t: 'hello', token }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.rejoin = m.rejoin; }
    if (m.t === 'state') c.room = m.room;
    if (m.t === 'error') c.errors.push(m.message);
    if (m.t === 'chat') c.chats.push(m.m);
    if (m.t === 'chatlog') c.chats = c.chats.concat(m.messages);
    if (m.t === 'notice') c.notices.push(m.text);
    if (m.t === 'left') { c.room = null; c.left++; }
    if (m.t === 'tables') c.tables = m;
  });
  c.sys = (re) => c.chats.filter((x) => x.sys && re.test(x.text)).length;
  c.at = (code) => !!(c.room && c.room.code === code);
  return c;
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, timeScale: 0.01, absentMs: 60000, maxMsgsPerSec: Infinity, matchLog: { log() {}, warn() {}, error() {} } });
  const all = [];
  const users = new Map();
  const mk = async (name) => {
    const u = await registerAndVerify(srv.port, { email: `${name.toLowerCase()}@test.local`, displayName: name, password: 'TestPass123!' });
    const c = client(srv.port, u.token); all.push(c); users.set(c, u);
    await until(() => c.id, name + ' welcome');
    return c;
  };
  const table = async (host) => {
    host.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
    await until(() => host.room && host.room.members.some((m) => m.id === host.id), 'table created');
    return host.room.code;
  };
  const joinAs = async (c, code, spectate = false) => {
    c.send({ t: 'join', code, spectate });
    await until(() => c.at(code), 'joined');
  };

  try {
    const host = await mk('Hosty'); const ann = await mk('Ann'); const bea = await mk('Bea'); const cyd = await mk('Cyd');
    const code = await table(host);
    await joinAs(ann, code); await joinAs(bea, code); await joinAs(cyd, code, true);

    await test('only the host can hand over the table, and only to another seated human', async () => {
      ann.send({ t: 'makeHost', id: bea.id });
      await until(() => ann.errors.some((e) => /Only the host/.test(e)), 'non-host refused');
      host.send({ t: 'makeHost', id: host.id });
      host.send({ t: 'makeHost', id: cyd.id });          // a spectator is not seated
      host.send({ t: 'makeHost', id: 'nobody' });
      await until(() => host.errors.length >= 3, 'bad targets refused');
      assert.equal(host.room.hostId, host.id);
    });

    await test('making someone else host: the old host stays seated and loses the host powers, the new host gains them', async () => {
      host.send({ t: 'makeHost', id: ann.id });
      await until(() => host.room.hostId === ann.id && ann.room.hostId === ann.id, 'host changed');
      assert.ok(host.room.members.some((m) => m.id === host.id), 'the old host is still seated');
      assert.equal(host.sys(/Hosty made Ann the host/), 1);
      const before = host.errors.length;
      host.send({ t: 'setVisibility', visibility: 'private' });
      host.send({ t: 'kick', id: bea.id });
      await until(() => host.errors.length >= before + 2, 'old host refused');
      assert.equal(ann.room.visibility, 'public');
      assert.ok(ann.room.members.some((m) => m.id === bea.id));
    });

    await test('removing a seated player: they are put out with a notice, cannot return by join, spectate or reconnect, and can still use other tables', async () => {
      ann.send({ t: 'kick', id: bea.id });
      await until(() => bea.left > 0, 'bea was told');
      assert.ok(bea.notices.some((n) => /removed you/.test(n)));
      assert.equal(ann.room.members.some((m) => m.id === bea.id), false);
      assert.equal(ann.sys(/Bea was removed by the host/), 1);
      bea.send({ t: 'join', code });
      bea.send({ t: 'join', code, spectate: true });
      await until(() => bea.errors.filter((e) => /removed you/.test(e)).length >= 2, 'refused twice');
      assert.equal(bea.room, null);
      // a fresh connection of the same account is not put back either
      const again = client(srv.port, users.get(bea).token); all.push(again);
      await until(() => again.id, 'bea reconnects');
      assert.deepEqual(again.rejoin || [], []);
      assert.equal(again.room, null);
      // but another table is open to her
      const other = await mk('Other'); const code2 = await table(other);
      await joinAs(again, code2);
    });

    await test('removing a spectator works the same way', async () => {
      ann.send({ t: 'kick', id: cyd.id });
      await until(() => cyd.left > 0, 'cyd was told');
      assert.equal(ann.room.spectators.some((s) => s.id === cyd.id), false);
      cyd.send({ t: 'join', code, spectate: true });
      await until(() => cyd.errors.some((e) => /removed you/.test(e)), 'cyd refused');
    });

    await test('a bot can be removed; you cannot remove yourself; an unknown id is refused', async () => {
      ann.send({ t: 'addBot' });
      await until(() => ann.room.members.some((m) => m.bot), 'bot added');
      const bot = ann.room.members.find((m) => m.bot);
      ann.send({ t: 'kick', id: bot.id });
      await until(() => !ann.room.members.some((m) => m.bot), 'bot removed');
      const n = ann.errors.length;
      ann.send({ t: 'kick', id: ann.id });
      ann.send({ t: 'kick', id: 'ghost' });
      await until(() => ann.errors.length >= n + 2, 'refused');
      assert.ok(ann.at(code) && ann.room.hostId === ann.id);
    });

    await test('no one can be removed once the game has started', async () => {
      const dee = await mk('Dee');
      await joinAs(dee, code);
      ann.send({ t: 'start' });
      await until(() => ann.room.status === 'playing', 'started');
      const n = ann.errors.length;
      ann.send({ t: 'kick', id: dee.id });
      await until(() => ann.errors.length > n, 'refused while playing');
      assert.ok(ann.room.members.some((m) => m.id === dee.id));
      // the host can still hand the table over during the game
      ann.send({ t: 'makeHost', id: dee.id });
      await until(() => ann.room.hostId === dee.id, 'handed over mid-game');
    });

    console.log(`\n${passed} host tool tests passed`);
  } finally {
    clearTimeout(guard);
    for (const c of all) try { c.ws.terminate(); } catch { /* closed */ }
    await srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
