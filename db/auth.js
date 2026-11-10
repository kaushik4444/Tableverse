'use strict';
const crypto = require('crypto');
const db = require('./pool');
const dbPlayers = require('./players');
const argon2 = require('@node-rs/argon2');

/** An error whose message is safe to show to the person using the form. Anything else is a server fault (500). */
class AuthError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const TOKEN_BYTES = 32;
const positive = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
const sessionTtlDays = () => dbPlayers.sessionTtlDays();
const verifyTtlMin = () => positive(process.env.AUTH_VERIFY_TTL_MIN, 60 * 24);
const resetTtlMin = () => positive(process.env.AUTH_RESET_TTL_MIN, 30);
const isEmailVerificationRequired = (env = process.env) => {
  const raw = String(env.REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase();
  if (!raw) return true;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return true; // secure default on invalid value
};
const PROVIDER_EMAIL = 'email';
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

// Used when an email does not exist: we still run Argon2 verify to keep timing close.
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$0GgPfIM9MqfotBF5KfEh/g$iKR5A2M4Km8CSdX6Fc09pcaBzicf93q7FCwHRzpAHKo';

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 320;
const normEmail = (s) => String(s || '').trim().toLowerCase();
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32) || 'Player';
const cleanAvatar = (s) => String(s || '').slice(0, 16) || '🧙';
const normUsername = (s) => String(s || '').trim().toLowerCase();
const isUsername = (u) => USERNAME_RE.test(u);
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
const newRawToken = () => crypto.randomBytes(TOKEN_BYTES).toString('hex');
const expiresAt = (mins) => new Date(Date.now() + mins * 60 * 1000);

function makeSessionResult(player, rawToken) {
  return {
    token: rawToken,
    player: {
      id: player.id,
      username: player.username || null,
      display_name: player.display_name,
      avatar: player.avatar,
      created_at: player.created_at,
      email: player.email || null,
      email_verified: Boolean(player.email_verified_at),
    },
  };
}

async function hashPassword(password) {
  return argon2.hash(String(password)); // default: Argon2id (OWASP baseline)
}

async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(String(hash), String(password));
  } catch {
    return false;
  }
}

async function revokeSession(rawToken) {
  if (!dbPlayers.isWellFormedToken(rawToken)) return false; // refused before any lookup
  if (!db.hasDatabase()) return dbPlayers.revokeMemoryToken(rawToken);
  const tokenHash = hashToken(rawToken);
  const res = await db.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  return res.rowCount > 0;
}

async function revokeAllSessionsForCurrent(rawToken) {
  if (!db.hasDatabase() || !dbPlayers.isWellFormedToken(rawToken)) return { revoked: 0 };
  const tokenHash = hashToken(rawToken);
  return db.withTransaction(async (client) => {
    const s = await client.query(
      `SELECT player_id
       FROM auth_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    if (!s.rows.length) return { revoked: 0 };
    const playerId = s.rows[0].player_id;
    const out = await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [playerId]);
    return { revoked: out.rowCount, playerId };
  });
}

async function readSessionFromCookie(rawToken) {
  if (!dbPlayers.isWellFormedToken(rawToken)) return null;
  if (!db.hasDatabase()) {
    const player = await dbPlayers.authenticateToken(rawToken); // memory mode: the session lives in this process
    return player ? { player_id: player.id } : null;
  }
  const tokenHash = hashToken(rawToken);
  const r = await db.query(
    `SELECT player_id
     FROM auth_sessions
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return r.rows[0] || null;
}

async function revokeAllSessionsForPlayer(playerId) {
  if (!db.hasDatabase() || !playerId) return { revoked: 0 };
  const out = await db.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [playerId]);
  return { revoked: out.rowCount };
}

/**
 * Single active session per account. The player row is locked first so two simultaneous logins queue up, every earlier
 * session is revoked, and only then is the new one inserted. The partial unique index in migration 006 is the backstop:
 * even a code path that forgets this cannot leave two active sessions.
 */
async function createSession(client, playerId) {
  const raw = newRawToken();
  const tokenHash = hashToken(raw);
  const ttlDays = sessionTtlDays();
  await client.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
  await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [playerId]);
  await client.query(
    'INSERT INTO auth_sessions (player_id, token_hash, expires_at) VALUES ($1, $2, NOW() + ($3::text || \' days\')::interval)',
    [playerId, tokenHash, String(ttlDays)]
  );
  return raw;
}

async function issueEmailToken(client, { playerId, purpose, email, ttlMinutes }) {
  const raw = newRawToken();
  const tokenHash = hashToken(raw);
  await client.query(
    `INSERT INTO auth_email_tokens (player_id, purpose, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [playerId, purpose, normEmail(email), tokenHash, expiresAt(ttlMinutes)]
  );
  return raw;
}

async function registerEmail({ email, username, password, displayName, avatar }) {
  if (!db.hasDatabase()) throw new AuthError('Email authentication requires PostgreSQL (set DATABASE_URL).', 503);
  if (!isEmail(email)) throw new AuthError('Please enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new AuthError('Password must be 8-200 characters.');

  const e = normEmail(email);
  const u = normUsername(username);
  if (!isUsername(u)) throw new AuthError('Username must be 3-24 chars: lowercase letters, numbers, underscore.');

  const pwHash = await hashPassword(password);

  try {
    return await db.withTransaction(async (client) => {
      // The username is checked first, for every address: whether it is taken must not depend on whether the email has an account.
      const existsUsername = await client.query('SELECT 1 FROM players WHERE LOWER(username) = LOWER($1) LIMIT 1', [u]);
      if (existsUsername.rows.length) throw new AuthError('This username is already taken.');

      // Not an error: the route answers exactly as it does for a new account, so the response cannot reveal that the address is taken.
      const existsEmail = await client.query('SELECT 1 FROM auth_identities WHERE provider = $1 AND provider_user_id = $2 LIMIT 1', [PROVIDER_EMAIL, e]);
      if (existsEmail.rows.length) return { alreadyRegistered: true, email: e };

      const p = await client.query(
        `INSERT INTO players (username, display_name, avatar, is_anonymous)
         VALUES ($1, $2, $3, FALSE)
         RETURNING id, username, display_name, avatar, created_at`,
        [u, cleanName(displayName), cleanAvatar(avatar)]
      );
      const player = p.rows[0];

      await client.query(
        `INSERT INTO auth_identities (player_id, provider, provider_user_id, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [player.id, PROVIDER_EMAIL, e, e, pwHash]
      );

      const verifyToken = await issueEmailToken(client, {
        playerId: player.id,
        purpose: 'verify_email',
        email: e,
        ttlMinutes: verifyTtlMin(),
      });

      // No session is created here. Registration never signs anyone in: the player verifies the email, then logs in.
      const { player: publicPlayer } = makeSessionResult(player, null);
      return { player: publicPlayer, verifyToken, email: e, username: u };
    });
  } catch (err) {
    if (err && (err.code === '23505' || /already exists/i.test(err.message || ''))) {
      if ((err.constraint || '').includes('username') || /username/i.test(err.message || '')) {
        throw new AuthError('This username is already taken.');
      }
      // a concurrent registration for the same address won the race: same generic answer
      return { alreadyRegistered: true, email: e };
    }
    if (err && err.code === '23514') throw new AuthError('Username must be 3-24 chars: lowercase letters, numbers, underscore.');
    throw err;
  }
}

async function checkUsernameAvailability({ username }) {
  if (!db.hasDatabase()) return { available: false, reason: 'requires_postgres' };
  const u = normUsername(username);
  if (!isUsername(u)) return { available: false, reason: 'invalid' };
  const r = await db.query('SELECT 1 FROM players WHERE LOWER(username) = LOWER($1) LIMIT 1', [u]);
  return { available: r.rows.length === 0, username: u };
}

async function loginEmail({ email, password }) {
  if (!db.hasDatabase()) throw new AuthError('Email authentication requires PostgreSQL (set DATABASE_URL).', 503);
  if (!isEmail(email) || typeof password !== 'string') throw new AuthError('Invalid email or password.', 401);

  // Argon2 takes tens of milliseconds: do it without holding a database connection or transaction open.
  let r;
  try {
    r = await db.query(
      `SELECT p.id, p.username, p.display_name, p.avatar, p.created_at, p.suspended_at,
              i.password_hash, i.email, i.email_verified_at
       FROM auth_identities i
       JOIN players p ON p.id = i.player_id
       WHERE i.provider = $1 AND i.provider_user_id = $2
       LIMIT 1`,
      [PROVIDER_EMAIL, normEmail(email)]
    );
  } catch (err) {
    if (db.isTransientConnectionError(err)) {
      throw new AuthError('Sign-in is temporarily unavailable. Please try again.', 503, { retryable: true });
    }
    throw err;
  }
  if (!r.rows.length) {
    await verifyPassword(DUMMY_HASH, password); // keep the timing close to a real check
    throw new AuthError('Invalid email or password.', 401);
  }
  const row = r.rows[0];
  if (!(await verifyPassword(row.password_hash, password))) throw new AuthError('Invalid email or password.', 401);
  if (row.suspended_at) throw new AuthError('This account is suspended.', 403);

  // Re-check under the account lock, the same lock a password reset takes. A reset that committed while this login was
  // checking the old password has changed the stored hash by now, so no session is issued for a password that no longer works.
  const token = await db.withTransaction(async (client) => {
    const locked = await client.query('SELECT suspended_at FROM players WHERE id = $1 FOR UPDATE', [row.id]);
    // a suspension that committed during the password check has already revoked the older sessions: issue none
    if (locked.rows[0] && locked.rows[0].suspended_at) throw new AuthError('This account is suspended.', 403);
    const now = await client.query(
      'SELECT password_hash FROM auth_identities WHERE player_id = $1 AND provider = $2 AND provider_user_id = $3',
      [row.id, PROVIDER_EMAIL, normEmail(email)]
    );
    if (!now.rows.length || now.rows[0].password_hash !== row.password_hash) throw new AuthError('Invalid email or password.', 401);
    return createSession(client, row.id);
  });
  return makeSessionResult(row, token);
}

async function resendVerification({ email }) {
  if (!db.hasDatabase()) throw new AuthError('Email authentication requires PostgreSQL (set DATABASE_URL).', 503);
  const e = normEmail(email);
  if (!isEmail(e)) return { ok: true }; // do not leak which emails exist

  return db.withTransaction(async (client) => {
    const r = await client.query(
      `SELECT i.player_id, i.email_verified_at
       FROM auth_identities i
       WHERE i.provider = $1 AND i.provider_user_id = $2
       LIMIT 1`,
      [PROVIDER_EMAIL, e]
    );
    if (!r.rows.length || r.rows[0].email_verified_at) return { ok: true };

    const verifyToken = await issueEmailToken(client, {
      playerId: r.rows[0].player_id,
      purpose: 'verify_email',
      email: e,
      ttlMinutes: verifyTtlMin(),
    });
    return { ok: true, verifyToken, email: e };
  });
}

async function verifyEmailToken(rawToken) {
  if (!db.hasDatabase()) throw new AuthError('Email authentication requires PostgreSQL (set DATABASE_URL).', 503);
  if (!rawToken || typeof rawToken !== 'string') throw new AuthError('Invalid verification token.');
  const tokenHash = hashToken(rawToken);

  return db.withTransaction(async (client) => {
    // Take the account's row lock before any token or identity changes. db/unverifiedCleanup.js takes the same lock (with
    // SKIP LOCKED) before it deletes an unverified account, so verification and cleanup of one account cannot interleave:
    // an account being verified is skipped by cleanup, and a verification that waits behind cleanup finds the account gone.
    const owner = await client.query(`SELECT player_id FROM auth_email_tokens WHERE token_hash = $1 AND purpose = 'verify_email' LIMIT 1`, [tokenHash]);
    if (!owner.rows.length) throw new AuthError('Invalid verification token.');
    const locked = await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [owner.rows[0].player_id]);
    if (!locked.rows.length) throw new AuthError('Invalid verification token.'); // the account was removed while this link waited

    const use = await client.query(
      `UPDATE auth_email_tokens
         SET used_at = NOW()
       WHERE token_hash = $1
         AND purpose = 'verify_email'
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING player_id, email`,
      [tokenHash]
    );
    if (!use.rows.length) {
      const reason = await client.query(
        `SELECT used_at, expires_at
         FROM auth_email_tokens
         WHERE token_hash = $1 AND purpose = 'verify_email'
         LIMIT 1`,
        [tokenHash]
      );
      if (!reason.rows.length) throw new AuthError('Invalid verification token.');
      if (reason.rows[0].used_at) throw new AuthError('This verification link has already been used.');
      throw new AuthError('This verification link has expired.');
    }

    // The token names the account it was issued for. Mark that account's identity; if no row matches, throw so the
    // transaction rolls back and the link is NOT spent on nothing.
    const t = use.rows[0];
    const marked = await client.query(
      `UPDATE auth_identities
       SET email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE player_id = $1 AND provider = $2 AND provider_user_id = $3`,
      [t.player_id, PROVIDER_EMAIL, normEmail(t.email)]
    );
    if (marked.rowCount !== 1) throw new AuthError('Invalid verification token.');
    return { ok: true };
  });
}

async function requestPasswordReset({ email }) {
  if (!db.hasDatabase()) throw new AuthError('Email authentication requires PostgreSQL (set DATABASE_URL).', 503);
  const e = normEmail(email);
  if (!isEmail(e)) return { ok: true };

  return db.withTransaction(async (client) => {
    const r = await client.query(
      `SELECT i.player_id, i.email_verified_at
       FROM auth_identities i
       WHERE i.provider = $1 AND i.provider_user_id = $2
       LIMIT 1`,
      [PROVIDER_EMAIL, e]
    );
    if (!r.rows.length || !r.rows[0].email_verified_at) return { ok: true }; // only verified accounts reset

    const resetToken = await issueEmailToken(client, {
      playerId: r.rows[0].player_id,
      purpose: 'password_reset',
      email: e,
      ttlMinutes: resetTtlMin(),
    });
    return { ok: true, resetToken, email: e };
  });
}

async function resetPassword({ token, newPassword }) {
  if (!db.hasDatabase()) throw new AuthError('Email authentication requires PostgreSQL (set DATABASE_URL).', 503);
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200) throw new AuthError('Password must be 8-200 characters.');
  if (!token || typeof token !== 'string') throw new AuthError('Invalid reset token.');

  const tokenHash = hashToken(token);
  const pwHash = await hashPassword(newPassword);

  const reasonFor = async (client) => {
    const reason = await client.query(
      `SELECT used_at, expires_at
       FROM auth_email_tokens
       WHERE token_hash = $1 AND purpose = 'password_reset'
       LIMIT 1`,
      [tokenHash]
    );
    if (!reason.rows.length) throw new AuthError('Invalid reset token.');
    if (reason.rows[0].used_at) throw new AuthError('This reset link has already been used.');
    throw new AuthError('This reset link has expired.');
  };

  return db.withTransaction(async (client) => {
    // Lock order matches loginEmail: the account row first, then the token. Find the account without locking the token.
    const peek = await client.query(
      `SELECT player_id FROM auth_email_tokens
       WHERE token_hash = $1 AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    if (!peek.rows.length) await reasonFor(client);
    await client.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [peek.rows[0].player_id]);
    const use = await client.query(
      `UPDATE auth_email_tokens
         SET used_at = NOW()
       WHERE token_hash = $1
         AND purpose = 'password_reset'
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING player_id, email`,
      [tokenHash]
    );
    if (!use.rows.length) await reasonFor(client); // spent or expired while the account lock was waiting

    const t = use.rows[0];
    const identity = await client.query(
      `UPDATE auth_identities
       SET password_hash = $1
       WHERE player_id = $2 AND provider = $3 AND provider_user_id = $4`,
      [pwHash, t.player_id, PROVIDER_EMAIL, t.email]
    );
    // Exactly one identity must change. Otherwise the throw rolls back the token use too, so no link is spent for nothing
    // and the sessions below are not revoked for a password that never changed.
    if (identity.rowCount !== 1) throw new AuthError('This reset link can no longer be used. Request a new one.', 400);
    await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [t.player_id]);
    return { ok: true, playerId: t.player_id };
  });
}

async function sessionInfo(rawToken) {
  const player = await dbPlayers.authenticateToken(rawToken);
  if (!player || !db.hasDatabase()) {
    return {
      authenticated: Boolean(player),
      emailVerified: false,
      provider: null,
      email: null,
      player,
    };
  }
  const r = await db.query(
    `SELECT email, email_verified_at, provider
     FROM auth_identities
     WHERE player_id = $1
     ORDER BY created_at ASC
     LIMIT 1`,
    [player.id]
  );
  const i = r.rows[0] || null;
  return {
    authenticated: true,
    emailVerified: Boolean(i && i.email_verified_at),
    provider: i ? i.provider : null,
    email: i ? i.email : null,
    player,
  };
}

/** Delete rows nobody can use any more. Safe to run at any time and from several instances. */
/** Stage 20.9: device trust. Pure helpers first, then the functions the routes use. */
const DEVICE_DAYS = 30;
const DEVICE_MAX_AGE_SECONDS = DEVICE_DAYS * 24 * 60 * 60;

/** A short label for the device, from the browser and system only (never the full user agent, never an address). */
function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const system = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return `${browser} on ${system}`.slice(0, 80);
}

/** Called after a password has been checked. Returns the device token once; only its hash is stored. Memory mode: none. */
async function rememberDevice({ playerId, userAgent = '' }) {
  if (!db.hasDatabase() || !playerId) return null;
  const raw = newRawToken();
  await db.query(
    `INSERT INTO auth_devices (player_id, token_hash, label, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::text || ' days')::interval)`,
    [playerId, hashToken(raw), deviceLabel(userAgent), String(DEVICE_DAYS)]
  );
  return raw;
}

/**
 * Starts a new session from a valid device token, for a registered account that is not suspended. The usual one-session rule
 * applies (the older session of the account is retired), and the device's expiry slides forward.
 */
async function restoreFromDevice(rawDevice) {
  if (!db.hasDatabase() || !dbPlayers.isWellFormedToken(rawDevice)) return null;
  const tokenHash = hashToken(rawDevice);
  return db.withTransaction(async (client) => {
    const r = await client.query(
      `SELECT d.id, d.player_id
         FROM auth_devices d
         JOIN players p ON p.id = d.player_id
        WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND d.expires_at > NOW()
          AND p.suspended_at IS NULL AND p.is_anonymous = FALSE`,
      [tokenHash]
    );
    if (!r.rows.length) return null;
    const { id, player_id: playerId } = r.rows[0];
    const token = await createSession(client, playerId); // locks the account and retires its older sessions
    await client.query(
      `UPDATE auth_devices SET last_used_at = NOW(), expires_at = NOW() + ($2::text || ' days')::interval WHERE id = $1`,
      [id, String(DEVICE_DAYS)]
    );
    return { token, playerId };
  });
}

/** Ends one device's trust (used by sign-out on that device). */
async function forgetDevice(rawDevice) {
  if (!db.hasDatabase() || !dbPlayers.isWellFormedToken(rawDevice)) return false;
  const r = await db.query('UPDATE auth_devices SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(rawDevice)]);
  return r.rowCount > 0;
}

/** Ends every device of an account: sign-out everywhere, a password reset, an owner sign-out, a suspension. */
async function revokeDevicesForPlayer(playerId) {
  if (!db.hasDatabase() || !playerId) return { revoked: 0 };
  const r = await db.query('UPDATE auth_devices SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [playerId]);
  return { revoked: r.rowCount };
}

async function purgeExpired() {
  if (!db.hasDatabase()) return { rateLimits: 0, tokens: 0, sessions: 0 };
  // trusted devices that ended or expired more than 30 days ago are removed
  await db.query("DELETE FROM auth_devices WHERE expires_at < NOW() - INTERVAL '30 days' OR revoked_at < NOW() - INTERVAL '30 days'");
  const run = async (sql) => (await db.query(sql)).rowCount;
  return {
    rateLimits: await run("DELETE FROM auth_rate_limits WHERE window_start < NOW() - INTERVAL '1 day'"),
    tokens: await run("DELETE FROM auth_email_tokens WHERE expires_at < NOW() - INTERVAL '7 days' OR used_at < NOW() - INTERVAL '7 days'"),
    // migration 011 revoked the legacy rows that had no expiry; revoked rows are removed here after 30 days like the rest
    sessions: await run("DELETE FROM auth_sessions WHERE (expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '7 days') OR revoked_at < NOW() - INTERVAL '30 days'"),
  };
}

module.exports = {
  verifyPassword,
  AuthError,
  normEmail,
  sessionTtlDays,
  purgeExpired,
  isEmailVerificationRequired,
  registerEmail,
  checkUsernameAvailability,
  loginEmail,
  resendVerification,
  verifyEmailToken,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  revokeAllSessionsForCurrent,
  revokeAllSessionsForPlayer,
  readSessionFromCookie,
  sessionInfo,
  deviceLabel, rememberDevice, restoreFromDevice, forgetDevice, revokeDevicesForPlayer, DEVICE_MAX_AGE_SECONDS,
};
