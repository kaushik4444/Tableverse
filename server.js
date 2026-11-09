'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const games = require('./games');
const pacing = require('./games/pacing');
const dbPool = require('./db/pool');
const { prepareDatabase } = require('./db/startup');
const { buildMatchRecord } = require('./db/matchRecord');
const dbPlayers = require('./db/players');
const dbAuth = require('./db/auth');
const dbMatches = require('./db/matches');
const { createMatchQueue, defaultSpoolDir } = require('./db/matchQueue');
const { makeAuthEmailSender } = require('./lib/email');
const { createAuthRoutes } = require('./lib/authRoutes');
const dbAccount = require('./db/account');
const { DELETED_NAME } = dbAccount;
const dbFriends = require('./db/friends');
const dbModeration = require('./db/moderation');
const moderation = require('./lib/moderation');
const { decideAccess } = require('./lib/roomAccess');
const { scrubText } = require('./games/scrub');
const { createStaticFiles } = require('./lib/staticFiles');
const { enqueueSocketMessage, createBoundedSerialQueue, sendBounded, sendBoundedRaw } = require('./lib/wsLimits');
const voiceRelay = require('./lib/voiceRelay');
const { clientAddress, parseTrustProxy } = require('./lib/clientIp');
const { debugTokensEnabled, assertSafeDebugConfig } = require('./lib/debugTokens');
const { createReadinessCheck } = require('./lib/health');
const { createAnalytics } = require('./lib/analytics');
const meteredTurn = require('./lib/meteredTurn');
const { createAdminRoutes } = require('./lib/adminRoutes');
const { createLogger, requestIdFrom } = require('./lib/log');
const serverLog = createLogger({ component: 'server' });
const httpLog = createLogger({ component: 'http' });
const wsLog = createLogger({ component: 'ws' });

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()', // the microphone is for table voice chat
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O
const BOT_NAMES = ['Merlin', 'Morgana', 'Gandalf', 'Circe', 'Rincewind', 'Radagast', 'Elminster', 'Oz'];
const MAX_ROOMS = 500;
const DEFAULT_MAX_SPECTATORS = 20;
const CHAT_KEEP = 60; // messages remembered per table
const AVATARS = ['🧙', '🧝', '🧛', '🧞', '🦊', '🐺', '🦉', '🐉', '🦄', '🐙', '🐸', '🦁', '🐼', '🐯', '🦅', '🐲'];
const EMOTES = ['👍', '👏', '😂', '😮', '😡', '🤔', '🔥', '😎'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const rand = (a, b) => a + Math.random() * (b - a);
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) : '');
const cleanText = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '');

function start(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT || 3000);
  const botDelay = opts.botDelay || [900, 1600]; // ms range a bot "thinks"
  const autoAdvanceMs = opts.autoAdvanceMs ?? 8000; // pause between rounds
  const absentMs = opts.absentMs ?? 15000; // a disconnected human's turn is played by a bot after this
  const maxRtcPerSec = opts.maxRtcPerSec ?? 200; // table voice setup messages
  const sessionCheckMs = opts.sessionCheckMs ?? 60000; // an open socket's session is re-checked this often
  const maxMsgsPerSec = opts.maxMsgsPerSec ?? 30; // per socket; humans send a handful of messages per minute
  const maxQueuedMessages = opts.maxQueuedMessages ?? 100; // bound async work queued behind slow database operations
  const maxPendingHellos = opts.maxPendingHellos ?? 250; // bound the global serial authentication queue during connection floods
  const maxBufferedBytes = opts.maxBufferedBytes ?? 1024 * 1024; // disconnect slow consumers before outbound memory grows without bound
  const botScale = opts.botDelay ? Math.min(1, opts.botDelay[1] / 1600) : 1; // tests run with fast bots; plugin-timed bots follow
  const trickPauseMs = opts.trickPauseMs ?? 1700; // time everybody gets to see a finished trick being collected
  const env = opts.env || process.env;
  // ICE servers for table voice, sent in each welcome. TURN may get a login made for that player (see lib/voiceRelay.js).
  // Metered REST credentials are created ahead of use (lib/meteredTurn.js); null unless METERED_APP_NAME, METERED_SECRET_KEY and TURN_URL are set
  // a new Metered credential is pushed to every connected signed-in player the moment it becomes usable (no reconnect needed)
  const pushIceToAll = () => {
    for (const ws of wss.clients) {
      const p = ws.player;
      if (p && ws.authToken && !ws.revoked && ws.readyState === 1) send(ws, { t: 'ice', ...iceMsg(p.id) });
    }
  };
  const metered = opts.metered !== undefined ? opts.metered : meteredTurn.fromEnv(env, { log: opts.log || console, onReady: pushIceToAll, onChange: pushIceToAll });
  const iceFor = (playerId) => opts.iceServers ?? voiceRelay.iceServers(env, { playerId, metered });
  /** The ICE list for one player, with the time its TURN login stops working (null when it does not expire). */
  // A list given through opts (tests, or a fixed deployment) is static: nothing in it is treated as expiring.
  // turnStatus tells the browser what voice can rely on: ready | pending | unavailable | quota (Metered), static, or none
  const turnStatus = () => (metered ? metered.status() : (env.TURN_URL ? 'static' : 'none'));
  const iceMsg = (playerId) => { const ice = iceFor(playerId); return { ice, turnStatus: turnStatus(), iceExpiresAt: opts.iceServers ? null : voiceRelay.iceExpiresAt(ice, env, metered) }; };
  const ICE_REFRESH_MIN_MS = 20000; // a browser may ask for fresh logins at most this often (see the 'ice' handler)
  assertSafeDebugConfig(env); // refuses test mode or a non-production NODE_ENV on a hosted deployment, before anything listens
  const production = env.NODE_ENV === 'production';
  const trustProxy = opts.trustProxy ?? parseTrustProxy(env.TRUST_PROXY, production); // behind Render's proxy the client address is in X-Forwarded-For
  // Origins are compared exactly as browsers send them: lower case, no trailing slash ("https://www.example.com/" never matches).
  const allowedOrigins = String(opts.allowedOrigins ?? env.ALLOWED_ORIGINS ?? '').split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  const maxSocketsPerIp = opts.maxSocketsPerIp ?? 40; // open WebSockets per client address
  const maxNewAccountsPerIp = opts.maxNewAccountsPerIp ?? 30; // new anonymous accounts per client address per hour
  const maxNewAccountsPerMin = opts.maxNewAccountsPerMin ?? 120; // site-wide backstop: stops a spoofed-address flood from filling the database
  const maxPlayers = opts.maxPlayers ?? 5000; // players held in memory
  const database = opts.database || { prepare: () => prepareDatabase() };
  // Finished games are saved in the background with retries; see db/matchQueue.js. `rooms` is declared below, which is fine:
  // the callback only runs later.
  const matchQueue = opts.matchQueue || createMatchQueue({
    record: opts.matchRecord || ((rec) => dbMatches.recordMatch(rec)), // opts.matchRecord / matchLog: test hooks (failure injection, quiet logs)
    log: opts.matchLog || console,
    spoolDir: dbPool.hasDatabase() ? (opts.matchSpoolDir !== undefined ? opts.matchSpoolDir : defaultSpoolDir(env)) : null, // memory mode cannot fail, so it needs no spool
    delays: opts.matchRetryDelays,
    onGiveUp: (rec) => {
      const room = rooms.get(rec.roomCode);
      if (room && room.matchKey === rec.matchKey) sys(room, '⚠ The result of this game could not be saved right now, so it may be missing from stats.');
    },
  });
  const MAX_SPECTATORS = opts.maxSpectators ?? DEFAULT_MAX_SPECTATORS; // tests lower it
  const timeScale = opts.timeScale ?? 1; // tests shrink the turn time limit with this
  // Optional site-wide notice (set the ANNOUNCEMENT env var, or pass opts.announcement); shown as a dismissible banner on the home screen
  const announcement = cleanText(opts.announcement ?? process.env.ANNOUNCEMENT ?? '');
  const dropGraceMs = opts.dropGraceMs ?? 4000; // a lost connection is announced to the table after this
  const forcedMs = opts.forcedMs ?? 700; // delay between automatic plays in the last trick of a round

  const players = new Map(); // id -> player
  const tokens = new Map(); // secret token -> player
  const rooms = new Map(); // code -> room
  const presence = new Map(); // player id -> { online, lastSeen }; best-effort and instance-local
  // What a friend may see: online now (a live socket), when they were last seen, and WHICH GAME they are playing (never the
  // table code, so presence cannot be used to find a private table).
  const playingAt = (id) => {
    const q = players.get(id);
    const room = q && q.room ? rooms.get(q.room) : null;
    return room && room.status === 'playing' && room.members.some((m) => m.id === id && !m.bot) ? room.gameId : null;
  };
  const presenceView = {
    get: (id) => {
      const q = players.get(id);
      const online = Boolean(q && q.connected);
      return { online, lastSeen: (presence.get(id) || {}).lastSeen || null, playing: online ? playingAt(id) : null, ping: online && q ? q.pingMs ?? null : null };
    },
  };
  const presenceTimers = new Map();
  function schedulePresence(id) { // debounced: evaluated after the table state has settled
    if (!id || !dbPool.hasDatabase() || presenceTimers.has(id)) return;
    const timer = setTimeout(() => { presenceTimers.delete(id); publishPresence(id); }, 150);
    if (timer.unref) timer.unref();
    presenceTimers.set(id, timer);
  }
  let purgeTimer = null;
  let spoolTimer = null;
  let shuttingDown = false; // set when the process is asked to stop: readiness fails, no new tables, players are told
  // Readiness: the database must answer within 3 s; an outage is logged once when it starts and once when it ends (lib/health.js).
  const readiness = createReadinessCheck({
    hasDatabase: () => dbPool.hasDatabase(),
    ping: () => dbPool.ping(),
    shuttingDown: () => shuttingDown,
    queueStats: () => matchQueue.stats(),
    log: createLogger({ component: 'health' }),
  });

  // ------------------------------------------------------------ http
  const readJsonBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      let text = '';
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          reject(new Error('payload too large'));
          req.destroy();
          return;
        }
        text += chunk.toString('utf8');
      });
      req.on('end', () => {
        if (!text) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('invalid json'));
        }
      });
      req.on('error', reject);
    });

  const setSecurityHeaders = (res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  };
  const setCommonHeaders = (res, contentType = 'application/json; charset=utf-8') => {
    res.setHeader('Content-Type', contentType);
    setSecurityHeaders(res);
  };

  const sendJson = (res, status, body) => {
    setCommonHeaders(res);
    res.setHeader('Cache-Control', 'no-store'); // API answers can be personal: never cached by a browser or proxy
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };

  const includeDebugTokens = debugTokensEnabled(env); // only tests receive raw tokens in responses (they are not browsers)
  const emailSender = opts.emailSender || makeAuthEmailSender({ env, logger: opts.log || console });
  // Stage 20.5: privacy-light analytics (buffered, never blocks) and the admin store. Both need PostgreSQL; without it they are off.
  const dbAdmin = dbPool.hasDatabase() ? require('./db/admin') : null;
  // Close this player's sockets that were opened with a session that no longer exists. `token` limits it to one
  // session (logout); `exceptToken` spares the session that was just created (a new login retires the old ones, 4002).
  // Used by the auth routes and by the admin console's sign-out.
  const closeSignedOutSockets = ({ playerId, token, exceptToken }) => {
    for (const ws of wss.clients) {
      const owner = ws.player || ws.pendingPlayer; // a socket still being checked belongs to its session too
      if (!owner || owner.id !== playerId) continue;
      if (token && ws.authToken !== token) continue;
      if (exceptToken && ws.authToken === exceptToken) continue;
      revokeSocket(ws, exceptToken ? 4002 : 4001, exceptToken ? 'signed in elsewhere' : 'signed out');
    }
  };
  const analytics = createAnalytics({ store: dbAdmin, enabled: env.ANALYTICS_ENABLED !== '0', log: opts.log || console });
  // A registered account counts as active once per UTC day: at its first authenticated message of that day, not only at login,
  // so a session that stays open across midnight is counted for the new day too.
  const markActive = (p, ws) => {
    if (!ws || !ws.authToken) return; // registered accounts only
    const day = new Date().toISOString().slice(0, 10);
    if (p.activeDay === day) return;
    p.activeDay = day;
    analytics.active(p.id); // the store keeps a keyed hash, not the id
  };
  const trackError = (code) => analytics.track('error', code);
  const adminPlatform = () => ({
    uptimeSec: Math.round(process.uptime()), node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    mode: dbPool.hasDatabase() ? 'postgres' : 'memory', rooms: rooms.size, players: players.size, sockets: wss.clients.size, shuttingDown,
  });
  const authRoutes = createAuthRoutes({
    env,
    onEvent: (metric, dim, playerId) => { analytics.track(metric, dim || ''); if (playerId) analytics.active(playerId); },
    extraRoutes: (ctx) => createAdminRoutes({
      env, store: dbAdmin, analytics, platform: adminPlatform, ctx,
      onSignedOut: closeSignedOutSockets,
    }).routes,
    production,
    trustProxy,
    emailSender,
    sendJson,
    readJsonBody,
    avatars: AVATARS,
    log: opts.log || console,
    // a signed-out or reset account must not keep playing on an already open socket
    // Is this table code still open on this server? ('lobby' | 'playing' | null). Used to drop stale recent tables.
    tableStatus: (code) => { const r = rooms.get(code); return r ? r.status : null; },
    friendsContext: {
      presence: presenceView,
      validateRoomInvite: async (inviterId, gameId, roomCode) => {
        const room = rooms.get(roomCode);
        const player = players.get(inviterId);
        return Boolean(room && player && room.visibility === 'private' && room.status === 'lobby' && room.gameId === gameId && player.room === roomCode
          && (room.hostId === inviterId || room.members.some((m) => m.id === inviterId && !m.bot)) // any seated player can invite, not only the host
          && ((room.hosts || (room.hosts = new Set())).add(inviterId), true)); // their accepted invitations stay valid like a host's
      },
      onEvent: (event) => (event.type === 'friend-removed' ? onFriendRemoved(event.playerId, event.friendId) : notifyAccount(event.playerId, event)),
    },
    onSignedOut: closeSignedOutSockets,
    // the display name and/or avatar was changed over HTTP (profile page): same effect as the lobby's own change
    onProfileChanged: ({ playerId, displayName, avatar }) => {
      const p = players.get(playerId);
      if (!p) return;
      if (displayName) p.name = displayName;
      if (avatar && AVATARS.includes(avatar)) p.avatar = avatar;
      const room = rooms.get(p.room);
      if (!room) return;
      const m = room.members.find((x) => x.id === p.id);
      if (m) {
        if (displayName && room.status !== 'playing') m.name = p.name; // a running game keeps the names it started with
        if (avatar && AVATARS.includes(avatar)) m.avatar = p.avatar;
      }
      const s = room.spectators.find((x) => x.id === p.id);
      if (s) {
        if (displayName) s.name = p.name;
        if (avatar && AVATARS.includes(avatar)) s.avatar = p.avatar;
      }
      broadcast(room);
    },
    // the account no longer exists: leave the table, close the socket, forget the player on this server
    onAccountDeleted: ({ playerId }) => {
      // drop this account's pseudonymous activity: pending in memory first (so no later write recreates it), then the stored rows
      if (dbAdmin) analytics.forget(playerId, () => dbAdmin.forgetActor(playerId)).catch(() => {}); // best effort
      const p = players.get(playerId);
      if (!p) return;
      // The real name must not outlive the account anywhere: not in the table, its log or chat, and not in the match
      // record when the game finishes. Rename the seat everywhere first, then let the player leave (a bot keeps it).
      // Every name this person went by at a table: the lobby name, the name a running game started with, a stale copy.
      const oldNames = new Set([p.name]);
      for (const room of rooms.values()) {
        for (const m of [...room.members, ...room.spectators]) if (m.id === playerId) oldNames.add(m.name);
      }
      oldNames.delete(DELETED_NAME);
      p.name = DELETED_NAME;
      for (const room of rooms.values()) {
        const seated = [...room.members, ...room.spectators].filter((m) => m.id === playerId);
        if (!seated.length && p.room !== room.code) continue;
        for (const m of seated) { m.name = DELETED_NAME; m.avatar = '🧙'; }
        // the game's own copy: players, every log line, trick records (the plugin owns its state)
        if (room.game && typeof room.game.scrub === 'function') room.game.scrub([...oldNames], DELETED_NAME);
        // chat: their messages, and every system line or message that mentions the name in plain text
        for (const c of room.chat || []) {
          if (c.id === playerId) { c.name = DELETED_NAME; c.avatar = '🧙'; }
          if (typeof c.text === 'string') c.text = scrubText(c.text, [...oldNames], DELETED_NAME);
        }
      }
      try { if (p.room) leaveRoom(p); } catch { /* the player is going away either way */ }
      if (p.ws) revokeSocket(p.ws, 4001, 'account deleted');
      // another device that signed in separately has its own socket (and its own player object): close those too
      // a socket still being checked for this account (its hello is awaiting the database) is closed too
      for (const ws of wss.clients) if ((ws.player || ws.pendingPlayer)?.id === playerId) revokeSocket(ws, 4001, 'account deleted');
      for (const [tok, q] of tokens) if (q.id === playerId) tokens.delete(tok);
      clearTimeout(p.dropTimer);
      players.delete(playerId);
    },
  });

  const staticFiles = createStaticFiles();
  const activeAuthRequests = new Set();
  const handleHttp = async (req, res) => {
    setSecurityHeaders(res); // apply to success and error responses, including health checks and 404s
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      // a malformed %-escape: an unknown player page is a plain 404 (as for any other name that does not exist); anything else is a bad request
      let raw = '';
      try { raw = new URL(req.url, 'http://x').pathname; } catch { /* keep empty */ }
      if (raw.startsWith('/api/players/')) return sendJson(res, 404, { ok: false, error: 'No such player.' });
      res.writeHead(400);
      return res.end();
    }

    const authRequest = authRoutes.handle(req, res, rel);
    if (rel.startsWith('/api/auth/')) {
      activeAuthRequests.add(authRequest);
      authRequest.then(() => activeAuthRequests.delete(authRequest), () => activeAuthRequests.delete(authRequest));
    }
    if (await authRequest) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD, POST' });
      return res.end();
    }

    if (rel === '/healthz') {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (rel === '/readyz') {
      if (shuttingDown) { res.setHeader('Cache-Control', 'no-store'); res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('shutting down'); }
      const respond = (status, text) => {
        res.setHeader('Cache-Control', 'no-store');
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(text);
      };
      readiness().then(({ status, body }) => respond(status, body));
      return;
    }
    // Public snapshot for visitors: the home page shows the game list and the table directory without a session or a socket.
    if (rel === '/api/games') {
      return sendJson(res, 200, { ok: true, games: games.list(), tables: publicTables(), announcement });
    }
    if (rel.includes('\0')) {
      res.writeHead(400);
      return res.end();
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    staticFiles.load(file, type, (err, entry) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      staticFiles.respond(req, res, entry, {
        'Content-Type': type,
        'Cache-Control': 'no-cache', // always revalidate; the ETag turns that into a cheap 304
        ...SECURITY_HEADERS,
        ...(production ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
      });
    });
  };
  // An unexpected error in any route answers 500 (and is logged) instead of leaving the request hanging until the timeout.
  const server = http.createServer((req, res) => {
    // Every response carries an ID so a user report ("it failed at 21:40") can be matched to one log line.
    const requestId = requestIdFrom(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', requestId);
    if (shuttingDown) {
      res.writeHead(503, { 'Connection': 'close' });
      return res.end('shutting down');
    }
    handleHttp(req, res).catch((err) => {
      trackError('http_unhandled');
      httpLog.error('http.unhandled', { requestId, method: req.method, path: String(req.url).split('?')[0], err });
      try {
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Server error'); }
        else res.destroy();
      } catch { /* the socket is gone */ }
    });
  });
  // Bound incomplete HTTP requests and idle keep-alive sockets. These are request-receive timeouts,
  // not limits on how long a completed auth/database operation may take to respond.
  server.headersTimeout = opts.headersTimeoutMs ?? 10000;
  server.requestTimeout = opts.requestTimeoutMs ?? 30000;
  server.keepAliveTimeout = opts.keepAliveTimeoutMs ?? 5000;

  // ------------------------------------------------------------ helpers
  const send = (ws, obj) => sendBounded(ws, obj, maxBufferedBytes);
  const sendError = (p, message) => send(p.ws, { t: 'error', message });
  function notifyAccount(playerId, event) {
    const recipient = players.get(playerId);
    if (!recipient || !recipient.connected) return; // live-only; DB records remain authoritative
    const text = {
      'friend-request': 'You have a new friend request.',
      'friend-accepted': 'Your friend request was accepted.',
      'table-invitation': 'You have a new private-table invitation.',
      'invitation-declined': 'A friend declined your table invitation. You can invite them again.',
    }[event.type];
    if (!text) return;
    send(recipient.ws, { t: 'socialNotice', kind: event.type, text, invitationId: event.invitationId });
  }
  /**
   * A friendship ended. Whoever could only be at a private table because of it loses access (policy: docs/PRIVATE_TABLES.md).
   * Both people are looked at wherever they are: it does not matter whether the inviter is the current host, a previous host
   * or has left. The database decides (the removal already revoked the invitations); this applies the result to live tables.
   */
  async function onFriendRemoved(a, b) {
    try {
      for (const room of [...rooms.values()]) {
        if (room.visibility !== 'private') continue;
        await enforceAccess(room, [a, b].filter((id) => players.get(id)?.room === room.code));
      }
    } catch (err) {
      console.error('[server] applying a removed friendship failed:', err.message);
    }
    publishPresence(a);
    publishPresence(b);
  }
  async function publishPresence(playerId) {
    if (!dbPool.hasDatabase()) return; // friends exist only with PostgreSQL
    try {
      const friends = await dbFriends.listFriends(playerId, presenceView);
      const owner = players.get(playerId);
      if (owner && owner.connected) send(owner.ws, { t: 'socialPresence', friends });
      for (const friend of friends) {
        const recipient = players.get(friend.id);
        if (recipient && recipient.connected) send(recipient.ws, {
          t: 'socialPresence', playerId,
          online: presenceView.get(playerId).online,
          lastSeen: presenceView.get(playerId).lastSeen,
          playing: presenceView.get(playerId).playing,
          ping: presenceView.get(playerId).ping,
        });
      }
    } catch (err) {
      console.error('[server] presence update failed:', err.message);
    }
  }
  /** Private-table access: the rule is in lib/roomAccess.js; this wires it to the database. `present` = already at the table. */
  async function canEnterRoom(p, room, { present = false } = {}) {
    if (room.removed && room.removed.has(p.id)) return false; // removed by the host
    try {
      const { allowed } = await decideAccess({
        room, playerId: p.id, isAnonymous: p.isAnonymous, hasDatabase: dbPool.hasDatabase(), present,
        invitedBy: (inviterIds, opts) => dbFriends.canJoinPrivateRoom(p.id, room.code, room.gameId, inviterIds, opts),
      });
      if (allowed && room.denied) room.denied.delete(p.id);
      return allowed;
    } catch (err) {
      console.error('[server] private room authorization failed:', err.message);
      return false;
    }
  }
  /** Re-check, against the database, everyone at this private table (or just `ids`) and apply the policy to those who lost access. */
  async function enforceAccess(room, ids = null) {
    if (room.visibility !== 'private') return;
    const here = ids || [...room.members.filter((m) => !m.bot).map((m) => m.id), ...room.spectators.map((x) => x.id)];
    for (const id of here) {
      const q = players.get(id);
      if (!q || q.room !== room.code || rooms.get(room.code) !== room) continue;
      if (!(await canEnterRoom(q, room, { present: true }))) revokeAccess(q, room);
    }
  }
  /**
   * "You may no longer be at this table". A seat in a game that is RUNNING is protected: the person finishes that game
   * (nobody's game is aborted by a friendship change) but is marked and cannot come back; everyone else leaves now.
   */
  function revokeAccess(q, room) {
    (room.denied || (room.denied = new Set())).add(q.id);
    const seated = room.members.some((m) => m.id === q.id && !m.bot);
    if (seated && room.status === 'playing') {
      if (q.connected) send(q.ws, { t: 'notice', text: 'You no longer have access to this private table. You can finish this game, but you cannot come back to the table.' });
      return;
    }
    leaveRoom(q);
    if (q.connected) {
      send(q.ws, { t: 'left' });
      send(q.ws, { t: 'notice', text: 'You no longer have access to that private table, so you left it.' });
      send(q.ws, tablesMsg(q));
    }
  }
  const isConnected = (m) => m.bot || !!players.get(m.id)?.connected;
  /** A bot is playing this seat for a person: they left the running game, or they have been offline long enough for the server to play for them. */
  const isStandIn = (room, m) => {
    if (room.status !== 'playing') return false;
    if (m.bot) return !!(room.leftEarly && room.leftEarly.has(m.id));
    const q = players.get(m.id);
    return !!q && !q.connected && Date.now() - (q.lastSeen || 0) >= absentMs;
  };
  /** The public @handle of a registered human at the table (null for bots, guests and anonymous players). */
  const usernameOf = (m) => (m.bot ? null : (players.get(m.id) || {}).username || null);
  /** Smoothed round-trip time in ms of a connected human (null for bots and people who are offline or not measured yet). */
  const pingOf = (m) => { if (m.bot) return null; const q = players.get(m.id); return q && q.connected && Number.isFinite(q.pingMs) ? q.pingMs : null; };
  const humans = (room) => room.members.filter((m) => !m.bot);
  const isSpec = (room, id) => room.spectators.some((s) => s.id === id);
  /** Everybody who should receive table updates: seated humans and spectators. */
  const viewers = (room) => humans(room).concat(room.spectators);
  const awaitingOf = (g) => [].concat(g.awaiting() ?? []);

  function roomInfo(room) {
    const def = games.get(room.gameId);
    return {
      code: room.code,
      gameId: room.gameId,
      hostId: room.hostId,
      status: room.status,
      options: room.options,
      visibility: room.visibility,
      seats: room.seats,
      min: def.seats.min,
      max: def.seats.max,
      seatLabels: def.seatLabel ? Array.from({ length: room.seats }, (_, i) => def.seatLabel(i, room.seats)) : null,
      members: room.members.map((m) => ({ id: m.id, name: m.name, bot: m.bot, avatar: m.avatar, connected: isConnected(m), ping: pingOf(m), username: usernameOf(m), standIn: isStandIn(room, m) })),
      spectators: room.spectators.map((s) => ({ id: s.id, name: s.name, avatar: s.avatar, connected: isConnected(s), ping: pingOf(s), username: usernameOf(s) })),
      outcome: room.status === 'finished' && room.outcome ? { winners: room.outcome.winners, sinceMs: Date.now() - room.outcome.at } : null,
      votes: room.status === 'finished' && room.votes ? [...room.votes] : [], // people who want to play again
      deadline: room.status === 'playing' ? room.deadline : null, // epoch ms when the awaited human(s) get auto-played
      now: Date.now(), // lets clients correct for clock differences
    };
  }

  /** The table directory. With a viewer, a host the viewer is blocked with (either way) is shown under a generic name. */
  function publicTables(viewerId = null) {
    return [...rooms.values()]
      .filter((room) => room.visibility === 'public' && (room.status === 'lobby' || room.status === 'playing'))
      .map((room) => ({
        code: room.code,
        gameId: room.gameId,
        status: room.status,
        seats: room.seats,
        // A filled bot seat is still an occupied player seat, so the directory
        // always reflects the live table population rather than only humans.
        members: room.members.length,
        humans: room.members.filter((m) => !m.bot).length,
        host: moderation.listedHostName(room.members.find((m) => m.id === room.hostId)?.name, viewerId !== null && room.hostId !== viewerId && pairBlocked(viewerId, room.hostId)),
        spectators: room.spectators.length,
      }));
  }

  /** Running games where this player still owns a seat that a bot is playing: they can take it back with one tap. */
  function rejoinFor(p) {
    const out = [];
    for (const room of rooms.values()) {
      if (room.status !== 'playing' || p.room === room.code) continue;
      if ((room.denied && room.denied.has(p.id)) || blockedWithRoom(room, p.id)) continue; // access revoked or blocked pair
      if (room.members.some((m) => m.id === p.id && m.bot)) out.push({ code: room.code, gameId: room.gameId, paused: !humans(room).some(isConnected) });
    }
    return out;
  }

  const tablesMsg = (p) => ({ t: 'tables', tables: publicTables(p.id), rejoin: rejoinFor(p) });

  /** Who can take a seat back: playerId -> [{code, gameId, paused}], built in one pass over the rooms (not once per player). */
  function rejoinIndex() {
    const index = new Map();
    for (const room of rooms.values()) {
      if (room.status !== 'playing') continue;
      let paused;
      for (const m of room.members) {
        if (!m.bot || (room.denied && room.denied.has(m.id)) || blockedWithRoom(room, m.id)) continue; // access revoked or blocked pair
        const q = players.get(m.id);
        if (q && q.room === room.code) continue;
        if (paused === undefined) paused = !humans(room).some(isConnected);
        const list = index.get(m.id) || index.set(m.id, []).get(m.id);
        list.push({ code: room.code, gameId: room.gameId, paused });
      }
    }
    return index;
  }

  /**
   * The table directory goes to people who are looking at it (not inside a table), at most every 120 ms however many
   * tables changed, and only when it differs from what that person already has. Every move at every table used to send
   * the whole directory to every connected player.
   */
  let tablesTimer = null;
  function broadcastTables() {
    if (tablesTimer) return;
    tablesTimer = setTimeout(flushTables, 120);
    if (tablesTimer.unref) tablesTimer.unref();
  }
  function flushTables() {
    tablesTimer = null;
    const rejoin = rejoinIndex();
    // Only people who block someone, or are blocked, can see a generic host name, so everyone else shares one listing.
    const involved = new Set();
    for (const q of players.values()) {
      const s = effectiveBlocked(q);
      if (s && s.size) { involved.add(q.id); for (const id of s) involved.add(id); }
    }
    const shared = publicTables();
    const sharedKey = JSON.stringify(shared);
    for (const p of players.values()) {
      if (!p.connected) continue;
      if (p.room) { p.tablesKey = null; continue; } // inside a table: it gets a fresh directory when it leaves
      const own = involved.has(p.id);
      const tables = own ? publicTables(p.id) : shared; // per viewer only where a block can apply
      const mine = rejoin.get(p.id) || [];
      const key = (own ? JSON.stringify(tables) : sharedKey) + '|' + JSON.stringify(mine);
      if (p.tablesKey === key) continue;
      p.tablesKey = key;
      send(p.ws, { t: 'tables', tables, rejoin: mine });
    }
  }

  function broadcast(room) {
    room.lastActivity = Date.now();
    const infoJson = JSON.stringify(roomInfo(room)); // the same for everybody at the table: serialised once
    for (const m of viewers(room)) {
      const p = players.get(m.id);
      if (p && p.connected) sendBoundedRaw(p.ws, `{"t":"state","room":${infoJson},"view":${JSON.stringify((room.game && room.game.view(m.id)) ?? null)}}`, maxBufferedBytes);
    }
    broadcastTables();
  }

  // ------------------------------------------------------------ chat
  // Include blocks whose database writes are queued or in flight. This closes the gap between accepting a request
  // and its serialized persistence turn, including when another socket reconnects during a slow write.
  const effectiveBlocked = (p) => {
    if (!p || !p.pendingBlocks || !p.pendingBlocks.size) return p && p.blocked;
    return new Set([...(p.blocked || []), ...p.pendingBlocks.keys()]);
  };
  function pushChat(room, m) {
    m.ts = Date.now();
    room.chat.push(m);
    if (room.chat.length > CHAT_KEEP) room.chat.shift();
    for (const v of viewers(room)) {
      const p = players.get(v.id);
      // a viewer never receives chat from an account they have blocked (server-enforced, not a client-side mute)
      if (p && p.connected && moderation.shouldDeliver(m, effectiveBlocked(p))) send(p.ws, { t: 'chat', m });
    }
  }
  const sys = (room, text) => pushChat(room, { sys: true, text });
  // A block in either direction keeps the pair out of each other's voice: the blocker does not hear the blocked person,
  // and the blocked person cannot reach the blocker through the table's voice chat. Nobody is told about the block.
  const blocksPlayer = (p, id) => { const s = effectiveBlocked(p); return !!s && s.has(id); };
  const pairBlocked = (a, b) => { const x = players.get(a); const y = players.get(b); return (!!x && blocksPlayer(x, b)) || (!!y && blocksPlayer(y, a)); };
  const voiceFor = (room, viewerId) => voiceRelay.voiceList(room, (id) => pairBlocked(viewerId, id), viewerId);
  /** A player is a blocked target if an occupant of this table has blocked them. */
  function blockedByRoom(room, playerId) {
    return [...room.members, ...room.spectators].some((m) => m.id !== playerId && blocksPlayer(players.get(m.id), playerId));
  }
  /** A player cannot enter or remain at a table with anyone they have blocked, or who has blocked them. */
  function blockedWithRoom(room, playerId) {
    return [...room.members, ...room.spectators].some((m) => m.id !== playerId && pairBlocked(playerId, m.id));
  }
  /** A seated player may reconnect to finish a running game only when they are the blocker, not the blocked target. */
  function blockedEntryDenied(room, playerId, allowCurrentGameSeat = false) {
    if (blockedByRoom(room, playerId)) return true;
    if (!blockedWithRoom(room, playerId)) return false;
    const alreadyPlaying = room.status === 'playing' && room.members.some((m) => m.id === playerId && !m.bot);
    return !(allowCurrentGameSeat && alreadyPlaying);
  }
  /**
   * Apply blocks to the shared table. Lobby members and spectators who are blocked targets leave immediately. A seated
   * player in a running game keeps their seat until it ends; blocked targets are removed when the result is recorded.
   */
  function enforceBlockedRoom(room) {
    if (!room) return;
    const occupants = [...room.members, ...room.spectators];
    for (const m of occupants) {
      if (!blockedByRoom(room, m.id)) continue;
      const q = players.get(m.id);
      const seated = room.members.some((member) => member.id === m.id);
      if (room.status === 'playing' && seated) continue;
      if (q && q.room === room.code) {
        leaveRoom(q);
        if (q.connected) {
          send(q.ws, { t: 'left' });
          send(q.ws, { t: 'notice', text: 'You can no longer share that table with someone here.' });
          send(q.ws, tablesMsg(q));
        }
      } else {
        const botIndex = room.members.findIndex((member) => member.id === m.id && member.bot);
        if (botIndex >= 0) {
          const [botSeat] = room.members.splice(botIndex, 1);
          if (room.hostId === m.id) ensureHost(room, { leaving: m.id });
          sys(room, 'A blocked player left the table');
          notifyOthers(room, m.id, 'A blocked player left the table');
          if (!humans(room).length && !room.spectators.length) destroyRoom(room);
          else broadcast(room);
        }
      }
    }
  }
  /** Sends this player their list of blocked accounts (names come from the database; none without one). */
  async function sendBlocks(p) {
    const blocks = dbPool.hasDatabase() ? await dbModeration.listBlocked(p.id) : [];
    send(p.ws, { t: 'blocks', blocks });
  }
  const sendChatLog = (p, room) => { send(p.ws, { t: 'chatlog', messages: moderation.visibleChat(room.chat, effectiveBlocked(p)) }); send(p.ws, { t: 'voice', ids: voiceFor(room, p.id) }); };
  /** Re-sends this viewer's chat history after a block or unblock, so the change shows at once. */
  const resyncChat = (p) => { const room = rooms.get(p.room); if (room) send(p.ws, { t: 'chatlog', messages: moderation.visibleChat(room.chat, effectiveBlocked(p)) }); };
  /** Tell everyone at the table who is in voice (and who is muted), leaving out anyone blocked with that viewer. */
  function broadcastVoice(room) {
    for (const v of viewers(room)) {
      const q = players.get(v.id);
      if (q && q.connected) send(q.ws, { t: 'voice', ids: voiceFor(room, v.id) });
    }
  }
  function notifyOthers(room, exceptId, text) {
    for (const v of viewers(room)) {
      if (v.id === exceptId) continue;
      const q = players.get(v.id);
      if (q && q.connected) send(q.ws, { t: 'notice', text });
    }
  }

  // ------------------------------------------------------------ turn timer
  const limitMs = (room) => {
    const s = Number(room.options && room.options.timeLimit);
    return Number.isFinite(s) && s > 0 ? s * 1000 * timeScale : 0;
  };

  /**
   * Called after every game action: starts a fresh deadline for whoever the game now waits for.
   * During simultaneous moves (everybody bids at once) the deadline is shared and not restarted by each bid.
   */
  function touchTimer(room) {
    const g = room.game;
    const limit = limitMs(room);
    const now = awaitingOf(g);
    const prev = room.waiting || [];
    const sameBatch = prev.length > 1 && now.length > 0 && now.every((id) => prev.includes(id));
    const humanWaiting = now.some((id) => room.members.some((m) => m.id === id && !m.bot));
    if (!limit || !humanWaiting) room.deadline = null;
    else if (!sameBatch || !room.deadline) {
      const walkHold = typeof g.holdMs === 'function' ? g.holdMs() : 0;
      room.deadline = Date.now() + Math.max(0, (room.pauseUntil || 0) - Date.now(), walkHold) + limit;
    }
    room.waiting = now;
  }

  /** Who won, for the pop-up at the end of a game: seats whose result says `winner`. Empty for a draw or a co-op loss. */
  function outcomeOf(room, g) {
    let results = null;
    try { results = typeof g.results === 'function' ? g.results() : null; } catch { results = null; }
    const winners = Array.isArray(results) && results.length === room.members.length
      ? room.members.filter((m, i) => results[i] && results[i].winner).map((m) => ({ id: m.id, name: m.name }))
      : [];
    return { winners, at: Date.now() };
  }

  function afterChange(room) {
    const g = room.game;
    if (g) {
      if (g.isOver() && room.status !== 'finished') {
        room.status = 'finished';
        analytics.track('game_finished', room.gameId);
        room.votes = new Set(); // who wants to play again (the host just starts it)
        room.outcome = outcomeOf(room, g);
        for (const m of humans(room)) schedulePresence(m.id);
        // Persist the completed match once (the status guard above plus the per-game key make a second attempt a no-op)
        try {
          const record = buildMatchRecord(room, g);
          if (!record) console.error(`[server] ${room.gameId} cannot report results; match not recorded`);
          else matchQueue.enqueue(record); // never blocks the game and never rejects; failures are retried and logged by the queue
        } catch (e) {
          console.error('[server] Error preparing match record:', e.message);
        }
        // A blocked player may finish this game, but must leave before the table can be used again.
        enforceBlockedRoom(room);
      }
      // a trick just finished: give everyone a moment to see it being collected before the next card
      const lt = g.stamp ? g.stamp() : null;
      if (lt && lt !== room.lastStamp && trickPauseMs > 0) room.pauseUntil = Date.now() + trickPauseMs;
      room.lastStamp = lt;
      touchTimer(room);
    }
    broadcast(room);
    schedule(room);
  }

  /** Decide whether the server must act soon (bot turn, absent human, forced play, timeout, between rounds) and set one timer for it. */
  function schedule(room) {
    clearTimeout(room.timer);
    room.timer = null;
    const g = room.game;
    if (!g || room.status !== 'playing' || g.isOver()) return;
    if (!humans(room).some(isConnected)) return; // nobody watching: pause

    const waiting = awaitingOf(g);
    // a game that is still animating a move (a token walking square by square) holds its bots back until the walk is done
    const walkHold = typeof g.holdMs === 'function' ? g.holdMs() : 0; // already scaled when it was recorded (games/pacing.js)
    const pause = Math.max(0, (room.pauseUntil || 0) - Date.now(), walkHold);
    let delay;
    let run;
    let valid;
    const forced = waiting.length && g.forcedPlay ? g.forcedPlay() : null;
    if (!waiting.length) {
      const auto = g.autoAction();
      if (!auto) return;
      delay = (typeof g.autoDelayMs === 'function' && g.autoDelayMs() * botScale) || autoAdvanceMs;
      run = () => g.act(null, auto);
      valid = () => awaitingOf(g).length === 0;
    } else if (forced) {
      // last trick of the round: after the first card the rest is automatic
      delay = Math.max(forcedMs, pause);
      run = () => g.act(forced.playerId, forced.action);
      valid = () => {
        const f = g.forcedPlay && g.forcedPlay();
        return !!f && f.playerId === forced.playerId;
      };
    } else {
      const ms = waiting.map((id) => room.members.find((x) => x.id === id)).filter(Boolean);
      const bots = ms.filter((m) => m.bot);
      let who = bots[0] || ms.find((m) => !m.bot && !isConnected(m));
      let botMs = null;
      if (bots.length && typeof g.botDelayMs === 'function') {
        // a real-time game (The Mind) times its bots itself: the bot that wants to play soonest goes next
        const t = bots.map((m) => ({ m, d: g.botDelayMs(m.id) })).sort((x, y) => x.d - y.d)[0];
        who = t.m;
        botMs = Math.max(0, t.d * botScale);
      }
      if (who) {
        delay = Math.max(who.bot ? (botMs !== null ? botMs : rand(botDelay[0], botDelay[1])) : absentMs, pause);
        run = () => g.act(who.id, g.botAction(who.id));
        valid = () => awaitingOf(g).includes(who.id) && (who.bot || !isConnected(who));
      } else if (room.deadline) {
        // connected humans are thinking, but the table has a time limit
        const dl = room.deadline;
        delay = Math.max(0, dl - Date.now());
        run = () => {
          let res = { ok: true };
          for (const id of awaitingOf(g)) {
            const m = room.members.find((x) => x.id === id);
            const r = g.act(id, g.botAction(id));
            if (!r.ok) res = r;
            else if (m && !m.bot) {
              sys(room, `⏱ ${m.name} ran out of time. A bot played for them.`);
              const q = players.get(id);
              if (q && q.connected) send(q.ws, { t: 'notice', text: 'Time is up! A bot played for you.' });
            }
          }
          return res;
        };
        valid = () => room.deadline === dl && awaitingOf(g).length > 0;
      } else return; // connected humans are thinking, no limit
    }
    room.timer = setTimeout(() => {
      room.timer = null;
      if (room.game !== g || g.isOver()) return;
      // A bug in one game must not take the whole server (and every other table) down: an exception here would
      // otherwise be an uncaught exception in a timer callback. Retry a couple of times, then close only this table.
      try {
        if (!valid()) return schedule(room);
        const res = run();
        if (!res || !res.ok) console.error('auto action failed:', res && res.error);
        room.autoFailures = 0;
        afterChange(room);
      } catch (e) {
        room.autoFailures = (room.autoFailures || 0) + 1;
        trackError('auto_play');
        console.error(`[server] table ${room.code} (${room.gameId}): automatic play failed (${room.autoFailures}/3):`, e && e.stack || e);
        if (room.autoFailures >= 3) {
          for (const m of viewers(room)) { const q = players.get(m.id); if (q && q.connected) send(q.ws, { t: 'notice', text: 'This game hit an error and had to be closed. Sorry! Please start a new table.' }); }
          destroyRoom(room);
        } else {
          try { schedule(room); } catch { /* the next gc pass closes an unhealthy table */ }
        }
      }
    }, delay);
    if (room.timer.unref) room.timer.unref();
  }

  function newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }

  function destroyRoom(room) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    for (const m of humans(room)) schedulePresence(m.id);
    if (dbPool.hasDatabase()) dbFriends.expireClosedRoomInvitations(room.code).catch((err) => console.error('[server] invitation cleanup failed:', err.message));
    broadcastTables();
    for (const m of viewers(room)) {
      const p = players.get(m.id);
      if (p && p.room === room.code) {
        p.room = null;
        clearTimeout(p.dropTimer);
        if (p.connected) {
          send(p.ws, { t: 'notice', text: 'This table was closed.' });
          send(p.ws, { t: 'left' });
        }
      }
    }
  }

  /**
   * Make sure the table has a host who is actually here. If the host left or has been offline, the host role goes to the
   * next seated human (connected ones first). Returns true when the host changed.
   */
  function ensureHost(room, { leaving } = {}) {
    const cur = room.members.find((m) => m.id === room.hostId && !m.bot);
    if (cur && cur.id !== leaving && isConnected(cur)) return false;
    const cands = humans(room).filter((m) => m.id !== leaving);
    const next = cands.find(isConnected) || (cur && cur.id !== leaving ? null : cands[0]);
    if (!next || next.id === room.hostId) return false;
    room.hostId = next.id;
    (room.hosts || (room.hosts = new Set())).add(next.id);
    sys(room, `👑 ${next.name} is now the host`);
    const q = players.get(next.id);
    if (q && q.connected) send(q.ws, { t: 'notice', text: '👑 You are now the host of this table' });
    return true;
  }

  function leaveRoom(p) {
    const room = rooms.get(p.room);
    p.room = null;
    clearTimeout(p.dropTimer);
    p.dropAnnounced = false;
    if (!room) return;
    if (voiceRelay.dropVoice(room, p.id)) broadcastVoice(room);
    if (room.votes) room.votes.delete(p.id);
    const si = room.spectators.findIndex((s) => s.id === p.id);
    if (si >= 0) {
      room.spectators.splice(si, 1);
      sys(room, `👁 ${p.name} stopped watching`);
      return broadcast(room);
    }
    const i = room.members.findIndex((m) => m.id === p.id);
    if (i < 0) return;
    const wasHost = room.hostId === p.id;
    if (room.status === 'playing') {
      room.members[i].bot = true; // a bot takes over the seat; the player can take it back by rejoining
      (room.leftEarly || (room.leftEarly = new Set())).add(p.id);
      sys(room, `🚪 ${p.name} left the game. A bot took over the seat.`);
    } else {
      room.members.splice(i, 1);
      sys(room, `🚪 ${p.name} left the table`);
    }
    notifyOthers(room, p.id, `🚪 ${p.name} left the table`);
    if (!humans(room).length && room.status === 'playing') {
      // the last human stepped out of a running game (e.g. a solo game against bots): keep it paused so they can come
      // back with one tap; the idle collector closes it after 10 minutes if nobody does.
      // A player keeps only ONE such parked table: otherwise a create/start/leave loop fills the server (MAX_ROOMS).
      const prev = p.parkedRoom && p.parkedRoom !== room.code ? rooms.get(p.parkedRoom) : null;
      if (prev && !humans(prev).length) destroyRoom(prev);
      p.parkedRoom = room.code;
      broadcast(room);
      return;
    }
    if (!humans(room).length) {
      // nobody left at the table: in a lobby a spectator can take over the empty table, otherwise it closes
      const heir = room.status === 'lobby' && room.spectators[0];
      if (!heir || !room.spectators.length) return destroyRoom(room);
      room.spectators.shift();
      room.members.push({ id: heir.id, name: heir.name, avatar: heir.avatar, bot: false });
      room.hostId = heir.id;
      (room.hosts || (room.hosts = new Set())).add(heir.id);
      sys(room, `👑 ${heir.name} took a seat and is now the host`);
    } else if (wasHost) ensureHost(room, { leaving: p.id });
    broadcast(room);
    schedule(room);
  }

  /** A connection dropped: after a short grace period tell the table, and hand the host role on if needed. */
  function onDrop(p) {
    clearTimeout(p.dropTimer);
    p.dropTimer = setTimeout(() => {
      p.dropTimer = null;
      if (p.connected) return;
      const room = rooms.get(p.room);
      if (!room || !room.members.some((m) => m.id === p.id && !m.bot)) return;
      p.dropAnnounced = true;
      sys(room, `📡 ${p.name} lost connection`);
      if (room.hostId === p.id) ensureHost(room);
      broadcast(room);
    }, dropGraceMs);
    if (p.dropTimer.unref) p.dropTimer.unref();
  }

  // Tables a player sits at or watches are remembered on their account (shown as "Recent tables" on any device).
  const RECENT_ON = new Set(['create', 'join', 'sit']);
  const PRESENCE_ON = new Set(['create', 'join', 'sit', 'leave', 'start', 'rematch']);
  function trackRecent(p) {
    const room = rooms.get(p.room);
    if (!room) return;
    dbAccount.rememberTable(p.id, { code: room.code, gameId: room.gameId }).catch((e) => console.error('[server] recent table not saved:', e.message));
  }

  function addMember(room, p) {
    const m = room.members.find((x) => x.id === p.id);
    if (m) {
      m.bot = false;
      m.name = p.name;
      m.avatar = p.avatar;
      p.room = room.code;
      return;
    }
    const s = room.spectators.findIndex((x) => x.id === p.id);
    if (s >= 0) room.spectators.splice(s, 1);
    room.members.push({ id: p.id, name: p.name, avatar: p.avatar, bot: false });
    p.room = room.code;
  }

  function addSpectator(room, p) {
    if (room.members.some((x) => x.id === p.id)) {
      p.room = room.code;
      return;
    }
    const s = room.spectators.find((x) => x.id === p.id);
    if (s) {
      s.name = p.name;
      s.avatar = p.avatar;
      p.room = room.code;
      return;
    }
    room.spectators.push({ id: p.id, name: p.name, avatar: p.avatar });
    p.room = room.code;
  }

  // ------------------------------------------------------------ message handlers
  // Block and unblock for one account run one at a time, in the order they were accepted, whichever socket sent them, so
  // the in-memory list ends where the database ends. A block takes effect in memory before its database write (hiding
  // more is safe, and undone if the write fails); an unblock takes effect only after its database write.
  const inModerationTurn = (p, task) => {
    const turn = (p.moderationTail || Promise.resolve()).then(task);
    p.moderationTail = turn.catch(() => {});
    return turn;
  };
  const handlers = {
    setName(p, msg) {
      applyProfile(p, msg);
      dbPlayers.updateProfile(p.id, { displayName: p.name, avatar: p.avatar }).catch(() => {});
      const room = rooms.get(p.room);
      if (!room) return;
      const m = room.members.find((x) => x.id === p.id);
      if (m) {
        m.avatar = p.avatar;
        if (room.status !== 'playing') m.name = p.name;
      }
      const s = room.spectators.find((x) => x.id === p.id);
      if (s) {
        s.avatar = p.avatar;
        s.name = p.name;
      }
      broadcast(room);
    },

    emote(p, msg) {
      const room = rooms.get(p.room);
      if (!room || room.status === 'lobby' || isSpec(room, p.id) || !EMOTES.includes(msg.e)) return;
      const now = Date.now();
      if (now - (p.lastEmote || 0) < 700) return;
      p.lastEmote = now;
      for (const m of viewers(room)) {
        if (m.id !== p.id && pairBlocked(p.id, m.id)) continue; // a blocked pair does not see each other's reactions
        const q = players.get(m.id);
        if (q && q.connected) send(q.ws, { t: 'emote', id: p.id, e: msg.e });
      }
    },

    /** Join or leave the table's voice chat, or change mute. The audio itself never passes through the server. */
    voice(p, msg) {
      const room = rooms.get(p.room);
      if (!room) return;
      const r = voiceRelay.setVoice(room, p.id, msg.on === true, msg.muted === true);
      if (!r.ok) return sendError(p, r.error);
      if (r.changed) broadcastVoice(room);
    },

    /** The browser asks for fresh TURN logins before its current ones run out. Answered at most once per ICE_REFRESH_MIN_MS. */
    ice(p) {
      const now = Date.now();
      if (p.lastIceRefresh && now - p.lastIceRefresh < ICE_REFRESH_MIN_MS) return;
      p.lastIceRefresh = now;
      send(p.ws, { t: 'ice', ...iceMsg(p.id) });
    },

    /** One setup message (offer, answer, ICE) for another person in voice at the same table. */
    rtc(p, msg) {
      const room = rooms.get(p.room);
      if (!room) return;
      // refused with the same answer as "not in voice", so the sender cannot tell a block from an absent person
      if (typeof msg.to === 'string' && pairBlocked(p.id, msg.to)) return sendError(p, 'Not in voice');
      const r = voiceRelay.relay(room, p.id, msg.to, msg.data, (toId, m) => {
        const q = players.get(toId);
        if (q && q.connected) send(q.ws, m);
      });
      if (!r.ok) return sendError(p, r.error);
    },

    chat(p, msg) {
      const room = rooms.get(p.room);
      if (!room) return;
      const text = cleanText(msg.text);
      if (!text) return;
      const now = Date.now();
      if (now - (p.lastChat || 0) < 500) return sendError(p, 'Slow down a little');
      p.lastChat = now;
      // mid identifies the message for reports; the server keeps the text, so a report cannot carry different content
      pushChat(room, { mid: crypto.randomUUID(), id: p.id, name: p.name, avatar: p.avatar, text, spec: isSpec(room, p.id) });
    },

    // Report a table chat message. The server looks the message up in its own copy of the table's chat.
    async report(p, msg) {
      const room = rooms.get(p.room);
      if (!room) return sendError(p, 'Join a table to report a message.');
      const checked = moderation.validateReport(msg);
      if (!checked.ok) return sendError(p, checked.error);
      const now = Date.now();
      if (now - (p.lastReport || 0) < moderation.REPORT_COOLDOWN_MS) return sendError(p, 'Slow down a little');
      p.lastReport = now;
      const m = room.chat.find((x) => x.mid === checked.messageId);
      if (!m || m.sys) return sendError(p, 'That message is no longer available to report.');
      if (m.id === p.id) return sendError(p, 'You cannot report your own message.');
      try {
        const out = await dbModeration.createChatReport({
          reporterId: p.id, reportedId: m.id, roomCode: room.code, messageId: checked.messageId,
          messageText: m.text, reason: checked.reason, details: checked.details,
        });
        send(p.ws, { t: 'notice', text: out.stored ? 'Thanks. Your report was recorded.' : 'You have already reported this message.' });
      } catch (e) {
        if (e instanceof dbModeration.ModerationError) return sendError(p, e.message);
        throw e;
      }
    },

    // Blocking applies to table access, seating, chat, reactions and voice in both directions; it never signs either account out.
    async block(p, msg) {
      const checked = moderation.validateBlockTarget(p.id, msg && msg.id);
      if (!checked.ok) return sendError(p, checked.error);
      const now = Date.now();
      if (now - (p.lastBlock || 0) < moderation.BLOCK_COOLDOWN_MS) return sendError(p, 'Slow down a little');
      p.lastBlock = now;
      if (!p.blocked) p.blocked = new Set();
      if (!p.pendingBlocks) p.pendingBlocks = new Map();
      const target = checked.targetId;
      // Reserve the filter before entering the serialized database turn. A second block queued behind a slow first
      // write must hide its own target immediately, including after a reconnect on another socket.
      p.pendingBlocks.set(target, (p.pendingBlocks.get(target) || 0) + 1);
      // Voice, public host labels and rejoin prompts follow the pending filter immediately.
      const room = rooms.get(p.room);
      if (room) broadcastVoice(room);
      broadcastTables();
      return inModerationTurn(p, async () => {
        try {
          await dbModeration.addBlock(p.id, target);
          p.blocked.add(target); // committed blocks live here; pending ones are included by effectiveBlocked()
          const targetPlayer = players.get(target);
          const sharedRoom = targetPlayer && targetPlayer.room && rooms.get(targetPlayer.room);
          if (sharedRoom && sharedRoom.members.concat(sharedRoom.spectators).some((m) => m.id === p.id)) {
            enforceBlockedRoom(sharedRoom);
            const targetIsSeated = sharedRoom.members.some((m) => m.id === target && !m.bot);
            if (sharedRoom.status === 'playing' && targetIsSeated && targetPlayer.connected) {
              send(targetPlayer.ws, { t: 'notice', text: 'You can finish this game, but you cannot rejoin this table after leaving.' });
            }
          }
        } catch (e) {
          if (e instanceof dbModeration.ModerationError) return sendError(p, e.message);
          throw e;
        } finally {
          const pending = (p.pendingBlocks.get(target) || 1) - 1;
          if (pending > 0) p.pendingBlocks.set(target, pending);
          else p.pendingBlocks.delete(target);
          // A failed write lifts the filter again, so the voice lists are sent again either way. The player may have moved
          // to another table while the write was pending, so that table is refreshed too.
          if (room) broadcastVoice(room);
          const current = rooms.get(p.room);
          if (current && current !== room) broadcastVoice(current);
          broadcastTables(); // refresh table labels and rejoin prompts whether the write succeeded or failed
        }
        resyncChat(p);
        await sendBlocks(p);
        const roomNow = rooms.get(p.room);
        if (roomNow) broadcastVoice(roomNow); // a voice connection to them closes now, on both sides
        send(p.ws, { t: 'notice', text: 'Blocked. They are hidden from your table chat and table voice, and you will not share another table. An active game can finish.' });
      });
    },

    /** The accounts this player has blocked, with names, for the Account tab. Answered after every block or unblock too. */
    blocks(p) { return sendBlocks(p); },

    async unblock(p, msg) {
      if (!moderation.isUuid(msg && msg.id)) return sendError(p, 'That player could not be found.');
      return inModerationTurn(p, async () => {
        // Check inside the serialized turn: a preceding block/unblock may have changed the cached state while this
        // request was waiting. No-op unblocks must not issue a DELETE or resend the entire chat history.
        if (!p.blocked || !p.blocked.has(msg.id)) return;
        const now = Date.now();
        if (now - (p.lastUnblock || 0) < moderation.UNBLOCK_COOLDOWN_MS) return sendError(p, 'Slow down a little');
        p.lastUnblock = now;
        // The database first: until the unblock is saved the author stays hidden, because a message delivered after a
        // failed unblock could not be taken back.
        await dbModeration.removeBlock(p.id, msg.id);
        p.blocked.delete(msg.id);
        broadcastTables();
        resyncChat(p);
        await sendBlocks(p);
        const roomNow = rooms.get(p.room);
        if (roomNow) broadcastVoice(roomNow); // they may be offered voice again
        send(p.ws, { t: 'notice', text: 'Unblocked.' });
      });
    },

    create(p, msg) {
      const def = games.get(msg.gameId);
      if (!def) return sendError(p, 'Unknown game');
      if (shuttingDown) return sendError(p, 'The server is restarting. Please try again in a minute.');
      if (rooms.size >= MAX_ROOMS) return sendError(p, 'Server is full, try again later');
      applyProfile(p, msg);
      if (p.room) leaveRoom(p);
      const room = {
        code: newCode(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
        idleSince: null,
        gameId: def.id,
        visibility: msg.visibility === 'public' ? 'public' : 'private',
        hostId: p.id,
        creatorId: p.id, // the person who opened the table: never loses access to it
        hosts: new Set([p.id]), // everyone who has hosted this table: their accepted invitations stay valid after a host change
        admitted: new Set(), // people already here when a public table was made private (docs/PRIVATE_TABLES.md)
        denied: new Set(), // people who lost private-table access while a game was running
        status: 'lobby',
        seats: def.seats.default,
        options: sanitizeOptions(def, {}),
        members: [],
        spectators: [],
        chat: [],
        game: null,
        timer: null,
        deadline: null,
        waiting: [],
        pauseUntil: 0,
        lastStamp: null,
      };
      rooms.set(room.code, room);
      addMember(room, p);
      broadcast(room);
      sendChatLog(p, room);
    },

    async join(p, msg) {
      const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      applyProfile(p, msg);
      if (!room) return sendError(p, `No table with code ${code || '?'}`);
      if (room.removed && room.removed.has(p.id)) return sendError(p, 'The host removed you from this table.');
      if (blockedEntryDenied(room, p.id, true)) return sendError(p, 'You cannot join a table with someone you have blocked or who has blocked you.');
      const here = room.members.some((m) => m.id === p.id && !m.bot) || isSpec(room, p.id);
      if (!await canEnterRoom(p, room, { present: here })) return sendError(p, 'This private table requires an accepted invitation.');
      if (rooms.get(code) !== room) return sendError(p, 'That table is no longer available.');
      if (room.removed && room.removed.has(p.id)) return sendError(p, 'The host removed you from this table.');
      if (blockedEntryDenied(room, p.id, true)) return sendError(p, 'You cannot join a table with someone you have blocked or who has blocked you.');
      const seat = room.members.find((m) => m.id === p.id);
      // Already at this table (seated, or watching): nothing to add. This is decided BEFORE any capacity check, so a full
      // table or a full spectator list never turns away someone who is already in it, and no second "joined/watching"
      // line is written. A stale p.room that points elsewhere is repaired.
      if ((seat && !seat.bot) || isSpec(room, p.id)) {
        if (p.room === code) return broadcast(room);
        if (p.room) leaveRoom(p);
        p.room = code;
        broadcast(room);
        return sendChatLog(p, room);
      }
      const wantsSpectate = msg.spectate === true;
      // Came back to a running game they left (a bot kept their seat): take the seat back, same player id.
      // This wins over "spectate": the home screen can only offer Spectate for a running game, and a player who
      // owns a seat must never be turned into a spectator while a bot plays their cards.
      if (seat && room.status === 'playing' && seat.bot) {
        if (p.room && p.room !== room.code) leaveRoom(p);
        const si = room.spectators.findIndex((s) => s.id === p.id);
        if (si >= 0) room.spectators.splice(si, 1);
        seat.bot = false;
        if (room.leftEarly) room.leftEarly.delete(p.id);
        seat.avatar = p.avatar;
        p.room = room.code;
        sys(room, `🔄 ${p.name} is back and took the seat from the bot`);
        notifyOthers(room, p.id, `🔄 ${p.name} rejoined the game`);
        ensureHost(room);
        broadcast(room);
        sendChatLog(p, room);
        schedule(room);
        return;
      }
      if (room.status !== 'lobby') {
        // the game is already running: the newcomer watches
        if (room.spectators.length >= MAX_SPECTATORS) return sendError(p, 'Too many spectators at that table');
        if (p.room && p.room !== room.code) leaveRoom(p);
        addSpectator(room, p);
        sys(room, `👁 ${p.name} is watching`);
        notifyOthers(room, p.id, `👁 ${p.name} is watching the game`);
        broadcast(room);
        sendChatLog(p, room);
        return;
      }
      if (wantsSpectate) {
        if (room.spectators.length >= MAX_SPECTATORS) return sendError(p, 'Too many spectators at that table');
        if (p.room && p.room !== room.code) leaveRoom(p);
        addSpectator(room, p);
        sys(room, `👁 ${p.name} is watching`);
        notifyOthers(room, p.id, `👁 ${p.name} is watching the lobby`);
        broadcast(room);
        sendChatLog(p, room);
        return;
      }
      if (room.members.length >= room.seats) return sendError(p, 'That table is full');
      if (p.room) leaveRoom(p);
      addMember(room, p);
      sys(room, `🙋 ${p.name} joined the table`);
      notifyOthers(room, p.id, `🙋 ${p.name} joined the table`);
      broadcast(room);
      sendChatLog(p, room);
    },

    async sit(p) {
      const room = rooms.get(p.room);
      if (!room || room.status !== 'lobby' || !isSpec(room, p.id)) return sendError(p, 'Not possible right now');
      if (blockedEntryDenied(room, p.id)) return sendError(p, 'You cannot take a seat at a table with someone you have blocked or who has blocked you.');
      if (!await canEnterRoom(p, room, { present: true })) return sendError(p, 'This private table requires an accepted invitation.');
      if (rooms.get(room.code) !== room || room.status !== 'lobby' || p.room !== room.code) return sendError(p, 'Not possible right now');
      const spectatorIndex = room.spectators.findIndex((s) => s.id === p.id);
      if (spectatorIndex < 0) return sendError(p, 'Not possible right now');
      if (blockedEntryDenied(room, p.id)) return sendError(p, 'You cannot take a seat at a table with someone you have blocked or who has blocked you.');

      if (room.members.length >= room.seats) return sendError(p, 'There is no open seat');
      room.spectators.splice(spectatorIndex, 1);
      addMember(room, p);
      broadcast(room);
    },

    leave(p) {
      leaveRoom(p);
      send(p.ws, { t: 'left' });
      send(p.ws, tablesMsg(p)); // the home screen can offer "Rejoin" straight away
    },

    addBot(p) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      if (room.members.length >= room.seats) return sendError(p, 'All seats are taken');
      addBotTo(room);
      broadcast(room);
    },

    removeBot(p, msg) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      const i = room.members.findIndex((m) => m.id === msg.id && m.bot);
      if (i >= 0) room.members.splice(i, 1);
      broadcast(room);
    },

    setOptions(p, msg) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      room.options = sanitizeOptions(games.get(room.gameId), msg.options);
      broadcast(room);
    },

    // Profile statistics for the asking player only (nobody can request somebody else's)
    getStats(p) {
      const now = Date.now();
      if (p.statsAt && now - p.statsAt < 1000) return;
      p.statsAt = now;
      dbMatches.getPlayerProfile(p.id, { memberSince: p.createdAt }).then(
        (stats) => send(p.ws, { t: 'stats', stats }),
        (err) => {
          console.error('[server] stats failed:', err.message);
          sendError(p, 'Stats are unavailable right now');
        }
      );
    },

    /** Host only: hand the table to another seated human (any time). The previous host stays at the table. */
    makeHost(p, msg) {
      const room = rooms.get(p.room);
      if (!room || room.hostId !== p.id) return sendError(p, 'Only the host can do that');
      const target = room.members.find((m) => m.id === msg.id && !m.bot);
      if (!target || target.id === p.id) return sendError(p, 'Pick another player sitting at this table');
      room.hostId = target.id;
      (room.hosts || (room.hosts = new Set())).add(target.id);
      sys(room, `👑 ${p.name} made ${target.name} the host`);
      notifyOthers(room, p.id, `👑 ${target.name} is now the host`);
      broadcast(room);
    },

    /**
     * Host only, lobby only: remove a seated player, a bot or a spectator. A removed person cannot come back to this table
     * (join, sit and reconnect all refuse them) until the table closes. The host cannot remove themselves (they use Leave).
     */
    kick(p, msg) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      if (msg.id === p.id) return sendError(p, 'You cannot remove yourself. Use Leave, or make someone else the host first.');
      const mi = room.members.findIndex((m) => m.id === msg.id);
      const si = room.spectators.findIndex((x) => x.id === msg.id);
      if (mi < 0 && si < 0) return sendError(p, 'That player is not at this table');
      if (mi >= 0 && room.members[mi].bot) { room.members.splice(mi, 1); return broadcast(room); }
      const gone = mi >= 0 ? room.members.splice(mi, 1)[0] : room.spectators.splice(si, 1)[0];
      (room.removed || (room.removed = new Set())).add(gone.id);
      const q = players.get(gone.id);
      if (q) {
        q.room = null;
        clearTimeout(q.dropTimer);
        q.dropAnnounced = false;
        if (q.connected) {
          send(q.ws, { t: 'left' });
          send(q.ws, { t: 'notice', text: 'The host removed you from that table.' });
          send(q.ws, tablesMsg(q));
        }
        schedulePresence(q.id);
      }
      // a removed player leaves voice at once: their slot is freed and the remaining table is told
      if (voiceRelay.dropVoice(room, gone.id)) broadcastVoice(room);
      sys(room, `🚫 ${gone.name} was removed by the host`);
      broadcast(room);
    },

    setVisibility(p, msg) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      const next = msg.visibility === 'public' ? 'public' : 'private';
      if (next === 'private' && room.visibility !== 'private') { // whoever is already here was let in as a public guest and stays
        room.admitted = new Set([...room.members.filter((m) => !m.bot).map((m) => m.id), ...room.spectators.map((x) => x.id)]);
      }
      room.visibility = next;
      broadcast(room); // also broadcasts the directory, removing private tables immediately
    },

    setSeats(p, msg) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      const def = games.get(room.gameId);
      const n = msg.seats;
      if (!Number.isInteger(n) || n < def.seats.min || n > def.seats.max) return sendError(p, 'Invalid number of players');
      while (room.members.length > n) {
        const i = room.members.map((m) => m.bot).lastIndexOf(true);
        if (i < 0) return sendError(p, 'Too many human players for that many seats');
        room.members.splice(i, 1);
      }
      room.seats = n;
      broadcast(room);
    },

    start(p) {
      const room = hostRoom(p, 'lobby');
      if (!room) return;
      const def = games.get(room.gameId);
      while (room.members.length < room.seats) addBotTo(room); // empty seats are filled with bots
      room.game = def.create(
        room.members.map((m) => ({ id: m.id, name: m.name })),
        room.options,
        Math.random
      );
      if (typeof room.game.setPacingScale === 'function') room.game.setPacingScale(botScale);
      else pacing.setScale(room.game, botScale);
      room.status = 'playing';
      analytics.track('game_started', room.gameId);
      room.matchKey = crypto.randomUUID(); // identifies this game in the match history
      room.startedAt = Date.now();
      room.leftEarly = new Set();
      room.deadline = null;
      room.waiting = [];
      room.pauseUntil = 0;
      room.lastStamp = null;
      afterChange(room);
    },

    act(p, msg) {
      const room = rooms.get(p.room);
      if (!room || room.status !== 'playing' || !room.game) return sendError(p, 'No game in progress');
      if (isSpec(room, p.id)) return sendError(p, 'You are watching this game');
      const res = room.game.act(p.id, msg.action);
      if (!res.ok) {
        sendError(p, res.error || 'Not allowed');
        return broadcast(room); // resync the sender's view
      }
      afterChange(room);
    },

    /** A player who is not the host asks for another game (tap again to take it back). The host sees the count and starts it. */
    rematchVote(p, msg) {
      const room = rooms.get(p.room);
      if (!room || room.status !== 'finished') return;
      if (!room.members.some((m) => m.id === p.id && !m.bot)) return sendError(p, 'Take a seat to vote');
      room.votes = room.votes || new Set();
      if (msg.on === false) room.votes.delete(p.id); else room.votes.add(p.id);
      broadcast(room);
    },

    async rematch(p) {
      const room = hostRoom(p, 'finished');
      if (!room) return;
      // Anyone who lost access to a private table while the game was running leaves now, before the next round forms.
      await enforceAccess(room);
      if (rooms.get(room.code) !== room || room.status !== 'finished' || room.hostId !== p.id) return; // the table changed while we checked
      clearTimeout(room.timer);
      room.game = null;
      room.status = 'lobby';
      room.deadline = null;
      room.votes = new Set(); room.outcome = null;
      // Spectators stay spectators: watching is a choice. They take an open seat themselves with `sit`.
      broadcast(room);
    },
  };

  function addBotTo(room) {
    const used = new Set(room.members.map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (room.members.length + 1);
    const usedAv = new Set(room.members.map((m) => m.avatar));
    const avatar = pick(AVATARS.filter((a) => !usedAv.has(a)).concat(AVATARS.slice(0, 1)));
    room.members.push({ id: 'bot_' + crypto.randomBytes(4).toString('hex'), name, avatar, bot: true });
  }

  function applyProfile(p, msg) {
    const name = cleanName(msg.name);
    if (name) p.name = name;
    if (AVATARS.includes(msg.avatar)) p.avatar = msg.avatar;
  }

  function hostRoom(p, status) {
    const room = rooms.get(p.room);
    if (!room) return null;
    if (room.hostId !== p.id) return void sendError(p, 'Only the host can do that');
    if (room.status !== status) return void sendError(p, 'Not possible right now');
    return room;
  }

  function sanitizeOptions(def, given) {
    const out = {};
    for (const o of def.options) {
      const v = given ? given[o.key] : undefined;
      if (o.type === 'boolean') out[o.key] = typeof v === 'boolean' ? v : o.default;
      else if (o.type === 'select') out[o.key] = o.choices.some((c) => c.value === v) ? v : o.default;
    }
    return out;
  }

  // ------------------------------------------------------------ websocket
  // A browser sends Origin on WebSocket upgrades: refuse pages from other sites (clients without Origin, such as tests, are fine)
  const originOk = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    let host;
    try { host = new URL(origin).host; } catch { return false; }
    return host === req.headers.host || allowedOrigins.includes(origin.toLowerCase()) || allowedOrigins.includes(host.toLowerCase());
  };
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, verifyClient: (info) => originOk(info.req) });

  const clientIp = (req) => clientAddress(req, trustProxy);
  const socketsByIp = new Map(); // ip -> open sockets
  const accountsByIp = new Map(); // ip -> creation times within the last hour
  let accountTimes = []; // creation times within the last minute (site-wide)
  const allowNewAccount = (ip) => {
    const now = Date.now();
    accountTimes = accountTimes.filter((t) => now - t < 60000);
    const mine = (accountsByIp.get(ip) || []).filter((t) => now - t < 3600000);
    if (accountTimes.length >= maxNewAccountsPerMin || mine.length >= maxNewAccountsPerIp || players.size >= maxPlayers) return false;
    mine.push(now);
    accountsByIp.set(ip, mine);
    accountTimes.push(now);
    return true;
  };

  const helloQueue = createBoundedSerialQueue(maxPendingHellos);
  const onHello = (ws, msg) => helloQueue.enqueue(
    () => handleHello(ws, msg),
    () => ws.close(1013, 'server busy')
  );

  async function handleHello(ws, msg) {
    if (ws.readyState !== 1 || ws.revoked) return; // the socket closed or was revoked while waiting in the queue

    // Only the HttpOnly session cookie on the upgrade request authenticates a socket. A token sent inside a message is not
    // accepted: anything a page can send can then never be mistaken for a session.
    const presentedToken = ws.cookieToken || null;
    if (!presentedToken) {
      send(ws, { t: 'authRequired', message: 'Please log in to play.' });
      return ws.close(1008, 'auth required');
    }

    let p = tokens.get(presentedToken) || null;
    if (!p) {
      const dbPlayer = await dbPlayers.authenticateToken(presentedToken);
      if (dbPlayer) {
        const known = players.get(dbPlayer.id);
        if (known) {
          p = known;
          p.token = presentedToken;
          p.name = dbPlayer.display_name;
          p.avatar = dbPlayer.avatar;
          p.username = dbPlayer.username || null;
          p.createdAt = dbPlayer.created_at;
          p.isAnonymous = Boolean(dbPlayer.is_anonymous);
        } else {
          p = {
            id: dbPlayer.id,
            token: presentedToken,
            name: dbPlayer.display_name,
            avatar: dbPlayer.avatar,
            username: dbPlayer.username || null,
            createdAt: dbPlayer.created_at,
            isAnonymous: Boolean(dbPlayer.is_anonymous),
            room: null,
            ws: null,
            connected: false,
            lastSeen: Date.now(),
          };
          players.set(p.id, p);
        }
        for (const [tok, who] of tokens) if (who.id === p.id && tok !== presentedToken) tokens.delete(tok);
        tokens.set(presentedToken, p);
      }
    }

    if (!p) {
      send(ws, { t: 'authRequired', message: 'Your session is invalid or expired. Please log in again.' });
      return ws.close(1008, 'invalid session');
    }

    // Tag the socket with its session and player before the first database check. A sign-out or a new login that runs from
    // now on finds this socket and closes it, even before the socket is registered below. Until registration the socket
    // cannot send commands or receive broadcasts, so a revoked session is never acted on.
    ws.authToken = presentedToken;
    ws.pendingPlayer = p;
    const auth = await dbAuth.sessionInfo(p.token);
    // A player may still be present in the in-memory token map after sign-out, password reset,
    // or session revocation from another request/server instance. Never let that cache bypass
    // the authoritative PostgreSQL session state.
    if (!auth.authenticated) {
      tokens.delete(p.token);
      send(ws, { t: 'authRequired', message: 'Your session is invalid or expired. Please log in again.' });
      return ws.close(1008, 'invalid session');
    }
    if (dbPool.hasDatabase() && dbAuth.isEmailVerificationRequired(env) && !auth.emailVerified) {
      send(ws, { t: 'authRequired', message: 'Please verify your email before entering the lobby.' });
      return ws.close(1008, 'email verification required');
    }

    // Blocks are stored per account and applied on every table; load them once per account on this server.
    if (!p.blocked) p.blocked = dbPool.hasDatabase() ? await dbModeration.loadBlockedIds(p.id) : new Set();

    // The socket may have closed while the database answered above. A closed socket must not take over the account:
    // it must not replace the open socket, and there would be nothing left to clean it up.
    if (ws.readyState !== 1 || ws.revoked) return;
    // The account may have been deleted, or its record dropped, while the checks above were pending. Only the player
    // record that is still registered on this server can be taken over.
    if (players.get(p.id) !== p) {
      send(ws, { t: 'authRequired', message: 'Your session is invalid or expired. Please log in again.' });
      return ws.close(1008, 'invalid session');
    }
    if (p.ws && p.ws !== ws) {
      p.ws.player = null;
      p.ws.close(4000, 'replaced');
    }
    for (const other of wss.clients) {
      if (other !== ws && other.player && other.player.id === p.id) {
        other.player = null;
        other.close(4000, 'replaced');
      }
    }
    p.ws = ws;
    p.connected = true;
    p.pingMs = null; // measured again on this connection
    ws.player = p;
    // Still the open socket that owns the player? A socket that closed or was replaced while an await was pending has
    // already been handled by its close handler (or by the newer socket), so this hello stops here: no welcome, no
    // cancelled drop timer, no seat, no room change.
    const stillOwner = () => ws.readyState === 1 && !ws.revoked && p.ws === ws;
    send(ws, { t: 'welcome', id: p.id, token: includeDebugTokens ? p.token : undefined, name: p.name, avatar: p.avatar, avatars: AVATARS, emotes: EMOTES, games: games.list(), tables: publicTables(p.id), rejoin: rejoinFor(p), announcement, ...iceMsg(p.id) });
    markActive(p, ws);
    clearTimeout(p.dropTimer);
    const room = rooms.get(p.room);
    const blocked = room && blockedEntryDenied(room, p.id, true);
    const allowed = room ? (!blocked && await canEnterRoom(p, room, { present: true })) : false;
    if (!stillOwner()) return; // closed while the room was checked: the drop its close handler scheduled stays in charge
    if (room && allowed) {
      if (p.dropAnnounced) {
        p.dropAnnounced = false;
        sys(room, `📶 ${p.name} reconnected`);
        notifyOthers(room, p.id, `📶 ${p.name} reconnected`);
      }
      broadcast(room);
      sendChatLog(p, room);
      schedule(room);
    } else {
      if (room) {
        if (blocked) {
          leaveRoom(p); // a blocked player cannot resume this seat; a bot takes over if a game is running
          send(ws, { t: 'left' });
          send(ws, { t: 'notice', text: 'You can no longer share that table with someone here.' });
          send(ws, tablesMsg(p));
        } else {
          (room.denied || (room.denied = new Set())).add(p.id);
          leaveRoom(p); // frees the seat (a bot takes over a running game) instead of leaving a ghost player behind
          send(ws, { t: 'left' });
          send(ws, { t: 'error', message: 'This private table requires an accepted invitation.' });
        }
      } else p.room = null;
    }
    presence.set(p.id, { online: true, lastSeen: presence.get(p.id)?.lastSeen || null });
    publishPresence(p.id);
  }

  /** The player's open socket has ended (it closed, or its session was revoked): presence, voice and the table are updated. */
  function detachSocket(p) {
    p.ws = null;
    p.connected = false;
    p.lastSeen = Date.now();
    presence.set(p.id, { online: false, lastSeen: new Date(p.lastSeen).toISOString() });
    dbAccount.updatePresence(p.id).catch(() => {});
    publishPresence(p.id);
    const room = rooms.get(p.room);
    if (room) {
      if (voiceRelay.dropVoice(room, p.id)) broadcastVoice(room); // a dropped connection ends their voice; they rejoin it when they are back
      broadcast(room);
      schedule(room);
      onDrop(p);
    }
  }

  /**
   * Ends one socket's session. The socket forgets its player first, so nothing queued behind it can act for that player,
   * and only then does the close handshake start. Used for sign-out, password reset, a new login elsewhere and failed checks.
   */
  function revokeSocket(ws, code, reason) {
    if (ws.revoked) return;
    ws.revoked = true;
    const p = ws.player || ws.pendingPlayer;
    ws.player = null;
    ws.pendingPlayer = null;
    if (p && p.ws === ws) {
      if (tokens.get(ws.authToken) === p) tokens.delete(ws.authToken);
      detachSocket(p);
    }
    ws.close(code, reason);
  }

  /**
   * Is the session behind this open socket still valid? A revoked or expired session ends the socket. Runs on an interval,
   * not for every message, so a busy socket does not add a database query per message.
   */
  async function checkSocketSession(ws) {
    const p = ws.player;
    if (!p || ws.revoked || ws.readyState !== 1 || ws.checkingSession) return;
    ws.checkingSession = true;
    try {
      const current = await dbPlayers.authenticateToken(ws.authToken);
      if (ws.revoked || ws.player !== p) return; // ended while the check was running
      if (!current || current.id !== p.id) {
        send(ws, { t: 'authRequired', message: 'Your session has ended. Please log in again.' });
        revokeSocket(ws, 4001, 'session ended');
      }
    } catch (err) {
      // a database fault does not prove the session ended: keep the socket and check again on the next interval
      wsLog.warn('session.check_failed', { connId: ws.connId, err });
    } finally {
      ws.checkingSession = false;
    }
  }

  wss.on('connection', (ws, req) => {
    analytics.track('session'); // one count per socket; no address or identity is recorded
    ws.ip = clientIp(req);
    ws.cookieToken = authRoutes.readSessionToken(req);
    const open = (socketsByIp.get(ws.ip) || 0) + 1;
    socketsByIp.set(ws.ip, open);
    ws.once('close', () => {
      const n = (socketsByIp.get(ws.ip) || 1) - 1;
      if (n <= 0) socketsByIp.delete(ws.ip);
      else socketsByIp.set(ws.ip, n);
    });
    if (open > maxSocketsPerIp) return ws.close(1013, 'too many connections');
    const sessionTimer = setInterval(() => { void checkSocketSession(ws); }, sessionCheckMs);
    sessionTimer.unref();
    ws.once('close', () => clearInterval(sessionTimer));
    ws.isAlive = true;
    ws.connId = crypto.randomUUID().slice(0, 8); // correlates this socket's log lines; not a secret
    ws.player = null;
    ws.msgs = 0;
    ws.rtcMsgs = 0;
    ws.queueDepth = 0;
    ws.on('pong', (data) => {
      ws.isAlive = true;
      // a latency probe answers with the id it carried; the keep-alive ping has no payload
      const tag = data && data.length ? String(data) : '';
      if (tag === 'p' + ws.probeId && ws.probeSentAt && ws.player) {
        const ms = Math.max(0, Math.min(9999, Date.now() - ws.probeSentAt));
        const q = ws.player;
        q.pingMs = Number.isFinite(q.pingMs) ? Math.round(q.pingMs * 0.6 + ms * 0.4) : ms; // smoothed: one slow packet does not look like a bad connection
        send(ws, { t: 'latency', ms: q.pingMs });
      }
    });
    ws.on('message', (raw) => {
      if (ws.revoked || ws.readyState !== 1) return; // a revoked or closing socket is not served
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      // flood guard; counters are reset every second. Voice setup messages come in bursts (several ICE candidates per
      // person at the table), so they have their own, larger allowance and do not use up the normal one.
      if (msg.t === 'rtc') { if (++ws.rtcMsgs > maxRtcPerSec) return ws.close(1008, 'slow down'); } else if (++ws.msgs > maxMsgsPerSec) return ws.close(1008, 'slow down');
      if (msg.t === 'hello') {
        // onHello is async (database lookup): a failure must close this socket, not crash the process with an unhandled rejection
        onHello(ws, msg).catch((e) => {
          console.error('[server] hello failed:', e.message);
          ws.close(1011, 'server error');
        });
        return;
      }
      const p = ws.player;
      if (!p || !Object.hasOwn(handlers, msg.t)) return;
      const run = async () => {
        // queued behind an earlier message: the session may have ended while it waited
        if (ws.revoked || ws.readyState !== 1 || ws.player !== p) return;
        markActive(p, ws); // at most one analytics mark per account per day
        try {
          const before = p.room;
          await handlers[msg.t](p, msg);
          if (PRESENCE_ON.has(msg.t)) {
            schedulePresence(p.id);
            const at = rooms.get(p.room);
            if (at && msg.t === 'start') for (const m of humans(at)) schedulePresence(m.id);
          }
          if (RECENT_ON.has(msg.t) && p.room && (p.room !== before || (msg.t === 'join' && String(msg.code || '').trim().toUpperCase() === p.room))) trackRecent(p);
        } catch (e) {
          trackError('ws_handler');
          wsLog.error('game.handler_failed', { connId: ws.connId, type: msg.t, room: p.room || null, err: e });
          sendError(p, 'Something went wrong');
        }
      };
      // one message at a time per socket: a join that waits for the database must finish before the next message
      // (act, chat, leave...) is looked at, exactly as when every handler was synchronous. Bound the waiting queue too.
      enqueueSocketMessage(ws, run, maxQueuedMessages);
    });
    ws.on('close', () => {
      const p = ws.player;
      if (!p || p.ws !== ws) return;
      detachSocket(p);
    });
    ws.on('error', (err) => wsLog.warn('ws.socket_error', { connId: ws.connId, code: err && err.code, err }));
  });

  // keep-alive, rate-limit window reset, garbage collection
  const ticker = setInterval(() => {
    for (const ws of wss.clients) {
      ws.msgs = 0;
      ws.rtcMsgs = 0;
      if (ws.player && (!ws.probeSentAt || Date.now() - ws.probeSentAt >= 8000)) {
        ws.probeId = (ws.probeId || 0) + 1;
        ws.probeSentAt = Date.now();
        try { ws.ping('p' + ws.probeId); } catch { /* the socket is closing */ }
      }
      if (!ws.pingAt || Date.now() - ws.pingAt > 30000) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.pingAt = Date.now();
        ws.ping();
      }
    }
  }, 1000);
  const gc = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const hasConnectedHuman = humans(room).some(isConnected);
      if (hasConnectedHuman) {
        room.idleSince = null;
      } else if (!room.idleSince) {
        room.idleSince = now;
      } else if (now - room.idleSince > 10 * 60 * 1000) {
        destroyRoom(room);
        continue;
      }
      // Abandoned lobbies are short lived; a stalled game gets a longer grace period.
      const idleLimit = room.status === 'lobby' ? 15 * 60 * 1000 : 60 * 60 * 1000;
      if (now - (room.lastActivity || room.createdAt || now) > idleLimit) {
        destroyRoom(room);
        continue;
      }
      // spectators who disappeared for a while are dropped
      for (const s of room.spectators.slice()) {
        const sp = players.get(s.id);
        if (!sp || (!sp.connected && now - sp.lastSeen > 5 * 60 * 1000)) {
          room.spectators.splice(room.spectators.indexOf(s), 1);
          if (sp) sp.room = null;
        }
      }
    }
    for (const [ip, times] of accountsByIp) if (!times.some((t) => now - t < 3600000)) accountsByIp.delete(ip);
    for (const p of players.values()) {
      if (!p.connected && !rooms.has(p.room) && now - p.lastSeen > 60 * 60 * 1000) {
        players.delete(p.id);
        tokens.delete(p.token);
      }
    }
  }, 60 * 1000);
  ticker.unref();
  gc.unref();

  /** One line of operational numbers for the logs (Render's log search is the free dashboard). */
  function statusLine() {
    const q = matchQueue.stats();
    let sockets = 0; for (const ws of wss.clients) if (ws.player) sockets++;
    let playing = 0; for (const r of rooms.values()) if (r.status === 'playing') playing++;
    return `[stats] rooms=${rooms.size} playing=${playing} sockets=${sockets} players=${players.size} rssMB=${Math.round(process.memoryUsage().rss / 1048576)} matches(saved=${q.saved} pending=${q.pending} failed=${q.failed} retried=${q.retried})`;
  }
  // every 5 minutes, and every minute while a match result is pending or failed (so a database problem is easy to spot in the logs)
  let statsAt = 0;
  const statsTimer = setInterval(() => {
    const q = matchQueue.stats();
    const urgent = q.pending || q.failed;
    if (Date.now() - statsAt >= (urgent ? 55000 : 299000)) { statsAt = Date.now(); (opts.log || console).log(statusLine()); }
  }, 30000);
  statsTimer.unref();

  async function close({ drainMs = 0 } = {}) {
    clearInterval(statsTimer);
    shuttingDown = true;
    const deadline = Date.now() + drainMs;
    const httpClosed = new Promise((resolve) => server.close(resolve));
    // Tables live in memory and do not survive a restart: say so, and close sockets with 1012 ("service restart") so the
    // app shows a calm message instead of a mysterious disconnect. Running games are NOT recorded as finished.
    for (const ws of wss.clients) {
      try {
        send(ws, { t: 'notice', text: 'The server is restarting for an update. Tables are not kept across a restart, so unfinished games are lost. Please start a new table in a minute.' });
        ws.close(1012, 'server restarting');
      } catch { /* already closing */ }
    }
    clearInterval(ticker);
    clearTimeout(tablesTimer);
    clearInterval(gc);
    clearInterval(purgeTimer);
    clearInterval(spoolTimer);
    // Let auth handlers finish before taking the delivery snapshot, within one shared shutdown window.
    if (drainMs) {
      const matchDrain = matchQueue.drain(drainMs);
      let timer;
      await Promise.race([
        Promise.allSettled([...activeAuthRequests]),
        new Promise((resolve) => { timer = setTimeout(resolve, drainMs); }),
      ]);
      clearTimeout(timer);
      await Promise.all([matchDrain, authRoutes.drainDeliveries(Math.max(0, deadline - Date.now()))]);
    }
    await analytics.close(2000); // last counters: always attempted, and shutdown waits at most 2 s for them
    if (metered) metered.stop();
    matchQueue.close();
    for (const room of rooms.values()) clearTimeout(room.timer);
    await new Promise((r) => setTimeout(r, wss.clients.size ? 300 : 0)); // let the restart notice reach the sockets
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await httpClosed;
  }

  // Verify the database and run migrations BEFORE accepting anybody. Any failure rejects start(): the process must not
  // serve players on a database it cannot use (and in production it must not silently fall back to memory).
  return database.prepare().then((info) => {
    if (production && info && info.mode === 'postgres') emailSender.assertReady();
    if (info && info.mode === 'postgres') {
      matchQueue.replaySpool(); // results a previous run could not save
      // a result whose retries ran out (database down for a while) is tried again every 10 minutes, not only at the next start
      spoolTimer = setInterval(() => matchQueue.replaySpool(), 10 * 60 * 1000);
      spoolTimer.unref();
      // old rate-limit rows, expired sessions and used tokens: once now, then every 6 hours (best effort)
      const purge = () => dbAuth.purgeExpired().catch((e) => (opts.log || console).error('[auth] housekeeping failed: ' + e.message));
      const purgeAdmin = () => dbAdmin.purge().catch((e) => (opts.log || console).error('[admin] retention housekeeping failed: ' + e.message));
      dbAdmin.bootstrapOwner(env).then((r) => { if (r.claimed) (opts.log || console).log('[admin] owner account set from server configuration'); }, (e) => (opts.log || console).error('[admin] owner bootstrap failed: ' + e.message));
      analytics.start();
      purge();
      purgeAdmin();
      purgeTimer = setInterval(() => { purge(); purgeAdmin(); }, 6 * 60 * 60 * 1000);
      purgeTimer.unref();
    }
    if (metered) metered.start(); // both modes: the credential is fetched ahead of the first welcome, and refreshed in the background
    return new Promise((resolve) => server.listen(port, () => resolve({ server, port: server.address().port, close, database: info, matchQueue, statusLine })));
  });
}

module.exports = { start };

if (require.main === module) {
  start().then(
    ({ port, database, close }) => {
      // Last-resort guards. An unhandled rejection means a code path we did not anticipate has gone wrong; the process
      // may be in an inconsistent state, so we do the same thing as uncaughtException: drain pending match writes and exit
      // (the host will restart us). We use a single `crashing` flag so that a rejection storm does not spawn multiple
      // concurrent shutdown sequences, and we give slightly more drain time (5 s) than a crash (the rejection is slower to
      // surface than a thrown exception).
      let crashing = false;
      const crashShutdown = (label, reason) => {
        serverLog.error('process.crash', { reason: label, err: reason });
        if (crashing) return;
        crashing = true;
        close({ drainMs: 5000 }).then(() => process.exit(1), () => process.exit(1));
      };
      process.on('unhandledRejection', (reason) => crashShutdown('unhandled rejection', reason));
      process.on('uncaughtException',  (err)    => crashShutdown('uncaught exception',  err));
      console.log(`Tableverse running on http://localhost:${port} (${database.mode} store)`);
      serverLog.info('server.started', { port, store: database.mode });
      // Render sends SIGTERM on deploy/restart: finish pending match writes first (it waits 30 s before killing us)
      let stopping = false;
      const stop = (sig) => {
        if (stopping) return;
        stopping = true;
        console.log(`[server] ${sig}: finishing pending match writes, then exiting`);
        serverLog.info('server.stopping', { signal: sig });
        close({ drainMs: 15000 }).then(() => process.exit(0), () => process.exit(1));
      };
      process.on('SIGTERM', () => stop('SIGTERM'));
      process.on('SIGINT', () => stop('SIGINT'));
    },
    (err) => {
      serverLog.error('server.start_failed', { err });
      console.error('[server] FATAL: refusing to start:', err.message); // operators and tests read this line
      process.exit(1);
    }
  );
}
