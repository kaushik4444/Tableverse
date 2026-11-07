'use strict';
require('./helpers/env');
const { sessionSocket } = require('./helpers/auth');
/**
 * Private-table access across the room lifecycle, on a REAL PostgreSQL through the running server.
 * Policy under test: docs/PRIVATE_TABLES.md. In short: the creator and the current host always have access; everyone else needs
 * an accepted invitation from the creator or any host AND the friendship must still exist. Losing it removes people from a
 * lobby / a finished table / the spectators at once; a seat in a game that is RUNNING is finished first, and then re-entry
 * (reconnect, rejoin, rematch) is refused. Also covers: spectators never become players on their own (rematch).
 * Needs TEST_DATABASE_URL (throw-away database per run).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { Browser } = require('./helpers/auth');
const testdb = require('./helpers/testdb');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`);
    await wait(15);
  }
}

/** A socket that behaves like the browser: cookie-less, token hello, keeps the latest room/view and what the server said. */
function wsClient(port, token) {
  const c = { room: null, view: null, errors: [], notices: [], lefts: 0, rejoin: [], presence: [], messages: [], welcomed: false, auto: false, lastKey: null,
    ws: new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token)) };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.step = () => { // plays wizard: enough to finish a game
    const v = c.view;
    if (!c.auto || !v || !v.myTurn) return;
    const key = [v.phase, v.round, v.hand.length, v.trick.length, v.players.filter((p) => p.bid !== null).length].join('|');
    if (key === c.lastKey) return;
    c.lastKey = key;
    if (v.phase === 'chooseTrump') c.send({ t: 'act', action: { type: 'chooseTrump', suit: 'G' } });
    else if (v.phase === 'bidding') c.send({ t: 'act', action: { type: 'bid', amount: v.forbiddenBid === 0 ? 1 : 0 } });
    else if (v.phase === 'playing') c.send({ t: 'act', action: { type: 'play', cardId: v.legal[0] } });
  };
  c.ws.on('open', () => c.send({ t: 'hello' }));
  c.ws.on('error', () => {});
  c.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.messages.push(m);
    if (m.t === 'welcome') { c.welcomed = true; c.rejoin = m.rejoin || []; }
    if (m.t === 'tables') c.rejoin = m.rejoin || [];
    if (m.t === 'state') { c.room = m.room; c.view = m.view; c.step(); }
    if (m.t === 'left') { c.room = null; c.view = null; c.lefts++; }
    if (m.t === 'error') c.errors.push(m.message);
    if (m.t === 'notice') c.notices.push(m.text);
    if (m.t === 'socialPresence') c.presence.push(m);
    if (m.t === 'socialNotice') c.social = (c.social || []).concat(m);
  });
  return c;
}
const seated = (c, id) => Boolean(c.room && c.room.members.some((m) => m.id === id && !m.bot));
const watching = (c, id) => Boolean(c.room && c.room.spectators.some((s) => s.id === id));

async function run() {
  const t = await testdb.create();
  if (!t) return;
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-accessspool-'));
  process.env.MATCH_SPOOL_DIR = spool;
  process.env.DATABASE_URL = t.url; // before server.js is loaded: db/pool.js reads it once
  const { start } = require('../server');
  const app = await start({ port: 0, trustProxy: false, maxMsgsPerSec: Infinity, maxSocketsPerIp: 1000, botDelay: [0, 3], autoAdvanceMs: 20, trickPauseMs: 0, forcedMs: 0, matchLog: { log() {}, warn() {}, error() {} } });
  const clients = []; const playerIds = [];
  const expiresAt = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let n = 0;
  try {
    async function account(label) {
      n++;
      const browser = new Browser(app.port);
      await browser.csrf();
      const username = `${label.toLowerCase()}_${n}`;
      const reg = await browser.must('/api/auth/register', { email: `${username}@test.local`, username, password: 'TestPass123!', displayName: label });
      playerIds.push(reg.json.player.id);
      await browser.must('/api/auth/verify-email', { token: reg.json.debug.verifyToken });
      const login = await browser.must('/api/auth/login', { email: `${username}@test.local`, password: 'TestPass123!' });
      const client = wsClient(app.port, login.json.token);
      clients.push(client);
      await until(() => client.welcomed, `${label} welcome`);
      return { browser, client, username, id: reg.json.player.id, token: login.json.token, label };
    }
    /** Close this account's socket and open a new one with the same session, as a phone does after a dropped connection. */
    async function reconnect(a) {
      a.client.ws.terminate();
      a.client = wsClient(app.port, a.token);
      clients.push(a.client);
      await until(() => a.client.welcomed, `${a.label} welcome again`);
      await wait(200); // the server decides about the old table right after the welcome
      return a.client;
    }
    const befriend = async (x, y) => {
      const r = await x.browser.post('/api/me/friend-requests', { username: y.username });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.equal((await y.browser.post('/api/me/friend-requests/accept', { requestId: r.json.request.id })).status, 200);
    };
    const unfriend = async (by, other) => assert.equal((await by.browser.post('/api/me/friends/remove', { friendId: other.id })).status, 200);
    /** `host` is invited-by and `guest` accepts and joins (as a player, or watching). */
    async function invite(host, guest, code, { spectate = false, join = true } = {}) {
      const inv = await host.browser.post('/api/me/table-invitations', { username: guest.username, gameId: 'wizard', roomCode: code, expiresAt: expiresAt() });
      assert.equal(inv.status, 201, JSON.stringify(inv.json));
      assert.equal((await guest.browser.post('/api/me/table-invitations/accept', { invitationId: inv.json.invitation.id })).status, 200);
      if (join) {
        guest.client.send({ t: 'join', code, spectate });
        await until(() => (spectate ? watching(guest.client, guest.id) : seated(guest.client, guest.id)), `${guest.label} in the table`);
      }
      return inv.json.invitation.id;
    }
    /** A private lobby with a host and `guests` invited friends, all seated. */
    async function lobby(guestCount = 2) {
      const host = await account('Host');
      const guests = [];
      for (let i = 0; i < guestCount; i++) { const g = await account('Guest'); await befriend(host, g); guests.push(g); }
      host.client.send({ t: 'create', gameId: 'wizard', visibility: 'private' });
      const code = (await until(() => host.client.room && host.client.room.visibility === 'private' && host.client.room, 'private table')).code;
      for (const g of guests) await invite(host, g, code);
      return { host, guests, code };
    }
    const tryJoin = async (a, code) => { const before = a.client.errors.length; a.client.send({ t: 'join', code }); await until(() => a.client.errors.length > before || a.client.room, 'join answered'); return Boolean(a.client.room && a.client.room.code === code); };

    // ------------------------------------------------------------------------------------------------ lobby
    console.log('private lobby');
    await test('the CURRENT host removes a friend: that guest leaves at once, the other guest stays, and a reconnect does not bring them back', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      await unfriend(host, g1);
      await until(() => g1.client.room === null && g1.client.lefts >= 1, 'g1 removed from the lobby');
      assert.ok(g1.client.notices.some((x) => /no longer have access/.test(x)), 'told why');
      await until(() => !seated(host.client, g1.id), 'host sees g1 gone');
      assert.ok(seated(host.client, g2.id), 'the other guest is untouched');
      await reconnect(g1);
      assert.equal(g1.client.room, null, 'no table after reconnecting');
      assert.equal(await tryJoin(g1, code), false, 'the same code no longer works');
      assert.ok(g1.client.errors.some((e) => /accepted invitation/.test(e)));
    });

    await test('a PREVIOUS host (the inviter) removes a friend after the host changed: the guest is removed, the current host keeps their seat', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      host.client.send({ t: 'leave' });
      await until(() => g1.client.room && g1.client.room.hostId !== host.id, 'host handed over');
      const newHost = g1.client.room.hostId === g1.id ? g1 : g2;
      const stayer = newHost === g1 ? g2 : g1; // invited by the old host, now an ordinary guest
      await unfriend(host, stayer); // the OLD host, who is no longer at the table, ends the friendship
      await until(() => stayer.client.room === null, 'stayer removed although the inviter is a previous host');
      await until(() => !seated(newHost.client, stayer.id), 'new host sees the guest gone');
      assert.ok(seated(newHost.client, newHost.id), 'the current host stays');
      await reconnect(stayer);
      assert.equal(stayer.client.room, null);
      assert.equal(await tryJoin(stayer, code), false);
    });

    await test('the same, started from the GUEST side (the guest unfriends the previous host)', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      host.client.send({ t: 'leave' });
      await until(() => g1.client.room && g1.client.room.hostId !== host.id, 'host handed over');
      const newHost = g1.client.room.hostId === g1.id ? g1 : g2;
      const stayer = newHost === g1 ? g2 : g1;
      await unfriend(stayer, host);
      await until(() => stayer.client.room === null, 'guest removed after unfriending the previous host');
      assert.ok(seated(newHost.client, newHost.id));
      assert.equal(await tryJoin(stayer, code), false);
    });

    await test('accepted invitations still survive a legitimate host change (reconnect works, nobody is thrown out)', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      host.client.send({ t: 'leave' });
      await until(() => g1.client.room && g1.client.room.hostId !== host.id, 'host handed over');
      const stayer = g1.client.room.hostId === g1.id ? g2 : g1;
      await reconnect(stayer);
      await until(() => seated(stayer.client, stayer.id), 'stayer is still seated after reconnecting');
      assert.ok(!stayer.client.errors.some((e) => /invitation/.test(e)));
      assert.ok(host.client.room === null || host.client.room.code !== code);
    });

    await test('the new host (invited by the old host) keeps hosting when the old host unfriends them; guests with intact friendships are unaffected', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      host.client.send({ t: 'leave' });
      await until(() => g1.client.room && g1.client.room.hostId !== host.id, 'host handed over');
      const newHost = g1.client.room.hostId === g1.id ? g1 : g2;
      const other = newHost === g1 ? g2 : g1;
      const late = await account('Late'); await befriend(newHost, late);
      await invite(newHost, late, code); // invited by the CURRENT host
      await unfriend(host, newHost);
      await wait(400);
      assert.ok(seated(newHost.client, newHost.id), 'a host is never thrown out of the table they run');
      assert.ok(seated(late.client, late.id), 'a guest of the current host is unaffected');
      assert.ok(seated(newHost.client, other.id), 'a guest whose own friendship is intact is unaffected');
    });

    await test('the CREATOR is never removed from their own table, whoever hosts now', async () => {
      const { host: creator, guests: [g1], code } = await lobby(1);
      creator.client.send({ t: 'leave' });
      await until(() => g1.client.room && g1.client.room.hostId === g1.id, 'guest hosts');
      assert.equal(await tryJoin(creator, code), true, 'the creator can come back without any invitation');
      await unfriend(g1, creator);
      await wait(400);
      assert.ok(seated(g1.client, creator.id), 'still seated');
      await reconnect(creator);
      assert.ok(seated(creator.client, creator.id), 'and still seated after reconnecting');
    });

    await test('any seated player can invite (not only the host); a decline tells the inviter, who can invite again', async () => {
      const { host, guests: [g1], code } = await lobby(1);
      const late = await account('Late'); await befriend(g1, late);
      assert.equal(await invite(g1, late, code).then(() => 'ok'), 'ok', 'a seated guest invited a friend and that friend got in');
      assert.ok(seated(late.client, late.id));
      const other = await account('Other'); await befriend(g1, other);
      const inv = await g1.browser.post('/api/me/table-invitations', { username: other.username, gameId: 'wizard', roomCode: code, expiresAt: expiresAt() });
      assert.equal(inv.status, 201);
      assert.equal((await other.browser.post('/api/me/table-invitations/decline', { invitationId: inv.json.invitation.id })).status, 200);
      await until(() => (g1.client.social || []).some((n) => n.kind === 'invitation-declined'), 'the inviter hears about the decline');
      assert.equal((await g1.browser.post('/api/me/table-invitations', { username: other.username, gameId: 'wizard', roomCode: code, expiresAt: expiresAt() })).status, 201, 'invite again after a decline');
      const stranger = await account('Stranger'); await befriend(other, stranger);
      assert.equal((await other.browser.post('/api/me/table-invitations', { username: stranger.username, gameId: 'wizard', roomCode: code, expiresAt: expiresAt() })).status, 404, 'someone who is not seated cannot invite');
    });
    await test('new invitations after a removal: refused until they are friends again; the old (revoked) invitation never works again; a fresh one does', async () => {
      const { host, guests: [g1], code } = await lobby(1);
      await unfriend(host, g1);
      await until(() => g1.client.room === null, 'removed');
      const refused = await host.browser.post('/api/me/table-invitations', { username: g1.username, gameId: 'wizard', roomCode: code, expiresAt: expiresAt() });
      assert.equal(refused.status, 404, 'not friends any more');
      await befriend(host, g1);
      assert.equal(await tryJoin(g1, code), false, 'friends again, but the old invitation was revoked');
      await invite(host, g1, code);
      assert.ok(seated(g1.client, g1.id), 'a new invitation works');
    });

    await test('an expired invitation stops NEW entries but never throws out someone who is already seated', async () => {
      const { host, guests: [g1], code } = await lobby(1);
      const dbPool = require('../db/pool');
      await dbPool.query("UPDATE private_table_invitations SET created_at = NOW() - INTERVAL '2 hours', expires_at = NOW() - INTERVAL '1 hour' WHERE invitee_id = $1", [g1.id]);
      await reconnect(g1);
      assert.ok(seated(g1.client, g1.id), 'a reconnect keeps the seat');
      g1.client.send({ t: 'leave' });
      await until(() => g1.client.room === null, 'left');
      assert.equal(await tryJoin(g1, code), false, 'coming back later needs a valid invitation');
      assert.ok(host.client.room);
    });

    await test('a public table made private keeps the people already at it; newcomers need an invitation', async () => {
      const owner = await account('Owner'); const early = await account('Early'); const late = await account('Late');
      owner.client.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      const code = (await until(() => owner.client.room && owner.client.room, 'public table')).code;
      assert.equal(await tryJoin(early, code), true);
      owner.client.send({ t: 'setVisibility', visibility: 'private' });
      await until(() => owner.client.room.visibility === 'private', 'now private');
      await reconnect(early);
      assert.ok(seated(early.client, early.id), 'already here: stays');
      assert.equal(await tryJoin(late, code), false, 'a newcomer is refused');
    });

    // ------------------------------------------------------------------------------------------------ running game
    console.log('running game');
    const startGame = async (host) => { host.client.send({ t: 'start' }); await until(() => host.client.room && host.client.room.status === 'playing', 'game running'); };

    await test('seated in a RUNNING game: the player may finish it, but a reconnect is refused and a bot takes the seat; no "Rejoin" is offered', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      await startGame(host);
      await unfriend(host, g1);
      await until(() => g1.client.notices.some((x) => /finish this game/.test(x)), 'g1 told they can finish');
      await wait(300);
      assert.ok(seated(g1.client, g1.id) && g1.client.room.status === 'playing', 'still in the running game');
      assert.ok(seated(host.client, g1.id) && !host.client.room.members.find((m) => m.id === g1.id).bot, 'the game is not aborted');
      await reconnect(g1);
      assert.equal(g1.client.room, null, 'the reconnect is refused');
      assert.ok(g1.client.errors.some((e) => /accepted invitation/.test(e)));
      await until(() => host.client.room.members.find((m) => m.id === g1.id)?.bot === true, 'a bot took the seat');
      assert.ok(!g1.client.rejoin.some((r) => r.code === code), 'the home screen does not offer to rejoin');
      assert.equal(await tryJoin(g1, code), false, 'and rejoining by code is refused too');
      assert.ok(seated(g2.client, g2.id), 'the other guest plays on');
    });

    await test('SPECTATING a running game: removing the friendship takes the spectator out immediately', async () => {
      const { host, guests: [g1], code } = await lobby(1);
      const fan = await account('Fan'); await befriend(host, fan);
      await invite(host, fan, code, { join: false }); // invitations can only be issued while the table is a lobby
      await startGame(host);
      fan.client.send({ t: 'join', code, spectate: true }); // the game is running: the invited friend watches
      await until(() => watching(host.client, fan.id), 'fan watching');
      await unfriend(host, fan);
      await until(() => fan.client.room === null, 'spectator removed');
      await until(() => !watching(host.client, fan.id), 'gone from the spectator list');
      assert.ok(seated(g1.client, g1.id));
      await reconnect(fan);
      assert.equal(await tryJoin(fan, code), false);
    });

    await test('presence never reveals a private table code (REST and live), only the game being played', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      await startGame(host);
      await wait(500);
      for (const viewer of [g1, g2]) {
        const body = JSON.stringify((await viewer.browser.get('/api/me/friends')).json);
        assert.ok(!body.includes(code), 'friends list has no table code');
        assert.ok(/"playing":"wizard"/.test(body), 'but says which game');
      }
      assert.ok(host.client.presence.length > 0, 'live presence reached the host');
      assert.ok(!JSON.stringify([host, g1, g2].map((x) => x.client.presence)).includes(code), 'live presence has no table code');
    });

    // ------------------------------------------------------------------------------------------------ finished game, rematch
    console.log('finished game and rematch');
    const playToEnd = async (everyone, hostAcct) => {
      for (const a of everyone) { a.client.auto = true; a.client.step(); }
      await until(() => hostAcct.client.room && hostAcct.client.room.status === 'finished', 'game finished', 120000);
      for (const a of everyone) a.client.auto = false;
    };

    await test('a player who lost access during the game is removed when the host starts the rematch', async () => {
      const { host, guests: [g1, g2] } = await lobby(2);
      await startGame(host);
      await unfriend(host, g1);
      await playToEnd([host, g1, g2], host);
      assert.ok(seated(g1.client, g1.id), 'they were allowed to finish the game');
      host.client.send({ t: 'rematch' });
      await until(() => g1.client.room === null, 'g1 removed at the rematch');
      await until(() => host.client.room && host.client.room.status === 'lobby', 'lobby again');
      assert.ok(!seated(host.client, g1.id));
      assert.ok(seated(host.client, g2.id), 'the other guest is carried over');
    });

    await test('SPECTATOR REGRESSION: a spectator never becomes a player when the host restarts, even with an open seat; they can sit by choice', async () => {
      const { host, guests: [g1, g2], code } = await lobby(2);
      const fan = await account('Fan'); await befriend(host, fan);
      await invite(host, fan, code, { join: false });
      await startGame(host);
      fan.client.send({ t: 'join', code, spectate: true });
      await until(() => watching(host.client, fan.id), 'fan watching');
      await playToEnd([host, g1, g2], host);
      g2.client.send({ t: 'leave' }); // frees a seat
      await until(() => !seated(host.client, g2.id), 'seat is free');
      host.client.send({ t: 'rematch' });
      await until(() => host.client.room && host.client.room.status === 'lobby', 'lobby again');
      await wait(300);
      assert.ok(watching(host.client, fan.id), 'still a spectator');
      assert.ok(!seated(host.client, fan.id), 'not seated');
      assert.ok(host.client.room.members.filter((m) => !m.bot).length < host.client.room.seats, 'there really was room');
      fan.client.send({ t: 'sit' });
      await until(() => seated(host.client, fan.id), 'sits on request');
      assert.ok(!watching(host.client, fan.id));
    });

    await test('a spectator also stays a spectator in a PUBLIC table rematch', async () => {
      const host = await account('PubHost'); const p2 = await account('PubTwo'); const p3 = await account('PubThree'); const fan = await account('PubFan');
      host.client.send({ t: 'create', gameId: 'wizard', visibility: 'public' });
      const code = (await until(() => host.client.room && host.client.room, 'public table')).code;
      await tryJoin(p2, code); await tryJoin(p3, code);
      await startGame(host);
      fan.client.send({ t: 'join', code, spectate: true });
      await until(() => watching(fan.client, fan.id), 'fan watching');
      await playToEnd([host, p2, p3], host);
      p3.client.send({ t: 'leave' });
      await until(() => !seated(host.client, p3.id), 'seat free');
      host.client.send({ t: 'rematch' });
      await until(() => host.client.room.status === 'lobby', 'lobby');
      await wait(300);
      assert.ok(watching(host.client, fan.id) && !seated(host.client, fan.id));
    });

    console.log(`\n${passed} private-table access tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
  } finally {
    for (const c of clients) c.ws.terminate();
    await app.close();
    try {
      if (playerIds.length) { const x = await t.client(); try { await x.query('DELETE FROM players WHERE id = ANY($1::uuid[])', [playerIds]); } finally { await x.end(); } }
    } catch { /* best effort */ }
    fs.rmSync(spool, { recursive: true, force: true });
    await t.drop();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
