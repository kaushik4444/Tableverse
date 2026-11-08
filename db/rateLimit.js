'use strict';

const db = require('./pool');

const mem = new Map();

function nowMs() { return Date.now(); }

function hitMemory(scope, key, limit, windowMs) {
  const k = `${scope}:${key}`;
  const now = nowMs();
  if (mem.size > 5000) for (const [key, v] of mem) if (now >= v.resetAt) mem.delete(key); // keep the in-memory table from growing forever
  const entry = mem.get(k);
  if (!entry || now >= entry.resetAt) {
    mem.set(k, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetMs: windowMs, count: 1, bucket: now + windowMs };
  }
  entry.count += 1;
  const allowed = entry.count <= limit;
  return { allowed, remaining: Math.max(0, limit - entry.count), resetMs: Math.max(0, entry.resetAt - now), count: entry.count, bucket: entry.resetAt };
}

async function hitDb(scope, key, limit, windowMs) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const sql = `
    WITH bucket AS (
      SELECT to_timestamp(floor(extract(epoch FROM NOW()) / $3::int) * $3::int) AS ws
    ),
    up AS (
      INSERT INTO auth_rate_limits(scope, key, window_start, count)
      SELECT $1, $2, ws, 1 FROM bucket
      ON CONFLICT (scope, key, window_start)
      DO UPDATE SET count = auth_rate_limits.count + 1
      RETURNING count, window_start
    )
    SELECT count,
           GREATEST(0, ($3::int - extract(epoch FROM (NOW() - window_start)))::int) AS reset_seconds,
           extract(epoch FROM window_start)::bigint AS bucket_seconds
    FROM up`;

  const r = await db.query(sql, [scope, key, windowSeconds]); // every parameter must be used by the SQL, or PostgreSQL cannot type it
  const row = r.rows[0] || { count: 1, reset_seconds: windowSeconds };
  const count = Number(row.count) || 1;
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetMs: (Number(row.reset_seconds) || windowSeconds) * 1000,
    count,
    bucket: row.bucket_seconds == null ? null : Number(row.bucket_seconds), // the window this hit was counted in
  };
}

/** Gives back one attempt that was reserved but did not count (a successful login, or a server fault). Never goes below zero.
 *  `bucket` is the window the hit was counted in (from hitRateLimit); a refund never touches a later window. */
function refundMemory(scope, key, bucket) {
  const entry = mem.get(`${scope}:${key}`);
  if (entry && nowMs() < entry.resetAt && entry.count > 0 && (bucket == null || entry.resetAt === bucket)) entry.count -= 1;
}

async function refundDb(scope, key, windowMs, bucket) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  if (bucket != null) {
    await db.query(
      `UPDATE auth_rate_limits SET count = count - 1
         WHERE scope = $1 AND key = $2 AND count > 0 AND window_start = to_timestamp($3)`,
      [scope, key, bucket]
    );
    return;
  }
  // no bucket was recorded: fall back to the current window (the window may have rolled over since the hit)
  await db.query(
    `UPDATE auth_rate_limits SET count = count - 1
       WHERE scope = $1 AND key = $2 AND count > 0
         AND window_start = to_timestamp(floor(extract(epoch FROM NOW()) / $3::int) * $3::int)`,
    [scope, key, windowSeconds]
  );
}

async function refundRateLimit({ scope, key, windowMs, bucket }) {
  if (!scope || !key || !Number.isFinite(windowMs)) throw new Error('rate limit refund config invalid');
  if (db.hasDatabase()) return refundDb(scope, key, windowMs, bucket);
  return refundMemory(scope, key, bucket);
}

async function hitRateLimit({ scope, key, limit, windowMs }) {
  if (!scope || !key || !Number.isFinite(limit) || !Number.isFinite(windowMs)) {
    throw new Error('rate limit config invalid');
  }
  if (db.hasDatabase()) return hitDb(scope, key, limit, windowMs);
  return hitMemory(scope, key, limit, windowMs);
}

/** Tests only: forget every in-memory counter so each test starts from zero. Has no effect when PostgreSQL is used. */
function resetMemoryCountersForTests() { mem.clear(); }

module.exports = { hitRateLimit, refundRateLimit, resetMemoryCountersForTests };
