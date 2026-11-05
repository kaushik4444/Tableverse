'use strict';
/** End-to-end: real HTTP + WebSocket server, two human clients and a bot play a complete Wizard game. */
require('./helpers/env');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { registerAndVerify } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => {
  console.error('FAIL smoke test timed out');
  process.exit(1);
}, 60000);

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ port, path, host: '127.0.0.1' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function client(port, name, token) {
  const c = { name, last: null, room: null, view: null, errors: [], chats: [], notices: [], tables: [], ws: new WebSocket(`ws://127.0.0.1:${port}/ws`), playing: false };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.waiters = [];
  c.until = (pred, label) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for ' + label)), 20000);
      const check = () => {
        if (pred()) { clearTimeout(t); resolve(); return true; }
        return false;
      };
      if (!check()) c.waiters.push(check);
    });
  c.ws.on('open', () => c.send({ t: 'hello', token }));
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') Object.assign(c, { id: m.id, token: m.token, games: m.games, tables: m.tables || [], rejoin: m.rejoin || [], announcement: m.announcement });
    if (m.t === 'state') { c.room = m.room; c.view = m.view; if (c.playing) c.step(); }
    if (m.t === 'error') c.errors.push(m.message);
    if (m.t === 'tables') { c.tables = m.tables || []; c.rejoin = m.rejoin || []; }
    if (m.t === 'chat') c.chats.push(m.m);
    if (m.t === 'notice') c.notices.push(m.text);
    c.waiters = c.waiters.filter((w) => !w());
  });
  c.step = () => {
    const v = c.view;
    if (!v || !v.myTurn) return;
    const key = [v.phase, v.round, v.hand.length, v.trick.length, v.players.filter((p) => p.bid !== null).length].join('|');
    if (key === c.lastKey) return;
    c.lastKey = key;
    if (v.phase === 'chooseTrump') c.send({ t: 'act', action: { type: 'chooseTrump', suit: 'G' } });
    else if (v.phase === 'bidding') c.send({ t: 'act', action: { type: 'bid', amount: v.forbiddenBid === 0 ? 1 : 0 } });
    else if (v.phase === 'playing') c.send({ t: 'act', action: { type: 'play', cardId: v.legal[0] } });
  };
  return c;
}

(async () => {
  const app = await start({ port: 0, botDelay: [0, 3], autoAdvanceMs: 20, absentMs: 150, maxMsgsPerSec: Infinity, trickPauseMs: 0, forcedMs: 0 });
  const { port } = app;
  let seq = 1;
  const authClient = async (name, p = port) => {
    const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.${seq++}@test.local`;
    const username = `${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)}${seq}`;
    const { token } = await registerAndVerify(p, { email, username, displayName: name, password: 'TestPass123!' });
    return client(p, name, token);
  };

  // no token -> authRequired
  {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs = [];
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
    ws.send(JSON.stringify({ t: 'hello', name: 'Guest' }));
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(msgs.some((m) => m.t === 'authRequired'));
    ws.close();
  }

  // unverified token: enforced only when PostgreSQL auth is enabled
  {
    const regRes = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `u.${Date.now()}@test.local`, password: 'TestPass123!', displayName: 'Unverified' }),
    });
    if (regRes.ok) {
      const reg = await regRes.json();
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const msgs = [];
      await new Promise((r) => ws.on('open', r));
      ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
      ws.send(JSON.stringify({ t: 'hello', token: reg.token }));
      await new Promise((r) => setTimeout(r, 120));
      assert.ok(msgs.some((m) => m.t === 'authRequired' && /verify/i.test(m.message || '')));
      ws.close();
    }
  }

  const home = await get(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Tableverse/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal((await get(port, '/games/wizard.js')).status, 200);
  assert.equal((await get(port, '/healthz')).body, 'ok');
  assert.equal((await get(port, '/nope')).status, 404);
  assert.equal((await get(port, '/../server.js')).status, 404);
  assert.notEqual((await get(port, '/%2e%2e/server.js')).status, 200);
  assert.notEqual((await get(port, '/..%2fserver.js')).status, 200);
  assert.notEqual((await get(port, '/%00')).status, 200);
  console.log('  ok  static files are served and traversal is blocked');

  const a = await authClient('Alice');
  await a.until(() => a.id, 'welcome');
  a.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
  await a.until(() => a.room, 'room created');

  const b = await authClient('Bob');
  await b.until(() => b.tables.some((t) => t.code === a.room.code && t.status === 'lobby'), 'public lobby listing');
  a.send({ t: 'setVisibility', visibility: 'private' });
  await b.until(() => !b.tables.some((t) => t.code === a.room.code), 'private hidden');
  a.send({ t: 'setVisibility', visibility: 'public' });
  await b.until(() => b.tables.some((t) => t.code === a.room.code), 'public visible');

  const privateHost = await authClient('Private Host');
  await privateHost.until(() => privateHost.id, 'welcome private host');
  privateHost.send({ t: 'create', gameId: 'wizard' });
  await privateHost.until(() => privateHost.room, 'private room');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(b.tables.some((t) => t.code === privateHost.room.code), false);
  privateHost.ws.close();

  b.send({ t: 'join', code: a.room.code.toLowerCase() });
  await b.until(() => b.room, 'B joined');
  await a.until(() => a.room.members.length === 2, 'A sees B');
  console.log('  ok  create / join by code');

  b.send({ t: 'setSeats', seats: 3 });
  await b.until(() => b.errors.some((e) => /host/.test(e)), 'only host sets seats');
  a.send({ t: 'setSeats', seats: 3 });
  a.send({ t: 'addBot' });
  await a.until(() => a.room.members.length === 3 && a.room.members[2].bot, 'bot added');

  a.playing = b.playing = true;
  a.send({ t: 'start' });
  await a.until(() => a.view, 'game started');
  await b.until(() => b.view, 'game started B');
  a.step(); b.step();

  const sp = await authClient('Sam');
  await sp.until(() => sp.id, 'welcome S');
  sp.send({ t: 'join', code: a.room.code });
  await sp.until(() => sp.room && sp.view, 'spectator joined');
  sp.send({ t: 'chat', text: 'hello table' });
  await a.until(() => a.chats.some((m) => m.name === 'Sam' && m.spec), 'chat reaches players');
  console.log('  ok  spectators join a running game and chat');

  await a.until(() => a.view.round >= 2, 'round 2');
  const token = a.token;
  a.playing = false;
  a.ws.close();
  const a2 = client(port, 'Alice', token);
  a2.playing = true;
  await a2.until(() => a2.view && a2.room, 'A resumed');
  a2.step();

  await b.until(() => b.view.phase === 'gameOver', 'game over');
  await a2.until(() => a2.view.phase === 'gameOver', 'game over A');
  console.log('  ok  full game over websocket');

  const c = await authClient('Cara');
  await c.until(() => c.id, 'welcome C');
  c.send({ t: 'create', gameId: 'twentynine' });
  await c.until(() => c.room && c.room.gameId === 'twentynine', '29 table');
  c.send({ t: 'start' });
  await c.until(() => c.view && c.view.game === 'twentynine', '29 started');
  c.ws.close();

  const pk = await authClient('Pia');
  await pk.until(() => pk.id, 'welcome P');
  pk.send({ t: 'create', gameId: 'poker' });
  await pk.until(() => pk.room && pk.room.gameId === 'poker', 'poker table');
  pk.send({ t: 'start' });
  await pk.until(() => pk.view && pk.view.game === 'poker', 'poker started');
  pk.ws.close();

  const tm = await authClient('Tom');
  await tm.until(() => tm.id, 'welcome Tom');
  tm.send({ t: 'create', gameId: 'themind' });
  await tm.until(() => tm.room && tm.room.gameId === 'themind', 'mind table');
  tm.send({ t: 'start' });
  await tm.until(() => tm.view && tm.view.game === 'themind', 'mind started');
  tm.ws.close();

  const gf = await authClient('Gina');
  await gf.until(() => gf.id, 'welcome Gina');
  gf.send({ t: 'create', gameId: 'gofish' });
  await gf.until(() => gf.room && gf.room.gameId === 'gofish', 'go fish table');
  gf.send({ t: 'start' });
  await gf.until(() => gf.view && gf.view.game === 'gofish', 'go fish started');
  assert.equal(gf.view.myTurn, true, 'the first seat starts');
  assert.ok(gf.view.hand.length >= 5 && gf.view.targets.length >= 1);
  assert.ok(gf.view.players.every((p) => !('hand' in p) && typeof p.cards === 'number'), 'other players show card counts only');
  gf.send({ t: 'act', action: { type: 'ask', target: gf.view.targets[0], rank: gf.view.askRanks[0] } });
  await gf.until(() => gf.view && gf.view.event && ['take', 'fish'].includes(gf.view.event.type), 'go fish ask answered');
  gf.send({ t: 'act', action: { type: 'ask', target: 'nobody', rank: 'A' } });
  gf.ws.close();

  const pr = await authClient('Priya');
  await pr.until(() => pr.id, 'welcome Priya');
  pr.send({ t: 'create', gameId: 'propertyrivals' });
  await pr.until(() => pr.room && pr.room.gameId === 'propertyrivals', 'property rivals table');
  pr.send({ t: 'start' });
  await pr.until(() => pr.view && pr.view.game === 'propertyrivals', 'property rivals started');
  assert.equal(pr.view.myTurn, true, 'the first seat starts');
  assert.equal(pr.view.squares.length, 40);
  assert.equal(JSON.stringify(pr.view).includes('"decks"'), false, 'deck order is never sent');
  pr.send({ t: 'act', action: { type: 'roll' } });
  await pr.until(() => pr.view && pr.view.dice && pr.view.dice[0] > 0, 'property rivals roll answered'); // the event is replaced by the landing, so wait for the dice
  pr.send({ t: 'act', action: { type: 'build', square: 0 } }); // refused, the table carries on
  pr.ws.close();

  for (const [id, who, send] of [['tictactoe', 'Tara', { type: 'place', cell: 4 }], ['fourinarow', 'Finn', { type: 'drop', col: 3 }]]) {
    const lg = await authClient(who);
    await lg.until(() => lg.id, 'welcome ' + who);
    lg.send({ t: 'create', gameId: id });
    await lg.until(() => lg.room && lg.room.gameId === id, id + ' table');
    const opts = id === 'fourinarow' ? { starter: 'host', line: '5' } : { starter: 'host' };
    lg.send({ t: 'setOptions', options: opts });
    await lg.until(() => lg.room.options && lg.room.options.starter === 'host', id + ' options set');
    lg.send({ t: 'start' });
    await lg.until(() => lg.view && lg.view.game === id, id + ' started');
    assert.equal(lg.view.myTurn, true, id + ': the first seat starts with starter=host');
    assert.equal(lg.view.board.filter((x) => x !== null).length, 0);
    if (id === 'fourinarow') { assert.equal(lg.view.cols, 9, 'line length 5 plays on the bigger grid'); assert.equal(lg.view.win, 5); }
    lg.send({ t: 'act', action: send });
    await lg.until(() => lg.view && lg.view.moves >= 1, id + ' move accepted');
    lg.send({ t: 'act', action: { type: 'place', cell: 9999 } }); // refused, the table carries on
    lg.ws.close();
  }

  const sl = await authClient('Sana');
  await sl.until(() => sl.id, 'welcome Sana');
  sl.send({ t: 'create', gameId: 'snakesladders' });
  await sl.until(() => sl.room && sl.room.gameId === 'snakesladders', 'snakes and ladders table');
  sl.send({ t: 'start' });
  await sl.until(() => sl.view && sl.view.game === 'snakesladders', 'snakes and ladders started');
  assert.equal(sl.view.myTurn, true, 'the first seat starts');
  assert.equal(sl.view.canRoll, true);
  assert.equal(Object.keys(sl.view.ladders).length, 8);
  sl.send({ t: 'act', action: { type: 'roll' } });
  await sl.until(() => sl.view && sl.view.lastRoll && sl.view.lastRoll.by === 0, 'roll answered');
  assert.ok(sl.view.lastRoll.dice >= 1 && sl.view.lastRoll.dice <= 6);
  sl.send({ t: 'act', action: { type: 'move', token: 0 } }); // not an action in this game: refused, the table carries on
  sl.ws.close();

  assert.equal(a.announcement, '');
  const ann = await start({ port: 0, announcement: '  Maintenance\n at 22:00 ' + 'x'.repeat(400) });
  const an = await authClient('Ann2', ann.port);
  await an.until(() => an.id, 'welcome announcement');
  assert.ok(an.announcement.startsWith('Maintenance at 22:00'));
  an.ws.close();
  await ann.close();

  a2.send({ t: 'leave' });
  a2.ws.close();
  b.ws.close();
  sp.ws.close();
  await app.close();
  clearTimeout(guard);
  console.log('\nsmoke test passed');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
