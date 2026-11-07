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

// Object field names whose value is always masked, whatever it holds. CSRF and short password names are included because
// they are secrets too (pw, pwd, csrf, X-CSRF, ct_csrf were logged in clear before).
const SENSITIVE_KEY = /password|passwd|passphrase|passcode|\bpass\b|pwd|\bpw\b|token|secret|credential|authoriz|cookie|api[_-]?key|database[_-]?url|connection[_-]?string|verif|reset[_-]?code|session|csrf|xsrf/i;
const MAX_DEPTH = 4;
const MAX_STRING = 2000;

/**
 * A secret written as `key: value`, `key=value`, JSON, or inside an escaped JSON string (`\"password\":\"...\"`).
 * A quoted value is consumed up to its closing quote, so whitespace, commas, ampersands and escaped quotes inside a
 * password are all masked. An unterminated quote masks to the end of the text (over-masking is the safe failure).
 * An unquoted value runs to whitespace, a closing brace or a quote, so `&` and `,` are masked too.
 */
// The key may carry a prefix or suffix (client_secret, password_hash, access_token, ct_session_id). Over-matching a word
// that merely contains one of these is the safe failure.
const SECRET_KEY_VALUE = new RegExp(
  '([a-z0-9_-]*(?:password|passwd|pwd|token|secret|api[_-]?key|authorization|credential|cookie|session|csrf|reset[_-]?code)[a-z0-9_-]*\\\\?["\']?(?:\\s*[:=]\\s*|%3A|%3D))' +
  '(?:\\\\?"(?:\\\\.|[^"\\\\])*\\\\?"?' +   // "double quoted", with \" escapes (also escaped-JSON form)
  "|'(?:\\\\.|[^'\\\\])*'?" +              // 'single quoted'
  '|[^\\s}"\']+)',                         // unquoted
  'gi',
);

function maskSecretValue(match, key) {
  const rest = match.slice(key.length);
  const quote = rest.startsWith('\\"') ? '\\"' : /^["']/.test(rest) ? rest[0] : '';
  return key + quote + '[redacted]' + quote;
}

/** Mask secrets inside a free-text string: URL credentials, key=value pairs, bearer tokens, Resend keys, e-mail addresses. */
function redactText(text) {
  return String(text)
    // credentials in a URL: everything before the last @ in the token (a password may contain an unencoded @)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s]*@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    // an authorization value may carry a scheme word (Basic, Token, Digest, ...); the credential after it is masked too.
    // Runs before the generic key rule.
    .replace(/(authorization["']?\s*[:=]\s*)(?:[A-Za-z][A-Za-z0-9_-]*\s+)?[^\s,;"'\\}]+/gi, '$1[redacted]')
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, '[redacted-key]')
    // password hashes and raw tokens carry no key name in free text: Argon2 strings and 48+ hex digits (session and e-mail tokens)
    .replace(/\$argon2[a-z]*\$[^\s"'`]+/gi, '[redacted-hash]')
    .replace(/\b[a-f0-9]{48,}\b/gi, '[redacted-token]')
    .replace(SECRET_KEY_VALUE, maskSecretValue)
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
  if (value instanceof String) return redactText(value.valueOf());
  // binary data (a Buffer or typed array) is never logged: as an object it would show every byte as a number
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k)) out[k] = '[redacted]';
      // A request ID is a plain token the server validated (requestIdFrom) and echoes in responses, so it must stay
      // searchable as written, even when it is 64 hex digits long.
      else if (k === 'requestId' && typeof v === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(v)) out[k] = v;
      else out[k] = redact(v, depth + 1);
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

// Through the console so that tools which redirect or capture console output see structured lines too.
function defaultWrite(level, line) {
  if (level === 'info') console.log(line);
  else console.error(line);
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
