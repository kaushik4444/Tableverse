'use strict';
/**
 * Readiness for load balancers and uptime monitors.
 *
 * Liveness (/healthz) answers 200 as long as the process runs. It does not touch the database, so a Neon outage
 * never makes Render restart the web service.
 *
 * Readiness (/readyz) answers 200 only when the database answers a `SELECT 1` within `timeoutMs`. Otherwise it answers
 * 503 with a fixed message, so no hostname, user or error text from the driver reaches a public response.
 * The check uses one pooled connection for a moment and nothing else; it is safe to poll every 30 seconds.
 */

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_MS = 2000; // polls closer together than this reuse the last answer (no extra database round trip)

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * createReadinessCheck({ hasDatabase, ping, shuttingDown, queueStats, log, timeoutMs })
 * returns an async function giving { status, body }.
 *
 * The log is written only when the state changes (ready -> unreachable and back), so a Neon outage produces one
 * warning and one recovery line, not one line per probe.
 */
function createReadinessCheck({ hasDatabase, ping, shuttingDown = () => false, queueStats = () => null, log = null, timeoutMs = DEFAULT_TIMEOUT_MS, cacheMs = DEFAULT_CACHE_MS }) {
  let reachable = null; // unknown until the first database probe
  let inflight = null; // the probe currently running, shared by every caller that arrives while it runs
  let last = null; // { at, result }: the latest finished probe, reused for `cacheMs`

  const tail = () => {
    const q = queueStats();
    return q && (q.pending || q.failed) ? ` (matches: ${q.pending} pending, ${q.failed} failed)` : '';
  };

  // One database round trip at a time. The public /readyz endpoint needs no login, so without this every request during
  // an outage would queue another connection request on the pool, and those would outlive the 3 s answer.
  const probe = async () => {
    try {
      await withTimeout(Promise.resolve().then(ping), timeoutMs);
      if (reachable === false && log) log.info('health.db_recovered');
      reachable = true;
      return { status: 200, body: 'ready' + tail() };
    } catch (err) {
      if (reachable !== false && log) {
        log.warn('health.db_unreachable', { code: err && err.code, timeoutMs, err: err && err.code === 'TIMEOUT' ? undefined : err });
      }
      reachable = false;
      return { status: 503, body: 'database unavailable' };
    }
  };

  return async function readiness() {
    if (shuttingDown()) return { status: 503, body: 'shutting down' };
    if (!hasDatabase()) return { status: 200, body: 'ready (in-memory store)' + tail() };
    if (last && Date.now() - last.at < cacheMs) return last.result;
    if (!inflight) {
      inflight = probe().then((result) => { last = { at: Date.now(), result }; return result; }).finally(() => { inflight = null; });
    }
    return inflight;
  };
}

module.exports = { createReadinessCheck, withTimeout, DEFAULT_TIMEOUT_MS };
