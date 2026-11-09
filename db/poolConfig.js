'use strict';

// Turns DATABASE_URL into the options for `new pg.Pool(...)`. Kept free of the `pg` package so it can be unit-tested
// without a database.
//
// Why a URL rewrite at all: pg-connection-string prints a warning on every start when the URL says sslmode=require,
// prefer or verify-ca, because those names are aliases for verify-full and are scheduled to change meaning in the next
// major version of pg. For those three, the URL is rewritten to sslmode=verify-full, which is what they already mean
// today, so the connection is the same and the warning goes away.
//
// Everything else is left exactly as given, so pg decides as it always did:
//   - sslmode=disable, and any unknown value
//   - a URL with other TLS parameters (ssl, sslrootcert, sslcert, sslkey, sslca, sslcrl, ...): pg lets those override
//     an explicit option, so rewriting could change the TLS setting
//   - uselibpqcompat: it changes what require and verify-ca mean
// The only option this file sets itself is for production: a remote host whose URL has no sslmode at all is forced to
// verified TLS, so a forgotten ?sslmode= is never plaintext.

const REWRITABLE_MODES = new Set(['require', 'prefer', 'verify-ca']);
const TLS_PARAMS = /^(ssl[a-z_]*|uselibpqcompat)$/i;

function isLocalConnectionString(connectionString) {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString) || /[?&]host=\//.test(connectionString);
}

/**
 * @param {string} connectionString the DATABASE_URL value (never logged)
 * @param {object} env              process.env or a stand-in
 * @returns {{ connectionString: string, ssl?: { rejectUnauthorized: true } }}
 *          `ssl` is present only when production forces verified TLS on a URL without any sslmode.
 */
function poolConnectionOptions(connectionString, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const isLocal = isLocalConnectionString(connectionString);

  if (!/[?&]sslmode=/.test(connectionString)) {
    if (production && !isLocal) return { connectionString, ssl: { rejectUnauthorized: true } };
    return { connectionString };
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString }; // not a URL we can edit: keep it exactly as given
  }
  const mode = url.searchParams.get('sslmode');
  const otherTlsControls = [...url.searchParams.keys()].some((k) => k !== 'sslmode' && TLS_PARAMS.test(k));
  if (!REWRITABLE_MODES.has(mode) || otherTlsControls) return { connectionString };

  url.searchParams.set('sslmode', 'verify-full');
  return { connectionString: url.toString() };
}

module.exports = { poolConnectionOptions, isLocalConnectionString };
