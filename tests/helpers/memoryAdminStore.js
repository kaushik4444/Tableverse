'use strict';
/**
 * An in-memory stand-in for db/admin.js, used by the DB-free tests. It applies the SAME policy modules (lib/adminPolicy.js and
 * lib/announcements.js) the PostgreSQL store uses; the SQL itself is covered by tests/admin.pg.test.js.
 */
const crypto = require('node:crypto');
const policy = require('../../lib/adminPolicy');
const ann = require('../../lib/announcements');
const { INACTIVE_DAYS, BroadcastError } = require('../../lib/broadcast');

function createMemoryAdminStore({ now = () => new Date(), env = {} } = {}) {
  const players = new Map(); // id -> { id, username, display_name, role, email, verified, created_at }
  const audit = [];
  const feedback = [];
  const anns = [];
  const dismissals = new Map(); // `${playerId}:${annId}` -> the revision dismissed
  const signedOut = [];
  const broadcasts = [];
  const broadcastAttempts = new Map(); // `${broadcastId}|${playerId}` -> ms of the first attempt
  const broadcastRecipients = new Map(); // broadcast id -> Map(player id -> pending | sent | failed | skipped)
  const INACTIVE_MS = INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const inAudience = (p, audience) => {
    switch (audience) {
      case 'all': return true;
      case 'verified': return !!p.verified;
      case 'unverified': return !p.verified;
      case 'admins': return p.role === 'admin' || p.role === 'owner';
      case 'players': return p.role === 'user';
      case 'inactive': return now() - new Date(p.last_seen_at ?? now()) > INACTIVE_MS;
      default: return false;
    }
  };
  const recipientsOf = ({ audience, category }) => [...players.values()].filter((p) => p.email && !p.is_anonymous && inAudience(p, audience)
    && (category !== 'promo' || (p.verified && !p.opted_out)));
  let failNext = null;
  const log = (actorId, action, targetType, targetId, detail = {}) => audit.push({ id: crypto.randomUUID(), at: now(), actor: players.get(actorId)?.username || null, action, target_type: targetType, target_id: targetId, detail });
  const st = {
    players, audit, feedback, anns, dismissals, signedOut, broadcasts, broadcastRecipients, broadcastAttempts,
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
      if (players.get(targetId).suspended_at) throw new policy.PolicyError('Lift the suspension before changing this account\'s role.', 409);
      const from = players.get(targetId).role;
      players.get(targetId).role = role;
      log(actorId, role === 'admin' ? 'role.grant_admin' : 'role.revoke_admin', 'player', targetId, { from, to: role });
      return { changed: true, role };
    },
    async listUsers({ q = '' } = {}) { const u = [...players.values()].filter((p) => !q || p.username.includes(q)); return { total: u.length, pageSize: 25, users: u.map(({ email, ...rest }) => rest) }; },
    async suspendUser({ actorId, targetId, reason = '' }) {
      policy.checkSuspend({ actor: players.get(actorId), target: players.get(targetId) });
      const t = players.get(targetId);
      const why = String(reason || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
      Object.assign(t, { suspended_at: now(), suspended_reason: why });
      signedOut.push(targetId);
      log(actorId, 'user.suspend', 'player', targetId, { reason: why });
      return { suspended: true, sessions: 1 };
    },
    async unsuspendUser({ actorId, targetId }) {
      policy.checkSuspend({ actor: players.get(actorId), target: players.get(targetId) });
      Object.assign(players.get(targetId), { suspended_at: null, suspended_reason: null });
      log(actorId, 'user.unsuspend', 'player', targetId);
      return { suspended: false };
    },
    async lookupUser({ username }) {
      const u = String(username || '').trim().toLowerCase();
      const p = [...players.values()].find((x) => x.username === u && !x.is_anonymous);
      if (!p) return { user: null };
      return { user: { id: p.id, username: p.username, display_name: p.display_name, role: p.role, verified: !!p.verified, suspended_at: p.suspended_at ?? null, suspended_reason: p.suspended_reason ?? null, active_sessions: 0 } };
    },
    async signOutUser({ actorId, targetId }) { policy.checkSignOut({ actor: players.get(actorId), target: players.get(targetId) }); signedOut.push(targetId); log(actorId, 'user.sign_out', 'player', targetId); return { revoked: 1 }; },
    async authorizeVerifyResend({ actorId, targetId }) {
      const t = players.get(targetId);
      policy.checkManageUser({ actor: players.get(actorId), target: t });
      if (!t || !t.email || t.verified) throw new policy.PolicyError('This account has no unverified email address.', 409);
      log(actorId, 'user.verify_resend', 'player', targetId);
      return { email: t.email };
    },
    async overview({ days = 30 } = {}) { return { days, series: [], dims: [], active: { dau: 0, wau: 0, mau: 0 }, accounts: { registered: players.size, registered_24h: 0, staff: 0 } }; },
    // the real SQL is in db/insights.js (tests/admin.pg.test.js); this records what the route asked for and returns a fixed answer
    async insights({ days = 30, tz = 'UTC' } = {}) {
      this.insightsCalls.push({ days, tz });
      return { days: [7, 30, 90].includes(Number(days)) ? Number(days) : 30, zone: tz, games: [], heat: [], countries: [{ country: 'DE', players: 2 }, { country: null, players: 1 }], playtime: { players: 0, totalMinutes: 0, avgMinutes: 0, medianMinutes: 0, buckets: [0, 0, 0, 0, 0] },
        returning: { activePlayers: 0, newPlayers: 2, returningPlayers: 1, daily: [{ day: '2026-11-08', newPlayers: 2, returningPlayers: 1 }], cohort: { size: 0, d1: 0, d7: 0 } }, top: [] };
    },
    // the real SQL is in db/playerStats.js (tests/admin.pg.test.js); these record the request and return fixed answers
    async listPlayers(opts = {}) {
      this.playerCalls.push(opts);
      return { total: 1, pageSize: 25, sort: opts.sort || 'seen', players: [{ username: 'ann', displayName: 'Ann', country: 'DE', role: 'user', joinedAt: '2026-11-01T10:00:00Z', lastSeenAt: '2026-11-08T09:00:00Z', suspended: false, games: 14, rated: 11, wins: 6, draws: 1, leftEarly: 2, minutes: 130, lastGameAt: '2026-11-08T08:00:00Z' }] };
    },
    async playerProfile({ username, actorId }) {
      const p = [...players.values()].find((x) => x.username === String(username || '').toLowerCase() && !x.is_anonymous);
      if (!p) return { player: null };
      log(actorId, 'player.view', 'player', p.id);
      return { player: { username: p.username, displayName: p.display_name, country: null, role: p.role, verified: true, joinedAt: '2026-11-01T10:00:00Z', lastSeenAt: null, suspended: false },
        totals: { games: 14, rated: 11, wins: 6, draws: 1, losses: 4, leftEarly: 2, minutes: 130, activeDays: 5, firstGameAt: '2026-11-02T10:00:00Z', lastGameAt: '2026-11-08T08:00:00Z' },
        perGame: [{ gameId: 'ludo', games: 10, rated: 7, wins: 4, draws: 0, leftEarly: 2, minutes: 120 }], hourly: { 'UTC': Array.from({ length: 24 }, (_, h) => (h === 19 ? 9 : 0)), 'Europe/Berlin': Array.from({ length: 24 }, (_, h) => (h === 20 ? 9 : 0)), 'Asia/Kolkata': Array.from({ length: 24 }, (_, h) => (h === 0 ? 9 : 0)) },
        recent: [{ gameId: 'ludo', at: '2026-11-08T08:00:00Z', seats: 4, won: true, draw: false, leftEarly: false, unknown: false, minutes: 22 },
          { gameId: 'ludo', at: '2026-11-07T08:00:00Z', seats: 4, won: false, draw: false, leftEarly: false, unknown: true, minutes: 18 }] };
    },
    playerCalls: [],
    reportCalls: [],
    // the real SQL is in db/reportQueue.js (tests/admin.pg.test.js); this records the request and returns a fixed answer
    funnelCalls: [],
    async funnel(opts = {}) {
      this.funnelCalls.push(opts);
      const daily = [{ day: '2026-11-07', signups: 4, played: 3, returned: 1 }, { day: '2026-11-08', signups: 2, played: 2, returned: 0 }];
      return { days: 30, totals: { signups: 6, played: 5, returned: 1 }, daily };
    },
    async listReports(opts = {}) {
      this.reportCalls.push(opts);
      return { total: 1, pageSize: 25, recentDays: 30, items: [{ id: 'r1', reason: 'threats', severity: 'high', details: '', message: 'hello', room: 'ABCD', createdAt: '2026-11-08T08:00:00Z', reporter: 'ann', reported: 'bob', reportedSuspended: false, reportedTotal: 2, reportedRecent: 1 }] };
    },
    async countryEngagement() { return { minPlayers: 10, rows: [{ country: 'DE', players: 12, gamesPerPlayer: 4.5, minutesPerPlayer: 38.2, leftEarlyPct: 8, daysPerPlayer: 2.1 }] }; },
    async sessionStats({ days, tz }) { this.sessionCalls.push({ days, tz }); return { zone: tz, byHour: Array.from({ length: 24 }, (_, h) => (h === 19 ? 30 : h === 20 ? 22 : 1)), length: [{ name: 'under 1 min', total: 5 }, { name: '1–5 min', total: 9 }, { name: '5–15 min', total: 7 }, { name: '15–60 min', total: 4 }, { name: 'over 1 h', total: 1 }] }; },
    sessionCalls: [],
    insightsCalls: [],
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
    // ---- owner e-mail broadcasts (Stage 20.7): same rules as db/broadcast.js and lib/broadcast.js
    async broadcastCount({ audience, category }) { return recipientsOf({ audience, category }).length; },
    async queueBroadcast({ actorId, audience, category, subject, body, expectedCount }) {
      policy.checkBroadcast({ actor: players.get(actorId) });
      const ids = recipientsOf({ audience, category }).map((p) => p.id);
      if (ids.length !== Number(expectedCount)) throw new BroadcastError(`The list now has ${ids.length} recipients, not ${expectedCount}. Check the count again before sending.`, 409);
      if (!ids.length) throw new BroadcastError('No one matches this audience yet.', 409);
      const id = crypto.randomUUID();
      broadcasts.push({ id, created_by: actorId, created_at: now(), audience, category, subject, body, status: 'queued', recipient_count: ids.length, sent_count: 0, failed_count: 0, finished_at: null });
      broadcastRecipients.set(id, new Map(ids.map((pid) => [pid, 'pending'])));
      log(actorId, 'broadcast.queue', 'broadcast', id, { audience, category, recipients: ids.length });
      return { id, recipientCount: ids.length };
    },
    async listBroadcasts({ page: p = 1 } = {}) {
      // as in the database: a finished broadcast shows its saved totals; a running one counts its recipients as they are now
      const live = (id) => [...(broadcastRecipients.get(id) || new Map()).values()];
      const items = broadcasts.slice().reverse().map(({ body, ...rest }) => {
        const counts = rest.status === 'sent' ? {} : { sent_count: live(rest.id).filter((s) => s === 'sent').length, failed_count: live(rest.id).filter((s) => s === 'failed').length };
        return { ...rest, ...counts, created_by: players.get(rest.created_by)?.username || null };
      });
      return { total: items.length, pageSize: 25, items: items.slice((Math.max(1, Number(p) || 1) - 1) * 25, Math.max(1, Number(p) || 1) * 25) };
    },
    async claimNext() {
      const now = Date.now();
      // a run silent for a day is closed, never resumed (see db/broadcast.js closeAbandoned)
      for (const b of broadcasts) {
        if (b.status === 'sending' && b.renewedAt && now - b.renewedAt > 24 * 3600 * 1000) {
          const m = broadcastRecipients.get(b.id) || new Map();
          for (const [pid, s] of m) if (s === 'pending') m.set(pid, 'failed');
          const vals = [...m.values()];
          Object.assign(b, { status: 'sent', finished_at: now, leaseUntil: null, leaseOwner: null, sent_count: vals.filter((s) => s === 'sent').length, failed_count: vals.filter((s) => s === 'failed').length });
        }
      }
      const b = broadcasts.find((x) => x.status === 'queued' || (x.status === 'sending' && (!x.leaseUntil || x.leaseUntil < now)));
      if (!b) return null;
      b.status = 'sending';
      b.leaseUntil = now + 5 * 60 * 1000;
      b.leaseOwner = crypto.randomUUID();
      b.renewedAt = now;
      return { id: b.id, category: b.category, subject: b.subject, body: b.body, owner: b.leaseOwner };
    },
    async renewLease(id, owner) {
      const b = broadcasts.find((x) => x.id === id);
      if (!b || b.status !== 'sending' || b.leaseOwner !== owner) return false;
      b.leaseUntil = Date.now() + 5 * 60 * 1000;
      b.renewedAt = Date.now();
      return true;
    },
    async pendingBatch(id, n) {
      const out = [];
      const b = broadcasts.find((x) => x.id === id);
      for (const [pid, state] of broadcastRecipients.get(id) || []) {
        if (state !== 'pending' || out.length >= n) continue;
        const p = players.get(pid);
        p.unsubscribe_token ??= crypto.randomUUID();
        const verified = !!p.verified;
        const skip = !p.email || (b.category === 'promo' && (!verified || !!p.opted_out));
        out.push({ player_id: pid, email: p.email || null, unsubscribe_token: p.unsubscribe_token, skip });
      }
      return out;
    },
    async currentRecipient(id, pid) {
      const b = broadcasts.find((x) => x.id === id);
      const p = players.get(pid);
      if (!b || !p || !broadcastRecipients.get(id)?.has(pid)) return null;
      p.unsubscribe_token ??= crypto.randomUUID();
      const verified = !!p.verified;
      const skip = !p.email || (b.category === 'promo' && (!verified || !!p.opted_out));
      const attempted = broadcastAttempts.get(`${id}|${pid}`);
      return { player_id: pid, email: p.email || null, unsubscribe_token: p.unsubscribe_token, skip, attempted_at: attempted ? new Date(attempted) : null };
    },
    async markAttempt(id, pid, owner) {
      const b = broadcasts.find((x) => x.id === id);
      if (!b || b.status !== 'sending' || b.leaseOwner !== owner) {
        const err = new Error('the broadcast was taken over by another run'); err.code = 'LEASE_LOST'; throw err;
      }
      const key = `${id}|${pid}`;
      if (!broadcastAttempts.has(key)) broadcastAttempts.set(key, Date.now());
    },
    async markRecipient(id, pid, state, owner) {
      const b = broadcasts.find((x) => x.id === id);
      if (!b || b.status !== 'sending' || b.leaseOwner !== owner) {
        const err = new Error('the broadcast was taken over by another run'); err.code = 'LEASE_LOST'; throw err;
      }
      broadcastRecipients.get(id)?.set(pid, state);
    },
    async finishBroadcast(id, owner) {
      const b = broadcasts.find((x) => x.id === id);
      if (b.status !== 'sending' || b.leaseOwner !== owner) return;
      const m = [...(broadcastRecipients.get(id) || new Map()).values()];
      Object.assign(b, { status: 'sent', finished_at: now(), sent_count: m.filter((s) => s === 'sent').length, failed_count: m.filter((s) => s === 'failed').length });
    },
    async unsubscribe(token) {
      const p = [...players.values()].find((x) => x.unsubscribe_token === token);
      if (!p) return false;
      p.opted_out = true;
      return true;
    },
    async listAudit() { return { total: audit.length, pageSize: 25, items: audit.slice().reverse() }; },
  };
  return st;
}

module.exports = { createMemoryAdminStore };
