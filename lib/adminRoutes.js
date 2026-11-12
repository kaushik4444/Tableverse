'use strict';
/**
 * Admin console, announcements and feedback endpoints. Mounted by lib/authRoutes.js (option `extraRoutes`), so they share its
 * single choke point: every POST passes the CSRF check, every error is answered the same way, and the session is the same
 * HttpOnly cookie. Rules for every /api/admin/* route:
 *   1. the session decides who is asking (a player id in a request is only ever the TARGET of an action);
 *   2. the role is read from the database on every request, never from the cookie, the page or the request;
 *   3. state changes go through the store, which re-checks the role inside its transaction and writes the audit row.
 * Anonymous callers get 401, signed-in non-admins get 403, and nothing in the 403 answer says what exists.
 */
const policy = require('./adminPolicy');
const ann = require('./announcements');
const { recentLogs } = require('./log');
const broadcast = require('./broadcast');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'];
const LIVE_CACHE_MS = 15 * 1000; // a new or ended announcement reaches every instance within this time (0 in tests)

function createAdminRoutes({ env = process.env, store = null, analytics = null, platform = () => ({}), onSignedOut = () => {}, now = () => new Date(), idPattern = UUID, auth = null, emailSender = null, onBroadcastQueued = () => {}, makeUnsubscribeUrl = () => null, renderLogs = null, ctx }) {
  const { limit, requestIp, readSessionToken, sendJson, sendText, readJsonBody, sessionInfo, AuthError } = ctx;
  const { funnelCsv } = require('./funnelCsv');
  const num = (key, prod, test) => Number(env[key] || (env.NODE_ENV === 'test' ? test : prod));
  const RL = {
    ip: { scope: 'admin:api:ip', limit: num('RL_ADMIN_IP_LIMIT', 300, 5000), windowMs: 10 * MIN },
    staff: { scope: 'admin:api:player', limit: num('RL_ADMIN_PLAYER_LIMIT', 600, 5000), windowMs: 10 * MIN },
    announceIp: { scope: 'announce:ip', limit: num('RL_ANNOUNCE_IP_LIMIT', 240, 5000), windowMs: 10 * MIN },
    feedbackIp: { scope: 'feedback:ip', limit: num('RL_FEEDBACK_IP_LIMIT', 6, 500), windowMs: HOUR },
    feedbackPlayer: { scope: 'feedback:player', limit: num('RL_FEEDBACK_PLAYER_LIMIT', 10, 500), windowMs: 24 * HOUR },
    // per account, so one person cannot have the same verification mail sent over and over
    resendTarget: { scope: 'admin:verify-resend:target', limit: num('RL_ADMIN_RESEND_LIMIT', 3, 500), windowMs: HOUR },
    // broadcasts: a mistake is costly to the mailbox reputation, so the owner can queue only a few per day
    broadcast: { scope: 'admin:broadcast', limit: num('RL_BROADCAST_LIMIT', 20, 500), windowMs: 24 * HOUR },
    unsubscribeIp: { scope: 'email:unsubscribe:ip', limit: num('RL_UNSUBSCRIBE_IP_LIMIT', 60, 5000), windowMs: 10 * MIN },
  };

  const convert = (fn) => async (req, res) => {
    try { return await fn(req, res); } catch (err) {
      if (err && (err.name === 'PolicyError' || err.name === 'AnnouncementError' || err.name === 'BroadcastError')) throw new AuthError(err.message, err.status || 400);
      throw err;
    }
  };
  const needStore = () => { if (!store) throw new AuthError('The admin console needs the PostgreSQL database.', 503); };

  /** The signed-in account from the session cookie, or null. */
  async function optionalUser(req) {
    const token = readSessionToken(req);
    const info = token ? await sessionInfo(token) : null;
    return info && info.authenticated && info.player ? { id: info.player.id, token } : null;
  }
  async function requireUser(req) {
    await limit([{ ...RL.ip, key: requestIp(req) }]);
    const u = await optionalUser(req);
    if (!u) throw new AuthError('Please log in.', 401);
    return u;
  }
  /** Signed in AND currently an admin or the owner, according to the database. */
  async function requireStaff(req) {
    needStore();
    const u = await requireUser(req);
    if (store.claimOwnerIfConfigured) await store.claimOwnerIfConfigured(u.id, env); // server-side bootstrap only
    const role = await store.getRole(u.id);
    if (!policy.isStaff(role)) throw new AuthError('Admin access is required.', 403);
    await limit([{ ...RL.staff, key: u.id }]);
    return { ...u, role };
  }
  const query = (req) => new URL(req.url, 'http://x').searchParams;
  const idOf = (v) => { if (typeof v !== 'string' || !idPattern.test(v)) throw new AuthError('That id is not valid.', 400); return v.toLowerCase(); };

  // ---------------------------------------------------------------- live announcements (shared cache)
  const liveCacheMs = Number(env.ANNOUNCEMENT_CACHE_MS ?? (env.NODE_ENV === 'test' ? 0 : LIVE_CACHE_MS));
  let live = { at: -Infinity, rows: [], inflight: null };
  async function liveRows() {
    const t = now().getTime();
    if (t - live.at < liveCacheMs) return live.rows;
    if (!live.inflight) {
      live.inflight = store.listLiveAnnouncements().then((rows) => { live = { at: now().getTime(), rows, inflight: null }; return rows; }, (err) => { live.inflight = null; throw err; });
    }
    return live.inflight;
  }
  const dropLiveCache = () => { live = { at: -Infinity, rows: [], inflight: null }; };

  function shapeOverview(o) {
    const days = [];
    const end = now();
    for (let i = o.days - 1; i >= 0; i--) days.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10));
    const series = {};
    for (const row of o.series) (series[row.metric] || (series[row.metric] = new Map())).set(row.day, row.total);
    const out = {};
    for (const m of Object.keys(series)) out[m] = days.map((d) => series[m].get(d) || 0);
    const totals = {};
    for (const m of Object.keys(out)) totals[m] = out[m].reduce((a, b) => a + b, 0);
    const by = (metric) => o.dims.filter((d) => d.metric === metric).map((d) => ({ name: d.dim || '(none)', total: d.total }));
    // rows older than the retention window are deleted, so those days are unknown (null), never zero
    const keep = store.RETENTION.activeDays;
    const queues = o.queues || { reports7d: 0, reports_total: 0, feedback_new: 0 };
    const activeByDay = new Map((o.activeDaily || []).map((row) => [row.day, row.active]));
    const activeDaily = days.map((d, idx) => (o.days - 1 - idx > keep ? null : (activeByDay.get(d) || 0)));
    // the charts read these series; a metric with no rows in the range is all zeros, not missing
    for (const m of ['registration', 'session', 'game_finished', 'error']) if (!out[m]) out[m] = days.map(() => 0);
    return { days: o.days, labels: days, series: out, totals, activeDaily, queues, active: o.active, accounts: o.accounts, popularGames: by('game_finished'), startedGames: by('game_started'), errors: by('error'), retention: store.RETENTION || null };
  }

  const routes = {
    // ---- who am I (for the UI only: the server checks the role again on every admin call)
    'GET /api/admin/me': convert(async (req, res) => {
      needStore();
      const u = await requireUser(req);
      if (store.claimOwnerIfConfigured) await store.claimOwnerIfConfigured(u.id, env);
      const role = (await store.getRole(u.id)) || 'user';
      sendJson(res, 200, { ok: true, role, isAdmin: policy.isStaff(role), isOwner: role === 'owner' });
    }),

    'GET /api/admin/overview': convert(async (req, res) => {
      await requireStaff(req);
      sendJson(res, 200, { ok: true, ...shapeOverview(await store.overview({ days: query(req).get('days') })) });
    }),

    // Right now: figures held in this process only (no stored data). Counts only; no player is named.
    'GET /api/admin/live': convert(async (req, res) => {
      await requireStaff(req);
      const p = platform();
      sendJson(res, 200, { ok: true, at: new Date().toISOString(), players: p.playersConnected ?? null, tables: p.rooms ?? null, sockets: p.sockets ?? null });
    }),

    // Read-only usage figures from data the app already keeps (matches, counters). Staff only; no e-mail, address or token is selected.
    'GET /api/admin/insights': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.insights) throw new AuthError('Insights are not available.', 503);
      const out = await store.insights({ days: query(req).get('days'), tz: query(req).get('tz') || 'UTC' });
      const visits = store.sessionStats ? await store.sessionStats({ days: out.days, tz: out.zone }) : { zone: out.zone, byHour: Array(24).fill(0), length: [] };
      const byCountry = store.countryEngagement ? await store.countryEngagement({ days: out.days }) : { minPlayers: 10, rows: [] };
      const labels = [];
      const end = now();
      for (let i = out.days - 1; i >= 0; i--) labels.push(new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10));
      const byDay = new Map(out.returning.daily.map((r) => [r.day, r]));
      const newPerDay = labels.map((d) => (byDay.get(d) || {}).newPlayers || 0);
      const returningPerDay = labels.map((d) => (byDay.get(d) || {}).returningPlayers || 0);
      sendJson(res, 200, { ok: true, ...out, countryEngagement: byCountry, visits, labels, returning: { ...out.returning, daily: undefined, newPerDay, returningPerDay } });
    }),

    'GET /api/admin/health': convert(async (req, res) => {
      await requireStaff(req);
      let db = { ok: true };
      try { db = { ok: true, ...(await store.health()) }; } catch (err) { db = { ok: false, code: (err && err.code) || 'ERROR' }; }
      sendJson(res, 200, { ok: true, platform: platform(), db, analytics: analytics ? analytics.stats() : { enabled: false } });
    }),

    'GET /api/admin/users': convert(async (req, res) => {
      await requireStaff(req);
      const q = query(req);
      sendJson(res, 200, { ok: true, ...(await store.listUsers({ q: q.get('q') || '', page: q.get('page') })) });
    }),

    'POST /api/admin/users/sign-out': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const body = await readJsonBody(req);
      const targetId = idOf(body.playerId);
      const out = await store.signOutUser({ actorId: staff.id, targetId });
      onSignedOut({ playerId: targetId, token: null });
      sendJson(res, 200, { ok: true, revoked: out.revoked });
    }),

    'POST /api/admin/users/resend-verification': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (!auth || !emailSender) throw new AuthError('Email is not configured on this server.', 503);
      const body = await readJsonBody(req);
      const targetId = idOf(body.playerId);
      // authorize first: a refused request must not use up the quota that an allowed send needs
      // the address is read on the server; the browser only learns that a mail went out, never the address
      const { email } = await store.authorizeVerifyResend({ actorId: staff.id, targetId });
      await limit([{ ...RL.resendTarget, key: targetId }]);
      const out = await auth.resendVerification({ email });
      if (!out.verifyToken) throw new AuthError('This account has already verified its email.', 409);
      try {
        await emailSender.sendVerification({ email: out.email, token: out.verifyToken });
      } catch {
        throw new AuthError('The email could not be sent. Try again later.', 502);
      }
      sendJson(res, 200, { ok: true, sent: true });
    }),

    // Stage 20.7: owner-only e-mail broadcasts. The role is read on every request; the store checks it again inside its transaction.
    'GET /api/admin/broadcasts': convert(async (req, res) => {
      const staff = await requireStaff(req);
      policy.checkBroadcast({ actor: staff });
      sendJson(res, 200, { ok: true, ...(await store.listBroadcasts({ page: query(req).get('page') })) });
    }),

    'GET /api/admin/broadcasts/preview': convert(async (req, res) => {
      const staff = await requireStaff(req);
      policy.checkBroadcast({ actor: staff });
      const target = broadcast.validateTarget({ audience: query(req).get('audience'), category: query(req).get('category') });
      sendJson(res, 200, { ok: true, count: await store.broadcastCount(target) });
    }),

    'POST /api/admin/broadcasts': convert(async (req, res) => {
      const staff = await requireStaff(req);
      policy.checkBroadcast({ actor: staff });
      const body = await readJsonBody(req);
      const message = broadcast.validateCompose(body);
      if (message.category === 'promo' && !makeUnsubscribeUrl('check')) throw new AuthError('Promotional e-mail needs PUBLIC_APP_URL on the server, for the unsubscribe link.', 503);
      await limit([{ ...RL.broadcast, key: staff.id }]);
      const out = await store.queueBroadcast({ actorId: staff.id, ...message, expectedCount: body.expectedCount });
      onBroadcastQueued(); // starts sending now; the worker also picks it up on its timer if this instance is busy
      sendJson(res, 200, { ok: true, id: out.id, recipientCount: out.recipientCount });
    }),

    // Public one-click opt-out from promotional mail (linked from every promo message). Answers the same page for any token,
    // so the link cannot be used to find out which tokens exist.
    'GET /api/email/unsubscribe': convert(async (req, res) => {
      await limit([{ ...RL.unsubscribeIp, key: requestIp(req) }]);
      const token = query(req).get('token') || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) await store.unsubscribe(token.toLowerCase());
      const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribed · Tableverse</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;line-height:1.5;color:#111"><h1>You are unsubscribed</h1><p>You will no longer receive promotional e-mail from Tableverse. You will still receive account e-mail, such as verification and password reset messages.</p><p><a href="/">Back to Tableverse</a></p></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page);
    }),

    // Stage 20.8: read-only lookup for staff (no address, no network address, no token)
    'GET /api/admin/users/lookup': convert(async (req, res) => {
      await requireStaff(req);
      sendJson(res, 200, { ok: true, ...(await store.lookupUser({ username: query(req).get('username') || '' })) });
    }),

    // Player directory: registered accounts with their play figures (staff only, read-only; never an address or a token)
    // Chat report queue (read-only). Opening it is written to the audit log; no account e-mail or network address is shown.
    'GET /api/admin/reports': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (!store.listReports) throw new AuthError('The report queue is not available.', 503);
      sendJson(res, 200, { ok: true, ...(await store.listReports({ page: query(req).get('page'), actorId: staff.id })) });
    }),
    // Seat-order check (read-only): wins per seat against the share expected by chance
    'GET /api/admin/seat-balance': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.seatBalance) throw new AuthError('The seat check is not available.', 503);
      sendJson(res, 200, { ok: true, ...(await store.seatBalance({ days: query(req).get('days') })) });
    }),
    // Signup funnel (read-only): per signup day, accounts that signed up, played a first game, and came back on a later day
    'GET /api/admin/funnel': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.funnel) throw new AuthError('The funnel is not available.', 503);
      sendJson(res, 200, { ok: true, ...(await store.funnel({ days: query(req).get('days') })) });
    }),
    // The same figures as a CSV file. The download is written to the audit log.
    'GET /api/admin/funnel.csv': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (!store.funnel) throw new AuthError('The funnel is not available.', 503);
      const f = await store.funnel({ days: query(req).get('days'), actorId: staff.id, exporting: true });
      sendText(res, 200, 'text/csv; charset=utf-8', `signup-funnel-${f.days}-days.csv`, funnelCsv(f));
    }),
    'GET /api/admin/players': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.listPlayers) throw new AuthError('The player directory is not available.', 503);
      const q = query(req);
      sendJson(res, 200, { ok: true, ...(await store.listPlayers({ q: q.get('q') || '', sort: q.get('sort') || 'seen', page: q.get('page') })) });
    }),
    // One player's profile. Opening it is recorded in the audit log (who looked at whom, never what was seen).
    'GET /api/admin/players/profile': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (!store.playerProfile) throw new AuthError('The player directory is not available.', 503);
      const q = query(req);
      sendJson(res, 200, { ok: true, ...(await store.playerProfile({ username: q.get('username') || '', actorId: staff.id })) });
    }),

    // Owner only; the store re-checks the role inside its transaction. The live sockets of the account close at once.
    'POST /api/admin/users/suspend': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can suspend an account.', 403);
      const body = await readJsonBody(req);
      const targetId = idOf(body.playerId);
      const out = await store.suspendUser({ actorId: staff.id, targetId, reason: typeof body.reason === 'string' ? body.reason : '' });
      onSignedOut({ playerId: targetId, token: null });
      sendJson(res, 200, { ok: true, ...out });
    }),

    'POST /api/admin/users/unsuspend': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can lift a suspension.', 403);
      const body = await readJsonBody(req);
      const out = await store.unsuspendUser({ actorId: staff.id, targetId: idOf(body.playerId) });
      sendJson(res, 200, { ok: true, ...out });
    }),

    'POST /api/admin/roles': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const body = await readJsonBody(req);
      const out = await store.setRole({ actorId: staff.id, targetId: idOf(body.playerId), role: body.role });
      sendJson(res, 200, { ok: true, ...out });
    }),

    'GET /api/admin/feedback': convert(async (req, res) => {
      await requireStaff(req);
      const q = query(req);
      sendJson(res, 200, { ok: true, ...(await store.listFeedback({ status: q.get('status') || '', page: q.get('page') })) });
    }),

    'POST /api/admin/feedback/status': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const body = await readJsonBody(req);
      sendJson(res, 200, { ok: true, ...(await store.setFeedbackStatus({ actorId: staff.id, id: idOf(body.id), status: body.status })) });
    }),

    'GET /api/admin/announcements': convert(async (req, res) => {
      await requireStaff(req);
      const t = now();
      const items = (await store.listAnnouncements()).map((a) => ({ ...a, status: ann.statusOf(a, t) }));
      sendJson(res, 200, { ok: true, items, limits: { maxMessage: ann.MAX_MESSAGE, maxDays: ann.MAX_DURATION_DAYS } });
    }),

    'POST /api/admin/announcements': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const fields = ann.parseInput(await readJsonBody(req), now());
      const row = await store.createAnnouncement({ actorId: staff.id, fields });
      dropLiveCache();
      sendJson(res, 201, { ok: true, announcement: { ...row, status: ann.statusOf(row, now()) } });
    }),

    'POST /api/admin/announcements/update': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const body = await readJsonBody(req);
      const fields = ann.parseInput(body, now(), { partial: true });
      const row = await store.updateAnnouncement({ actorId: staff.id, id: idOf(body.id), fields });
      dropLiveCache();
      sendJson(res, 200, { ok: true, announcement: { ...row, status: ann.statusOf(row, now()) } });
    }),

    'POST /api/admin/announcements/end': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const body = await readJsonBody(req);
      await store.endAnnouncement({ actorId: staff.id, id: idOf(body.id) });
      dropLiveCache();
      sendJson(res, 200, { ok: true });
    }),

    // recent lines of this process (already redacted when they were written); the full history is in Render's log view
    'GET /api/admin/logs': convert(async (req, res) => {
      await requireStaff(req);
      const q = query(req);
      const out = recentLogs.list({ level: q.get('level') || '', component: q.get('component') || '', event: q.get('event') || '', limit: q.get('limit') || 100 });
      sendJson(res, 200, { ok: true, ...out });
    }),

    // Stage 20.8: Render's own history of this service, owner only (it can carry more than the in-app lines). Masked; 24 hours.
    'GET /api/admin/render-logs': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can read Render history.', 403);
      const q = query(req);
      const out = renderLogs ? await renderLogs.recent({ text: q.get('text') || '', limit: q.get('limit') || 100 }) : { configured: false, items: [] };
      sendJson(res, 200, { ok: true, ...out });
    }),

    'GET /api/admin/audit': convert(async (req, res) => {
      await requireStaff(req);
      sendJson(res, 200, { ok: true, ...(await store.listAudit({ page: query(req).get('page') })) });
    }),

    // ---- public: what banners this viewer should see (the server decides audience, schedule and expiry)
    'GET /api/announcements': convert(async (req, res) => {
      await limit([{ ...RL.announceIp, key: requestIp(req) }]);
      if (!store) return sendJson(res, 200, { ok: true, announcements: [] });
      const u = await optionalUser(req);
      let isAdmin = false;
      let dismissed = new Map();
      if (u) {
        isAdmin = policy.isStaff(await store.getRole(u.id));
        dismissed = await store.listDismissed(u.id);
      }
      const list = ann.forViewer(await liveRows(), { signedIn: Boolean(u), isAdmin }, now(), dismissed);
      sendJson(res, 200, { ok: true, announcements: list, signedIn: Boolean(u) });
    }),

    // a signed-in dismissal is stored on the account, so it holds on every device; guests remember it in their own browser.
    // `revision` is the revision the player saw (the one the page was showing); without it the current revision is used.
    'POST /api/announcements/dismiss': convert(async (req, res) => {
      needStore();
      const u = await requireUser(req);
      const body = await readJsonBody(req);
      const revision = body.revision === undefined || body.revision === null ? null : Number(body.revision);
      if (revision !== null && !(Number.isInteger(revision) && revision >= 1 && revision <= 2147483647)) throw new ann.AnnouncementError('That banner revision is not valid.', 400);
      sendJson(res, 200, { ok: true, ...(await store.dismissAnnouncement({ playerId: u.id, announcementId: idOf(body.id), revision })) });
    }),

    'POST /api/feedback': convert(async (req, res) => {
      needStore();
      await limit([{ ...RL.feedbackIp, key: requestIp(req) }]);
      const u = await optionalUser(req);
      if (u) await limit([{ ...RL.feedbackPlayer, key: u.id }]);
      const body = await readJsonBody(req);
      const category = FEEDBACK_CATEGORIES.includes(body.category) ? body.category : 'other';
      const message = ann.cleanMessage(typeof body.message === 'string' ? body.message.slice(0, 4000) : '');
      if (!message) throw new AuthError('Write a few words of feedback.', 400);
      if (message.length > 1000) throw new AuthError('Please keep feedback to 1000 characters.', 400);
      await store.createFeedback({ playerId: u ? u.id : null, category, message });
      if (analytics) analytics.track('feedback', category);
      sendJson(res, 201, { ok: true, message: 'Thank you! Your feedback was sent.' });
    }),
  };
  return { routes, dropLiveCache };
}

module.exports = { createAdminRoutes, UUID };
