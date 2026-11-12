'use strict';
/**
 * Privacy-light, non-blocking analytics.
 *
 *  - Only counters per day, metric and dimension (for example game id) are kept, plus distinct active accounts per day as a
 *    keyed hash (the store does the hashing). No addresses, user agents, message text, names or per-event rows.
 *  - track() and active() are synchronous, never throw and never wait for the database: they add to an in-memory buffer. A
 *    timer writes the buffer in batches. If the database is slow or down, the buffer is kept (bounded) and retried; once it
 *    is full, new counts are dropped and counted in stats().dropped. Analytics can never slow down or break a game or a login.
 *  - ANALYTICS_ENABLED=0 turns everything off. See docs/ADMIN.md for retention and deletion.
 */
const { randomUUID } = require('crypto');

const METRICS = ['registration', 'login', 'session', 'session_hour', 'session_len', 'game_started', 'game_finished', 'error', 'feedback'];
const DIM_RE = /[^a-z0-9_.:-]/g;

const dayKey = (d) => d.toISOString().slice(0, 10);
const cleanDim = (s) => String(s == null ? '' : s).toLowerCase().replace(DIM_RE, '').slice(0, 48);

function createAnalytics({ store, enabled = true, flushMs = 15000, maxKeys = 2000, maxActive = 5000, writeTimeoutMs = 5000, log = console, now = () => new Date() } = {}) {
  const counters = new Map(); // "day|metric|dim" -> count
  const actives = new Map(); // day -> Set(playerId): kept in this process only until the next write, never logged
  let activeCount = 0;
  const stats = { dropped: 0, failures: 0, flushed: 0, lastFlushAt: null, lastFailureAt: null, lastErrorCode: null };
  let flushing = null;
  let timer = null;

  const on = () => enabled && Boolean(store);

  function track(metric, dim = '') {
    try {
      if (!on() || !METRICS.includes(metric)) return;
      const key = `${dayKey(now())}|${metric}|${cleanDim(dim)}`;
      if (!counters.has(key) && counters.size >= maxKeys) { stats.dropped++; return; }
      counters.set(key, (counters.get(key) || 0) + 1);
    } catch { stats.dropped++; }
  }

  /** Marks an account as active today (once per day per process; the store keeps only a keyed hash). */
  function active(playerId) {
    try {
      if (!on() || !playerId) return;
      const day = dayKey(now());
      let set = actives.get(day);
      if (!set) { set = new Set(); actives.set(day, set); }
      if (set.has(playerId)) return;
      if (activeCount >= maxActive) { stats.dropped++; return; }
      set.add(playerId);
      activeCount++;
    } catch { stats.dropped++; }
  }

  const withTimeout = (p) => {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('analytics write timed out'), { code: 'TIMEOUT' })), writeTimeoutMs); })]).finally(() => clearTimeout(t));
  };

  // A batch whose write failed (or timed out, with the outcome unknown) is sent again first, with the same id. The store
  // applies each id once, so a write that did land is not counted twice.
  let retry = null;

  /** Sends one batch. Returns false (and keeps the batch for the next attempt) when the write failed. */
  async function send(batch) {
    try {
      if (batch.rows.length) await withTimeout(store.addCounters(batch.rows, batch.id));
      if (batch.act.length) await withTimeout(store.addActive(batch.act, batch.id));
      stats.flushed++;
      stats.lastFlushAt = new Date().toISOString();
      return true;
    } catch (err) {
      stats.failures++;
      stats.lastFailureAt = new Date().toISOString();
      stats.lastErrorCode = (err && (err.code || err.name)) || 'ERROR';
      retry = batch;
      try { log.warn ? log.warn(`[analytics] write failed (${stats.lastErrorCode}); the batch will be sent again`) : log.error(`[analytics] write failed (${stats.lastErrorCode})`); } catch { /* logging must not throw */ }
      return false;
    }
  }

  /** Takes the current buffer as one batch with a new id (null when there is nothing to send). */
  function takeBuffer() {
    const rows = [...counters].map(([k, count]) => { const [day, metric, dim] = k.split('|'); return { day, metric, dim, count }; });
    const act = [];
    for (const [day, set] of actives) for (const playerId of set) act.push({ day, playerId });
    if (!rows.length && !act.length) return null;
    counters.clear(); actives.clear(); activeCount = 0;
    return { id: randomUUID(), rows, act };
  }

  async function runFlush() {
    if (retry) {
      const again = retry;
      retry = null;
      if (!(await send(again))) return; // still failing: it waits for the next flush, and the buffer keeps filling meanwhile
    }
    const fresh = takeBuffer();
    if (fresh) await send(fresh);
  }

  /** Writes the buffer now. Never rejects; overlapping calls share one write. */
  // A flush that is called while another one runs waits for it, then takes its own snapshot: counts added in the meantime are
  // written too (so close() cannot return with them still buffered).
  function flush() {
    if (!on()) return Promise.resolve();
    const prev = flushing;
    const p = (prev ? prev.then(() => runFlush()) : runFlush())
      .catch(() => {})
      .finally(() => { if (flushing === p) flushing = null; });
    flushing = p;
    return p;
  }

  /**
   * Forgets an account's pending activity, then runs `deleteStored()` (which removes what was already written). Waits for an
   * in-flight write first, and removes the account from the buffers before anything else runs, so no later write can
   * recreate its activity after the deletion.
   */
  async function forget(playerId, deleteStored) {
    if (flushing) await flushing;
    for (const set of actives.values()) if (set.delete(playerId)) activeCount--;
    if (retry) retry.act = retry.act.filter((a) => a.playerId !== playerId);
    return deleteStored();
  }

  function start() {
    if (!on() || timer) return;
    timer = setInterval(() => { void flush(); }, flushMs);
    if (timer.unref) timer.unref();
  }

  /** Stops the timer and tries one last write, giving up after `ms` so shutdown is never held up. */
  async function close(ms = 2000) {
    if (timer) { clearInterval(timer); timer = null; }
    let t;
    await Promise.race([flush(), new Promise((r) => { t = setTimeout(r, ms); })]);
    clearTimeout(t);
  }

  return { track, active, flush, start, close, forget, stats: () => ({ enabled: on(), buffered: counters.size, bufferedActive: activeCount, ...stats }) };
}

/** The bucket a visit of this many seconds belongs to, or null when it is too short to count. */
function lengthBucket(seconds) {
  if (!(seconds >= 3)) return null;
  if (seconds < 60) return 'lt1m';
  if (seconds < 300) return '1_5m';
  if (seconds < 900) return '5_15m';
  if (seconds < 3600) return '15_60m';
  return 'gt60m';
}

module.exports = { createAnalytics, METRICS, cleanDim, dayKey, lengthBucket };
