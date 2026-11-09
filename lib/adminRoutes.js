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

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'];
const LIVE_CACHE_MS = 15 * 1000; // a new or ended announcement reaches every instance within this time (0 in tests)

function createAdminRoutes({ env = process.env, store = null, analytics = null, platform = () => ({}), onSignedOut = () => {}, now = () => new Date(), idPattern = UUID, ctx }) {
  const { limit, requestIp, readSessionToken, sendJson, readJsonBody, sessionInfo, AuthError } = ctx;
  const num = (key, prod, test) => Number(env[key] || (env.NODE_ENV === 'test' ? test : prod));
  const RL = {
    ip: { scope: 'admin:api:ip', limit: num('RL_ADMIN_IP_LIMIT', 300, 5000), windowMs: 10 * MIN },
    staff: { scope: 'admin:api:player', limit: num('RL_ADMIN_PLAYER_LIMIT', 600, 5000), windowMs: 10 * MIN },
    announceIp: { scope: 'announce:ip', limit: num('RL_ANNOUNCE_IP_LIMIT', 240, 5000), windowMs: 10 * MIN },
    feedbackIp: { scope: 'feedback:ip', limit: num('RL_FEEDBACK_IP_LIMIT', 6, 500), windowMs: HOUR },
    feedbackPlayer: { scope: 'feedback:player', limit: num('RL_FEEDBACK_PLAYER_LIMIT', 10, 500), windowMs: 24 * HOUR },
  };

  const convert = (fn) => async (req, res) => {
    try { return await fn(req, res); } catch (err) {
      if (err && (err.name === 'PolicyError' || err.name === 'AnnouncementError')) throw new AuthError(err.message, err.status || 400);
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
    return { days: o.days, labels: days, series: out, totals, active: o.active, accounts: o.accounts, popularGames: by('game_finished'), startedGames: by('game_started'), errors: by('error'), retention: store.RETENTION || null };
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
      if (revision !== null && !(Number.isInteger(revision) && revision >= 1)) throw new ann.AnnouncementError('That banner revision is not valid.', 400);
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
