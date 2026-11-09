'use strict';
const pool = require('./pool');
const { migrate } = require('./migrate');

// A Neon compute that has scaled to zero needs a few seconds to wake, and the pool's connect timeout (5 s) is shorter than
// that on a bad day. In production the first connectivity check is therefore retried, but only for connection-level errors
// and only inside a hard time limit; anything else (wrong password, unknown database, bad host name) fails at once.
const PRODUCTION_WAIT_MS = 45 * 1000; // default total wait before giving up, production only
const MAX_WAIT_MS = 2 * 60 * 1000; // DB_STARTUP_WAIT_MS cannot raise it above this
const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

/** How long the first connectivity check may keep retrying. 0 means a single attempt (development and tests by default). */
function startupWaitMs(env) {
  const raw = env.DB_STARTUP_WAIT_MS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, MAX_WAIT_MS);
  }
  return env.NODE_ENV === 'production' ? PRODUCTION_WAIT_MS : 0;
}

/**
 * True for "could not get a connection yet" and false for everything that retrying cannot fix. The pg driver reports its own
 * connect timeouts without an error code, so those are recognised by message as well as by code.
 */
function isTransientStartupError(db, err) {
  // A PostgreSQL/driver error code is authoritative. Never let a coincidental phrase in an auth or
  // database-name error turn it into a retryable connection failure.
  if (err && err.code) {
    return Boolean(db && typeof db.isTransientConnectionError === 'function' && db.isTransientConnectionError(err));
  }
  // pg's connect-timeout error has no code, so its known messages are the narrow fallback.
  return /connection timeout|timeout exceeded when trying to connect|connection terminated/i.test(String((err && err.message) || ''));
}

/** Race an in-flight ping against the remaining startup budget. The losing query is not cancelled, but
 * the startup path itself cannot wait beyond its deadline; pg's configured query timeout bounds normal
 * server-side query stalls, while the pool's connection timeout bounds connection acquisition. */
async function pingBeforeDeadline(db, remainingMs) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => db.ping()),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`database ping exceeded the startup retry window (${remainingMs} ms)`);
          err.code = 'ETIMEDOUT';
          reject(err);
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pings the database, retrying transient connection errors with a doubling delay (1, 2, 4, 8, 8 ... s) until `waitMs` is used up. */
async function pingWithRetry({ db, waitMs, log, sleep, now }) {
  const started = now();
  for (let attempt = 1; ; attempt++) {
    try {
      const elapsed = now() - started;
      if (waitMs > 0) {
        const remaining = waitMs - elapsed;
        if (remaining <= 0) {
          const err = new Error('database startup retry window expired before ping');
          err.code = 'ETIMEDOUT';
          err.startupAttempts = attempt;
          throw err;
        }
        await pingBeforeDeadline(db, remaining);
      } else {
        await db.ping();
      }
      if (attempt > 1) log.log(`[db] Reachable after ${attempt} attempts (${now() - started} ms).`);
      return;
    } catch (err) {
      const delay = Math.min(FIRST_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      if (!isTransientStartupError(db, err) || now() - started + delay > waitMs) {
        err.startupAttempts = attempt;
        throw err;
      }
      // the message of a connection error never contains the connection string; only it and the attempt number are logged
      log.warn(`[db] Not reachable yet (${err.message}); attempt ${attempt}, trying again in ${delay} ms.`);
      await sleep(delay);
    }
  }
}

/**
 * Decide, before the server accepts anybody, whether the database setup is acceptable.
 *
 *  - production without DATABASE_URL            -> throw (never silently fall back to memory with real users)
 *  - DATABASE_URL set but the pg driver missing -> throw in production, warn elsewhere
 *  - DATABASE_URL set                           -> the database must answer and every migration must apply, otherwise throw
 *                                                  (the first answer is awaited for a bounded time, see pingWithRetry)
 *  - development / tests without DATABASE_URL   -> in-memory store
 *
 * `deps` exists so tests can pass fakes.
 */
async function prepareDatabase(deps = {}) {
  const env = deps.env || process.env;
  const db = deps.db || pool;
  const runMigrations = deps.migrate || migrate;
  const log = deps.log || console;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now || Date.now;
  const production = env.NODE_ENV === 'production';

  if (!env.DATABASE_URL) {
    if (production) throw new Error('DATABASE_URL is required when NODE_ENV=production (refusing to run on the in-memory store)');
    log.log('[db] No DATABASE_URL set: using the in-memory store (data is lost on restart).');
    return { mode: 'memory' };
  }
  if (db.driverMissing()) {
    const msg = 'DATABASE_URL is set but the "pg" package is not installed';
    if (production) throw new Error(msg);
    log.warn('[db] ' + msg + ': using the in-memory store.');
    return { mode: 'memory' };
  }
  try {
    await pingWithRetry({ db, waitMs: startupWaitMs(env), log, sleep, now });
  } catch (err) {
    const tries = err.startupAttempts > 1 ? ` (after ${err.startupAttempts} attempts)` : '';
    throw new Error('Cannot reach the database: ' + err.message + tries);
  }
  try {
    const res = await runMigrations();
    log.log(`[db] Connected. ${res && res.applied && res.applied.length ? 'Applied ' + res.applied.join(', ') : 'Schema is up to date.'}`);
  } catch (err) {
    throw new Error('Database migration failed: ' + err.message);
  }
  return { mode: 'postgres' };
}

module.exports = { prepareDatabase, startupWaitMs, isTransientStartupError };
