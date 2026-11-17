'use strict';
/**
 * Guest play policy: one place that decides what a guest (a visitor who played without registering) may do.
 * Pure: it reads the environment it is given and the list of game ids. Nothing here touches the database or the sockets.
 *
 * Switches (Render environment variables; every one defaults to the safe value):
 *  - GUEST_PLAY_ENABLED: "true" allows new guest sessions. Anything else (including unset) blocks them. Existing guest
 *    sessions are not cut off by turning it off; they simply cannot be made again, and they are still bound by the game rules.
 *  - GUEST_SESSION_TTL_HOURS: how long a guest session lasts (1 to 168, default 72). After that the session expires.
 *  - <GAME>_GUESTSONLY, one per game, where <GAME> is the game id in capitals with the non-letters removed
 *    (WIZARD_GUESTSONLY, PENALTYROWS_GUESTSONLY, ...). "true" LOCKS that game for guests: it is shown greyed out, and a guest
 *    who taps it is asked to create a free account. It does not affect registered players. Unset or "false" means open to guests.
 *    The name ends in _GUESTSONLY as the owner asked; the switch is on when the game is "guests only" = locked for guests.
 *
 * The rules live here, not in the game code: game modules never check whether a player is a guest.
 */

const DEFAULT_TTL_HOURS = 72;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 168;

const truthy = (v) => String(v == null ? '' : v).trim().toLowerCase() === 'true';

/** True only when GUEST_PLAY_ENABLED is exactly "true". Fails closed. */
function guestPlayEnabled(env = process.env) {
  return truthy(env.GUEST_PLAY_ENABLED);
}

/** The environment variable that locks a game for guests, e.g. "wizard" -> "WIZARD_GUESTSONLY". */
function lockVarFor(gameId) {
  return `${String(gameId).toUpperCase().replace(/[^A-Z0-9]/g, '')}_GUESTSONLY`;
}

/** True when the game is locked for guests by its own switch. */
function lockedForGuests(gameId, env = process.env) {
  return truthy(env[lockVarFor(gameId)]);
}

/**
 * Whether a player may start or join a game. `isGuest` is true for a guest session. A registered player is never refused
 * here (game availability for everybody is still decided by lib/gameFlags.js).
 * Returns { allowed: true } or { allowed: false, reason: 'guest_locked' }. Turning guest play off stops new guest sessions (see the routes).
 */
function gameAllowed({ isGuest, gameId, env = process.env }) {
  if (!isGuest) return { allowed: true };
  if (lockedForGuests(gameId, env)) return { allowed: false, reason: 'guest_locked' };
  return { allowed: true };
}

/** Per-game lock map for the client: { gameId: true | false } for the given ids. Guest play switched off locks every game. */
function lockMap(gameIds, env = process.env) {
  const off = !guestPlayEnabled(env);
  const out = {};
  for (const id of gameIds) out[id] = off || lockedForGuests(id, env);
  return out;
}

/** Lifetime of a guest session in hours: the configured value, clamped to 1-168, default 72. */
function guestTtlHours(env = process.env) {
  const n = Number(env.GUEST_SESSION_TTL_HOURS);
  if (!Number.isFinite(n) || env.GUEST_SESSION_TTL_HOURS === undefined || String(env.GUEST_SESSION_TTL_HOURS).trim() === '') return DEFAULT_TTL_HOURS;
  return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, Math.round(n)));
}

module.exports = { guestPlayEnabled, lockVarFor, lockedForGuests, gameAllowed, lockMap, guestTtlHours, DEFAULT_TTL_HOURS, MIN_TTL_HOURS, MAX_TTL_HOURS };
