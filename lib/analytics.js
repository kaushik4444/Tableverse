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
const METRICS = ['registration', 'login', 'session', 'game_started', 'game_finished', 'error', 'feedback'];
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

  async function runFlush() {
    const rows = [...counters].map(([k, count]) => { const [day, metric, dim] = k.split('|'); return { day, metric, dim, count }; });
    const act = [];
    for (const [day, set] of actives) for (const playerId of set) act.push({ day, playerId });
    if (!rows.length && !act.length) return;
    counters.clear(); actives.clear(); activeCount = 0;
    try {
      if (rows.length) await withTimeout(store.addCounters(rows));
      // counters are saved; if the active write fails only the actives go back, so nothing is counted twice
      rows.length = 0;
      if (act.length) await withTimeout(store.addActive(act));
      stats.flushed++;
      stats.lastFlushAt = new Date().toISOString();
    } catch (err) {
      stats.failures++;
      stats.lastFailureAt = new Date().toISOString();
      stats.lastErrorCode = (err && (err.code || err.name)) || 'ERROR';
      // put the unsaved work back (bounded), then try again at the next tick
      for (const r of rows) {
        const key = `${r.day}|${r.metric}|${r.dim}`;
        if (!counters.has(key) && counters.size >= maxKeys) { stats.dropped += r.count; continue; }
        counters.set(key, (counters.get(key) || 0) + r.count);
      }
      for (const a of act) {
        let set = actives.get(a.day);
        if (!set) { set = new Set(); actives.set(a.day, set); }
        if (!set.has(a.playerId)) { if (activeCount >= maxActive) { stats.dropped++; continue; } set.add(a.playerId); activeCount++; }
      }
      try { log.warn ? log.warn(`[analytics] write failed (${stats.lastErrorCode}); keeping ${counters.size} counters for retry`) : log.error(`[analytics] write failed (${stats.lastErrorCode})`); } catch { /* logging must not throw */ }
    }
  }

  /** Writes the buffer now. Never rejects; overlapping calls share one write. */
  function flush() {
    if (!on()) return Promise.resolve();
    if (!flushing) flushing = runFlush().catch(() => {}).finally(() => { flushing = null; });
    return flushing;
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

  return { track, active, flush, start, close, stats: () => ({ enabled: on(), buffered: counters.size, bufferedActive: activeCount, ...stats }) };
}

module.exports = { createAnalytics, METRICS, cleanDim, dayKey };
