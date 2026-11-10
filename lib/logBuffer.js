'use strict';
/**
 * The most recent structured log lines of this process, for the admin console's Logs tab.
 *
 * Lines are taken after lib/log.js has redacted them, so a secret is never stored here. The buffer is bounded (old lines
 * are dropped first) and lives only in memory: it starts empty after every restart. Render keeps the full history.
 */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const LEVELS = new Set(['info', 'warn', 'error']);

function createLogBuffer(capacity = 500) {
  const items = [];
  let dropped = 0;
  return {
    push(entry) {
      items.push(entry);
      if (items.length > capacity) { items.shift(); dropped += 1; }
    },
    /** Newest first. Filters are optional: level (exact), component (exact), event (contains). */
    list({ level = '', component = '', event = '', limit = DEFAULT_LIMIT } = {}) {
      const want = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT));
      const lv = LEVELS.has(level) ? level : '';
      const comp = String(component || '').slice(0, 60);
      const ev = String(event || '').slice(0, 60);
      const out = [];
      for (let i = items.length - 1; i >= 0 && out.length < want; i -= 1) {
        const e = items[i];
        if (lv && e.level !== lv) continue;
        if (comp && e.component !== comp) continue;
        if (ev && !String(e.event || '').includes(ev)) continue;
        out.push(e);
      }
      return { items: out, held: items.length, dropped, capacity };
    },
  };
}

module.exports = { createLogBuffer };
