'use strict';
/**
 * A real http server around lib/authRoutes.js with the admin routes mounted exactly as server.js mounts them (same CSRF check,
 * same error handling, same session cookie), on the in-memory store. No WebSocket server and no database are needed.
 */
require('./env');
require('./fakeArgon');
const http = require('node:http');
const { createAuthRoutes } = require('../../lib/authRoutes');
const { createAdminRoutes } = require('../../lib/adminRoutes');
const { createMemoryAdminStore } = require('./memoryAdminStore');
const { Browser } = require('./auth');
const dbPlayers = require('../../db/players');

async function start({ env = {}, analytics = null, store: given = null, clock = { t: Date.parse('2026-11-08T10:00:00Z') }, mail = [], broadcastMail = [] } = {}) {
  require('../../db/rateLimit').resetMemoryCountersForTests();
  const now = () => new Date(clock.t);
  const e = { NODE_ENV: 'test', ...env };
  const store = given || createMemoryAdminStore({ now, env: e });
  const signedOutCalls = [];
  // stand-ins for the database token issue and the mail sender: `mail` collects what would have been sent
  const auth = { resendVerification: async ({ email }) => ({ ok: true, verifyToken: 'tok-' + mail.length, email }) };
  const queued = { count: 0 };
  // broadcastMail collects the broadcast messages the worker would have handed to the provider (headers included)
  const emailSender = {
    sendVerification: async ({ email, token }) => { mail.push({ email, token }); },
    sendBroadcast: async (m) => { broadcastMail.push(m); },
  };
  const sendJson = (res, status, body) => { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.writeHead(status); res.end(JSON.stringify(body)); };
  const readJsonBody = (req) => new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (c) => { text += c; if (text.length > 65536) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('invalid json')); } });
  });
  const routes = createAuthRoutes({
    env: e, production: false, trustProxy: false, emailSender: {}, sendJson, readJsonBody, log: { error() {}, warn() {}, log() {} },
    extraRoutes: (ctx) => createAdminRoutes({ env: e, store, analytics, now, ctx, platform: () => ({ rooms: 0 }), idPattern: /^(p_)?[0-9a-f-]{36}$/i, // in-memory players have p_<uuid> ids; production uses plain UUIDs
       auth, emailSender, onSignedOut: (o) => signedOutCalls.push(o),
       onBroadcastQueued: () => { queued.count++; }, makeUnsubscribeUrl: (t) => 'https://app.test/api/email/unsubscribe?token=' + t }).routes,
    onEvent: () => {},
  });
  const server = http.createServer((req, res) => {
    const rel = new URL(req.url, 'http://x').pathname;
    routes.handle(req, res, rel).then((done) => { if (!done) { res.writeHead(404); res.end(); } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  /** A signed-in browser (cookie jar + CSRF) for a fresh player, registered in the store with `role`. */
  async function login({ role = 'user', email = null, verified = false } = {}) {
    const created = await dbPlayers.createAnonymousPlayer({ displayName: 'P', avatar: '🧙' });
    store.addPlayer(created.player.id, { role, email, verified, username: 'u' + created.player.id.slice(0, 6) });
    const b = new Browser(port);
    b.cookies.set('ct_session', encodeURIComponent(created.rawToken));
    await b.csrf();
    return { b, id: created.player.id, token: created.rawToken };
  }
  /** Another device of the same account: same session cookie, a different cookie jar. */
  async function otherDevice(token) {
    const b = new Browser(port);
    b.cookies.set('ct_session', encodeURIComponent(token));
    await b.csrf();
    return b;
  }
  async function guest() { const b = new Browser(port); await b.csrf(); return b; }
  return { port, store, clock, env: e, signedOutCalls, queued, login, otherDevice, guest, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { start };
