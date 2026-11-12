'use strict';
/**
 * Publication switch and details for the Impressum (public/impressum.html).
 *
 * Off unless LEGAL_IMPRESSUM_PUBLISHED is exactly "true" (fail closed). While off, the page answers 404, the server
 * tells the client it is not published, and the client shows no link to it. Turning it on is a deliberate owner action
 * after the legal review; it is not part of any deploy.
 *
 * The owner's personal details are NOT in Git. The template holds {{IMPRESSUM_*}} tokens, and the server fills them
 * from environment variables (IMPRESSUM_NAME, IMPRESSUM_ADDRESS, IMPRESSUM_EMAIL). If any value is missing, the page
 * is not rendered at all, so a partly filled legal notice can never be served.
 */
const TOKENS = { '{{IMPRESSUM_NAME}}': 'IMPRESSUM_NAME', '{{IMPRESSUM_ADDRESS}}': 'IMPRESSUM_ADDRESS', '{{IMPRESSUM_EMAIL}}': 'IMPRESSUM_EMAIL' };

function impressumPublished(env) { return env.LEGAL_IMPRESSUM_PUBLISHED === 'true'; }

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Fills the template from env. Returns null (fail closed) when a value is missing or a token is left over. */
function renderImpressum(template, env) {
  let out = template;
  for (const [token, key] of Object.entries(TOKENS)) {
    const v = env[key];
    if (typeof v !== 'string' || !v.trim()) return null;
    out = out.split(token).join(escapeHtml(v.trim()));
  }
  return /\{\{IMPRESSUM_/.test(out) ? null : out;
}

module.exports = { impressumPublished, renderImpressum, TOKENS };
