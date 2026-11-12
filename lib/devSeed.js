'use strict';
/**
 * Creates (or refreshes) a local test account directly in the local database: verified, adult-confirmed, with a generated
 * password. For local development only: the caller (scripts/dev-seed.js) checks the environment first, and this function checks
 * again so it cannot be used by mistake from anywhere else.
 */
const { assertSafeDevEnv, generatePassword, DevEnvError } = require('./devEnv');
const policy = require('../public/password-policy');

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} o   email, username, displayName?, owner?, resetPassword?, password?
 * @param {object} deps { db (pool module), hashPassword, env }
 * @returns {{ created, email, username, password|null, role }}  password is null when the account already existed and was kept as it is
 */
async function seedAccount(o, { db, hashPassword, env = process.env }) {
  assertSafeDevEnv(env);
  if (!env.DATABASE_URL) throw new DevEnvError('DATABASE_URL is not set. Point it at a local PostgreSQL (see docs/LOCAL_DEVELOPMENT.md).');
  const email = String(o.email || '').trim().toLowerCase();
  const username = String(o.username || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new DevEnvError('Give a valid --email (it never leaves this machine; for example me@local.test).');
  if (!USERNAME_RE.test(username)) throw new DevEnvError('--username must be 3-24 characters: lowercase letters, numbers, underscore.');
  let password = o.password ? String(o.password) : null;
  if (password) { const weak = policy.check(password, { email, username }); if (weak) throw new DevEnvError(weak); }

  return db.withTransaction(async (c) => {
    const existing = await c.query("SELECT i.player_id FROM auth_identities i WHERE i.provider = 'email' AND i.provider_user_id = $1", [email]);
    let playerId; let created = false; let shown = null;
    if (existing.rows.length) {
      playerId = existing.rows[0].player_id;
      if (o.resetPassword || password) {
        shown = password || generatePassword();
        await c.query("UPDATE auth_identities SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE player_id = $1 AND provider = 'email'", [playerId, await hashPassword(shown)]);
      }
    } else {
      if ((await c.query('SELECT 1 FROM players WHERE LOWER(username) = $1', [username])).rows.length) throw new DevEnvError(`The username "${username}" is already used by another account.`);
      created = true;
      shown = password || generatePassword();
      const p = await c.query(`INSERT INTO players (username, display_name, avatar, is_anonymous, adult_confirmed_at) VALUES ($1, $2, $3, FALSE, NOW()) RETURNING id`, [username, String(o.displayName || username).slice(0, 32), '🧙']);
      playerId = p.rows[0].id;
      await c.query("INSERT INTO auth_identities (player_id, provider, provider_user_id, email, password_hash, email_verified_at) VALUES ($1, 'email', $2, $2, $3, NOW())", [playerId, email, await hashPassword(shown)]);
    }
    let role = (await c.query('SELECT role FROM players WHERE id = $1', [playerId])).rows[0].role;
    if (o.owner && role !== 'owner') {
      // the same rule as the admin console: exactly one owner, and only when there is none yet
      const upd = await c.query("UPDATE players SET role = 'owner' WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM players WHERE role = 'owner')", [playerId]);
      if (!upd.rowCount) throw new DevEnvError('This local database already has an owner. Use that account, or reset the local database (see docs/LOCAL_DEVELOPMENT.md).');
      role = 'owner';
    }
    return { created, email, username, password: shown, role };
  });
}

module.exports = { seedAccount };
