'use strict';
const guestFeatures = require('./guestFeatures'); // what guests may do (owner switches)
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
const games = require('../games');
const gameFlags = require('./gameFlags');
const gameAccess = require('../public/game-access');
const { recentLogs } = require('./log');
const broadcast = require('./broadcast');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const { UUID, validHistoryCursor } = require('./historyCursor');
const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'];
const LIVE_CACHE_MS = 15 * 1000; // a new or ended announcement reaches every instance within this time (0 in tests)

/** Runs one player's role change after the previous one for that player, so notifications leave in the order the changes were saved. */
const roleQueues = new Map();
function queueRoleChange(playerId, work) {
  const prev = roleQueues.get(playerId) || Promise.resolve();
  const run = prev.then(work);
  const tail = run.catch(() => {});
  roleQueues.set(playerId, tail);
  tail.then(() => { if (roleQueues.get(playerId) === tail) roleQueues.delete(playerId); });
  return run;
}

function createAdminRoutes({ env = process.env, store = null, analytics = null, platform = () => ({}), onSignedOut = () => {}, onAccountDeleted = () => {}, onRoleChanged = () => {}, now = () => new Date(), idPattern = UUID, auth = null, emailSender = null, onBroadcastQueued = () => {}, makeUnsubscribeUrl = () => null, renderLogs = null, renderDeploy = null, ctx }) {
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
    const queues = o.queues || { reports7d: 0, reports_total: 0, feedback_new: 0, forfeits7d: 0, forfeits_total: 0 };
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
      // gameNames: the names players see, so the tables show "Take 5" and not the internal id
      sendJson(res, 200, { ok: true, role, isAdmin: policy.isStaff(role), isOwner: role === 'owner', gameNames: Object.fromEntries(games.list().map((g) => [g.id, g.name])) });
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
      sendJson(res, 200, { ok: true, ...(await store.listUsers({ q: q.get('q') || '', page: q.get('page'), staleDays: q.get('stale'), sort: q.get('sort') || '', dir: q.get('dir') || '' })) });
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
    // Game by game over a range: counts and averages only, no player is named.
    'GET /api/admin/games': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.gameStats) throw new AuthError('Game statistics are not available.', 503);
      sendJson(res, 200, { ok: true, ...(await store.gameStats({ days: query(req).get('days') })) });
    }),
    // Tables hosted, newest first, a page at a time (no player is named). The cursor comes from the previous page.
    'GET /api/admin/matches': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.matchHistory) throw new AuthError('Table history is not available.', 503);
      const before = query(req).get('before');
      if (before !== null && !validHistoryCursor(before)) throw new AuthError('That page is not valid. Reload the list.', 400);
      sendJson(res, 200, { ok: true, ...(await store.matchHistory({ before, limit: query(req).get('limit') })) });
    }),
    // game switches: staff can read them; only the owner can change them (lib/gameFlags.js)
    'GET /api/admin/game-flags': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.listGameFlags) throw new AuthError('Game switches are not available.', 503);
      const rowsNow = await store.listGameFlags();
      const byId = new Map(rowsNow.map((r) => [r.game_id, r]));
      const placed = new Map(rowsNow.filter((r) => Number.isInteger(r.sort_order) && games.get(r.game_id)).map((r) => [r.game_id, r.sort_order]));
      sendJson(res, 200, {
        ok: true,
        modes: gameAccess.MODES,
        labels: gameAccess.LABELS,
        games: gameFlags.sortByPosition(games.list(), placed).map((g) => {
          const row = byId.get(g.id);
          // The stored mode, not this process's cache. A game with no row is 'on'.
          const access = row ? (gameAccess.MODES.includes(row.access) ? row.access : (row.enabled === false ? 'owner' : 'on')) : 'on';
          return {
            id: g.id, name: g.name, icon: g.icon,
            access,
            enabled: access === 'on',
            // guest plays per game (1 to 9), or null for no limit: lib/guestPolicy.js explains how guests are limited
            trialLimit: row && Number.isInteger(row.guest_trial_limit) ? row.guest_trial_limit : null,
            // Beta: an experimental game, shown with a Beta tag to everybody (it changes nothing about who may play)
            beta: !!row && row.beta === true,
            updatedAt: row ? new Date(row.updated_at).toISOString() : null,
          };
        }),
      });
    }),
    // The order of the games in the home menu: staff (owner and admins) set the full list, first to last.
    'POST /api/admin/game-order': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (!store.setGameOrder || !store.listGameFlags) throw new AuthError('Game order is not available.', 503);
      const body = await readJsonBody(req);
      const known = games.list().map((g) => g.id);
      const order = body.order;
      if (!Array.isArray(order) || order.length !== known.length || new Set(order).size !== order.length || !order.every((id) => known.includes(id))) {
        throw new AuthError('The order must list every game exactly once.', 400);
      }
      await store.setGameOrder({ actorId: staff.id, order });
      gameFlags.setOrder(order); // this process shows the new order at once, before the re-read
      try {
        const token = gameFlags.begin();
        gameFlags.apply(await store.listGameFlags(), token);
      } catch (e) {
        console.error('[games] order re-read failed: ' + e.message); // the order is saved; the next periodic read picks it up
      }
      sendJson(res, 200, { ok: true, order });
    }),
    // The guest play limit of one game: owner only. null removes it; otherwise 1 to 9 plays per guest device.
    'POST /api/admin/game-trials': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can limit guest plays.', 403);
      if (!store.setGameTrialLimit) throw new AuthError('Guest play limits are not available.', 503);
      const body = await readJsonBody(req);
      if (!games.get(body.gameId)) throw new AuthError('That game does not exist.', 400);
      const limit = body.limit === null ? null : body.limit;
      if (limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= 9)) throw new AuthError('Choose a limit from 1 to 9, or none.', 400);
      await store.setGameTrialLimit({ actorId: staff.id, gameId: body.gameId, limit });
      gameFlags.setTrialLimit(body.gameId, limit); // this process applies it at once, before the re-read
      try {
        const token = gameFlags.begin();
        gameFlags.apply(await store.listGameFlags(), token);
      } catch (e) {
        console.error('[games] trial limit re-read failed: ' + e.message); // saved; the next periodic read picks it up
      }
      sendJson(res, 200, { ok: true, gameId: body.gameId, limit });
    }),
    // Beta mark of one game: owner only. The tag shows on the home menu; who may play is unchanged.
    'POST /api/admin/game-beta': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can mark a game as beta.', 403);
      if (!store.setGameBeta || !store.listGameFlags) throw new AuthError('Beta marks are not available.', 503);
      const body = await readJsonBody(req);
      if (!games.get(body.gameId)) throw new AuthError('That game does not exist.', 400);
      if (typeof body.beta !== 'boolean') throw new AuthError('Choose beta on or off.', 400);
      await store.setGameBeta({ actorId: staff.id, gameId: body.gameId, beta: body.beta });
      gameFlags.setBeta(body.gameId, body.beta); // this process shows it at once, before the re-read
      try {
        const token = gameFlags.begin();
        gameFlags.apply(await store.listGameFlags(), token);
      } catch (e) {
        console.error('[games] beta re-read failed: ' + e.message); // saved; the next periodic read picks it up
      }
      sendJson(res, 200, { ok: true, gameId: body.gameId, beta: body.beta });
    }),
    'POST /api/admin/game-flags': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can switch games on or off.', 403);
      if (!store.setGameFlag || !store.listGameFlags) throw new AuthError('Game switches are not available.', 503);
      const body = await readJsonBody(req);
      if (!games.get(body.gameId)) throw new AuthError('That game does not exist.', 400);
      // The access mode: on | admins | guests | owner (public/game-access.js). The older {enabled: true|false} still works: true = on, false = owner only.
      let access = body.access;
      if (access === undefined && typeof body.enabled === 'boolean') access = body.enabled ? 'on' : 'owner';
      if (!gameAccess.MODES.includes(access)) throw new AuthError('Choose who may play the game: on, admins, guests or owner.', 400);
      await store.setGameFlag({ actorId: staff.id, gameId: body.gameId, access });
      gameFlags.setOne(body.gameId, access); // this process sees the change at once, before the re-read
      try {
        const token = gameFlags.begin();
        gameFlags.apply(await store.listGameFlags(), token);
      } catch (e) {
        console.error('[games] switches re-read failed: ' + e.message); // the change is saved; the next periodic read picks it up
      }
      sendJson(res, 200, { ok: true, gameId: body.gameId, access });
    }),
    'GET /api/admin/players': convert(async (req, res) => {
      await requireStaff(req);
      if (!store.listPlayers) throw new AuthError('The player directory is not available.', 503);
      const q = query(req);
      sendJson(res, 200, { ok: true, ...(await store.listPlayers({ q: q.get('q') || '', sort: q.get('sort') || 'seen', dir: q.get('dir') || '', page: q.get('page') })) });
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

    // Owner only, with the username typed as confirmation. Irreversible; the live sockets close and the player is forgotten on this server.
    'POST /api/admin/users/delete': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can delete an account.', 403);
      const body = await readJsonBody(req);
      const targetId = idOf(body.playerId);
      const out = await store.deleteUser({ actorId: staff.id, targetId, confirm: typeof body.confirm === 'string' ? body.confirm : '' });
      onAccountDeleted({ playerId: targetId });
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
      const targetId = idOf(body.playerId);
      const out = await queueRoleChange(targetId, async () => {
        const result = await store.setRole({ actorId: staff.id, targetId, role: body.role });
        // a live session takes the stored role at once (see server.js onRoleChanged), so a demoted staff member loses restricted games now.
        // If the stored role cannot be read back, the live session drops to the least privilege (fail closed) and reconnecting reads the stored role.
        let liveRole = 'user';
        let unverified = false;
        try { liveRole = (await store.getRole(targetId)) || 'user'; } catch (e) { unverified = true; console.error('[admin] could not re-read the role: ' + e.message); }
        onRoleChanged({ playerId: targetId, role: liveRole, unverified });
        return result;
      });
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
    // What guests may do (lib/guestFeatures.js). Staff can read and change these; the server enforces them on every request.
    'GET /api/admin/guest-features': convert(async (req, res) => {
      await requireStaff(req);
      const rows = store.listGuestFeatures ? await store.listGuestFeatures() : [];
      const byKey = new Map(rows.map((r) => [r.feature, r]));
      sendJson(res, 200, {
        ok: true,
        features: guestFeatures.FEATURES.map((f) => ({ key: f.key, label: f.label, hint: f.hint, enabled: byKey.get(f.key)?.enabled === true, updatedAt: byKey.get(f.key)?.updated_at || null })),
      });
    }),
    'POST /api/admin/guest-features': convert(async (req, res) => {
      const staff = await requireStaff(req);
      const body = await readJsonBody(req);
      if (!guestFeatures.FEATURES.some((f) => f.key === body.feature)) throw new AuthError('That guest feature does not exist.', 400);
      if (typeof body.enabled !== 'boolean') throw new AuthError('Say whether guests may use it (true or false).', 400);
      if (!store.setGuestFeature || !store.listGuestFeatures) throw new AuthError('Guest switches are not available.', 503);
      await store.setGuestFeature({ actorId: staff.id, feature: body.feature, enabled: body.enabled });
      guestFeatures.setOne(body.feature, body.enabled); // this process at once; the stored state is read back below
      // the read token is issued before the read starts, so an older read can never be applied over a newer one
      const token = guestFeatures.begin();
      try { guestFeatures.apply(await store.listGuestFeatures(), token); } catch (e) { console.error('[admin] guest feature re-read failed (the change is saved): ' + e.message); }
      sendJson(res, 200, { ok: true, feature: body.feature, enabled: body.enabled });
    }),

    // The owner's redeploy of this app on Render (lib/renderDeploy.js). Owner only, and a typed word stops a stray click.
    'POST /api/admin/render/redeploy': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can redeploy the app.', 403);
      const body = await readJsonBody(req);
      if (body.confirm !== 'REDEPLOY') throw new AuthError('Type REDEPLOY to confirm.', 400);
      const out = renderDeploy ? await renderDeploy.redeploy() : { ok: false, status: 503, error: 'Redeploy is not set up on this server.' };
      // a cooldown refusal is not a request, so it is not audited (docs/OPERATIONS_RUNBOOK.md)
      if (store && store.recordAudit && out.status !== 429) {
        await store.recordAudit({ actorId: staff.id, action: 'render.redeploy', targetType: 'service', detail: { ok: out.ok, status: out.ok ? 202 : out.status } })
          .catch((e) => console.error('[admin] could not record the redeploy: ' + e.message));
      }
      if (!out.ok) return sendJson(res, out.status || 502, { ok: false, error: out.error, ...(out.retryAfterMs ? { retryAfterMs: out.retryAfterMs } : {}) });
      sendJson(res, 202, { ok: true, message: 'Redeploy requested. The app restarts in a few minutes, and connected players reconnect.' });
    }),

    'GET /api/admin/render-logs': convert(async (req, res) => {
      const staff = await requireStaff(req);
      if (staff.role !== 'owner') throw new AuthError('Only the owner can read Render history.', 403);
      const q = query(req);
      const out = renderLogs ? await renderLogs.recent({ text: q.get('text') || '', limit: q.get('limit') || 100 }) : { configured: false, items: [] };
      // the redeploy has its own settings (no owner id): the page enables the button from this flag
      sendJson(res, 200, { ok: true, ...out, redeployReady: Boolean(renderDeploy && renderDeploy.configured) });
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
