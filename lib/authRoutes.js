'use strict';
/**
 * HTTP routes under /api/auth: register, login, logout, email verification, password reset, session info.
 *
 *  - The session lives only in an HttpOnly cookie (ct_session). Scripts never see it, and the WebSocket upgrade carries
 *    the cookie itself, so no endpoint hands the token to JavaScript. (Only NODE_ENV=test returns it, for test clients
 *    that are not browsers.)
 *  - CSRF uses the double-submit pattern with a real cookie: the ct_csrf cookie is set by the server and every POST must
 *    repeat its value in the X-CSRF-Token header. A page on another site can neither read nor set that cookie.
 *  - Every mutating endpoint is rate limited per address and, where an email or token is involved, per email/token.
 *  - Endpoints that could reveal whether an email has an account (resend, forgot password) always answer the same way.
 */
const crypto = require('crypto');
const dbAuth = require('../db/auth');
const { AuthError } = dbAuth;
const { hitRateLimit, refundRateLimit } = require('../db/rateLimit');
const { createAccountRoutes } = require('./accountRoutes');
const { createFriendRoutes } = require('./friendRoutes');
const { clientAddress } = require('./clientIp');
const { debugTokensEnabled, isTestMode } = require('./debugTokens');

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function createAuthRoutes({ env, production, trustProxy, emailSender, sendJson, readJsonBody, avatars = [], onSignedOut = () => {}, onProfileChanged = () => {}, onAccountDeleted = () => {}, tableStatus = () => null, friendsContext = {}, extraRoutes = null, onEvent = () => {}, log = console }) {
  const debugTokens = debugTokensEnabled(env); // raw tokens in responses: tests only, never on a hosted deployment
  const rate = (prod, test, key) => Number(env[key] || (isTestMode(env) ? test : prod));
  const RL = {
    registerIp: { scope: 'auth:register:ip', limit: rate(8, 500, 'RL_REGISTER_IP_LIMIT'), windowMs: 10 * MIN },
    registerEmail: { scope: 'auth:register:email', limit: rate(4, 100, 'RL_REGISTER_EMAIL_LIMIT'), windowMs: HOUR },
    loginIp: { scope: 'auth:login:ip', limit: rate(25, 1000, 'RL_LOGIN_IP_LIMIT'), windowMs: 10 * MIN },
    // failed attempts per address and per address-plus-IP: a wrong guess against one account from one place is throttled without
    // letting one attacker lock the owner out from every other place (see docs/SESSION_POLICY.md)
    loginEmailIp: { scope: 'auth:login:emailip', limit: rate(8, 200, 'RL_LOGIN_EMAIL_LIMIT'), windowMs: 15 * MIN },
    resendIp: { scope: 'auth:resend:ip', limit: rate(10, 400, 'RL_RESEND_IP_LIMIT'), windowMs: HOUR },
    resendEmail: { scope: 'auth:resend:email', limit: rate(3, 100, 'RL_RESEND_EMAIL_LIMIT'), windowMs: HOUR },
    forgotIp: { scope: 'auth:forgot:ip', limit: rate(10, 400, 'RL_FORGOT_IP_LIMIT'), windowMs: HOUR },
    forgotEmail: { scope: 'auth:forgot:email', limit: rate(5, 100, 'RL_FORGOT_EMAIL_LIMIT'), windowMs: HOUR },
    resetIp: { scope: 'auth:reset:ip', limit: rate(12, 400, 'RL_RESET_IP_LIMIT'), windowMs: HOUR },
    resetToken: { scope: 'auth:reset:token', limit: rate(6, 150, 'RL_RESET_TOKEN_LIMIT'), windowMs: 15 * MIN },
    usernameIp: { scope: 'auth:username:ip', limit: rate(60, 2000, 'RL_USERNAME_IP_LIMIT'), windowMs: 10 * MIN },
    verifyIp: { scope: 'auth:verify:ip', limit: rate(30, 1000, 'RL_VERIFY_IP_LIMIT'), windowMs: 10 * MIN },
    sessionIp: { scope: 'auth:session:ip', limit: rate(120, 4000, 'RL_SESSION_IP_LIMIT'), windowMs: 10 * MIN },
    logoutIp: { scope: 'auth:logout:ip', limit: rate(60, 2000, 'RL_LOGOUT_IP_LIMIT'), windowMs: 10 * MIN },
  };

  const hashKey = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex');
  const requestIp = (req) => clientAddress(req, trustProxy);

  // ---------------------------------------------------------------- cookies and CSRF
  const secure = production ? '; Secure' : '';
  const maxAge = () => Math.round(dbAuth.sessionTtlDays() * 24 * 60 * 60);
  const sessionCookie = (token) => `ct_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge()}; HttpOnly; SameSite=Lax${secure}`;
  // Stage 20.9: the device token is sent only to the account endpoints (Path=/api/auth), and never to other sites (SameSite=Lax)
  const deviceCookie = (token) => `ct_device=${encodeURIComponent(token)}; Path=/api/auth; Max-Age=${dbAuth.DEVICE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
  const clearedDeviceCookie = () => `ct_device=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  const clearedSessionCookie = () => `ct_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  const csrfCookie = (token) => `ct_csrf=${token}; Path=/; Max-Age=${maxAge()}; SameSite=Lax${secure}`; // readable by the page on purpose

  const readCookie = (req, name) => {
    for (const chunk of String(req.headers.cookie || '').split(';')) {
      const i = chunk.indexOf('=');
      if (i < 0 || chunk.slice(0, i).trim() !== name) continue;
      try { return decodeURIComponent(chunk.slice(i + 1).trim()) || null; } catch { return null; }
    }
    return null;
  };
  const readSessionToken = (req) => readCookie(req, 'ct_session');

  const pendingCookies = new WeakMap(); // res -> Set-Cookie lines (a response may need both cookies)
  const addCookie = (res, line) => {
    const list = pendingCookies.get(res) || [];
    list.push(line);
    pendingCookies.set(res, list);
    res.setHeader('Set-Cookie', list);
  };

  const csrfFor = (req, res) => {
    const existing = readCookie(req, 'ct_csrf');
    if (existing && /^[a-f0-9]{48}$/.test(existing)) return existing;
    const fresh = crypto.randomBytes(24).toString('hex');
    addCookie(res, csrfCookie(fresh));
    return fresh;
  };
  const requireCsrf = (req) => {
    const cookie = readCookie(req, 'ct_csrf') || '';
    const header = String(req.headers['x-csrf-token'] || '');
    const ok = cookie.length > 0 && cookie.length === header.length && crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
    if (!ok) throw new AuthError('Invalid CSRF token.', 403);
  };

  // ---------------------------------------------------------------- helpers
  /** Reserves one attempt on each counter. Returns the reservations (with their buckets) so a later refund hits the same window.
   *  If any step fails, every counter this call actually incremented is given back, including the refusing one: the request
   *  never ran, so a refused or failed reservation must not keep pushing shared counters (such as the per-address one) higher. */
  async function limit(checks) {
    const reserved = [];
    try {
      for (const c of checks) {
        if (!c.key) continue;
        const out = await hitRateLimit({ scope: c.scope, key: c.key, limit: c.limit, windowMs: c.windowMs });
        // recorded only once the increment has happened, so a counter whose query failed is never refunded for an attempt it did not count
        reserved.push({ scope: c.scope, key: c.key, windowMs: c.windowMs, bucket: out.bucket });
        if (!out.allowed) {
          throw new AuthError('Too many requests. Please wait and try again.', 429, { retryAfter: Math.max(1, Math.ceil(out.resetMs / 1000)) });
        }
      }
    } catch (err) {
      await refund(reserved); // best effort; refund() logs its own failures and never throws
      throw err;
    }
    return reserved;
  }
  const byIpAndEmail = (req, ipRule, emailRule, email) => [{ ...ipRule, key: requestIp(req) }, { ...emailRule, key: hashKey(dbAuth.normEmail(email)) }];
  const loginChecks = (req, email) => [
    { ...RL.loginIp, key: requestIp(req) }, // every failed login from this address, whatever the account (aggregate)
    { ...RL.loginEmailIp, key: `${hashKey(dbAuth.normEmail(email))}:${requestIp(req)}` },
  ];
  // Returns the attempts reserved by limit() to their counters. Best effort: a failed refund is logged and never fails the
  // request, so a database hiccup cannot block a successful login or the session revocation that follows it.
  async function refund(reserved) {
    for (const r of reserved) {
      if (!r.key) continue;
      try {
        await refundRateLimit({ scope: r.scope, key: r.key, windowMs: r.windowMs, bucket: r.bucket });
      } catch (err) {
        log.error('rate limit refund failed; the attempt stays counted', err);
      }
    }
  }

  // Email is best effort once the database row exists: a provider outage must not strand the account or reveal who has one.
  const senders = {
    verify: (m) => emailSender.sendVerification(m),
    reset: (m) => emailSender.sendPasswordReset(m),
    exists: (m) => emailSender.sendAccountExists(m),
  };
  // Sends still running. Shutdown waits for them (drainDeliveries) so a verification email is not cut off mid-send.
  const inFlight = new Set();
  /** Never rejects: a failed send is logged and reported as false. */
  function deliver(kind, { email, token }) {
    const job = (async () => {
      try {
        if (!debugTokens) await senders[kind]({ email, token });
        return true;
      } catch (err) {
        log.error(`[auth] ${kind} email could not be delivered: ${err.message}`);
        return false;
      }
    })();
    inFlight.add(job);
    job.then(() => inFlight.delete(job));
    return job;
  }
  /** Waits up to ms for sends already started. Resolves either way. */
  async function drainDeliveries(ms) {
    if (!ms || inFlight.size === 0) return;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    await Promise.race([Promise.allSettled([...inFlight]), timeout]);
    clearTimeout(timer);
  }

  // ---------------------------------------------------------------- routes
  const routes = {
    'GET /api/auth/csrf': async (req, res) => sendJson(res, 200, { ok: true, csrfToken: csrfFor(req, res) }),

    'GET /api/auth/username-available': async (req, res) => {
      await limit([{ ...RL.usernameIp, key: requestIp(req) }]);
      const username = new URL(req.url, 'http://x').searchParams.get('username') || '';
      sendJson(res, 200, { ok: true, ...(await dbAuth.checkUsernameAvailability({ username })) });
    },

    'GET /api/auth/session': async (req, res) => {
      await limit([{ ...RL.sessionIp, key: requestIp(req) }]);
      const token = readSessionToken(req);
      const csrfToken = csrfFor(req, res);
      let info = token ? await dbAuth.sessionInfo(token) : { authenticated: false };
      // Stage 20.9: no live session but a trusted device: start a session for it (the same account, after the same checks)
      const device = readCookie(req, 'ct_device');
      if (!info.authenticated && device) {
        const restored = await dbAuth.restoreFromDevice(device);
        if (restored && restored.reused) {
          // another tab of this browser just started the session for this device: answer for it, without replacing it
          addCookie(res, deviceCookie(restored.device));
          info = await dbAuth.sessionInfoForPlayer(restored.playerId);
        } else if (restored) {
          onSignedOut({ playerId: restored.playerId, token: null, exceptToken: restored.token });
          addCookie(res, sessionCookie(restored.token));
          addCookie(res, deviceCookie(restored.device)); // the device's lifetime is renewed with the cookie
          info = await dbAuth.sessionInfo(restored.token);
        }
      } else if (info.authenticated && device && info.player && (await dbAuth.touchDevice(device, info.player.id))) {
        addCookie(res, deviceCookie(device)); // a visit with a live session also keeps the device alive
      }
      if (!token && !info.authenticated) {
        return sendJson(res, 200, {
          ok: true,
          authenticated: false,
          emailVerificationRequired: dbAuth.isEmailVerificationRequired(env),
          csrfToken,
        });
      }
      const player = info.player
        ? { ...info.player, email: info.email || null, email_verified: Boolean(info.emailVerified) }
        : null;
      sendJson(res, 200, {
        ok: true,
        authenticated: Boolean(info.authenticated),
        player,
        emailVerified: Boolean(info.emailVerified),
        emailVerificationRequired: dbAuth.isEmailVerificationRequired(env),
        csrfToken,
      });
    },

    // Registration never issues a session, for a new address or for one that already has an account. Both answer with the
    // same status, keys and message, and neither sets ct_session. The player verifies the email, then logs in.
    'POST /api/auth/register': async (req, res) => {
      const body = await readJsonBody(req);
      await limit(byIpAndEmail(req, RL.registerIp, RL.registerEmail, body.email));
      const out = await dbAuth.registerEmail({ email: body.email, username: body.username, password: body.password, displayName: body.displayName, avatar: body.avatar });
      if (!out.alreadyRegistered) onEvent('registration'); // analytics counter only (never throws, never waits)
      const verificationRequired = dbAuth.isEmailVerificationRequired(env);
      const emailSent = out.alreadyRegistered
        ? await deliver('exists', { email: out.email })
        : await deliver('verify', { email: out.email, token: out.verifyToken });
      const message = emailSent
        ? (verificationRequired
            ? 'Check your email for a verification link. After verifying, log in to play.'
            : 'Check your email for a verification link. You can log in now; verification is optional right now.')
        : (verificationRequired
            ? 'The verification email could not be sent. Use "Resend verification email" in a moment, then log in.'
            : 'The verification email could not be sent. You can log in now; verification is optional right now.');
      sendJson(res, 201, {
        ok: true,
        requiresVerification: verificationRequired,
        emailVerificationRequired: verificationRequired,
        emailSent,
        csrfToken: csrfFor(req, res),
        player: null,
        message,
        ...(debugTokens && !out.alreadyRegistered ? { debug: { verifyToken: out.verifyToken } } : {}),
      });
    },

    'POST /api/auth/login': async (req, res) => {
      const body = await readJsonBody(req);
      // limit() reserves one attempt on each counter before any password check, so concurrent guesses cannot all slip under it.
      const checks = loginChecks(req, body.email);
      const reserved = await limit(checks);
      let out;
      try {
        out = await dbAuth.loginEmail({ email: body.email, password: body.password, rememberDevice: body.rememberDevice === true, userAgent: req.headers['user-agent'], replaceDevice: readCookie(req, 'ct_device') });
      } catch (err) {
        // a wrong password or unknown address uses up the attempt; a server fault must not lock the player out
        if (!(err instanceof AuthError && err.status === 401)) await refund(reserved);
        throw err;
      }
      // one active session: the older device is signed out first, so a slow or stalled refund below cannot keep its socket open
      onSignedOut({ playerId: out.player.id, token: null, exceptToken: out.token });
      // a device this sign-in replaced may have belonged to another account: close the sockets of the sessions it ended
      for (const r of out.revokedSessions || []) onSignedOut({ playerId: r.playerId, tokenHash: r.tokenHash });
      await refund(reserved); // a successful login is not a failed attempt
      onEvent('login', null, out.player.id);
      addCookie(res, sessionCookie(out.token));
      // a password login replaces the trust this browser had before (retired in the login transaction)
      if (out.device) addCookie(res, deviceCookie(out.device));
      else addCookie(res, clearedDeviceCookie());
      const verificationRequired = dbAuth.isEmailVerificationRequired(env) && !out.player.email_verified;
      sendJson(res, 200, {
        ok: true,
        token: debugTokens ? out.token : undefined,
        csrfToken: csrfFor(req, res),
        player: out.player,
        requiresVerification: verificationRequired,
        emailVerificationRequired: dbAuth.isEmailVerificationRequired(env),
      });
    },

    'POST /api/auth/logout': async (req, res) => {
      await limit([{ ...RL.logoutIp, key: requestIp(req) }]);
      const token = readSessionToken(req);
      const s = await dbAuth.readSessionFromCookie(token);
      // this browser's session and its trusted device end together, in one transaction
      const out = await dbAuth.endCurrentSession({ sessionToken: token, deviceToken: readCookie(req, 'ct_device') });
      if (s) onSignedOut({ playerId: s.player_id, token });
      // sessions a racing restore started from this device end here too: close their sockets as well
      for (const r of out.revoked) onSignedOut({ playerId: r.playerId, tokenHash: r.tokenHash });
      addCookie(res, clearedSessionCookie());
      addCookie(res, clearedDeviceCookie());
      sendJson(res, 200, { ok: true });
    },

    'POST /api/auth/logout-all': async (req, res) => {
      await limit([{ ...RL.logoutIp, key: requestIp(req) }]);
      const out = await dbAuth.revokeAllSessionsForCurrent(readSessionToken(req));
      if (out.playerId) onSignedOut({ playerId: out.playerId, token: null });
      addCookie(res, clearedSessionCookie());
      addCookie(res, clearedDeviceCookie());
      sendJson(res, 200, { ok: true, revoked: out.revoked || 0 });
    },

    'POST /api/auth/resend-verification': async (req, res) => {
      const body = await readJsonBody(req);
      await limit(byIpAndEmail(req, RL.resendIp, RL.resendEmail, body.email));
      const out = await dbAuth.resendVerification({ email: body.email });
      if (out.verifyToken) void deliver('verify', { email: out.email, token: out.verifyToken }); // not awaited: the answer must not depend on whether the address has an account
      sendJson(res, 200, { ok: true, ...(debugTokens && out.verifyToken ? { debug: { verifyToken: out.verifyToken } } : {}), message: 'If this account exists, a verification email has been sent.' });
    },

    'POST /api/auth/verify-email': async (req, res) => {
      const body = await readJsonBody(req);
      await limit([{ ...RL.verifyIp, key: requestIp(req) }]);
      await dbAuth.verifyEmailToken(body.token);
      sendJson(res, 200, { ok: true, message: 'Email verified. You can now enter the lobby.' });
    },

    'POST /api/auth/forgot-password': async (req, res) => {
      const body = await readJsonBody(req);
      await limit(byIpAndEmail(req, RL.forgotIp, RL.forgotEmail, body.email));
      const out = await dbAuth.requestPasswordReset({ email: body.email });
      if (out.resetToken) void deliver('reset', { email: out.email, token: out.resetToken }); // not awaited, for the same reason as resend
      sendJson(res, 200, { ok: true, ...(debugTokens && out.resetToken ? { debug: { resetToken: out.resetToken } } : {}), message: 'If this account exists, a reset email has been sent.' });
    },

    'POST /api/auth/reset-password': async (req, res) => {
      const body = await readJsonBody(req);
      await limit([{ ...RL.resetIp, key: requestIp(req) }, { ...RL.resetToken, key: hashKey(body.token) }]);
      const out = await dbAuth.resetPassword({ token: body.token, newPassword: body.newPassword });
      if (out.playerId) onSignedOut({ playerId: out.playerId, token: null });
      addCookie(res, clearedSessionCookie());
      addCookie(res, clearedDeviceCookie());
      sendJson(res, 200, { ok: true, message: 'Password updated. Please log in again.' });
    },
  };

  // Signed-in account endpoints (profile, history, recent tables, deletion) and the public profile share these helpers.
  const accountRoutes = createAccountRoutes({
    env, debugTokens, avatars, onProfileChanged, onAccountDeleted, tableStatus,
    ctx: { limit, requestIp, readSessionToken, sendJson, readJsonBody, addCookie, clearedSessionCookie },
  });
  const friendRoutes = createFriendRoutes({
    env, debugTokens,
    ctx: { limit, requestIp, readSessionToken, sendJson, readJsonBody, ...friendsContext },
  });
  const meRoutes = { ...accountRoutes, ...friendRoutes };
  // Stage 20.5: admin console, announcements and feedback. They are routed below, so they get the same CSRF check and error handling.
  const adminRoutes = extraRoutes
    ? extraRoutes({ limit, requestIp, readSessionToken, sendJson, readJsonBody, sessionInfo: dbAuth.sessionInfo, AuthError })
    : {};
  const isAdminPath = (rel) => rel.startsWith('/api/admin/') || rel === '/api/announcements' || rel === '/api/announcements/dismiss' || rel === '/api/feedback' || rel === '/api/email/unsubscribe';

  /** Returns true when the request belonged to /api/auth/, /api/me/ or /api/players/ and has been answered. */
  async function handle(req, res, rel) {
    let route = null;
    if (rel.startsWith('/api/auth/')) route = routes[`${req.method} ${rel}`];
    else if (rel.startsWith('/api/me/')) route = meRoutes[`${req.method} ${rel}`];
    else if (isAdminPath(rel)) route = adminRoutes[`${req.method} ${rel}`];
    else if (rel.startsWith('/api/players/') && req.method === 'GET') {
      try { req.routeParam = decodeURIComponent(rel.slice('/api/players/'.length)).slice(0, 64); } catch { req.routeParam = ''; }
      route = accountRoutes['GET /api/players/:username'];
    }
    if (!route) return false;
    try {
      if (req.method === 'POST') requireCsrf(req);
      await route(req, res);
    } catch (err) {
      if (res.headersSent) return true;
      if (err instanceof AuthError) {
        if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
        sendJson(res, err.status, { ok: false, error: err.message, ...(err.retryable ? { retryable: true } : {}) });
      } else if (err && err.message === 'payload too large') sendJson(res, 413, { ok: false, error: 'Request too large.' });
      else if (err && err.message === 'invalid json') sendJson(res, 400, { ok: false, error: 'Invalid request.' });
      else {
        log.error(`[auth] ${req.method} ${rel} failed: ${err && err.stack ? err.stack : err}`);
        sendJson(res, 500, { ok: false, error: 'Could not process request.' });
      }
    }
    return true;
  }

  return { handle, readSessionToken, drainDeliveries };
}

module.exports = { createAuthRoutes };
