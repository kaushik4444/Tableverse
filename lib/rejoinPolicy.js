'use strict';
/**
 * Rejoin grace period and active playing time for a running game. Pure bookkeeping on the room; server.js still does
 * the seat changes. Rules are in docs/PROGRESS_LEVELS.md ("Leaving and coming back").
 *
 *  - The first voluntary departure of a seated person starts a grace period (REJOIN_GRACE_MS, 2 minutes). Later
 *    leave/rejoin cycles in the same game never move that deadline.
 *  - Inside the period the person may take the seat back from the bot: the leave penalty for that person is removed
 *    (server.js also removes room.forfeits / room.leftEarly through leavePolicy). After the period the seat stays with
 *    the bot and they can only watch. Network drops are not voluntary departures and never reach this module.
 *  - Active time: each seated person's time is the sum of their intervals in the seat. Time spent with a bot in their
 *    seat (after they left) is not counted, and nor is time as a spectator. Bots have none.
 *
 * room.activity is a Map: playerId -> { activeMs, since (ms or null), firstLeftAt (ms or null) }. It is in memory only.
 */

const REJOIN_GRACE_MS = 2 * 60 * 1000;
const MAX_SECONDS = 6 * 60 * 60; // a single game counts at most 6 hours, as before

function activityOf(room) {
  if (!room.activity) room.activity = new Map();
  return room.activity;
}

/** A game starts: every seated human is in their seat from now on. */
function startActivity(room, playerIds, now) {
  const map = activityOf(room);
  map.clear();
  for (const id of playerIds) map.set(id, { activeMs: 0, since: now, firstLeftAt: null });
}

/** The person stops being in their seat (voluntary leave): closes the current interval and starts the grace period once. */
function leftSeat(room, playerId, now) {
  const map = activityOf(room);
  const e = map.get(playerId);
  if (!e) return;
  if (e.since !== null) e.activeMs += Math.max(0, now - e.since);
  e.since = null;
  if (e.firstLeftAt === null) e.firstLeftAt = now;
}

/** May the person take their seat back from the bot now? Only inside the grace period that their first departure started. */
function canReclaimSeat(room, playerId, now, graceMs = REJOIN_GRACE_MS) {
  const e = activityOf(room).get(playerId);
  if (!e || e.firstLeftAt === null || e.since !== null) return false;
  return now - e.firstLeftAt <= graceMs;
}

/** The person is back in the seat. Their deadline is not reset: it still counts from their first departure. */
function reclaimSeat(room, playerId, now) {
  const e = activityOf(room).get(playerId);
  if (e && e.since === null) e.since = now;
}

/** Whole seconds the person has actually been in the seat, up to `now` (or to the game's end when `now` is that time). */
function playedSeconds(room, playerId, now) {
  const e = activityOf(room).get(playerId);
  if (!e) return 0;
  const ms = e.activeMs + (e.since !== null ? Math.max(0, now - e.since) : 0);
  return Math.min(MAX_SECONDS, Math.floor(ms / 1000));
}

module.exports = { REJOIN_GRACE_MS, startActivity, leftSeat, canReclaimSeat, reclaimSeat, playedSeconds };
