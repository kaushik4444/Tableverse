'use strict';
/**
 * TURN logins from Metered's official REST API (POST https://<app>.metered.live/api/v1/turn/credential?secretKey=...).
 *
 *  - The Secret Key stays on the server. It is sent only to Metered, never logged, never put in a welcome message or an error.
 *  - A new credential takes up to 2 minutes to start working, so credentials are created ahead of use: the next one is fetched
 *    REFRESH_LEAD_MS before the current one expires and is used only after its propagation time has passed.
 *  - A failed request is retried after RETRY_MS. Until a credential is ready, callers simply get no TURN entry (STUN still works).
 *  - Without METERED_APP_NAME, METERED_SECRET_KEY and TURN_URL, nothing here runs (see fromEnv).
 */
const PROPAGATION_MS = 2 * 60 * 1000;
const REFRESH_LEAD_MS = 10 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000; // never hand out a credential in its last minute
const RETRY_MS = 30 * 1000;
const TICK_MS = 60 * 1000;
const DEFAULT_TTL = 3600;
const TTL_MIN = 300;
const TTL_MAX = 86400;
const APP_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i; // a plain Metered app name: it becomes part of a host name

function createMeteredTurn({ appName, secretKey, ttlSeconds = DEFAULT_TTL, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 5000, log = console } = {}) {
  if (!APP_RE.test(String(appName || ''))) throw new Error('METERED_APP_NAME must be the app name only (letters, digits and dashes)');
  if (!String(secretKey || '').trim()) throw new Error('METERED_SECRET_KEY is empty');
  const ttl = Math.min(TTL_MAX, Math.max(TTL_MIN, Math.floor(Number(ttlSeconds) || DEFAULT_TTL)));
  const endpoint = `https://${appName}.metered.live/api/v1/turn/credential`;

  let current = null; // { username, password, readyAt, expiresAt }
  let next = null; // fetched, waiting for its propagation time
  let inflight = null;
  let retryAt = 0;
  let timer = null;
  const stats = { fetched: 0, failed: 0, lastFailureAt: null, lastStatus: null };

  /** One request to Metered. The URL (it carries the secret) is never logged; only the status code or error name is. */
  async function fetchOnce() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(`${endpoint}?secretKey=${encodeURIComponent(secretKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ expiryInSeconds: ttl, label: 'tableverse-voice' }),
        signal: ctl.signal,
      });
      stats.lastStatus = r.status;
      if (!r.ok) throw Object.assign(new Error(`Metered answered HTTP ${r.status}`), { status: r.status });
      const j = await r.json();
      if (!j || typeof j.username !== 'string' || typeof j.password !== 'string' || !j.username || !j.password) {
        throw new Error('Metered answer did not contain a credential');
      }
      const issuedAt = now();
      next = {
        username: j.username,
        password: j.password,
        readyAt: issuedAt + PROPAGATION_MS,
        expiresAt: issuedAt + (Math.min(TTL_MAX, Math.max(TTL_MIN, Number(j.expiryInSeconds) || ttl)) * 1000),
      };
      stats.fetched++;
      retryAt = 0;
      return true;
    } catch (err) {
      stats.failed++;
      stats.lastFailureAt = new Date(now()).toISOString();
      retryAt = now() + RETRY_MS;
      // only the kind of failure is logged: a network error can echo the request URL, and that URL carries the secret
      const kind = err && err.status ? `HTTP ${err.status}` : err && err.name === 'AbortError' ? 'timeout' : err && err.name === 'SyntaxError' ? 'bad answer' : err && err.message && err.message.startsWith('Metered answer did not') ? 'bad answer' : 'network error';
      if (log && log.warn) log.warn(`[turn] Metered credential request failed (${kind}); retrying in ${RETRY_MS / 1000}s`);
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /** Starts one request unless one is running. Never throws. */
  function refresh() {
    if (!inflight) inflight = fetchOnce().catch(() => false).finally(() => { inflight = null; });
    return inflight;
  }

  /** Moves a fetched credential into place once it has propagated. */
  function promote(t) {
    if (next && t >= next.readyAt) { current = next; next = null; }
  }

  /** Keeps the pipeline moving: asks for a new credential when the current one is near expiry (or missing). */
  function tick() {
    const t = now();
    promote(t);
    const expiring = !current || t >= current.expiresAt - REFRESH_LEAD_MS;
    if (expiring && !next && !inflight && t >= retryAt) void refresh();
  }

  /**
   * The credential to hand out right now, or null while none is ready. Never waits for the network: a missing or expiring
   * credential starts a refresh in the background and the caller goes on without TURN for now.
   */
  function snapshot() {
    tick();
    const t = now();
    if (!current || t < current.readyAt || t >= current.expiresAt - EXPIRY_MARGIN_MS) return null;
    return { username: current.username, password: current.password, expiresAt: current.expiresAt };
  }

  /** Fetches the first credential now and keeps the refresh timer running. */
  function start() {
    if (timer) return;
    void refresh();
    timer = setInterval(tick, TICK_MS);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { snapshot, start, stop, refresh, stats: () => ({ ...stats, ready: Boolean(current), pending: Boolean(next) }) };
}

/** A client for this server's environment, or null when Metered is not configured (the default). */
function fromEnv(env = process.env, opts = {}) {
  if (!env.METERED_APP_NAME || !env.METERED_SECRET_KEY || !env.TURN_URL) return null;
  return createMeteredTurn({ appName: env.METERED_APP_NAME, secretKey: env.METERED_SECRET_KEY, ttlSeconds: env.TURN_TTL_SECONDS, ...opts });
}

module.exports = { createMeteredTurn, fromEnv, PROPAGATION_MS, REFRESH_LEAD_MS, EXPIRY_MARGIN_MS };
