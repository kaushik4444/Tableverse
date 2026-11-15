'use strict';
/**
 * Sign in with Google: verification of the ID token that Google Identity Services hands to the browser.
 *
 * Free to use: it needs only a web OAuth client ID from Google Cloud (no secret, no billing). The server never trusts the
 * browser's word: it checks the token's RS256 signature against Google's published keys and then its issuer, audience,
 * expiry, nonce and verified email. No dependency: Node's crypto reads the public keys as JWKs.
 */
const crypto = require('crypto');
const https = require('https');

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const MAX_TOKEN_CHARS = 4096;
const CLOCK_SKEW_S = 60;

/** A reason that is safe to show the person; the details stay in the server log. */
class GoogleAuthError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'GoogleAuthError';
    this.detail = detail || message;
  }
}

/** Fetches Google's signing keys. Small, time-limited and size-limited so a slow or hostile answer cannot hold the server. */
function fetchGoogleJwks() {
  return new Promise((resolve, reject) => {
    const req = https.get(JWKS_URL, { timeout: 5000, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('JWKS status ' + res.statusCode)); }
      let size = 0; const parts = [];
      res.on('error', reject); // a connection that drops mid-body must fail this fetch, not crash the server
      res.on('data', (c) => { size += c.length; if (size > 65536) { req.destroy(new Error('JWKS too large')); } else parts.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('JWKS timeout')));
    req.on('error', reject);
  });
}

const b64urlJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const sameString = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The nonce that binds an ID token to one browser: a hash of that browser's CSRF cookie value. */
const nonceFor = (csrfValue) => crypto.createHash('sha256').update('google-nonce:' + String(csrfValue)).digest('hex');

function createVerifier({ clientId, fetchJwks = fetchGoogleJwks, now = () => Date.now(), keyTtlMs = 3600000, refetchMinMs = 60000, retryAfterFailureMs = 10000 } = {}) {
  let keys = new Map(); let fetchedAt = -Infinity; let attemptedAt = -Infinity; let lastFailed = false; let inflight = null;

  async function refresh() {
    if (!inflight) {
      attemptedAt = now();
      inflight = (async () => {
        try {
          const jwks = await fetchJwks();
          const next = new Map();
          for (const k of (jwks && jwks.keys) || []) if (k && k.kid && k.kty === 'RSA' && k.n && k.e) next.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
          if (!next.size) throw new Error('no usable keys');
          keys = next; fetchedAt = now(); lastFailed = false;
        } catch (e) { lastFailed = true; throw e; }
      })().finally(() => { inflight = null; });
    }
    return inflight;
  }

  // At most one fetch per attempt window, for failures as well: during a Google outage the keys are not asked for on every sign-in,
  // and one request never causes two fetches. The window is longer after a success (a rotated key is rare) than after a failure.
  const mayAttempt = () => now() - attemptedAt >= (lastFailed ? retryAfterFailureMs : refetchMinMs);

  async function keyFor(kid) {
    // a fetch already running serves this request too: wait for it instead of failing (cold cache) or rejecting a just-rotated key
    if (inflight) { try { await inflight; } catch (e) { /* judged below from what is cached */ } }
    const expired = now() - fetchedAt > keyTtlMs;
    if (expired && (attemptedAt === -Infinity || mayAttempt())) { try { await refresh(); } catch (e) { if (!keys.size) throw e; } }
    // an unknown key id means Google rotated keys: look again, within the same attempt window
    else if (!keys.has(kid) && mayAttempt()) { try { await refresh(); } catch (e) { /* keep the keys we have */ } }
    if (!keys.size && !keys.has(kid)) throw new Error('keys unavailable');
    return keys.get(kid) || null;
  }

  /** Returns { sub, email, emailVerified, name, picture } or throws GoogleAuthError. */
  async function verify(idToken, { nonce, maxAgeSeconds } = {}) {
    if (!clientId) throw new GoogleAuthError('Sign in with Google is not available.', 'no client id');
    if (typeof idToken !== 'string' || idToken.length > MAX_TOKEN_CHARS) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'bad token shape');
    const parts = idToken.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'not a JWT');
    let header; let claims;
    try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch (e) { throw new GoogleAuthError('Google sign-in failed. Please try again.', 'unreadable JWT'); }
    // only RS256 is accepted: never "none", never a symmetric algorithm
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw new GoogleAuthError('Google sign-in failed. Please try again.', 'bad alg or kid');
    let key;
    try { key = await keyFor(header.kid); } catch (e) { throw new GoogleAuthError('Google sign-in is temporarily unavailable. Please try again.', 'jwks: ' + e.message); }
    if (!key) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'unknown kid');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'bad signature');

    const t = Math.floor(now() / 1000);
    if (!claims || !ISSUERS.has(claims.iss)) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'bad issuer');
    if (claims.aud !== clientId) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'bad audience');
    if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_S < t) throw new GoogleAuthError('That Google sign-in has expired. Please try again.', 'expired');
    if (Number.isFinite(claims.iat) && claims.iat - CLOCK_SKEW_S > t) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'iat in the future');
    // a deletion asks for a token issued just now (not a reusable one from earlier in the browser's life)
    if (maxAgeSeconds && (!Number.isFinite(claims.iat) || t - claims.iat > maxAgeSeconds)) throw new GoogleAuthError('Confirm with Google again to continue.', 'token too old for this confirmation');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'bad sub');
    if (nonce === undefined || typeof claims.nonce !== 'string' || !sameString(claims.nonce, nonce)) throw new GoogleAuthError('Google sign-in failed. Please try again.', 'nonce mismatch');
    if (typeof claims.email !== 'string' || !claims.email) throw new GoogleAuthError('Your Google account has no email address to use.', 'no email');
    // only an address Google has verified may be used: otherwise anyone could claim an address they do not own
    if (claims.email_verified !== true) throw new GoogleAuthError('Your Google email address is not verified.', 'email not verified');
    return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: typeof claims.name === 'string' ? claims.name : '' };
  }

  return { verify };
}

/**
 * The page may load Google's sign-in script, button frame and styles, and only when Sign in with Google is configured
 * (GOOGLE_CLIENT_ID). Nothing else is opened up.
 */
function cspFor(env) {
  const g = String(env.GOOGLE_CLIENT_ID || '').trim() !== '';
  return "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; "
    + (g ? "script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; "
         : "style-src 'self' 'unsafe-inline'; ")
    + "img-src 'self' data:; connect-src 'self' ws: wss:" + (g ? ' https://accounts.google.com/gsi/' : '') + "; frame-ancestors 'none'";
}

module.exports = { cspFor, createVerifier, GoogleAuthError, nonceFor, JWKS_URL };
