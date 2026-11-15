'use strict';
/**
 * Active playing time per seated person, across every stretch they were in the game. Pure bookkeeping on the room.
 *
 *  - A seated person's time runs from the start of the game (or from the moment they take their seat back) until they
 *    leave, their connection drops, or the game ends. A network drop pauses it; reconnecting resumes it.
 *  - Spectators never accumulate time, and neither do bots.
 *  - Closed stretches are added to `total`; a running stretch is in `open` (since when).
 *
 * The total is what the account's XP (time) and the stored seconds_played use, so it must only ever grow by real play.
 */
const MAX_SECONDS = 21600; // one game counts at most six hours, as before

function playTimeOf(room) {
  if (!room.playTime) room.playTime = { open: new Map(), total: new Map() };
  return room.playTime;
}

/** The person is playing from now on (game start, a seat taken back, a reconnection). Calling it twice changes nothing. */
function startPlay(room, id, now) {
  const t = playTimeOf(room);
  if (!t.open.has(id)) t.open.set(id, now);
}

/** The person stops playing now (a voluntary leave, a dropped connection). Nothing happens if they were not playing. */
function stopPlay(room, id, now) {
  const t = playTimeOf(room);
  const since = t.open.get(id);
  if (since === undefined) return;
  t.open.delete(id);
  t.total.set(id, (t.total.get(id) || 0) + Math.max(0, now - since));
}

/** Closes every running stretch (the game ended). */
function stopAllPlay(room, now) {
  for (const id of [...playTimeOf(room).open.keys()]) stopPlay(room, id, now);
}

/**
 * Whole seconds this person actively played, capped per game. Null when the room has no play-time record (a room made
 * before this bookkeeping existed): callers then fall back to the old rule. Call stopAllPlay first, when the game ended.
 */
function secondsPlayed(room, id) {
  if (!room.playTime) return null;
  return Math.min(MAX_SECONDS, Math.floor((room.playTime.total.get(id) || 0) / 1000));
}

module.exports = { startPlay, stopPlay, stopAllPlay, secondsPlayed, MAX_SECONDS };
