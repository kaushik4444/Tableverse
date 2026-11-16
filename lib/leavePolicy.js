'use strict';
const { startPlay, stopPlay } = require('./playTime');
/**
 * What leaving a running game means. Pure bookkeeping on the room; the server still does the seat changes.
 *
 *  - Other people still playing: the leaver is marked as penalised (room.forfeits). The loss is written only if the game
 *    finishes (db/matchRecord.js), so a rejoin can still cancel it.
 *  - The third leave of the same person in one game is final (room.finalForfeits): the penalty stays even if that person
 *    rejoins, and it is still written if the game is abandoned later. Rejoining is still allowed inside the window.
 *  - Playing only against bots: nothing is marked.
 *  - A second person leaves while a penalty from someone else is pending, even if nobody else is still human: the game is
 *    abandoned (room.abandoned). Nobody who is not final is penalised, and the people who stayed get no result.
 *    The flag lasts for the game.
 *
 * Returns what happened, for logging and tests: { penalised, abandoned }.
 */
const FINAL_LEAVE = 3; // the third leave of one person in one game

function ensureLeaveState(room) {
  if (!room.forfeits) room.forfeits = new Set();
  if (!room.leaveCounts) room.leaveCounts = new Map();
  if (!room.finalForfeits) room.finalForfeits = new Set();
}

/** A penalty pending for someone other than this player (their own pending penalty is not a reason to abandon). */
function pendingForOthers(room, playerId) {
  return [...room.forfeits].some((id) => id !== playerId);
}

function leaveRunningGame(room, playerId) {
  ensureLeaveState(room);
  room.leaveCounts.set(playerId, (room.leaveCounts.get(playerId) || 0) + 1);
  const count = room.leaveCounts.get(playerId);
  if (room.abandoned) return { penalised: false, abandoned: true }; // sticky for the game: nobody is penalised
  if (pendingForOthers(room, playerId)) {
    room.abandoned = true;
    return { penalised: false, abandoned: true };
  }
  const othersPlaying = room.members.some((m) => !m.bot && m.id !== playerId);
  if (othersPlaying) {
    room.forfeits.add(playerId);
    if (count >= FINAL_LEAVE) room.finalForfeits.add(playerId);
    return { penalised: true, abandoned: false };
  }
  return { penalised: false, abandoned: false };
}

/** How many times this person has left this running game (rejoining does not reset it). */
function leaveCountOf(room, playerId) {
  return room.leaveCounts ? room.leaveCounts.get(playerId) || 0 : 0;
}

/**
 * What leaving the running game now would do for this person, for the leave prompt: 'counts' (a loss for the leaver),
 * 'abandons' (another person's penalty is pending, so leaving abandons the game and nobody is penalised) or 'abandoned'
 * (already abandoned: nothing counts). Mirrors leaveRunningGame, which must stay the single place that changes the state.
 */
function leaveStateOf(room, playerId) {
  if (room.abandoned) return 'abandoned';
  if (room.forfeits && pendingForOthers(room, playerId)) return 'abandons';
  return 'counts';
}

// ------------------------------------------------------------------ rejoin window
// A person who leaves a running game on purpose can take their seat back during a short window (REJOIN_GRACE_SECONDS,
// default 120, allowed 0 to 600). The window starts at the FIRST departure of that person in this game and is never
// restarted: a later leave or rejoin cannot extend it. After it, the bot keeps the seat for the rest of the game and the
// person may only watch. A network drop is not a departure and does not use this window (see server.js detachSocket).
const DEFAULT_REJOIN_SECONDS = 120;
const MAX_REJOIN_SECONDS = 600;

/** The rejoin window in milliseconds from the REJOIN_GRACE_SECONDS setting. Bad or missing values use the default. */
function rejoinGraceMs(raw) {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) return DEFAULT_REJOIN_SECONDS * 1000;
  return Math.min(MAX_REJOIN_SECONDS, Math.max(0, Math.round(n))) * 1000;
}

/** Starts this person's window in this game, if it has not started. Repeated departures never move the deadline. */
function startRejoinWindow(room, playerId, now, graceMs) {
  if (!room.leaveDeadlines) room.leaveDeadlines = new Map();
  if (!room.leaveDeadlines.has(playerId)) room.leaveDeadlines.set(playerId, now + graceMs);
}

/**
 * Whether this person may take their own seat back now. The one rule the server uses:
 *  - the game must still be running and not abandoned (an abandoned game gives nobody a seat back);
 *  - the person must have left on purpose in this game (fails closed when there is no window);
 *  - the window must not have passed (the deadline itself is still in time).
 * Returns { seat, reason }. A refused person may still watch as a spectator.
 */
function rejoinDecision(room, playerId, now) {
  if (room.status !== 'playing') return { seat: false, reason: 'not-playing' };
  if (room.abandoned) return { seat: false, reason: 'abandoned' };
  const deadline = room.leaveDeadlines ? room.leaveDeadlines.get(playerId) : undefined;
  if (deadline === undefined) return { seat: false, reason: 'not-a-leaver' };
  if (now > deadline) return { seat: false, reason: 'expired' };
  return { seat: true, reason: 'in-time', deadline };
}

/**
 * A voluntary leave of a running game: the penalty bookkeeping, the play time stops, the person's window starts (only at
 * their first departure) and a bot takes the seat. Used by the server; the tests drive this same function.
 */
function voluntaryLeave(room, member, now, graceMs) {
  leaveRunningGame(room, member.id);
  stopPlay(room, member.id, now);
  startRejoinWindow(room, member.id, now, graceMs);
  member.bot = true;
  (room.leftEarly || (room.leftEarly = new Set())).add(member.id);
}

/**
 * Taking the seat back inside the window: the bot gives it up, the pending leave penalty is removed (it was never written:
 * it is only recorded when the game ends), and play resumes. A final (third) leave keeps its penalty. Returns the decision;
 * the seat is untouched when refused.
 */
function reclaimSeat(room, member, now) {
  const decision = rejoinDecision(room, member.id, now);
  if (!decision.seat) return decision;
  member.bot = false;
  const final = Boolean(room.finalForfeits && room.finalForfeits.has(member.id));
  // A final (third) leaver stays in leftEarly and forfeits: the record still shows the leave.
  if (room.leftEarly && !final) room.leftEarly.delete(member.id);
  if (room.forfeits && !final) room.forfeits.delete(member.id);
  startPlay(room, member.id, now);
  return decision;
}

module.exports = { leaveRunningGame, leaveStateOf, leaveCountOf, FINAL_LEAVE, rejoinGraceMs, startRejoinWindow, rejoinDecision, voluntaryLeave, reclaimSeat, DEFAULT_REJOIN_SECONDS, MAX_REJOIN_SECONDS };
