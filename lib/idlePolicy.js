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

/** Counts one bot turn played for this person. Returns how many in a row there are now (kick at IDLE_KICK_TURNS). */
function noteBotTurn(room, playerId) {
  if (!room.idleTurns) room.idleTurns = new Map();
  const n = (room.idleTurns.get(playerId) || 0) + 1;
  room.idleTurns.set(playerId, n);
  return n;
}

/** The person acted for themselves: their streak of bot turns starts again. */
function clearIdle(room, playerId) {
  if (room.idleTurns) room.idleTurns.delete(playerId);
}

/**
 * Removes an idle person from the seat. The penalty is exactly the one for leaving voluntarily (leavePolicy.leaveRunningGame):
 * a loss when others are still playing, and the third leave of the game is final. A bot takes the seat and there is no
 * rejoin. Returns what the leave did for the penalty: { penalised, abandoned }.
 */
function kickIdle(room, member, now) {
  const result = leaveRunningGame(room, member.id);
  stopPlay(room, member.id, now);
  member.bot = true;
  (room.leftEarly || (room.leftEarly = new Set())).add(member.id);
  (room.removed || (room.removed = new Set())).add(member.id);
  clearIdle(room, member.id);
  return result;
}

module.exports = { IDLE_KICK_TURNS, noteBotTurn, clearIdle, kickIdle };
