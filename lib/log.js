'use strict';
/**
 * Structured operational logs.
 *
 * One JSON object per line: info goes to stdout, warn and error to stderr, so Render's log view can be searched by
 * `event` (for example "db.pool_error" or "ws.error"). Every field passes through redact() before it is written, so a
 * secret that reaches a log call by accident (a DATABASE_URL inside an error message, a token in a request body) is
 * masked instead of leaked. Redaction is defence in depth: callers still should not pass secrets in the first place.
 *
 * Existing human-readable lines (for example the periodic "[stats]" line) are unchanged; this module is for events
 * that operators need to filter and correlate.
 */
const crypto = require('node:crypto');

const SENSITIVE_KEY = /pass(word|wd)?|token|secret|credential|authoriz|cookie|api[_-]?key|database[_-]?url|connection[_-]?string|verif|reset[_-]?code|session/i;
const MAX_DEPTH = 4;
const MAX_STRING = 2000;

/** Mask secrets inside a free-text string: URL credentials, key=value pairs, bearer tokens, Resend keys, e-mail addresses. */
function redactText(text) {
  return String(text)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, '[redacted-key]')
    .replace(/((?:password|passwd|pwd|token|secret|api[_-]?key|authorization|credential)["']?\s*[:=]\s*["']?)([^\s,;"'&}]+)/gi, '$1[redacted]')
    .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,})/gi, '$1***@$2')
    .slice(0, MAX_STRING);
}

/** Recursively redact a value: sensitive keys are replaced wholesale, strings are scrubbed, errors are flattened. */
function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return serializeError(value, depth);
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return redactText(String(value));
}

/** An error as plain data. The stack is kept (it shows where it failed) but is scrubbed like any other text. */
function serializeError(err, depth = 0) {
  const out = { name: err.name, message: redactText(err.message || '') };
  if (err.code !== undefined) out.code = String(err.code);
  if (err.stack) out.stack = redactText(err.stack);
  if (depth < 1 && err.cause instanceof Error) out.cause = serializeError(err.cause, depth + 1);
  return out;
}

/** Use a caller's X-Request-Id only when it is a plain token (no spaces or line breaks); otherwise make a new one. */
function requestIdFrom(headerValue) {
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof v === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(v)) return v;
  return crypto.randomUUID();
}

function defaultWrite(level, line) {
  (level === 'info' ? process.stdout : process.stderr).write(line + '\n');
}

/**
 * createLogger({ component, write?, clock? })
 *  log.info(event, fields?) / log.warn(event, fields?) / log.error(event, fields?)
 * `fields.err` (an Error) is serialised; any other field is redacted by name and by content.
 */
function createLogger({ component = 'app', write = defaultWrite, clock = () => new Date() } = {}) {
  const emit = (level, event, fields = {}) => {
    const entry = { time: clock().toISOString(), level, component, event };
    const safe = redact(fields);
    write(level, JSON.stringify({ ...entry, ...safe }));
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) => createLogger({ component: extra.component || component, write, clock }),
  };
}

module.exports = { createLogger, redact, redactText, serializeError, requestIdFrom };
