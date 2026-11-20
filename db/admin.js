'use strict';
/**
 * PostgreSQL store for the admin console (Stage 20.5): roles, analytics counters, feedback, announcements and the audit log.
 * Rules live in lib/adminPolicy.js and lib/announcements.js; this module stores them. Every state-changing method re-reads the
 * acting account's role INSIDE its transaction (a request's earlier role check is never trusted) and writes its audit row in
 * that same transaction, so a change and its record succeed or fail together.
 */
const crypto = require('crypto');
const db = require('./pool');
const policy = require('../lib/adminPolicy');
const announcements = require('../lib/announcements');

const { validHistoryCursor } = require('../lib/historyCursor');

const PAGE = 25;
const RETENTION = { activeDays: 35, dailyDays: 400, auditDays: 365, feedbackDays: 180, announcementDays: 90 };
let ownerKnown = false; // once an owner exists nothing else needs checking (an owner is only ever removed by deleting the account)

const like = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const page = (p) => Math.max(0, (Math.floor(Number(p)) || 1) - 1);

async function audit(client, { actorId, action, targetType = null, targetId = null, detail = {} }) {
  await client.query(
    'INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actorId || null, String(action).slice(0, 48), targetType, targetId == null ? null : String(targetId).slice(0, 64), JSON.stringify(detail || {})]
  );
}

/**
 * Locks the acting account and checks that it is still staff, inside the same transaction as the change. A request whose
 * body arrived after the account was demoted is refused here, not by the route's earlier check.
 */
async function lockStaff(client, actorId) {
  const r = await client.query('SELECT role FROM players WHERE id = $1 FOR UPDATE', [actorId]);
  if (!r.rows[0] || (r.rows[0].role !== 'admin' && r.rows[0].role !== 'owner')) throw new policy.PolicyError('Admin access is required.', 403);
}

/** Locks the given accounts (always in id order, so two admins cannot deadlock) and returns them by id. */
async function lockAccounts(client, ids) {
  const r = await client.query('SELECT id, username, role, is_anonymous, suspended_at FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[...new Set(ids)]]);
  return new Map(r.rows.map((row) => [row.id, row]));
}

// ---------------------------------------------------------------- roles and owner bootstrap
async function getRole(playerId) {
  const r = await db.query('SELECT role FROM players WHERE id = $1', [playerId]);
  return r.rows[0] ? r.rows[0].role : null;
}

/**
 * Makes `playerId` the owner if, and only if, no owner exists and the server-side configuration names this account.
 * Safe to call often and from several instances: the unique index and the advisory lock allow exactly one winner.
 */
async function claimOwnerIfConfigured(playerId, env = process.env) {
  if (ownerKnown) return false;
  if (!String(env.ADMIN_OWNER_ID || '').trim() && !String(env.ADMIN_OWNER_EMAIL || '').trim()) return false;
  const outcome = await db.withTransaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727275)');
    const has = (await c.query("SELECT 1 FROM players WHERE role = 'owner' LIMIT 1")).rows.length > 0;
    if (has) return 'known';
    const idRow = await c.query(
      'SELECT email FROM auth_identities WHERE player_id = $1 AND email IS NOT NULL AND email_verified_at IS NOT NULL ORDER BY created_at ASC LIMIT 1',
      [playerId]
    );
    const verifiedEmail = idRow.rows[0] ? idRow.rows[0].email : null;
    if (!policy.shouldClaimOwner({ env, hasOwner: false, playerId, verifiedEmail })) return 'no';
    const upd = await c.query("UPDATE players SET role = 'owner' WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM players WHERE role = 'owner')", [playerId]);
    if (upd.rowCount !== 1) return 'no';
    await audit(c, { actorId: playerId, action: 'owner.claimed', targetType: 'player', targetId: playerId, detail: { via: String(env.ADMIN_OWNER_ID || '').trim() ? 'id' : 'email' } });
    return 'claimed';
  });
  // Remembered only after the transaction committed: a rolled-back claim is tried again on the next call.
  if (outcome === 'known' || outcome === 'claimed') ownerKnown = true;
  return outcome === 'claimed';
}

/**
 * At start-up: finds the configured owner account and claims ownership for it. The verified e-mail (ADMIN_OWNER_EMAIL) is tried
 * first; if no verified account has that address, the stable account id (ADMIN_OWNER_ID) is used.
 */
async function bootstrapOwner(env = process.env) {
  const id = String(env.ADMIN_OWNER_ID || '').trim().toLowerCase();
  const email = String(env.ADMIN_OWNER_EMAIL || '').trim().toLowerCase();
  if (!id && !email) return { claimed: false };
  if (await hasOwner()) return { claimed: false };
  const candidates = [];
  if (email) {
    const r = await db.query('SELECT player_id FROM auth_identities WHERE LOWER(email) = $1 AND email_verified_at IS NOT NULL LIMIT 1', [email]);
    if (r.rows[0]) candidates.push(r.rows[0].player_id);
  }
  if (id && /^[0-9a-f-]{36}$/.test(id)) {
    const r = await db.query('SELECT id FROM players WHERE id = $1', [id]);
    if (r.rows[0]) candidates.push(r.rows[0].id);
  }
  if (!candidates.length) return { claimed: false, reason: 'the configured owner has no verified account yet' };
  for (const playerId of candidates) {
    if (await claimOwnerIfConfigured(playerId, env)) return { claimed: true };
  }
  return { claimed: false };
}

async function hasOwner() {
  return (await db.query("SELECT 1 FROM players WHERE role = 'owner' LIMIT 1")).rows.length > 0;
}

async function setRole({ actorId, targetId, role }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    const { noop } = policy.checkSetRole({ actor: rows.get(actorId), target: rows.get(targetId), newRole: role });
    if (noop) return { changed: false, role };
    // a suspended account stays a plain user until the suspension is lifted: a promotion now would leave it unable to sign in
    if (rows.get(targetId).suspended_at) throw new policy.PolicyError('Lift the suspension before changing this account\'s role.', 409);
    // the WHERE clause repeats the rule in SQL: an owner row can never match, whatever the code above did
    const upd = await c.query("UPDATE players SET role = $2 WHERE id = $1 AND role <> 'owner' AND role <> $2", [targetId, role]);
    if (upd.rowCount !== 1) throw new policy.PolicyError('The role was not changed.', 409);
    await audit(c, { actorId, action: role === 'admin' ? 'role.grant_admin' : 'role.revoke_admin', targetType: 'player', targetId, detail: { from: rows.get(targetId).role, to: role } });
    return { changed: true, role };
  });
}

// Column sorts for the users list. Fixed expressions only: no request text reaches the SQL. `verified` is the output alias.
const USER_SORTS = {
  joined: { by: 'p.created_at', dir: 'DESC' },
  seen: { by: 'COALESCE(p.last_seen_at, p.created_at)', dir: 'DESC' },
  name: { by: 'LOWER(p.display_name)', dir: 'ASC' },
  role: { by: 'p.role', dir: 'ASC' },
  verified: { by: 'verified', dir: 'DESC' },
};
async function listUsers({ q = '', page: p = 1, staleDays = 0, sort = '', dir = '' } = {}) {
  const key = Object.hasOwn(USER_SORTS, sort) ? sort : '';
  const direction = dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : (key ? USER_SORTS[key].dir : '');
  const term = String(q || '').trim().slice(0, 40);
  const days = Math.min(3650, Math.max(0, Math.floor(Number(staleDays)) || 0));
  const conds = [];
  const args = [];
  if (term) { args.push(like(term)); conds.push(`(username ILIKE $${args.length} ESCAPE '\\' OR display_name ILIKE $${args.length} ESCAPE '\\')`); }
  // "Stale": a registered ordinary account nobody has used for N days (last seen, else the day it was created); the quietest first
  if (days) { args.push(days); conds.push(`(is_anonymous = FALSE AND role = 'user' AND COALESCE(last_seen_at, created_at) < NOW() - ($${args.length}::int * INTERVAL '1 day'))`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM players ${where}`, args)).rows[0].n;
  // a filter or a role change can leave the requested page past the end: answer with the last page that exists
  const last = Math.max(0, Math.ceil(total / PAGE) - 1);
  const pg = Math.min(page(p), last);
  const r = await db.query(
    `SELECT p.id, p.username, p.display_name, p.role, p.is_anonymous, p.country, p.created_at, p.last_seen_at, p.suspended_at,
            EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NOT NULL) AS verified
       FROM players p ${where}
      ORDER BY ${key ? `${USER_SORTS[key].by} ${direction}` : days ? 'COALESCE(p.last_seen_at, p.created_at) ASC' : 'p.created_at DESC'}, p.id
      LIMIT ${PAGE} OFFSET $${args.length + 1}`,
    [...args, pg * PAGE]
  );
  return { total, pageSize: PAGE, page: pg + 1, users: r.rows, sort: key, dir: key ? direction.toLowerCase() : '' };
}

async function signOutUser({ actorId, targetId }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    policy.checkSignOut({ actor: rows.get(actorId), target: rows.get(targetId) });
    const r = await c.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [targetId]);
    await c.query('UPDATE auth_devices SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [targetId]);
    await audit(c, { actorId, action: 'user.sign_out', targetType: 'player', targetId, detail: { sessions: r.rowCount } });
    return { revoked: r.rowCount };
  });
}

/**
 * Staff asks for the verification email of an account that has not verified yet. The role check and the lookup run inside one
 * transaction, and the address is returned to the server only (never to the browser). The audit row records the attempt, not the address.
 */
async function authorizeVerifyResend({ actorId, targetId }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    policy.checkManageUser({ actor: rows.get(actorId), target: rows.get(targetId) });
    const r = await c.query(
      `SELECT provider_user_id AS email FROM auth_identities
       WHERE player_id = $1 AND provider = 'email' AND email_verified_at IS NULL LIMIT 1`,
      [targetId]
    );
    if (!r.rows.length) throw new policy.PolicyError('This account has no unverified email address.', 409);
    await audit(c, { actorId, action: 'user.verify_resend', targetType: 'player', targetId, detail: {} });
    return { email: r.rows[0].email };
  });
}

/** Owner only: suspends an ordinary account. Its sessions are revoked in the same transaction, and the audit row is written there too. */
async function suspendUser({ actorId, targetId, reason = '' }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    policy.checkSuspend({ actor: rows.get(actorId), target: rows.get(targetId) });
    // 200 characters by code point, so an emoji is never cut in half
    const why = Array.from(String(reason || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 200).join('') || null;
    await c.query('UPDATE players SET suspended_at = NOW(), suspended_reason = $2 WHERE id = $1', [targetId, why]);
    const r = await c.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [targetId]);
    await c.query('UPDATE auth_devices SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [targetId]);
    await audit(c, { actorId, action: 'user.suspend', targetType: 'player', targetId, detail: { sessions: r.rowCount, reason: why } });
    return { suspended: true, sessions: r.rowCount };
  });
}

/** Owner only: lifts a suspension. Signing in again is then possible; sessions are not restored. */
async function unsuspendUser({ actorId, targetId }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    policy.checkSuspend({ actor: rows.get(actorId), target: rows.get(targetId) });
    await c.query('UPDATE players SET suspended_at = NULL, suspended_reason = NULL WHERE id = $1', [targetId]);
    await audit(c, { actorId, action: 'user.unsuspend', targetType: 'player', targetId, detail: {} });
    return { suspended: false };
  });
}

/**
 * Owner only: permanently deletes an ordinary registered account, for stale or abandoned ones. The same removal as a self-service
 * deletion (finished games keep the seat as "Deleted player"; login, sessions and recent tables go). The audit row records the
 * username and counts, never an e-mail address, and survives the account (no foreign key on target_id).
 */
async function deleteUser({ actorId, targetId, confirm }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    policy.checkDelete({ actor: rows.get(actorId), target: rows.get(targetId), confirm });
    const target = rows.get(targetId);
    const out = await require('./account').removePlayerTx(c, targetId);
    await audit(c, { actorId, action: 'user.delete', targetType: 'player', targetId, detail: { username: target.username, matchesKept: out.matchesKept } });
    return { deleted: true, matchesKept: out.matchesKept };
  });
}

/** Read-only account lookup for staff. Never returns an e-mail address, IP address or session token; active_sessions is a count. */
async function lookupUser({ username }) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(u)) return { user: null };
  const r = await db.query(
    `SELECT p.id, p.username, p.display_name, p.role, p.country, p.created_at, p.last_seen_at, p.suspended_at, p.suspended_reason,
            EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NOT NULL) AS verified,
            (SELECT COUNT(*)::int FROM auth_sessions s WHERE s.player_id = p.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
       FROM players p
      WHERE p.username = $1 AND p.is_anonymous = FALSE
      LIMIT 1`,
    [u]
  );
  return { user: r.rows[0] || null };
}

/** Used by the account deletion path: the owner account must be handed over (an operator action) before it can be deleted. */
async function isOwner(playerId) { return (await getRole(playerId)) === 'owner'; }

// ---------------------------------------------------------------- analytics
/**
 * Applies one write at most once per key. The key is recorded in the same transaction as the write, so a retried batch
 * (after a timeout or an error whose outcome is unknown) that already landed is ignored. Without a key, it just writes.
 */
async function applyOnce(key, write) {
  if (key && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[ca]$/i.test(key)) throw new Error('analytics write key is not valid');
  // Always a transaction: the share locks taken by a write must be held until its rows commit (see addActive).
  return db.withTransaction(async (c) => {
    if (key) {
      const fresh = await c.query('INSERT INTO analytics_batches (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id', [key]);
      if (!fresh.rows.length) return false;
    }
    await write(c);
    return true;
  });
}

async function addCounters(rows, batchId = null) {
  if (!rows.length) return;
  await applyOnce(batchId && `${batchId}:c`, (q) => q.query(
    `INSERT INTO analytics_daily (day, metric, dim, total)
     SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::bigint[])
     ON CONFLICT (day, metric, dim) DO UPDATE SET total = analytics_daily.total + EXCLUDED.total`,
    [rows.map((r) => r.day), rows.map((r) => r.metric), rows.map((r) => r.dim), rows.map((r) => r.count)]
  ));
}

let salt = null;
async function analyticsSalt() {
  if (salt) return salt;
  await db.query("INSERT INTO analytics_meta (key, value) VALUES ('salt', $1) ON CONFLICT (key) DO NOTHING", [crypto.randomBytes(32).toString('hex')]);
  salt = (await db.query("SELECT value FROM analytics_meta WHERE key = 'salt'")).rows[0].value;
  return salt;
}
// Lowercased: the same account hashes the same whatever the case of the id it arrives with (pg returns UUIDs in lowercase).
const actorHash = (s, playerId) => crypto.createHmac('sha256', s).update(String(playerId).toLowerCase()).digest('hex').slice(0, 32);

/**
 * Stores hashed activity for accounts that still exist. The account rows are share-locked (FOR SHARE) in the same transaction
 * as the insert. Account deletion takes a row lock on the same row (FOR UPDATE, then DELETE) and commits before
 * forgetActor runs, so either this write sees the account gone and stores nothing, or it commits first and forgetActor
 * removes what it stored. A timed-out write whose transaction is still open cannot land after the purge.
 */
async function addActive(rows, batchId = null) {
  if (!rows.length) return;
  const s = await analyticsSalt();
  await applyOnce(batchId && `${batchId}:a`, async (q) => {
    const ids = [...new Set(rows.map((r) => String(r.playerId).toLowerCase()))];
    // ORDER BY id, as lockAccounts() does: two transactions that lock the same accounts cannot wait on each other in opposite order
    const live = await q.query('SELECT id FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE', [ids]);
    const alive = new Set(live.rows.map((r) => r.id));
    const keep = rows.filter((r) => alive.has(String(r.playerId).toLowerCase()));
    if (!keep.length) return;
    await q.query(
      'INSERT INTO analytics_active (day, actor) SELECT * FROM unnest($1::date[], $2::text[]) ON CONFLICT DO NOTHING',
      [keep.map((r) => r.day), keep.map((r) => actorHash(s, r.playerId))]
    );
  });
}

/** Removes an account's pseudonymous activity rows (called when the account is deleted). */
async function forgetActor(playerId) {
  const s = await analyticsSalt();
  await db.query('DELETE FROM analytics_active WHERE actor = $1', [actorHash(s, playerId)]);
}

async function overview({ days = 30 } = {}) {
  const n = Math.min(90, Math.max(1, Math.floor(Number(days)) || 30));
  const [series, dims, active, accounts, activeDaily, queues] = await Promise.all([
    db.query("SELECT day::text AS day, metric, SUM(total)::int AS total FROM analytics_daily WHERE day > (NOW() AT TIME ZONE 'UTC')::date - $1::int GROUP BY day, metric ORDER BY day", [n]),
    db.query("SELECT metric, dim, SUM(total)::int AS total FROM analytics_daily WHERE day > (NOW() AT TIME ZONE 'UTC')::date - $1::int AND metric IN ('game_started', 'game_finished', 'error') GROUP BY metric, dim ORDER BY total DESC LIMIT 60", [n]),
    db.query(`SELECT COUNT(DISTINCT actor) FILTER (WHERE day = (NOW() AT TIME ZONE 'UTC')::date)::int AS dau,
                     COUNT(DISTINCT actor) FILTER (WHERE day > (NOW() AT TIME ZONE 'UTC')::date - 7)::int AS wau,
                     COUNT(DISTINCT actor) FILTER (WHERE day > (NOW() AT TIME ZONE 'UTC')::date - 30)::int AS mau FROM analytics_active`),
    db.query(`SELECT COUNT(*) FILTER (WHERE NOT is_anonymous)::int AS registered,
                     COUNT(*) FILTER (WHERE NOT is_anonymous AND created_at > NOW() - INTERVAL '1 day')::int AS registered_24h,
                     COUNT(*) FILTER (WHERE role <> 'user')::int AS staff FROM players`),
    // one row per player per day in analytics_active (a keyed hash, never an account id), so a count is distinct players that day
    db.query("SELECT day::text AS day, COUNT(*)::int AS active FROM analytics_active WHERE day > (NOW() AT TIME ZONE 'UTC')::date - $1::int GROUP BY day ORDER BY day", [n]),
    // work waiting for a person: reports (no status column yet, so recent and total) and feedback not yet read
    db.query(`SELECT (SELECT COUNT(*) FROM chat_reports WHERE created_at > NOW() - INTERVAL '7 days')::int AS reports7d,
                     (SELECT COUNT(*) FROM chat_reports)::int AS reports_total,
                     (SELECT COUNT(*) FROM feedback WHERE status = 'new')::int AS feedback_new,
                     (SELECT COUNT(*) FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.forfeit AND m.finished_at > NOW() - INTERVAL '7 days')::int AS forfeits7d,
                     (SELECT COUNT(*) FROM match_participants WHERE forfeit)::int AS forfeits_total`),
  ]);
  return { days: n, series: series.rows, dims: dims.rows, active: active.rows[0], accounts: accounts.rows[0], activeDaily: activeDaily.rows, queues: queues.rows[0] };
}

/**
 * Game by game, over the last N days: finished games, player-games, signed-in players, penalised leaves (left while
 * others were still playing), leaves without a penalty, average play time per player-game, and games in the last 7 days.
 * Counts and averages only: no player is named, and guests are counted without an identity.
 */
async function gameStats({ days = 30 } = {}) {
  const n = Math.min(90, Math.max(1, Math.floor(Number(days)) || 30));
  const perGame = await db.query(`
    SELECT m.game_id,
           COUNT(DISTINCT m.id) FILTER (WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day'))::int AS finished,
           COUNT(*) FILTER (WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day') AND NOT mp.is_bot)::int AS player_games,
           COUNT(DISTINCT mp.player_id) FILTER (WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day') AND NOT mp.is_bot AND NOT pl.is_anonymous)::int AS signed_in_players,
           COUNT(*) FILTER (WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day') AND NOT mp.is_bot AND mp.forfeit)::int AS penalised_leaves,
           COUNT(*) FILTER (WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day') AND NOT mp.is_bot AND mp.left_early AND NOT mp.forfeit)::int AS left_without_penalty,
           COALESCE(AVG(mp.seconds_played) FILTER (WHERE m.finished_at > NOW() - ($1::int * INTERVAL '1 day') AND NOT mp.is_bot), 0)::float AS avg_seconds,
           COUNT(DISTINCT m.id) FILTER (WHERE m.finished_at > NOW() - INTERVAL '7 days')::int AS finished_7d
      FROM matches m JOIN match_participants mp ON mp.match_id = m.id
      LEFT JOIN players pl ON pl.id = mp.player_id
     WHERE m.finished_at > NOW() - (GREATEST($1::int, 7) * INTERVAL '1 day')
     GROUP BY m.game_id
     ORDER BY finished DESC, m.game_id`, [n]);
  return {
    days: n,
    games: perGame.rows.map((r) => ({
      gameId: r.game_id, finished: r.finished, playerGames: r.player_games, signedInPlayers: r.signed_in_players,
      penalisedLeaves: r.penalised_leaves, leftWithoutPenalty: r.left_without_penalty,
      avgMinutes: Math.round((r.avg_seconds / 60) * 10) / 10, finished7d: r.finished_7d,
    })),
  };
}

/**
 * Tables hosted, newest first, a page at a time. Each row: the game, the room code, when it started and ended, the seats,
 * how many were people and how many bots, and whether it was completed. No player is named.
 * The cursor is the last row's "finished_at|id" from the previous page, so paging stays correct as new tables finish.
 */
const HISTORY_MAX = 100;
async function matchHistory({ before = null, limit = 50 } = {}) {
  const n = Math.min(HISTORY_MAX, Math.max(1, Math.floor(Number(limit)) || 50));
  let cursorAt = null;
  let cursorId = null;
  if (before) {
    if (!validHistoryCursor(before)) throw new Error('Bad cursor');
    [cursorAt, cursorId] = before.split('|');
  }
  const r = await db.query(`
    SELECT id, room_code, game_id, seats, started_at, finished_at, completed, table_humans, table_bots,
           to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM matches
     WHERE ($2::timestamptz IS NULL OR (finished_at, id) < ($2::timestamptz, $3::uuid))
     ORDER BY finished_at DESC, id DESC
     LIMIT $1`, [n + 1, cursorAt, cursorId]);
  const rows = r.rows.slice(0, n);
  const last = rows[rows.length - 1];
  return {
    tables: rows.map((m) => ({
      id: m.id, roomCode: m.room_code, gameId: m.game_id, seats: m.seats,
      humans: m.table_humans, bots: m.table_bots, startedAt: m.started_at, finishedAt: m.finished_at, completed: m.completed,
    })),
    nextCursor: r.rows.length > n && last ? `${last.cursor_at}|${last.id}` : null,
  };
}

async function health() {
  const t0 = Date.now();
  await db.query('SELECT 1');
  const dbMs = Date.now() - t0;
  const r = await db.query(`SELECT (SELECT COUNT(*)::int FROM schema_migrations) AS migrations,
                                   (SELECT COUNT(*)::int FROM feedback WHERE status = 'new') AS feedback_new,
                                   (SELECT COUNT(*)::int FROM analytics_daily) AS analytics_rows`);
  return { dbMs, ...r.rows[0] };
}

// ---------------------------------------------------------------- feedback
async function createFeedback({ playerId, category, message }) {
  const r = await db.query('INSERT INTO feedback (player_id, category, message) VALUES ($1, $2, $3) RETURNING id', [playerId || null, category, message]);
  return { id: r.rows[0].id };
}

async function listFeedback({ status = '', page: p = 1 } = {}) {
  const ok = ['new', 'read', 'resolved'].includes(status);
  const where = ok ? 'WHERE f.status = $1' : '';
  const args = ok ? [status] : [];
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM feedback f ${where}`, args)).rows[0].n;
  const r = await db.query(
    `SELECT f.id, f.category, f.message, f.status, f.created_at, pl.username, pl.display_name
       FROM feedback f LEFT JOIN players pl ON pl.id = f.player_id ${where}
      ORDER BY f.created_at DESC, f.id LIMIT ${PAGE} OFFSET $${args.length + 1}`,
    [...args, page(p) * PAGE]
  );
  return { total, pageSize: PAGE, items: r.rows };
}

async function setFeedbackStatus({ actorId, id, status }) {
  if (!['new', 'read', 'resolved'].includes(status)) throw new policy.PolicyError('Unknown status.', 400);
  return db.withTransaction(async (c) => {
    await lockStaff(c, actorId);
    const r = await c.query('UPDATE feedback SET status = $2 WHERE id = $1 RETURNING id', [id, status]);
    if (!r.rows.length) throw new policy.PolicyError('No such feedback.', 404);
    await audit(c, { actorId, action: 'feedback.status', targetType: 'feedback', targetId: id, detail: { status } });
    return { id, status };
  });
}

// ---------------------------------------------------------------- announcements
const A_COLS = 'id, message, level, audience, starts_at, ends_at, ended_at, created_at, updated_at, revision';

async function createAnnouncement({ actorId, fields }) {
  return db.withTransaction(async (c) => {
    await lockStaff(c, actorId);
    const r = await c.query(
      `INSERT INTO announcements (message, level, audience, starts_at, ends_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${A_COLS}`,
      [fields.message, fields.level, fields.audience, fields.startsAt, fields.endsAt, actorId]
    );
    await audit(c, { actorId, action: 'announcement.create', targetType: 'announcement', targetId: r.rows[0].id, detail: { audience: fields.audience, level: fields.level, endsAt: fields.endsAt } });
    return r.rows[0];
  });
}

async function listAnnouncements() {
  return (await db.query(`SELECT ${A_COLS} FROM announcements WHERE COALESCE(ended_at, ends_at) > NOW() - INTERVAL '30 days' ORDER BY starts_at DESC, id LIMIT 100`)).rows;
}

async function updateAnnouncement({ actorId, id, fields }) {
  return db.withTransaction(async (c) => {
    await lockStaff(c, actorId);
    const cur = (await c.query(`SELECT ${A_COLS} FROM announcements WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw new announcements.AnnouncementError('No such announcement.', 404);
    const st = announcements.statusOf(cur);
    if (st === 'expired' || st === 'ended') throw new announcements.AnnouncementError('This announcement has finished. Create a new one to run it again.', 409);
    // Only the fields that were sent change. The window is merged with the stored row and checked as a whole, so an edit of
    // one date can never move the other one (and a duration re-computes the end from the merged start).
    const startsAt = fields.startsAt ?? new Date(cur.starts_at);
    const windowSent = fields.startsAt !== undefined || fields.endsAt !== undefined || fields.durationHours !== undefined;
    const endsAt = fields.endsAt ?? (fields.durationHours !== undefined ? announcements.endAfter(startsAt, fields.durationHours) : new Date(cur.ends_at));
    if (windowSent) announcements.checkWindow(startsAt, endsAt, new Date());
    const next = { message: fields.message ?? cur.message, level: fields.level ?? cur.level, audience: fields.audience ?? cur.audience, starts_at: startsAt, ends_at: endsAt };
    // What players see changed: a new revision, so every dismissal of the old one stops matching (migration 014). Saving
    // the same values again is not a change and keeps the revision, so dismissals stay.
    const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();
    const changed = next.message !== cur.message || next.level !== cur.level || next.audience !== cur.audience
      || !sameInstant(next.starts_at, cur.starts_at) || !sameInstant(next.ends_at, cur.ends_at);
    const revision = cur.revision + (changed ? 1 : 0);
    const r = await c.query(
      `UPDATE announcements SET message = $2, level = $3, audience = $4, starts_at = $5, ends_at = $6, revision = $7, updated_at = NOW() WHERE id = $1 RETURNING ${A_COLS}`,
      [id, next.message, next.level, next.audience, next.starts_at, next.ends_at, revision]
    );
    await audit(c, { actorId, action: 'announcement.update', targetType: 'announcement', targetId: id, detail: { fields: Object.keys(fields) } });
    return r.rows[0];
  });
}

async function endAnnouncement({ actorId, id }) {
  return db.withTransaction(async (c) => {
    await lockStaff(c, actorId);
    const r = await c.query('UPDATE announcements SET ended_at = NOW(), updated_at = NOW() WHERE id = $1 AND ended_at IS NULL AND ends_at > NOW() RETURNING id', [id]);
    if (!r.rows.length) throw new announcements.AnnouncementError('That announcement is not running or scheduled.', 404);
    await audit(c, { actorId, action: 'announcement.end', targetType: 'announcement', targetId: id });
    return { id };
  });
}

/** Live now: not ended early, started, not expired (decided by the database clock). */
async function listLiveAnnouncements() {
  return (await db.query(`SELECT ${A_COLS} FROM announcements WHERE ended_at IS NULL AND starts_at <= NOW() AND ends_at > NOW()`)).rows;
}

/**
 * Records that the player dismissed the revision they saw (`revision`; the current one when it is not given). A dismissal
 * that arrives after an edit therefore hides only the text the player read, and a later dismissal never lowers a newer one.
 */
async function dismissAnnouncement({ playerId, announcementId, revision = null }) {
  try {
    const r = await db.query(
      `INSERT INTO announcement_dismissals (player_id, announcement_id, dismissed_revision)
       SELECT $1, a.id, LEAST(COALESCE($3::int, a.revision), a.revision) FROM announcements a WHERE a.id = $2
       ON CONFLICT (player_id, announcement_id)
       DO UPDATE SET dismissed_revision = GREATEST(EXCLUDED.dismissed_revision, announcement_dismissals.dismissed_revision)
       RETURNING announcement_id`,
      [playerId, announcementId, revision]
    );
    if (!r.rows.length) return { dismissed: false };
  } catch (err) {
    if (err && (err.code === '23503' || err.code === '22P02')) return { dismissed: false };
    throw err;
  }
  return { dismissed: true };
}

/** announcement id -> the revision this player dismissed. */
async function listDismissed(playerId) {
  const r = await db.query('SELECT announcement_id, dismissed_revision FROM announcement_dismissals WHERE player_id = $1', [playerId]);
  return new Map(r.rows.map((row) => [row.announcement_id, row.dismissed_revision]));
}

// ---------------------------------------------------------------- audit log and retention
async function listAudit({ page: p = 1 } = {}) {
  const total = (await db.query('SELECT COUNT(*)::int AS n FROM admin_audit_log')).rows[0].n;
  const r = await db.query(
    `SELECT a.id, a.at, a.action, a.target_type, a.target_id, a.detail, pl.username AS actor
       FROM admin_audit_log a LEFT JOIN players pl ON pl.id = a.actor_id
      ORDER BY a.at DESC, a.id LIMIT ${PAGE} OFFSET $1`,
    [page(p) * PAGE]
  );
  return { total, pageSize: PAGE, items: r.rows };
}

/** Retention (docs/ADMIN.md): safe to run at any time and from several instances. */
async function purge() {
  const run = async (sql) => (await db.query(sql)).rowCount;
  return {
    active: await run(`DELETE FROM analytics_active WHERE day < CURRENT_DATE - ${RETENTION.activeDays}`),
    daily: await run(`DELETE FROM analytics_daily WHERE day < CURRENT_DATE - ${RETENTION.dailyDays}`),
    audit: await run(`DELETE FROM admin_audit_log WHERE at < NOW() - INTERVAL '${RETENTION.auditDays} days'`),
    feedback: await run(`DELETE FROM feedback WHERE created_at < NOW() - INTERVAL '${RETENTION.feedbackDays} days'`),
    // retention runs from the real end: an announcement ended early today is kept 90 days from today, not from its scheduled end
    announcements: await run(`DELETE FROM announcements WHERE COALESCE(ended_at, ends_at) < NOW() - INTERVAL '${RETENTION.announcementDays} days'`),
    analyticsWrites: await run("DELETE FROM analytics_batches WHERE created_at < NOW() - INTERVAL '3 days'"),
  };
}

// ---------------------------------------------------------------- game switches (owner)
/** Every explicit switch: { game_id, access, enabled, updated_at }. A game without a row is on for everyone (lib/gameFlags.js). */
async function listGameFlags() {
  return (await db.query('SELECT game_id, access, enabled, updated_at, sort_order FROM game_flags')).rows;
}

/**
 * Sets one game's access mode ('on' | 'admins' | 'guests' | 'owner'). `enabled` is kept in step (true only for 'on'), so an
 * older application version reads a restricted game as off. Audited in the same transaction.
 */
/** Guest feature switches (lib/guestFeatures.js): rows as stored. */
async function listGuestFeatures() {
  return (await db.query('SELECT feature, enabled, updated_at FROM guest_features')).rows;
}

/** Opens (enabled true) or locks (false) one guest feature. Audited in the same transaction; a repeat of the same value is not. */
async function setGuestFeature({ actorId, feature, enabled }) {
  await db.withTransaction(async (c) => {
    const r = await c.query(
      `INSERT INTO guest_features (feature, enabled, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (feature) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW(), updated_by = EXCLUDED.updated_by
       WHERE guest_features.enabled IS DISTINCT FROM EXCLUDED.enabled
       RETURNING feature`,
      [feature, enabled === true, actorId]
    );
    if (r.rows.length) await audit(c, { actorId, action: 'guest.feature', targetType: 'guest_feature', targetId: feature, detail: { enabled: enabled === true } });
  });
}

/** Writes one audit row on its own (used by the owner's Render redeploy, which changes no table). */
async function recordAudit({ actorId, action, targetType = null, targetId = null, detail = {} }) {
  await db.withTransaction((c) => audit(c, { actorId, action, targetType, targetId, detail }));
}

async function setGameFlag({ actorId, gameId, access }) {
  await db.withTransaction(async (c) => {
    // Only a real change is written and audited: repeating the same value leaves no second entry.
    const r = await c.query(
      `INSERT INTO game_flags (game_id, enabled, access, updated_at, updated_by) VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (game_id) DO UPDATE SET access = EXCLUDED.access, enabled = EXCLUDED.enabled, updated_at = NOW(), updated_by = EXCLUDED.updated_by
       WHERE game_flags.access IS DISTINCT FROM EXCLUDED.access
       RETURNING game_id`,
      [gameId, access === 'on', access, actorId]
    );
    if (r.rows.length) await audit(c, { actorId, action: 'game.switch', targetType: 'game', targetId: gameId, detail: { access } });
  });
}

/**
 * Sets the order of the games in the home menu. `order` is the full list of game ids, first to last; it must name every game
 * exactly once (the route checks this). Only positions that change are written, and one audit entry records the whole order.
 */
async function setGameOrder({ actorId, order }) {
  await db.withTransaction(async (c) => {
    await lockStaff(c, actorId);
    // one order writer at a time: two staff saving together must not each read the old positions and then interleave
    await c.query("SELECT pg_advisory_xact_lock(hashtext('game_order'))");
    const cur = await c.query('SELECT game_id, sort_order FROM game_flags');
    const have = new Map(cur.rows.map((r) => [r.game_id, r.sort_order]));
    let changed = false;
    for (let i = 0; i < order.length; i++) {
      if (have.get(order[i]) === i) continue;
      changed = true;
      // a game with no row yet gets one that keeps it enabled and open to everybody, as a missing row does
      await c.query(
        `INSERT INTO game_flags (game_id, enabled, access, sort_order, updated_at, updated_by) VALUES ($1, TRUE, 'on', $2, NOW(), $3)
         ON CONFLICT (game_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [order[i], i, actorId]
      );
    }
    if (changed) await audit(c, { actorId, action: 'game.order', targetType: 'game', detail: { order } });
  });
}

module.exports = {
  RETENTION, PAGE,
  getRole, claimOwnerIfConfigured, bootstrapOwner, setRole, listUsers, signOutUser, authorizeVerifyResend, suspendUser, unsuspendUser, deleteUser, lookupUser, isOwner,
  addCounters, addActive, forgetActor, overview, health, gameStats, matchHistory, listGameFlags, setGameFlag, setGameOrder, listGuestFeatures, setGuestFeature, recordAudit,
  insights: (opts) => require('./insights').insights(opts), // read-only usage figures for the Insights tab
  countryEngagement: (opts) => require('./countryStats').countryEngagement(opts), // per-country play figures (minimum sample applied)
  sessionStats: (opts) => require('./sessionStats').sessionStats(opts), // connections by hour and visit length (aggregate counters)
  listPlayers: (opts) => require('./playerStats').listPlayers(opts), // the player directory (read-only)
  playerProfile: (opts) => require('./playerStats').playerProfile(opts), // one player's stats; writes a player.view audit row
  listReports: (opts) => require('./reportQueue').listReports(opts), // chat report queue (read-only); writes a reports.view audit row
  funnel: (opts) => require('./funnel').funnel(opts), // signup funnel; a CSV export writes a funnel.export audit row
  seatBalance: (opts) => require('./seatBalance').seatBalance(opts), // seat-order win check (read-only)
  createFeedback, listFeedback, setFeedbackStatus,
  createAnnouncement, listAnnouncements, updateAnnouncement, endAnnouncement, listLiveAnnouncements, dismissAnnouncement, listDismissed,
  listAudit, purge, audit,
  _resetForTests: () => { ownerKnown = false; salt = null; },
};
