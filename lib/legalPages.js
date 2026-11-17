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

/** True only when every detail the page needs is set. The published flag is reported as on only when this holds too. */
function detailsComplete(env) { return Object.values(TOKENS).every((key) => typeof env[key] === 'string' && env[key].trim() !== ''); }

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

// ---- Privacy notice and terms (/privacy, /terms) ----
// Two separate switches: LEGAL_PRIVACY_PUBLISHED and LEGAL_TERMS_PUBLISHED. Each is on only when its value is exactly "true"
// (fail closed). The text lives in lib/legal/*.md and is shown only when the switch is on AND the text is complete: no
// [OWNER ...] or [LEGAL ...] placeholder is left, and the controller details from the Impressum variables are set.
// The controller name, address and e-mail are NOT in Git: the markdown uses {{IMPRESSUM_*}} tokens that are filled from
// the same environment variables the Impressum uses. The legacy LEGAL_PAGES_PUBLISHED flag is ignored.

const PLACEHOLDER = /\[(OWNER|LEGAL)\b/;

function privacyPublished(env) { return env.LEGAL_PRIVACY_PUBLISHED === 'true'; }
function termsPublished(env) { return env.LEGAL_TERMS_PUBLISHED === 'true'; }

/** True when the markdown is free of owner or legal placeholders (the text is approved to show). */
function legalTextComplete(markdown) { return typeof markdown === 'string' && markdown.trim() !== '' && !PLACEHOLDER.test(markdown); }

/**
 * Replaces the {{IMPRESSUM_*}} tokens with the raw values from env. Returns null when any detail is missing.
 * The values are not escaped here: renderLegal escapes the whole text afterwards, so they cannot add markup.
 */
function fillDetails(markdown, env) {
  if (!detailsComplete(env)) return null;
  let out = markdown;
  for (const [token, key] of Object.entries(TOKENS)) out = out.split(token).join(env[key].trim());
  return out;
}

/** True when the page can be shown: its switch is on, the details are set and no placeholder remains after filling. */
function legalPageLive(markdown, env, switchOn) {
  if (!switchOn) return false;
  const filled = fillDetails(markdown || '', env);
  return filled !== null && legalTextComplete(filled);
}

/** Inline markup for one already-escaped line: **bold** and https:// links. Anything else stays as plain text. */
function inlineHtml(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, text, url) => `<a href="${url}" rel="noopener">${text}</a>`);
}

/**
 * Converts the small markdown subset the legal texts use (headings, paragraphs, bullets, bold, https links) into HTML.
 * Every character is escaped first, so the text can never add markup or script. Returns null while placeholders remain.
 */
function renderLegal(rawMarkdown, env) {
  const markdown = fillDetails(rawMarkdown || '', env || {});
  if (markdown === null || !legalTextComplete(markdown)) return null;
  const out = [];
  let para = [];
  let list = false;
  const flush = () => {
    if (para.length) { out.push(`<p>${inlineHtml(escapeHtml(para.join(' ')))}</p>`); para = []; }
    if (list) { out.push('</ul>'); list = false; }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    if (/^-{3,}$/.test(line.trim())) { flush(); continue; } // horizontal rules are not used on the page
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) { flush(); out.push(`<h${h[1].length}>${inlineHtml(escapeHtml(h[2]))}</h${h[1].length}>`); continue; }
    const li = /^\s*- (.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inlineHtml(escapeHtml(li[1]))}</li>`);
      continue;
    }
    if (list) { out.push('</ul>'); list = false; }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

const LEGAL_CSS = 'body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f;background:#fff}main{max-width:720px;margin:0 auto;padding:24px 16px 96px}h1{font-size:26px;margin:0 0 16px}h2{font-size:19px;margin:28px 0 8px}h3{font-size:16px;margin:20px 0 6px}p,li{margin:0 0 8px}a{color:#0d3b2c}';

/** The whole page around rendered text. The title is a constant from the server, never user input. No script, so no app or session is needed. */
function legalPage(title, body) {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>${escapeHtml(title)} — Tableverse</title>\n<style>${LEGAL_CSS}</style>\n</head>\n<body>\n<main>\n${body}\n<p><a href="/">Back to Tableverse</a></p>\n</main>\n</body>\n</html>\n`;
}

module.exports = { impressumPublished, detailsComplete, renderImpressum, TOKENS, privacyPublished, termsPublished, legalTextComplete, fillDetails, legalPageLive, renderLegal, legalPage };
