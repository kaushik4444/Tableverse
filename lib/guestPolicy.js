'use strict';
/**
 * Guest play policy: one place that decides what a guest (a visitor who played without registering) may do.
 * Pure: it reads the environment it is given and the list of game ids. Nothing here touches the database or the sockets.
 *
 * Switches (Render environment variables; every one defaults to the safe value):
 *  - GUEST_PLAY_ENABLED: "true" allows new guest sessions. Anything else (including unset) blocks them. Existing guest
 *    sessions are not cut off by turning it off; they simply cannot be made again, and they are still bound by the game rules.
 *  - GUEST_SESSION_TTL_HOURS: how long a guest session lasts (1 to 168, default 72). After that the session expires.
 *
 * Which games a guest may play is NOT an environment setting: it is the owner's per-game access mode in the admin console
 * (lib/gameFlags.js, public/game-access.js: enable / disable for non admins / disable guests only / disable for all).
 *
 * The rules live here, not in the game code: game modules never check whether a player is a guest.
 */

const DEFAULT_TTL_HOURS = 72;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 168;

/** True only when GUEST_PLAY_ENABLED is exactly "true" (case and spaces count). Anything else, including unset, fails closed. */
function guestPlayEnabled(env = process.env) {
  return env.GUEST_PLAY_ENABLED === 'true';
}

/** Lifetime of a guest session in hours: the configured value, clamped to 1-168, default 72. */
function guestTtlHours(env = process.env) {
  const n = Number(env.GUEST_SESSION_TTL_HOURS);
  if (!Number.isFinite(n) || env.GUEST_SESSION_TTL_HOURS === undefined || String(env.GUEST_SESSION_TTL_HOURS).trim() === '') return DEFAULT_TTL_HOURS;
  return Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, Math.round(n)));
}

module.exports = { guestPlayEnabled, guestTtlHours, DEFAULT_TTL_HOURS, MIN_TTL_HOURS, MAX_TTL_HOURS };
