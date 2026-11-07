'use strict';
// A WebSocket authenticates only from the ct_session cookie on the upgrade request. A token inside a hello message is
// ignored, so a page cannot present a session by message, and a conflicting token in the body never changes whose
// socket it is.
require('./helpers/env');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { registerAndVerify, sessionSocket } = require('./helpers/auth');
const { start } = require('../server');

const guard = setTimeout(() => { console.error('FAIL hello-auth test timed out'); process.exit(1); }, 60000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

/** Opens a socket (optionally with a cookie) and sends a hello. Returns what the server said and how it closed. */
function open(port, { cookieToken, helloBody }) {
  return new Promise((resolve) => {
    const o = { msgs: [], closed: null };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, sessionSocket(cookieToken));
    ws.on('message', (d) => o.msgs.push(JSON.parse(d)));
    ws.on('close', (code) => { o.closed = code; });
    ws.on('error', () => {});
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', ...(helloBody ? { token: helloBody } : {}) })));
    o.ws = ws;
    setTimeout(() => resolve(o), 250);
  });
}

(async () => {
  const srv = await start({ port: 0, trustProxy: false, botDelay: [0, 3], timeScale: 0.01, maxMsgsPerSec: Infinity, matchLog: { log() {}, warn() {}, error() {} } });
  try {
    console.log('hello authentication');
    const alice = await registerAndVerify(srv.port, { email: 'hello.alice@test.local', displayName: 'Alice', password: 'TestPass123!' });
    const bob = await registerAndVerify(srv.port, { email: 'hello.bob@test.local', displayName: 'Bob', password: 'TestPass123!' });

    await test('a token sent only inside the hello message is refused', async () => {
      const o = await open(srv.port, { helloBody: alice.token });
      assert.ok(o.msgs.some((m) => m.t === 'authRequired'), 'the server asks the page to log in');
      assert.equal(o.msgs.some((m) => m.t === 'welcome'), false, 'no welcome: the body token is not a session');
      assert.equal(o.closed, 1008);
      o.ws.close();
    });

    await test('the session cookie on the upgrade request authenticates the socket', async () => {
      const o = await open(srv.port, { cookieToken: alice.token });
      assert.ok(o.msgs.some((m) => m.t === 'welcome'), 'welcomed');
      o.ws.close();
    });

    await test('a conflicting token in the message body does not replace the cookie identity', async () => {
      const o = await open(srv.port, { cookieToken: alice.token, helloBody: bob.token });
      const welcome = o.msgs.find((m) => m.t === 'welcome');
      assert.ok(welcome, 'welcomed through the cookie');
      assert.equal(welcome.id, alice.player.id, 'the socket belongs to the cookie owner, not the body token');
      o.ws.close();
    });

    await test('no cookie and no body token is refused', async () => {
      const o = await open(srv.port, {});
      assert.ok(o.msgs.some((m) => m.t === 'authRequired'));
      assert.equal(o.closed, 1008);
      o.ws.close();
    });

    await wait(20);
    console.log(`${passed} hello authentication checks passed`);
  } finally {
    clearTimeout(guard);
    await srv.close();
  }
})().catch((e) => { console.error('FAIL hello-auth', e); process.exit(1); });
