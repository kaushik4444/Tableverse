'use strict';
/**
 * TURN logins from Metered's official REST API (POST https://<app>.metered.live/api/v1/turn/credential?secretKey=...).
 *
 *  - The Secret Key stays on the server. It is sent only to Metered, never logged, never put in a welcome message or an error.
 *  - Lifetime and rotation follow Metered's guidance: a 48-hour credential, replaced every 24 hours. The replacement is fetched
 *    at that point and is used only after its propagation time has passed. Old credentials are left to expire (Metered's
 *    expiry is a hard cutoff; nothing is deleted early). Short lifetimes (TURN_TTL_SECONDS, at least 15 minutes) rotate half-way through, and
 *    10 minutes before expiry, whichever comes first.
 *  - A new credential takes up to 2 minutes to start working, so credentials are created ahead of use.
 *  - Retries are bounded: failures back off exponentially from RETRY_BASE_MS up to RETRY_MAX_MS, and a refusal that looks like
 *    quota or access trouble (HTTP 402, 403, 429) waits QUOTA_RETRY_MS. Nothing retries in a tight loop.
 *  - status() says what voice can rely on: 'ready' (a usable login), 'pending' (first login or propagation in progress),
 *    'unavailable' (no usable login and the last request failed) or 'quota' (the last refusal looked like quota or access).
 *    Callers use it to tell players, never to block voice.
 *  - Without METERED_APP_NAME, METERED_SECRET_KEY and TURN_URL, nothing here runs (see fromEnv).
 */
const PROPAGATION_MS = 2 * 60 * 1000;
const REFRESH_LEAD_MS = 10 * 60 * 1000;
const ROTATE_AFTER_MS = 24 * 60 * 60 * 1000; // replace a 48-hour credential every 24 hours (Metered's recommendation)
const EXPIRY_MARGIN_MS = 60 * 1000; // never hand out a credential in its last minute
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 15 * 60 * 1000;
const QUOTA_RETRY_MS = 60 * 60 * 1000;
const QUOTA_STATUSES = [402, 403, 429];
const TICK_MS = 60 * 1000;
const TTL_MIN = 15 * 60;
const TTL_MAX = 48 * 60 * 60; // Metered's recommended lifetime; a longer one is not asked for
const DEFAULT_TTL = TTL_MAX;
const APP_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i; // a plain Metered app name: it becomes part of a host name

function createMeteredTurn({
  appName, secretKey, ttlSeconds = DEFAULT_TTL, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 5000,
  log = console, onReady = () => {}, onChange = () => {}, setTimer = setTimeout,
} = {}) {
  if (!APP_RE.test(String(appName || ''))) throw new Error('METERED_APP_NAME must be the app name only (letters, digits and dashes)');
  if (!String(secretKey || '').trim()) throw new Error('METERED_SECRET_KEY is empty');
  const ttl = Math.min(TTL_MAX, Math.max(TTL_MIN, Math.floor(Number(ttlSeconds) || DEFAULT_TTL)));
  const endpoint = `https://${appName}.metered.live/api/v1/turn/credential`;

  let current = null; // { username, password, readyAt, rotateAt, expiresAt }
  let next = null; // fetched, waiting for its propagation time
  let inflight = null;
  let retryAt = 0;
  let timer = null;
  let failures = 0; // consecutive failed requests
  let quotaHit = false; // the last failure was a refusal that looks like quota or access trouble
  const stats = { fetched: 0, failed: 0, lastFailureAt: null, lastStatus: null, lastFailureKind: null };

  /** When to ask for the replacement: 24 h after issue, but never later than 10 min before expiry, and never before half the lifetime. */
  const rotationPoint = (issuedAt, expiresAt) => Math.max(
    issuedAt + (expiresAt - issuedAt) / 2,
    Math.min(issuedAt + ROTATE_AFTER_MS, expiresAt - REFRESH_LEAD_MS),
  );

  const usable = (t) => Boolean(current && t >= current.readyAt && t < current.expiresAt - EXPIRY_MARGIN_MS);
  function statusAt(t) {
    if (usable(t)) return 'ready';
    if (failures > 0) return quotaHit ? 'quota' : 'unavailable';
    if (current) return 'unavailable'; // the old login has run out and the new one is not usable yet
    return 'pending';
  }
  let lastStatus = statusAt(now());
  /** Reports a status change once (the server pushes fresh settings to players when it changes). */
  function noteStatus() {
    const s = statusAt(now());
    if (s !== lastStatus) { lastStatus = s; try { onChange(s); } catch { /* a listener must not break TURN */ } }
    return s;
  }

  /** One request to Metered. The URL (it carries the secret) is never logged; only the kind of failure is. */
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
        throw Object.assign(new Error('Metered answer did not contain a credential'), { badAnswer: true });
      }
      const issuedAt = now();
      const expiresAt = issuedAt + (Math.min(TTL_MAX, Math.max(TTL_MIN, Number(j.expiryInSeconds) || ttl)) * 1000);
      next = {
        username: j.username,
        password: j.password,
        readyAt: issuedAt + PROPAGATION_MS,
        rotateAt: rotationPoint(issuedAt, expiresAt),
        expiresAt,
      };
      stats.fetched++;
      failures = 0;
      quotaHit = false;
      retryAt = 0;
      // tell the server as soon as the new credential is usable, so connected players get it without waiting for a poll
      // whichever comes first (this timer or a poll) promotes the credential and tells the server exactly once
      setTimer(() => { promote(now()); noteStatus(); }, PROPAGATION_MS + 50).unref?.();
      noteStatus();
      return true;
    } catch (err) {
      stats.failed++;
      failures++;
      quotaHit = false; // classify this failure on its own: an earlier refusal must not colour a later outage
      stats.lastFailureAt = new Date(now()).toISOString();
      let delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 10));
      let kind = 'network error';
      if (err && err.status) {
        kind = `HTTP ${err.status}`;
        if (QUOTA_STATUSES.includes(err.status)) { delay = QUOTA_RETRY_MS; quotaHit = true; kind = `HTTP ${err.status} (quota or access; waiting an hour)`; }
      } else if (err && err.name === 'AbortError') kind = 'timeout';
      else if (err && err.badAnswer) kind = 'bad answer';
      stats.lastFailureKind = kind;
      retryAt = now() + delay;
      // only the kind of failure is logged: a network error can echo the request URL, and that URL carries the secret
      if (log && log.warn) log.warn(`[turn] Metered credential request failed (${kind}); next try in ${Math.round(delay / 1000)}s`);
      noteStatus();
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /** Starts one request unless one is running or the back-off has not passed (force skips the back-off only). Never throws. */
  function refresh({ force = false } = {}) {
    if (inflight) return inflight;
    if (!force && now() < retryAt) return Promise.resolve(false);
    inflight = fetchOnce().catch(() => false).finally(() => { inflight = null; });
    return inflight;
  }

  /** Moves a fetched credential into place once it has propagated, and tells the server. Returns true when one was moved. */
  function promote(t) {
    if (next && t >= next.readyAt) {
      current = next; next = null;
      try { onReady(); } catch { /* a listener must not break TURN */ }
      return true;
    }
    return false;
  }

  /** Keeps the pipeline moving: asks for a new credential when the current one is near expiry (or missing), no sooner than the back-off allows. */
  function tick() {
    const t = now();
    promote(t);
    const expiring = !current || t >= current.rotateAt;
    if (expiring && !next && !inflight) void refresh();
    noteStatus();
  }

  /**
   * The credential to hand out right now, or null while none is usable (propagating, expired, or Metered unavailable).
   * Never waits for the network: a missing or expiring credential starts a refresh in the background.
   */
  function snapshot() {
    tick();
    const t = now();
    if (!usable(t)) return null;
    return { username: current.username, password: current.password, expiresAt: current.expiresAt };
  }

  /** 'ready' | 'pending' | 'unavailable'. */
  function status() {
    tick();
    return statusAt(now());
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

  return {
    snapshot, status, start, stop, refresh,
    stats: () => ({ ...stats, consecutiveFailures: failures, status: statusAt(now()), ready: Boolean(current), pending: Boolean(next) }),
  };
}

/** A client for this server's environment, or null when Metered is not configured (the default). */
function fromEnv(env = process.env, opts = {}) {
  if (!env.METERED_APP_NAME || !env.METERED_SECRET_KEY || !env.TURN_URL) return null;
  return createMeteredTurn({ appName: env.METERED_APP_NAME, secretKey: env.METERED_SECRET_KEY, ttlSeconds: env.TURN_TTL_SECONDS, ...opts });
}

module.exports = { createMeteredTurn, fromEnv, PROPAGATION_MS, REFRESH_LEAD_MS, ROTATE_AFTER_MS, EXPIRY_MARGIN_MS, RETRY_BASE_MS, RETRY_MAX_MS, QUOTA_RETRY_MS, DEFAULT_TTL, TTL_MAX };
