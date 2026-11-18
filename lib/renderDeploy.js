'use strict';
/**
 * Owner-only redeploy of this app's Render service (admin console). Asks Render to build and deploy the latest commit of the
 * service's branch: POST https://api.render.com/v1/services/{RENDER_SERVICE_ID}/deploys with an empty JSON body.
 *
 * The key is read from the server environment (RENDER_API_KEY) and is never sent to the browser. The browser gets a short
 * message and nothing from Render's answer. Without both RENDER_API_KEY and RENDER_SERVICE_ID the feature says it is not set
 * up. A redeploy restarts the server, so connected players reconnect; a cooldown stops repeated clicks from starting several.
 */

const API = 'https://api.render.com/v1/services';
const TIMEOUT_MS = 10000;
const COOLDOWN_MS = 5 * 60 * 1000;

function createRenderDeploy({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), cooldownMs = COOLDOWN_MS } = {}) {
  const apiKey = String(env.RENDER_API_KEY || '').trim();
  const serviceId = String(env.RENDER_SERVICE_ID || '').trim();
  const configured = Boolean(apiKey && serviceId);
  let lastAt = null; // when a request last went to Render (success or not)
  let busy = false; // one request at a time

  /**
   * Asks Render for a new deploy. Returns { ok: true } on success, or { ok: false, status, error, retryAfterMs } where status is
   * 503 (not set up), 429 (cooldown or a request in progress), or 502 (Render refused or could not be reached).
   */
  async function redeploy() {
    if (!configured) return { ok: false, status: 503, error: 'Redeploy is not set up on this server (RENDER_API_KEY and RENDER_SERVICE_ID are needed).' };
    if (busy) return { ok: false, status: 429, error: 'A redeploy is already being requested. Wait a moment.' };
    if (lastAt !== null && now() - lastAt < cooldownMs) {
      const retryAfterMs = lastAt + cooldownMs - now();
      return { ok: false, status: 429, error: 'A redeploy was asked for a few minutes ago. Wait before asking again.', retryAfterMs };
    }
    busy = true;
    lastAt = now();
    try {
      const res = await fetchImpl(`${API}/${encodeURIComponent(serviceId)}/deploys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Render answers 201 (created) or 202 (queued); the body is not passed on
      await res.text().catch(() => '');
      if (res.status === 201 || res.status === 202) return { ok: true };
      return { ok: false, status: 502, error: `Render answered with HTTP ${res.status}. Check that the API key can deploy this service.` };
    } catch (err) {
      return { ok: false, status: 502, error: `Render could not be reached (${err && err.name === 'TimeoutError' ? 'timed out' : 'network error'}).` };
    } finally {
      busy = false;
    }
  }

  return { configured, redeploy };
}

module.exports = { createRenderDeploy, COOLDOWN_MS };
