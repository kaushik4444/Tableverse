'use strict';
const { stopPlay } = require('./playTime');
const { leaveRunningGame } = require('./leavePolicy');
/**
 * A person who does not act for themselves: a bot plays their turn (they are away, or they ran out of the table's time).
 * After IDLE_KICK_TURNS such turns in a row they are removed from the table. The removal is a penalty: it is the final
 * leave of that person in the game (room.finalForfeits), it counts as a loss when others are still playing (see
 * leavePolicy), and there is no rejoin window. A bot takes the seat. Any move the person makes themselves resets the count.
 *
 * Pure bookkeeping on the room; the server sends the messages and the table notice.
 */
const IDLE_KICK_TURNS = 3;

/** Counts one bot turn played for this person. Returns true when they must be removed now. */
function noteBotTurn(room, playerId) {
  if (!room.idleTurns) room.idleTurns = new Map();
  const n = (room.idleTurns.get(playerId) || 0) + 1;
  room.idleTurns.set(playerId, n);
  return n >= IDLE_KICK_TURNS;
}

/** The person acted for themselves: their streak of bot turns starts again. */
function clearIdle(room, playerId) {
  if (room.idleTurns) room.idleTurns.delete(playerId);
}

/**
 * Removes an idle person from the seat: a bot takes it, the penalty is recorded as their final leave, and they cannot rejoin.
 * Returns what the leave did for the penalty: { penalised, abandoned } (see leavePolicy.leaveRunningGame).
 */
function kickIdle(room, member, now) {
  const result = leaveRunningGame(room, member.id);
  if (!room.finalForfeits) room.finalForfeits = new Set();
  room.finalForfeits.add(member.id); // the penalty stays, even if the game is later abandoned
  stopPlay(room, member.id, now);
  member.bot = true;
  (room.leftEarly || (room.leftEarly = new Set())).add(member.id);
  (room.removed || (room.removed = new Set())).add(member.id);
  clearIdle(room, member.id);
  return result;
}

module.exports = { IDLE_KICK_TURNS, noteBotTurn, clearIdle, kickIdle };
