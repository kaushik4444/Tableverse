'use strict';
/**
 * Local development helpers (used by scripts/dev.js and scripts/dev-seed.js, never by the server itself).
 *
 * The rules these enforce:
 *  - Nothing here runs when NODE_ENV=production.
 *  - Local tools only talk to a database on this machine (localhost / 127.0.0.1 / ::1). A managed host (Neon, Render, Supabase,
 *    AWS ...) is refused outright; any other remote host needs an explicit ALLOW_REMOTE_DEV_DB=1.
 *  - Local passwords are generated, never written in the repository.
 */
const crypto = require('node:crypto');
const policy = require('../public/password-policy');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MANAGED = /(neon\.tech|supabase\.co|supabase\.com|render\.com|amazonaws\.com|azure\.com|googleusercontent\.com|herokuapp\.com|elephantsql\.com|aivencloud\.com)$/i;

class DevEnvError extends Error {}

/** Parses the text of a .env file: KEY=value lines, # comments, optional quotes. No interpolation, no export keyword games. */
function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q));
    else v = v.replace(/\s+#.*$/, ''); // a trailing comment on an unquoted value
    out[m[1]] = v;
  }
  return out;
}

/** Throws unless local tools may run with this environment. Returns the parsed database URL (or null when there is none). */
function assertSafeDevEnv(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') throw new DevEnvError('Refusing to run: NODE_ENV=production. The local development tools never run in production.');
  const url = env.DATABASE_URL;
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { throw new DevEnvError('DATABASE_URL is not a valid URL.'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new DevEnvError('DATABASE_URL must be a postgres:// URL.');
  // pg takes host and hostaddr from the query string and lets them override the URL host, so a URL could name a local host
  // here and connect elsewhere. Refused outright: the host checked below is the host that is used.
  if (u.searchParams.has('host') || u.searchParams.has('hostaddr')) throw new DevEnvError('DATABASE_URL must not set host or hostaddr in its query string: put the host in the URL itself.');
  if (MANAGED.test(u.hostname)) throw new DevEnvError(`Refusing to use ${u.hostname}: it is a managed (possibly production) database. Local development uses a database on this machine.`);
  if (!LOOPBACK.has(u.hostname) && env.ALLOW_REMOTE_DEV_DB !== '1') throw new DevEnvError(`Refusing to use the non-local database host ${u.hostname}. Use a database on this machine (see docs/LOCAL_DEVELOPMENT.md).`);
  return u;
}

/** A random password that satisfies the password rule (upper, lower, number, symbol; 20 characters). */
function generatePassword() {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; const L = 'abcdefghijkmnopqrstuvwxyz'; const N = '23456789'; const S = '!?#%*-_+=';
  for (;;) {
    const chars = [pick(U), pick(L), pick(N), pick(S)];
    const all = U + L + N + S;
    while (chars.length < 20) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    const pw = chars.join('');
    if (!policy.check(pw)) return pw; // practically always the first try
  }
}

/** Defaults for local play: e-mail verification is optional (no mail provider is needed). Explicit values always win. */
function devDefaults(env = process.env) {
  return { REQUIRE_EMAIL_VERIFICATION: env.REQUIRE_EMAIL_VERIFICATION || 'false' };
}

module.exports = { parseEnvFile, assertSafeDevEnv, generatePassword, devDefaults, DevEnvError, LOOPBACK, MANAGED };
