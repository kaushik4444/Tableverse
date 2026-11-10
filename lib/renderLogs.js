'use strict';
/**
 * Render's own log history for the owner's Logs tab (Stage 20.8). The server asks Render (the browser never does), so the API key
 * stays on the server and is only ever sent in the Authorization header. Answers are masked with the same rules as the in-app
 * logs, kept for a short time, and limited to the last 24 hours. Configuration: RENDER_API_KEY, RENDER_SERVICE_ID (srv-...),
 * RENDER_OWNER_ID (tea-... or usr-...). Without all three the feature answers "not configured" and calls nothing.
 */
const { redactText } = require('./log');

const ENDPOINT = 'https://api.render.com/v1/logs';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 100;
const CACHE_MS = 30 * 1000;
const TIMEOUT_MS = 8000;

function guessLevel(message) {
  if (/\b(error|fatal|exception|failed)\b/i.test(message)) return 'error';
  if (/\bwarn(ing)?\b/i.test(message)) return 'warn';
  return 'info';
}

function createRenderLogs({ env = process.env, fetchImpl = global.fetch, now = () => Date.now(), cacheMs = CACHE_MS } = {}) {
  const apiKey = String(env.RENDER_API_KEY || '').trim();
  const serviceId = String(env.RENDER_SERVICE_ID || '').trim();
  const ownerId = String(env.RENDER_OWNER_ID || '').trim();
  const configured = Boolean(apiKey && serviceId && ownerId);
  const cache = new Map();

  /** Recent lines of the service, newest first. `text` filters on the server side (plain words, at most 100 characters). */
  async function recent({ text = '', limit = MAX_LINES } = {}) {
    if (!configured) return { configured: false, items: [] };
    const lim = Math.min(MAX_LINES, Math.max(1, Math.floor(Number(limit)) || MAX_LINES));
    const filter = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 100);
    const key = `${filter}|${lim}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.out;

    const q = new URLSearchParams({
      ownerId, resource: serviceId, direction: 'backward', limit: String(lim),
      startTime: new Date(now() - WINDOW_MS).toISOString(), endTime: new Date(now()).toISOString(),
    });
    if (filter) q.set('text', filter);
    let res;
    try {
      res = await fetchImpl(`${ENDPOINT}?${q.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { configured: true, error: 'Render did not answer. Try again in a moment.', items: [] };
    }
    if (!res.ok) {
      // the status is useful; the body can echo request details, so it is not passed on
      return { configured: true, error: `Render answered HTTP ${res.status}. Check the API key, the service id and the owner id.`, items: [] };
    }
    // a body that times out or is not JSON is an error, and it is not cached: the next request asks again
    let body;
    try { body = await res.json(); } catch {
      return { configured: true, error: 'Render sent an answer that could not be read. Try again in a moment.', items: [] };
    }
    const raw = Array.isArray(body && body.logs) ? body.logs : [];
    const items = raw.slice(0, lim).map((l) => {
      const labels = Object.fromEntries((Array.isArray(l.labels) ? l.labels : []).map((x) => [x.name, x.value]));
      const message = String(l.message || '');
      return {
        time: l.timestamp || null,
        level: labels.level && ['info', 'warn', 'error'].includes(String(labels.level).toLowerCase()) ? String(labels.level).toLowerCase() : guessLevel(message),
        source: String(labels.type || labels.instance || 'render').slice(0, 40),
        text: redactText(message).slice(0, 500),
      };
    });
    const out = { configured: true, items, hasMore: Boolean(body.hasMore) };
    // drop answers that have expired, so filters that are never asked again do not stay in memory
    for (const [k, v] of cache) if (now() - v.at >= cacheMs) cache.delete(k);
    cache.set(key, { at: now(), out });
    return out;
  }

  return { configured, recent };
}

module.exports = { createRenderLogs, guessLevel };
