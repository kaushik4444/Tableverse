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
const { hashTrialKey } = require('../db/guestTrials');
const dbAuth = require('../db/auth');
const { AuthError } = dbAuth;
const { hitRateLimit, refundRateLimit } = require('../db/rateLimit');
const { createAccountRoutes } = require('./accountRoutes');
const { createFriendRoutes } = require('./friendRoutes');
const { clientAddress } = require('./clientIp');
const { createVerifier, GoogleAuthError, nonceFor } = require('./googleAuth');
const dbGoogle = require('../db/authGoogle');
const { debugTokensEnabled, isTestMode } = require('./debugTokens');
const dbPlayers = require('../db/players');
const guestPolicy = require('./guestPolicy');
const { pickGuestName } = require('./guestNames');

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function createAuthRoutes({ env, production, trustProxy, emailSender, sendJson, sendText, readJsonBody, avatars = [], onSignedOut = () => {}, onProfileChanged = () => {}, onGuestUpgraded = () => {}, onAccountDeleted = () => {}, tableStatus = () => null, friendsContext = {}, extraRoutes = null, onEvent = () => {}, log = console, googleVerifier = null, googleAllowed = false }) {
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
    // guest sessions: per address, and one all-guests ceiling per hour so a flood of addresses cannot make unlimited guests
    guestIp: { scope: 'auth:guest:ip', limit: rate(10, 500, 'RL_GUEST_IP_LIMIT'), windowMs: HOUR },
    guestAll: { scope: 'auth:guest:all', limit: rate(300, 5000, 'RL_GUEST_ALL_LIMIT'), windowMs: HOUR, key: 'all' },
  };

  // Sign in with Google: on only when a web client ID is configured (GOOGLE_CLIENT_ID). Free: no secret and no billing are involved.
  const googleClientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  // The verifier exists whenever a client ID is set: it confirms an account deletion with Google, which must stay possible
  // for existing Google-only accounts. Creating an account or signing in with Google is offered only when the caller says the
  // privacy notice is live (googleAllowed). The googleVerifier override is for tests and also enables sign-in.
  const google = googleVerifier || (googleClientId ? createVerifier({ clientId: googleClientId }) : null);
  const googleSignInOn = !!google && (googleAllowed || !!googleVerifier);
  RL.googleIp = { scope: 'auth:google:ip', limit: rate(30, 1000, 'RL_GOOGLE_IP_LIMIT'), windowMs: 10 * MIN };
  RL.googleSignupIp = { scope: 'auth:google:signup:ip', limit: rate(8, 500, 'RL_GOOGLE_SIGNUP_IP_LIMIT'), windowMs: 10 * MIN };

  const hashKey = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex');
  const requestIp = (req) => clientAddress(req, trustProxy);

  // ---------------------------------------------------------------- cookies and CSRF
  const secure = production ? '; Secure' : '';
  const maxAge = () => Math.round(dbAuth.sessionTtlDays() * 24 * 60 * 60);
  const sessionCookie = (token) => `ct_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge()}; HttpOnly; SameSite=Lax${secure}`;
  // Stage 20.9: the device token is sent only to the account endpoints (Path=/api/auth), and never on a cross-site request or
  // navigation (SameSite=Strict): a link from another site cannot restore this browser's device and end the account's other session
  const deviceCookie = (token) => `ct_device=${encodeURIComponent(token)}; Path=/api/auth; Max-Age=${dbAuth.DEVICE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
  const clearedDeviceCookie = () => `ct_device=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
  const clearedSessionCookie = () => `ct_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  const guestSessionCookie = (token, hours) => `ct_session=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.round(hours * 3600)}; HttpOnly; SameSite=Lax${secure}`;
  // The device's guest-trial cookie (game limits, db/guestTrials.js). Long-lived and reused, so a new guest on the same device
  // shares the device's count. Only its hash is stored.
  const TRIAL_COOKIE = 'tv_trial';
  const trialCookie = (token) => `${TRIAL_COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
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
    confirm_upgrade: (m) => emailSender.sendUpgradeConfirmation(m),
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

  async function verifyGoogle(req, credential, { maxAgeSeconds } = {}) {
    try {
      return await google.verify(credential, { nonce: nonceFor(readCookie(req, 'ct_csrf') || ''), maxAgeSeconds });
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        log.warn && log.warn('[google] sign-in refused: ' + err.detail); // the reason, never the token
        throw new AuthError(err.message, /temporarily/.test(err.message) ? 503 : 401);
      }
      throw err;
    }
  }
  function finishGoogleSession(req, res, out, event) {
    // one active session: the older one is signed out, the same as after a password login
    for (const r of out.revokedSessions || []) onSignedOut({ playerId: r.playerId, tokenHash: r.tokenHash, replaced: true });
    onEvent(event, null, out.player.id);
    addCookie(res, sessionCookie(out.token));
    // the device this browser trusted before is retired in the sign-in transaction, as after a password login; "Keep me signed in" issues a new one
    addCookie(res, out.device ? deviceCookie(out.device) : clearedDeviceCookie());
    // Google has verified the address, so this player needs no verification; the configured policy is still reported, as after a password login
    sendJson(res, 200, { ok: true, token: debugTokens ? out.token : undefined, csrfToken: csrfFor(req, res), player: out.player, requiresVerification: false, emailVerificationRequired: dbAuth.isEmailVerificationRequired(env) });
  }

  // ---------------------------------------------------------------- routes
  const routes = {
    'GET /api/auth/csrf': async (req, res) => sendJson(res, 200, { ok: true, csrfToken: csrfFor(req, res) }),

    'GET /api/auth/google/config': async (req, res) => {
      // the nonce ties a Google token to this browser: a token taken from another browser cannot be replayed here
      const csrf = csrfFor(req, res);
      sendJson(res, 200, google ? { ok: true, enabled: googleSignInOn, deleteConfirm: true, clientId: googleClientId, nonce: nonceFor(csrf) } : { ok: true, enabled: false, deleteConfirm: false });
    },

    // Step 1: a verified Google identity either signs in, is refused (its address belongs to another account), or must still pick a username.
    'POST /api/auth/google': async (req, res) => {
      if (!googleSignInOn) throw new AuthError('Sign in with Google is not available.', 404);
      const body = await readJsonBody(req);
      await limit([{ ...RL.googleIp, key: requestIp(req) }]);
      const claims = await verifyGoogle(req, body.credential);
      const found = await dbGoogle.lookupGoogle(claims);
      if (found.status === 'new') {
        return sendJson(res, 200, { ok: true, needsSignup: true, email: found.email, suggestedName: found.suggestedName, csrfToken: csrfFor(req, res) });
      }
      const out = await dbGoogle.signInGoogle(found.player, readCookie(req, 'ct_device'), { rememberDevice: body.rememberDevice === true, userAgent: req.headers['user-agent'] });
      finishGoogleSession(req, res, out, 'login');
    },

    // Step 2 for a new person: the same token again, plus the username and the adult confirmation. The token is verified again.
    'POST /api/auth/google/complete': async (req, res) => {
      if (!googleSignInOn) throw new AuthError('Sign in with Google is not available.', 404);
      const body = await readJsonBody(req);
      await limit([{ ...RL.googleSignupIp, key: requestIp(req) }]);
      const claims = await verifyGoogle(req, body.credential);
      const out = await dbGoogle.completeGoogleSignup({ claims, username: body.username, displayName: body.displayName, avatar: avatars.includes(body.avatar) ? body.avatar : undefined, adultConfirmed: body.adultConfirmed === true, replaceDevice: readCookie(req, 'ct_device'), rememberDevice: body.rememberDevice === true, userAgent: req.headers['user-agent'] });
      onEvent('registration');
      finishGoogleSession(req, res, out, 'login');
    },

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
      let sessionReissued = false;
      // Stage 20.9: no live session but a trusted device: start a session for it (the same account, after the same checks)
      const device = readCookie(req, 'ct_device');
      if (!info.authenticated && device) {
        const restored = await dbAuth.restoreFromDevice(device);
        if (restored) {
          sessionReissued = true;
          // only the sessions this restore retired lose their sockets (by hash); the new session's socket is left alone
          for (const r of restored.ended) onSignedOut({ playerId: r.player_id, tokenHash: r.token_hash, replaced: true });
          addCookie(res, sessionCookie(restored.token));
          addCookie(res, deviceCookie(restored.device)); // the device's lifetime is renewed with the cookie
          info = await dbAuth.sessionInfoForPlayer(restored.playerId);
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
      // An upgraded guest's cookie still carries the short guest lifetime: renew it to the account's lifetime with the same token
      if (token && !sessionReissued && info.authenticated && info.player && !info.player.is_anonymous) addCookie(res, sessionCookie(token));
      // welcomed_at is not sent to the client: the flag says whether the first-login welcome is still due (only accounts with a database have it)
      const { welcomed_at: welcomedAt, ...sharedPlayer } = info.player || {};
      const player = info.player
        ? { ...sharedPlayer, email: info.email || null, email_verified: Boolean(info.emailVerified) }
        : null;
      sendJson(res, 200, {
        ok: true,
        authenticated: Boolean(info.authenticated),
        isGuest: Boolean(info.player && info.player.is_anonymous), // a guest session (lib/guestPolicy.js): no account yet
        role: info.player && info.player.is_anonymous ? 'guest' : (info.player && info.player.role) || 'user', // decides the game access (public/game-access.js)
        player,
        emailVerified: Boolean(info.emailVerified),
        emailVerificationRequired: dbAuth.isEmailVerificationRequired(env),
        welcome: Boolean(info.player) && welcomedAt === null, // first login: show the welcome dialog once
        csrfToken,
      });
    },

    // Registration never issues a session, for a new address or for one that already has an account. Both answer with the
    // same status, keys and message, and neither sets ct_session. The player verifies the email, then logs in.
    // Guest play: a visitor gets a temporary account and a session cookie, with no email and no password. Off unless
    // GUEST_PLAY_ENABLED=true. See docs/GUEST_PLAY.md for what a guest is, how long it lasts and how it becomes an account.
    'POST /api/auth/guest': async (req, res) => {
      if (!guestPolicy.guestPlayEnabled(env)) {
        return sendJson(res, 403, { ok: false, error: 'Guest play is not available right now. Create a free account to play.', guestPlay: false });
      }
      const body = await readJsonBody(req);
      await limit([{ ...RL.guestIp, key: requestIp(req) }, { ...RL.guestAll, key: 'all' }]);
      const hours = guestPolicy.guestTtlHours(env);
      const name = await pickGuestName(body.displayName, (candidate) => dbPlayers.displayNameInUse(candidate));
      const existing = readCookie(req, TRIAL_COOKIE);
      const trialToken = existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing) ? existing : crypto.randomBytes(32).toString('base64url');
      const { player, rawToken } = await dbPlayers.createAnonymousPlayer({ displayName: name, ttlHours: hours, trialKey: hashTrialKey(trialToken) });
      addCookie(res, guestSessionCookie(rawToken, hours));
      addCookie(res, trialCookie(trialToken));
      sendJson(res, 201, {
        ok: true,
        guest: true,
        csrfToken: csrfFor(req, res),
        expiresInHours: hours,
        player: { id: player.id, name: player.display_name, avatar: player.avatar, isGuest: true },
        message: `You are playing as ${player.display_name}. Guest progress is kept in this browser for ${hours} hours and does not sync to other devices.`,
      });
    },

    // A guest becomes an account in two steps (db/auth.js requestGuestUpgrade / completeGuestUpgrade). This step stores the
    // request and e-mails a link; nothing about the guest changes until the link is used (POST /api/auth/verify-email).
    'POST /api/auth/upgrade-guest': async (req, res) => {
      const token = readSessionToken(req);
      const info = token ? await dbAuth.sessionInfo(token) : null;
      if (!info || !info.authenticated || !info.player || !info.player.is_anonymous) {
        return sendJson(res, 403, { ok: false, error: 'Only a guest can create an account this way. Log in to continue.' });
      }
      const body = await readJsonBody(req);
      await limit(byIpAndEmail(req, RL.registerIp, RL.registerEmail, body.email));
      const out = await dbAuth.requestGuestUpgrade({ playerId: info.player.id, email: body.email, username: body.username, password: body.password, adultConfirmed: body.adultConfirmed, displayName: body.displayName });
      // The same answer whether or not the address already has an account: its owner gets an e-mail either way, and the
      // response never says which case it was.
      const sent = out.alreadyRegistered
        ? await deliver('exists', { email: out.email })
        : await deliver('confirm_upgrade', { email: out.email, token: out.verifyToken });
      // A provider failure is reported the same way for both cases, and does not say which address it was for.
      if (!sent) return sendJson(res, 503, { ok: false, error: 'We could not send the email right now. Please try again in a few minutes.' });
      sendJson(res, 200, {
        ok: true,
        upgraded: false,
        pending: true,
        csrfToken: csrfFor(req, res),
        message: 'Check your email to confirm your account. Until you do, nothing changes and you keep playing as a guest.',
        // debug mode only (never in production): the same field in both cases, so the answer does not differ by address
        ...(debugTokens ? { debug: { verifyToken: out.verifyToken || null } } : {}),
      });
    },

    'POST /api/auth/register': async (req, res) => {
      const body = await readJsonBody(req);
      await limit(byIpAndEmail(req, RL.registerIp, RL.registerEmail, body.email));
      const out = await dbAuth.registerEmail({ email: body.email, username: body.username, password: body.password, displayName: body.displayName, avatar: body.avatar, adultConfirmed: body.adultConfirmed });
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
      // only the sessions this sign-in ended lose their sockets (by hash): the account's older sessions, and any session a
      // replaced device started for another account. The new session's socket is never closed here.
      for (const r of out.revokedSessions || []) onSignedOut({ playerId: r.playerId, tokenHash: r.tokenHash, replaced: true });
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
      const out = await dbAuth.revokeAllSessionsForCurrent(readSessionToken(req), readCookie(req, 'ct_device'));
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
      // a guest upgrade link is tried first; any other token is an ordinary e-mail verification
      const up = await dbAuth.completeGuestUpgrade(body.token);
      if (up && up.upgraded) {
        onGuestUpgraded({ playerId: up.playerId, username: up.username, displayName: up.displayName }); // every open socket of the account sees it now (server.js)
        onEvent('registration');
        return sendJson(res, 200, { ok: true, upgraded: true, message: `Your account ${up.username} is confirmed. Your games and history are still yours. Log in with your email and password on any device.` });
      }
      if (up) return sendJson(res, 400, { ok: false, error: up.error });
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
    verifyGoogle: google ? (req, credential, opts) => verifyGoogle(req, credential, opts) : null,
    ctx: { limit, requestIp, readSessionToken, sendJson, readJsonBody, addCookie, clearedSessionCookie },
  });
  const friendRoutes = createFriendRoutes({
    env, debugTokens,
    ctx: { limit, requestIp, readSessionToken, sendJson, readJsonBody, ...friendsContext },
  });
  const meRoutes = { ...accountRoutes, ...friendRoutes };
  // Stage 20.5: admin console, announcements and feedback. They are routed below, so they get the same CSRF check and error handling.
  const adminRoutes = extraRoutes
    ? extraRoutes({ limit, requestIp, readSessionToken, sendJson, sendText, readJsonBody, sessionInfo: dbAuth.sessionInfo, AuthError })
    : {};
  const isAdminPath = (rel) => rel.startsWith('/api/admin/') || rel === '/api/announcements' || rel === '/api/announcements/dismiss' || rel === '/api/feedback' || rel === '/api/email/unsubscribe';

  /** Returns true when the request belonged to /api/auth/, /api/me/ or /api/players/ and has been answered. */
  async function handle(req, res, rel) {
    let route = null;
    if (rel.startsWith('/api/auth/')) route = routes[`${req.method} ${rel}`];
    else if (req.method === 'GET' && rel === '/api/ratings/board') route = accountRoutes['GET /api/ratings/board'];
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
        sendJson(res, err.status, { ok: false, error: err.message, ...(err.retryable ? { retryable: true } : {}), ...(err.code ? { code: err.code } : {}), ...(err.feature ? { feature: err.feature } : {}) });
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
