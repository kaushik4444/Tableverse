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
function createReadinessCheck({ hasDatabase, ping, shuttingDown = () => false, queueStats = () => null, log = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let reachable = null; // unknown until the first database probe

  const tail = () => {
    const q = queueStats();
    return q && (q.pending || q.failed) ? ` (matches: ${q.pending} pending, ${q.failed} failed)` : '';
  };

  return async function readiness() {
    if (shuttingDown()) return { status: 503, body: 'shutting down' };
    if (!hasDatabase()) return { status: 200, body: 'ready (in-memory store)' + tail() };

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
}

module.exports = { createReadinessCheck, withTimeout, DEFAULT_TIMEOUT_MS };
