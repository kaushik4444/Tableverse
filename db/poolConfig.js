'use strict';

// Turns DATABASE_URL into the options for `new pg.Pool(...)`. Kept free of the `pg` package so it can be unit-tested
// without a database.
//
// Why sslmode is taken out of the URL: pg-connection-string warns on every start when the URL says sslmode=require (or
// prefer / verify-ca), because those names are treated as aliases for verify-full and are scheduled to change meaning in
// the next major version of pg. The TLS behaviour is therefore written here explicitly, with the same effect as today:
//   require / prefer / verify-ca / verify-full -> TLS, certificate and host name checked (rejectUnauthorized: true)
//   disable                                    -> no TLS
//   no sslmode, production, remote host        -> TLS, as before (a URL that forgot ?sslmode= is never plaintext)
//   no sslmode elsewhere, or a local host      -> the pg library default (no TLS)
// An sslmode value this file does not know is left in the URL untouched, so the pg library decides as it always did.

const VERIFIED_TLS_MODES = new Set(['require', 'prefer', 'verify-ca', 'verify-full']);

function isLocalConnectionString(connectionString) {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString) || /[?&]host=\//.test(connectionString);
}

/**
 * @param {string} connectionString the DATABASE_URL value (never logged)
 * @param {object} env              process.env or a stand-in
 * @returns {{ connectionString: string, ssl?: false | { rejectUnauthorized: true } }}
 *          `ssl` is present only when this function decided it; otherwise the caller passes nothing.
 */
function poolConnectionOptions(connectionString, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const isLocal = isLocalConnectionString(connectionString);
  const result = { connectionString };

  if (/[?&]sslmode=/.test(connectionString)) {
    let url;
    try {
      url = new URL(connectionString);
    } catch {
      return result; // not a URL we can edit: keep the string exactly as given
    }
    const mode = url.searchParams.get('sslmode');
    if (mode === 'disable') {
      url.searchParams.delete('sslmode');
      return { connectionString: url.toString(), ssl: false };
    }
    if (VERIFIED_TLS_MODES.has(mode)) {
      url.searchParams.delete('sslmode');
      return { connectionString: url.toString(), ssl: { rejectUnauthorized: true } };
    }
    return result; // an unknown mode: leave it to the pg library
  }

  if (production && !isLocal) return { connectionString, ssl: { rejectUnauthorized: true } };
  return result;
}

module.exports = { poolConnectionOptions, isLocalConnectionString };
