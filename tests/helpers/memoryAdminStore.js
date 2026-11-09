'use strict';
/**
 * An in-memory stand-in for db/admin.js, used by the DB-free tests. It applies the SAME policy modules (lib/adminPolicy.js and
 * lib/announcements.js) the PostgreSQL store uses; the SQL itself is covered by tests/admin.pg.test.js.
 */
const crypto = require('node:crypto');
const policy = require('../../lib/adminPolicy');
const ann = require('../../lib/announcements');

function createMemoryAdminStore({ now = () => new Date(), env = {} } = {}) {
  const players = new Map(); // id -> { id, username, display_name, role, email, verified, created_at }
  const audit = [];
  const feedback = [];
  const anns = [];
  const dismissals = new Map(); // `${playerId}:${annId}` -> the revision dismissed
  const signedOut = [];
  let failNext = null;
  const log = (actorId, action, targetType, targetId, detail = {}) => audit.push({ id: crypto.randomUUID(), at: now(), actor: players.get(actorId)?.username || null, action, target_type: targetType, target_id: targetId, detail });
  const st = {
    players, audit, feedback, anns, dismissals, signedOut,
    RETENTION: { activeDays: 35, dailyDays: 400, auditDays: 365, feedbackDays: 180, announcementDays: 90 },
    addPlayer(id, { username = id.slice(0, 8), role = 'user', email = null, verified = false } = {}) { players.set(id, { id, username, display_name: username, role, email, verified, is_anonymous: !email, created_at: now(), last_seen_at: now() }); return id; },
    failWith(err) { failNext = err; },
    check() { if (failNext) { const e = failNext; failNext = null; throw e; } },
    async getRole(id) { st.check(); return players.get(id)?.role || null; },
    async claimOwnerIfConfigured(playerId, e = env) {
      const has = [...players.values()].some((p) => p.role === 'owner');
      const p = players.get(playerId);
      if (!p) return false;
      if (!policy.shouldClaimOwner({ env: e, hasOwner: has, playerId, verifiedEmail: p.verified ? p.email : null })) return false;
      p.role = 'owner';
      log(playerId, 'owner.claimed', 'player', playerId);
      return true;
    },
    async setRole({ actorId, targetId, role }) {
      const { noop } = policy.checkSetRole({ actor: players.get(actorId), target: players.get(targetId), newRole: role });
      if (noop) return { changed: false, role };
      const from = players.get(targetId).role;
      players.get(targetId).role = role;
      log(actorId, role === 'admin' ? 'role.grant_admin' : 'role.revoke_admin', 'player', targetId, { from, to: role });
      return { changed: true, role };
    },
    async listUsers({ q = '' } = {}) { const u = [...players.values()].filter((p) => !q || p.username.includes(q)); return { total: u.length, pageSize: 25, users: u.map(({ email, ...rest }) => rest) }; },
    async signOutUser({ actorId, targetId }) { policy.checkManageUser({ actor: players.get(actorId), target: players.get(targetId) }); signedOut.push(targetId); log(actorId, 'user.sign_out', 'player', targetId); return { revoked: 1 }; },
    async overview({ days = 30 } = {}) { return { days, series: [], dims: [], active: { dau: 0, wau: 0, mau: 0 }, accounts: { registered: players.size, registered_24h: 0, staff: 0 } }; },
    async health() { return { dbMs: 1, migrations: 13, feedback_new: feedback.filter((f) => f.status === 'new').length, analytics_rows: 0 }; },
    async createFeedback({ playerId, category, message }) { st.check(); const row = { id: crypto.randomUUID(), player_id: playerId, category, message, status: 'new', created_at: now() }; feedback.push(row); return { id: row.id }; },
    async listFeedback() { return { total: feedback.length, pageSize: 25, items: feedback.slice() }; },
    async setFeedbackStatus({ actorId, id, status }) { const f = feedback.find((x) => x.id === id); if (!f) throw new policy.PolicyError('No such feedback.', 404); f.status = status; log(actorId, 'feedback.status', 'feedback', id, { status }); return { id, status }; },
    async createAnnouncement({ actorId, fields }) {
      const row = { id: crypto.randomUUID(), message: fields.message, level: fields.level, audience: fields.audience, starts_at: fields.startsAt, ends_at: fields.endsAt, ended_at: null, created_by: actorId, revision: 1, created_at: now(), updated_at: now() };
      anns.push(row); log(actorId, 'announcement.create', 'announcement', row.id); return row;
    },
    async listAnnouncements() { return anns.slice(); },
    async updateAnnouncement({ actorId, id, fields }) {
      const cur = anns.find((a) => a.id === id);
      if (!cur) throw new ann.AnnouncementError('No such announcement.', 404);
      const s = ann.statusOf(cur, now());
      if (s === 'expired' || s === 'ended') throw new ann.AnnouncementError('This announcement has finished. Create a new one to run it again.', 409);
      // same rule as db/admin.js: merge the stored window with what was sent, then check the whole window
      const startsAt = fields.startsAt ?? new Date(cur.starts_at);
      const windowSent = fields.startsAt !== undefined || fields.endsAt !== undefined || fields.durationHours !== undefined;
      const endsAt = fields.endsAt ?? (fields.durationHours !== undefined ? ann.endAfter(startsAt, fields.durationHours) : new Date(cur.ends_at));
      if (windowSent) ann.checkWindow(startsAt, endsAt, now());
      const next = { ...cur, message: fields.message ?? cur.message, level: fields.level ?? cur.level, audience: fields.audience ?? cur.audience, starts_at: startsAt, ends_at: endsAt };
      const same = (x, y) => new Date(x).getTime() === new Date(y).getTime();
      const changed = next.message !== cur.message || next.level !== cur.level || next.audience !== cur.audience || !same(next.starts_at, cur.starts_at) || !same(next.ends_at, cur.ends_at);
      Object.assign(cur, next, { revision: cur.revision + (changed ? 1 : 0), updated_at: now() }); log(actorId, 'announcement.update', 'announcement', id); return cur;
    },
    async endAnnouncement({ actorId, id }) {
      const a = anns.find((x) => x.id === id);
      if (!a || a.ended_at || new Date(a.ends_at) <= now()) throw new ann.AnnouncementError('That announcement is not running or scheduled.', 404);
      a.ended_at = now(); log(actorId, 'announcement.end', 'announcement', id); return { id };
    },
    async listLiveAnnouncements() { st.check(); return anns.filter((a) => !a.ended_at && new Date(a.starts_at) <= now() && new Date(a.ends_at) > now()); },
    async dismissAnnouncement({ playerId, announcementId, revision = null }) {
      const a = anns.find((x) => x.id === announcementId); if (!a) return { dismissed: false };
      const key = `${playerId}:${announcementId}`; const rev = Math.min(revision ?? a.revision, a.revision);
      dismissals.set(key, Math.max(rev, dismissals.get(key) ?? 0)); return { dismissed: true };
    },
    async listDismissed(playerId) { return new Map([...dismissals].filter(([k]) => k.startsWith(`${playerId}:`)).map(([k, rev]) => [k.split(':')[1], rev])); },
    async listAudit() { return { total: audit.length, pageSize: 25, items: audit.slice().reverse() }; },
  };
  return st;
}

module.exports = { createMemoryAdminStore };
