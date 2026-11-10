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
  const r = await client.query('SELECT id, role, is_anonymous, suspended_at FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[...new Set(ids)]]);
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

async function listUsers({ q = '', page: p = 1 } = {}) {
  const term = String(q || '').trim().slice(0, 40);
  const where = term ? "WHERE (username ILIKE $1 ESCAPE '\\' OR display_name ILIKE $1 ESCAPE '\\')" : '';
  const args = term ? [like(term)] : [];
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM players ${where}`, args)).rows[0].n;
  const r = await db.query(
    `SELECT p.id, p.username, p.display_name, p.role, p.is_anonymous, p.created_at, p.last_seen_at, p.suspended_at,
            EXISTS (SELECT 1 FROM auth_identities i WHERE i.player_id = p.id AND i.email_verified_at IS NOT NULL) AS verified
       FROM players p ${where}
      ORDER BY p.created_at DESC, p.id
      LIMIT ${PAGE} OFFSET $${args.length + 1}`,
    [...args, page(p) * PAGE]
  );
  return { total, pageSize: PAGE, users: r.rows };
}

async function signOutUser({ actorId, targetId }) {
  return db.withTransaction(async (c) => {
    const rows = await lockAccounts(c, [actorId, targetId]);
    policy.checkSignOut({ actor: rows.get(actorId), target: rows.get(targetId) });
    const r = await c.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE player_id = $1 AND revoked_at IS NULL', [targetId]);
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

/** Read-only account lookup for staff. Never returns an e-mail address, IP address or session token; active_sessions is a count. */
async function lookupUser({ username }) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(u)) return { user: null };
  const r = await db.query(
    `SELECT p.id, p.username, p.display_name, p.role, p.created_at, p.last_seen_at, p.suspended_at, p.suspended_reason,
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
    db.query('SELECT day::text AS day, metric, SUM(total)::int AS total FROM analytics_daily WHERE day > CURRENT_DATE - $1::int GROUP BY day, metric ORDER BY day', [n]),
    db.query("SELECT metric, dim, SUM(total)::int AS total FROM analytics_daily WHERE day > CURRENT_DATE - $1::int AND metric IN ('game_started', 'game_finished', 'error') GROUP BY metric, dim ORDER BY total DESC LIMIT 60", [n]),
    db.query(`SELECT COUNT(DISTINCT actor) FILTER (WHERE day = CURRENT_DATE)::int AS dau,
                     COUNT(DISTINCT actor) FILTER (WHERE day > CURRENT_DATE - 7)::int AS wau,
                     COUNT(DISTINCT actor) FILTER (WHERE day > CURRENT_DATE - 30)::int AS mau FROM analytics_active`),
    db.query(`SELECT COUNT(*) FILTER (WHERE NOT is_anonymous)::int AS registered,
                     COUNT(*) FILTER (WHERE NOT is_anonymous AND created_at > NOW() - INTERVAL '1 day')::int AS registered_24h,
                     COUNT(*) FILTER (WHERE role <> 'user')::int AS staff FROM players`),
    // one row per player per day in analytics_active (a keyed hash, never an account id), so a count is distinct players that day
    db.query('SELECT day::text AS day, COUNT(*)::int AS active FROM analytics_active WHERE day > CURRENT_DATE - $1::int GROUP BY day ORDER BY day', [n]),
    // work waiting for a person: reports (no status column yet, so recent and total) and feedback not yet read
    db.query(`SELECT (SELECT COUNT(*) FROM chat_reports WHERE created_at > NOW() - INTERVAL '7 days')::int AS reports7d,
                     (SELECT COUNT(*) FROM chat_reports)::int AS reports_total,
                     (SELECT COUNT(*) FROM feedback WHERE status = 'new')::int AS feedback_new`),
  ]);
  return { days: n, series: series.rows, dims: dims.rows, active: active.rows[0], accounts: accounts.rows[0], activeDaily: activeDaily.rows, queues: queues.rows[0] };
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

module.exports = {
  RETENTION, PAGE,
  getRole, claimOwnerIfConfigured, bootstrapOwner, setRole, listUsers, signOutUser, authorizeVerifyResend, suspendUser, unsuspendUser, lookupUser, isOwner,
  addCounters, addActive, forgetActor, overview, health,
  createFeedback, listFeedback, setFeedbackStatus,
  createAnnouncement, listAnnouncements, updateAnnouncement, endAnnouncement, listLiveAnnouncements, dismissAnnouncement, listDismissed,
  listAudit, purge, audit,
  _resetForTests: () => { ownerKnown = false; salt = null; },
};
