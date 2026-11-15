'use strict';
/**
 * Accounts that sign in with Google. The ID token has already been verified (lib/googleAuth.js); these functions decide what it means.
 *
 *  - A known Google identity signs in.
 *  - A Google address that already belongs to another Tableverse account is refused. Linking it silently would let anyone who
 *    controls that mailbox at Google take over the account, so the person signs in the way they registered.
 *  - A new person chooses a username and confirms they are an adult (the same rules as registering by email), then the account
 *    is created. Google has verified the address, so no verification email is sent.
 * Google-only accounts have no password; every password flow already looks only at the 'email' identity, so they are unaffected.
 */
const db = require('./pool');
const dbAuth = require('./auth');
const dbPlayers = require('./players');

const { AuthError } = dbAuth;
const PROVIDER_GOOGLE = 'google';

const taken = () => new AuthError('That email already has a Tableverse account. Sign in with your email and password instead.', 409, { code: 'email_taken' });


/** Who owns the device this browser presented (null if none or not well formed). Looked up before any lock is taken. */
async function deviceOwner(replaceDevice) {
  if (!dbPlayers.isWellFormedToken(replaceDevice)) return null;
  return ((await db.query('SELECT player_id FROM auth_devices WHERE token_hash = $1', [dbAuth.hashToken(replaceDevice)])).rows[0] || {}).player_id || null;
}

/**
 * Retires the trusted device this browser presented, and the sessions started from it, whichever account they belong to: a Google
 * sign-in replaces the trust the browser had before, exactly as a password login does. Without it, signing in as B on a browser that
 * remembered A would bring A back when B's session ended. Runs inside the sign-in transaction.
 */
async function retireDevice(client, replaceDevice, ended) {
  if (!dbPlayers.isWellFormedToken(replaceDevice)) return;
  const old = await client.query('UPDATE auth_devices SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id', [dbAuth.hashToken(replaceDevice)]);
  for (const d of old.rows) {
    const r = await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE device_id = $1 AND revoked_at IS NULL RETURNING player_id, token_hash', [d.id]);
    ended.push(...r.rows);
  }
}

/** What the verified claims mean: an account that signs in, a refusal, or a new person who still has to choose a username. */
async function lookupGoogle(claims) {
  if (!db.hasDatabase()) throw new AuthError('Sign in with Google requires PostgreSQL (set DATABASE_URL).', 503);
  const r = await db.query(
    `SELECT p.id, p.username, p.display_name, p.avatar, p.created_at, p.suspended_at, i.email, i.email_verified_at
       FROM auth_identities i JOIN players p ON p.id = i.player_id
      WHERE i.provider = $1 AND i.provider_user_id = $2 LIMIT 1`,
    [PROVIDER_GOOGLE, claims.sub]
  );
  if (r.rows.length) return { status: 'existing', player: r.rows[0] };
  const e = await db.query('SELECT 1 FROM auth_identities WHERE LOWER(email) = LOWER($1) LIMIT 1', [claims.email]);
  if (e.rows.length) throw taken();
  return { status: 'new', email: claims.email, suggestedName: dbAuth.cleanName(claims.name) };
}

/** Signs an existing Google account in: one transaction, the suspension re-checked under the account lock, the older session ended. */
async function signInGoogle(player, replaceDevice = null) {
  if (player.suspended_at) throw new AuthError('This account is suspended.', 403);
  const ended = [];
  const owner = await deviceOwner(replaceDevice);
  const raw = await db.withTransaction(async (client) => {
    // both accounts are locked in sorted-id order, the same as a password login, so two sign-ins that replace each other's devices cannot deadlock
    let suspendedAt;
    for (const id of [...new Set([player.id, owner].filter(Boolean))].sort()) {
      const r = (await client.query('SELECT suspended_at FROM players WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (id === player.id) suspendedAt = r ? r.suspended_at : undefined;
    }
    if (suspendedAt === undefined) throw new AuthError('Sign in with Google failed. Please try again.', 401);
    if (suspendedAt) throw new AuthError('This account is suspended.', 403);
    await retireDevice(client, replaceDevice, ended);
    return dbAuth.createSession(client, player.id, null, ended);
  });
  const result = dbAuth.makeSessionResult({ ...player, email_verified_at: player.email_verified_at || new Date() }, raw);
  result.revokedSessions = ended.map((x) => ({ playerId: x.player_id, tokenHash: x.token_hash }));
  return result;
}

/** Creates the account for a new Google person and signs them in. */
async function completeGoogleSignup({ claims, username, displayName, avatar, adultConfirmed, replaceDevice = null }) {
  if (!db.hasDatabase()) throw new AuthError('Sign in with Google requires PostgreSQL (set DATABASE_URL).', 503);
  if (adultConfirmed !== true) throw new AuthError('You must confirm that you are 18 or older to create an account.', 400);
  const u = dbAuth.normUsername(username);
  if (!dbAuth.isUsername(u)) throw new AuthError('Username must be 3-24 chars: lowercase letters, numbers, underscore.');
  const ended = [];
  const owner = await deviceOwner(replaceDevice);
  try {
    const out = await db.withTransaction(async (client) => {
      if ((await client.query('SELECT 1 FROM players WHERE LOWER(username) = LOWER($1) LIMIT 1', [u])).rows.length) throw new AuthError('This username is already taken.');
      if ((await client.query('SELECT 1 FROM auth_identities WHERE LOWER(email) = LOWER($1) LIMIT 1', [claims.email])).rows.length) throw taken();
      const p = await client.query(
        `INSERT INTO players (username, display_name, avatar, is_anonymous, adult_confirmed_at)
         VALUES ($1, $2, $3, FALSE, NOW()) RETURNING id, username, display_name, avatar, created_at`,
        [u, dbAuth.cleanName(displayName || claims.name), dbAuth.cleanAvatar(avatar)]
      );
      const player = p.rows[0];
      await client.query(
        `INSERT INTO auth_identities (player_id, provider, provider_user_id, email, email_verified_at) VALUES ($1, $2, $3, $4, NOW())`,
        [player.id, PROVIDER_GOOGLE, claims.sub, claims.email]
      );
      if (owner) await client.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [owner]);
      await retireDevice(client, replaceDevice, ended);
      const raw = await dbAuth.createSession(client, player.id, null, ended);
      return { player, raw };
    });
    const result = dbAuth.makeSessionResult({ ...out.player, email: claims.email, email_verified_at: new Date() }, out.raw);
    result.revokedSessions = ended.map((x) => ({ playerId: x.player_id, tokenHash: x.token_hash }));
    return result;
  } catch (err) {
    if (err && err.code === '23505') {
      if (/username/i.test(err.constraint || err.message || '')) throw new AuthError('This username is already taken.');
      throw taken(); // the same address or Google account was taken by a concurrent sign-up
    }
    if (err && err.code === '23514') throw new AuthError('Username must be 3-24 chars: lowercase letters, numbers, underscore.');
    throw err;
  }
}

module.exports = { lookupGoogle, signInGoogle, completeGoogleSignup, PROVIDER_GOOGLE };
