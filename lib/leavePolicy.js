'use strict';
/**
 * What leaving a running game means. Pure bookkeeping on the room; the server still does the seat changes.
 *
 *  - Other people still playing: the leaver is marked as penalised (room.forfeits). The loss is only written if the
 *    game finishes (db/matchRecord.js), so a later second leave can still cancel it.
 *  - Playing only against bots: nothing is marked.
 *  - A second person leaves while a penalty is pending, even if nobody else is still human: the game is abandoned
 *    (room.abandoned). Nobody is penalised, and the people who stayed get no result. The flag lasts for the game.
 *
 * Returns what happened, for logging and tests.
 */
function leaveRunningGame(room, playerId) {
  if (!room.forfeits) room.forfeits = new Set();
  if (room.abandoned) return { penalised: false, abandoned: true }; // sticky for the game: nobody is penalised
  if (room.forfeits.size > 0) {
    room.abandoned = true;
    return { penalised: false, abandoned: true };
  }
  const othersPlaying = room.members.some((m) => !m.bot && m.id !== playerId);
  if (othersPlaying) {
    room.forfeits.add(playerId);
    return { penalised: true, abandoned: false };
  }
  return { penalised: false, abandoned: false };
}

/**
 * What leaving the running game now would do, for the leave prompt: 'counts' (a loss for the leaver), 'abandons' (the
 * next leaver abandons the game and nobody is penalised) or 'abandoned' (already abandoned: nothing counts).
 * Mirrors leaveRunningGame, which must stay the single place that changes the state.
 */
function leaveStateOf(room) {
  if (room.abandoned) return 'abandoned';
  if (room.forfeits && room.forfeits.size > 0) return 'abandons';
  return 'counts';
}

module.exports = { leaveRunningGame, leaveStateOf };
