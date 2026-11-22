'use strict';
/**
 * Signed-in account endpoints (/api/me/...) and the public profile (/api/players/:username).
 * Built on the helpers of lib/authRoutes.js: the same cookie session, CSRF check and rate limiter.
 *
 *  - Who you are always comes from the session cookie, never from a player id in the request.
 *  - /api/players/:username returns only username, display name, avatar, join date and win totals.
 */
const dbAuth = require('../db/auth');
const { isTestMode } = require('./debugTokens');
const dbAccount = require('../db/account');
const dbMatches = require('../db/matches');
const dbRatings = require('../db/ratings');
const { monthKey } = require('./ratings');

const { AuthError } = dbAuth;
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

// a Google sign-in used to confirm a deletion must be this recent (a replayed earlier token is refused)
const DELETE_CONFIRM_MAX_AGE_S = 300;

function createAccountRoutes({ env, debugTokens, ctx, avatars = [], onProfileChanged = () => {}, onAccountDeleted = () => {}, tableStatus = () => null, verifyGoogle = null }) {
  const { limit, requestIp, readSessionToken, sendJson, readJsonBody, addCookie, clearedSessionCookie } = ctx;
  const rate = (prod, test, key) => Number(env[key] || (isTestMode(env) ? test : prod));
  const RL = {
    api: { scope: 'me:api:ip', limit: rate(240, 5000, 'RL_ME_IP_LIMIT'), windowMs: 10 * MIN },
    name: { scope: 'me:name:player', limit: rate(20, 500, 'RL_ME_NAME_LIMIT'), windowMs: HOUR },
    avatar: { scope: 'me:avatar:player', limit: rate(60, 500, 'RL_ME_AVATAR_LIMIT'), windowMs: HOUR },
    delete: { scope: 'me:delete:player', limit: rate(5, 100, 'RL_ME_DELETE_LIMIT'), windowMs: HOUR },
    publicIp: { scope: 'players:public:ip', limit: rate(120, 5000, 'RL_PUBLIC_PROFILE_IP_LIMIT'), windowMs: 10 * MIN },
  };

  /** The signed-in player, from the cookie. Anonymous legacy sessions and sessions without an account are refused. */
  async function requireUser(req) {
    await limit([{ ...RL.api, key: requestIp(req) }]);
    const token = readSessionToken(req);
    const info = token ? await dbAuth.sessionInfo(token) : null;
    if (!info || !info.authenticated || !info.player) throw new AuthError('Please log in.', 401);
    return { id: info.player.id, token };
  }
  const query = (req) => new URL(req.url, 'http://x').searchParams;

  const routes = {
    'GET /api/me/profile': async (req, res) => {
      const u = await requireUser(req);
      const [profile, stats, progress] = await Promise.all([dbAccount.getOwnProfile(u.id), dbMatches.getPlayerProfile(u.id), dbMatches.getProgress(u.id)]);
      sendJson(res, 200, { ok: true, profile, stats: { ...stats, progress } });
    },

    // The weekly board for one game: public, read-only, and it names only people who turned the board on.
    'GET /api/leaderboard': async (req, res) => {
      await limit([{ ...RL.api, key: requestIp(req) }]);
      const game = query(req).get('game') || '';
      if (!/^[a-z0-9-]{1,40}$/.test(game)) throw new AuthError('Choose a game.', 400);
      sendJson(res, 200, { ok: true, game, days: 7, board: await dbMatches.weeklyBoard(game, { days: 7, limit: 10 }) });
    },

    // The skill-rating board for one game: lifetime, or this UTC month. Public and read-only, opted-in people only, and
    // `enabled` is false while the ratings are off (the page then shows nothing).
    'GET /api/ratings/board': async (req, res) => {
      await limit([{ ...RL.api, key: requestIp(req) }]);
      const game = query(req).get('game') || '';
      if (!/^[a-z0-9-]{1,40}$/.test(game)) throw new AuthError('Choose a game.', 400);
      const month = query(req).get('scope') === 'month';
      const enabled = dbRatings.liveEnabled();
      const scope = month ? monthKey(new Date()) : 'lifetime';
      const board = enabled ? await dbRatings.ratingBoard({ gameId: game, scope }) : [];
      // A signed-in player also gets their own row, so they can see their rating when they are not on the boards.
      let me = null;
      const token = enabled ? readSessionToken(req) : null;
      const info = token ? await dbAuth.sessionInfo(token) : null;
      if (info && info.authenticated && info.player) me = await dbRatings.ratingOwn({ playerId: info.player.id, gameId: game, scope });
      sendJson(res, 200, { ok: true, enabled, game, scope: month ? 'month' : 'lifetime', board, me });
    },

    // Turns the player's own weekly board entry on or off (off by default).
    'POST /api/me/leaderboard': async (req, res) => {
      const u = await requireUser(req);
      await limit([{ ...RL.name, key: u.id }]);
      const body = await readJsonBody(req);
      if (typeof (body && body.optIn) !== 'boolean') throw new AuthError('Say whether to show you on the boards.', 400);
      sendJson(res, 200, { ok: true, optIn: await dbAccount.setLeaderboardOptIn(u.id, body.optIn) });
    },

    'POST /api/me/welcome-seen': async (req, res) => {
      const u = await requireUser(req);
      await dbAccount.markWelcomed(u.id);
      sendJson(res, 200, { ok: true });
    },

    'POST /api/me/display-name': async (req, res) => {
      const u = await requireUser(req);
      await limit([{ ...RL.name, key: u.id }]);
      const body = await readJsonBody(req);
      const out = await dbAccount.updateDisplayName(u.id, body.displayName);
      onProfileChanged({ playerId: u.id, displayName: out.displayName });
      sendJson(res, 200, { ok: true, displayName: out.displayName });
    },

    'POST /api/me/country': async (req, res) => {
      const u = await requireUser(req);
      await limit([{ ...RL.name, key: u.id }]);
      const body = await readJsonBody(req);
      sendJson(res, 200, { ok: true, ...(await dbAccount.updateCountry(u.id, body && body.country)) });
    },

    'POST /api/me/avatar': async (req, res) => {
      const u = await requireUser(req);
      await limit([{ ...RL.avatar, key: u.id }]);
      const body = await readJsonBody(req);
      const out = await dbAccount.updateAvatar(u.id, body && body.avatar, avatars);
      onProfileChanged({ playerId: u.id, avatar: out.avatar });
      sendJson(res, 200, { ok: true, avatar: out.avatar });
    },

    'GET /api/me/history': async (req, res) => {
      const u = await requireUser(req);
      const q = query(req);
      sendJson(res, 200, { ok: true, ...(await dbAccount.getHistory(u.id, { page: q.get('page'), game: q.get('game') })) });
    },

    'GET /api/me/recent': async (req, res) => {
      const u = await requireUser(req);
      // only tables that still exist on this server are returned; the stale rows are deleted, so the list never fills with dead codes
      const all = await dbAccount.listRecentTables(u.id);
      const live = all.filter((t) => tableStatus(t.code));
      if (live.length !== all.length) await dbAccount.forgetRecentTables(u.id, all.filter((t) => !tableStatus(t.code)).map((t) => t.code));
      sendJson(res, 200, { ok: true, tables: live.map((t) => ({ ...t, status: tableStatus(t.code) })) });
    },

    'POST /api/me/recent/clear': async (req, res) => {
      const u = await requireUser(req);
      await dbAccount.clearRecentTables(u.id);
      sendJson(res, 200, { ok: true });
    },

    'POST /api/me/delete-account': async (req, res) => {
      const u = await requireUser(req);
      await limit([{ ...RL.delete, key: u.id }]);
      const body = await readJsonBody(req);
      let out;
      if (typeof body.credential === 'string' && body.credential) {
        // Google-only accounts have no password: a fresh Google sign-in (same token check as sign-in, bound to this browser) confirms it
        if (!verifyGoogle) throw new AuthError('Sign in with Google is not available.', 404);
        out = await dbAccount.deleteAccountWithGoogle(u.id, await verifyGoogle(req, body.credential, { maxAgeSeconds: DELETE_CONFIRM_MAX_AGE_S }));
      } else {
        out = await dbAccount.deleteAccount(u.id, body.password);
      }
      onAccountDeleted({ playerId: u.id }); // closes open sockets and forgets the player on this server
      addCookie(res, clearedSessionCookie());
      sendJson(res, 200, { ok: true, matchesKept: out.matchesKept, message: 'Your account has been deleted.' });
    },

    'GET /api/players/:username': async (req, res) => {
      await limit([{ ...RL.publicIp, key: requestIp(req) }]);
      // a signed-in viewer (if any) is told whether they have blocked this player or been blocked by them: the profile is shown as blocked
      const token = readSessionToken(req);
      const info = token ? await dbAuth.sessionInfo(token) : null;
      const viewerId = info && info.authenticated && info.player ? info.player.id : null;
      if (info && info.authenticated && info.player && info.player.is_anonymous) { // account-only: player stats are for accounts
        return sendJson(res, 403, { ok: false, code: 'guest_locked', feature: 'profiles', error: 'Create a free account to see player profiles.' });
      }
      const profile = await dbAccount.getPublicProfile(req.routeParam, { viewerId });
      if (!profile) throw new AuthError('No such player.', 404);
      sendJson(res, 200, { ok: true, profile });
    },
  };
  return routes;
}

module.exports = { createAccountRoutes };
