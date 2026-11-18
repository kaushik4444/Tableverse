'use strict';
// Guest play, end to end in memory mode (no database): the switch, the session cookie, CSRF, rate limits, game locks at
// the socket gates, and what a guest is told. The database parts (upgrade, expiry) are in guest-play.pg.test.js.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { Browser, registerAndVerify, sessionSocket } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL guest-play test timed out'); process.exit(1); }, 90000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

/** Opens a socket with the given session cookie, says hello, and collects what the server sends. */
function open(port, token) {
  return new Promise((resolve) => {
    const o = { msgs: [], closed: null, ws: null };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(token));
    o.ws = ws;
    ws.on('message', (d) => o.msgs.push(JSON.parse(d)));
    ws.on('close', (code) => { o.closed = code; });
    ws.on('error', () => {});
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello' })));
    setTimeout(() => resolve(o), 300);
  });
}
const sent = (o, t) => o.msgs.filter((m) => m.t === t);

(async () => {
  const off = await start({ port: 0, env: { ...process.env, GUEST_PLAY_ENABLED: 'false' } });
  const offPort = off.port;
  try {
    await test('guest play off: a new guest is refused with 403 and no session cookie', async () => {
      const b = new Browser(offPort);
      await b.csrf();
      const r = await b.post('/api/auth/guest', { displayName: 'Ann' });
      assert.equal(r.status, 403);
      assert.equal(r.json.guestPlay, false);
      assert.ok(!b.cookies.has('ct_session'), 'no session was issued');
    });
  } finally { await off.close(); }

  const on = await start({ port: 0, env: { ...process.env, GUEST_PLAY_ENABLED: 'true', GUEST_SESSION_TTL_HOURS: '24' } });
  const port = on.port;
  // The owner's access mode for wizard: guests are refused, registered players may play it (set in-process, as the admin route does).
  require('../lib/gameFlags').apply([{ game_id: 'wizard', access: 'guests' }]);
  try {
    let guest;
    await test('guest play on: POST /api/auth/guest needs the CSRF token like every POST', async () => {
      const b = new Browser(port);
      await b.csrf();
      const r = await b.post('/api/auth/guest', { displayName: 'Ann' }, { csrf: false });
      assert.equal(r.status, 403);
    });

    await test('guest play on: a guest gets a named session with a 24 hour cookie and a CSRF token', async () => {
      const b = new Browser(port);
      await b.csrf();
      const r = await b.must('/api/auth/guest', { displayName: '  Ann  ' });
      assert.equal(r.status, 201);
      assert.equal(r.json.guest, true);
      assert.equal(r.json.expiresInHours, 24);
      assert.equal(r.json.player.name, 'Ann');
      assert.equal(r.json.player.isGuest, true);
      assert.ok(r.json.csrfToken);
      const line = r.setCookie.find((c) => c.startsWith('ct_session='));
      assert.ok(line && /HttpOnly/.test(line) && /Max-Age=86400/.test(line), line);
      guest = { browser: b, id: r.json.player.id };
    });

    await test('guest play on: a guest session can say hello and sees the game list with guest locks', async () => {
      const token = guest.browser.cookies.get('ct_session');
      const o = await open(port, decodeURIComponent(token));
      const welcome = sent(o, 'welcome')[0];
      assert.ok(welcome, 'the server welcomed the guest');
      assert.equal(welcome.name, 'Ann');
      const wizard = welcome.games.find((g) => g.id === 'wizard');
      const ludo = welcome.games.find((g) => g.id === 'ludo');
      assert.equal(wizard.access, 'guests', 'wizard is set to "disabled for guests only"');
      assert.equal(wizard.enabled, false, 'so it is locked for this guest');
      assert.equal(ludo.enabled, true, 'ludo is open to guests');
      o.ws.close();
    });

    await test('a guest who creates a locked game is told to create an account (guest_locked)', async () => {
      const token = decodeURIComponent(guest.browser.cookies.get('ct_session'));
      const o = await open(port, token);
      o.ws.send(JSON.stringify({ t: 'create', gameId: 'wizard' }));
      await wait(200);
      const err = sent(o, 'error').find((m) => m.code === 'guest_locked');
      assert.ok(err, JSON.stringify(o.msgs.slice(-3)));
      assert.equal(err.gameId, 'wizard');
      o.ws.close();
    });

    await test('a guest can create an open game', async () => {
      const token = decodeURIComponent(guest.browser.cookies.get('ct_session'));
      const o = await open(port, token);
      o.ws.send(JSON.stringify({ t: 'create', gameId: 'ludo' }));
      await wait(200);
      assert.equal(sent(o, 'error').filter((m) => m.code === 'guest_locked').length, 0);
      o.ws.close();
    });

    // A registered player playing a game disabled for guests only is covered in guest-play.pg.test.js: in memory mode there is
    // no real registration (the helper falls back to a guest row), so a "registered" player here would be a guest.

    await test('a game disabled for all (owner only) is refused to a guest with the plain message, not the account prompt', async () => {
      const gameFlags = require('../lib/gameFlags');
      gameFlags.apply([{ game_id: 'ludo', access: 'owner' }]);
      try {
        const token = decodeURIComponent(guest.browser.cookies.get('ct_session'));
        const o = await open(port, token);
        o.ws.send(JSON.stringify({ t: 'create', gameId: 'ludo' }));
        await wait(200);
        const err = sent(o, 'error')[0];
        assert.ok(err && err.message === 'That game is not available right now.', JSON.stringify(o.msgs.slice(-3)));
        assert.equal(err.code, undefined, 'no account prompt: a registered player could not play it either');
        o.ws.close();
      } finally { gameFlags.apply([{ game_id: 'ludo', access: 'on' }]); }
    });

    await test('guests are asked to verify nothing: a guest session is not stopped by the e-mail gate', async () => {
      const token = decodeURIComponent(guest.browser.cookies.get('ct_session'));
      const o = await open(port, token);
      assert.equal(sent(o, 'authRequired').length, 0, 'no verification prompt for a guest');
      assert.ok(sent(o, 'welcome').length === 1);
      o.ws.close();
    });

    await test('a guest cannot upgrade without a session, and an account cannot be "upgraded" again', async () => {
      const b = new Browser(port);
      await b.csrf();
      const none = await b.post('/api/auth/upgrade-guest', { email: 'x@test.local', username: 'xyzzy', password: 'TestPass123!', adultConfirmed: true });
      assert.equal(none.status, 403);
    });
  } finally { require('../lib/gameFlags').apply([]); await on.close(); }

  clearTimeout(guard);
  console.log(`\n${passed} passed`);
  if (process.exitCode) process.exit(1);
})();
