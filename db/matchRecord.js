'use strict';

/**
 * Turn a finished room into the record we store. Pure: no I/O, so it is unit-tested.
 * Returns null when the game cannot say who won (so we store nothing rather than wrong results).
 *
 * room.seated is the member in each seat of the game (the seat order may be shuffled); without it, room.members is in seat
 * order. A member who left mid-game is flagged `bot` (a bot finished their seat) and listed in room.leftEarly; they stay in the record but are not counted in stats.
 */
function buildMatchRecord(room, game) {
  // A leave is only a loss if the game is finished without a second leaver. In an abandoned game nobody is penalised.
  const leavers = room.abandoned ? new Set() : room.forfeits || new Set();
  const results = typeof game.results === 'function' ? game.results() : null;
  // Results are indexed by seat; room.seated lists the member in each seat (shuffled games), else the join order.
  const seated = room.seated || room.members;
  if (!Array.isArray(results) || results.length !== seated.length) return null;
  const left = room.leftEarly || new Set();
  return {
    matchKey: room.matchKey || null,
    roomCode: room.code,
    gameId: room.gameId,
    seats: room.seats,
    options: room.options || {},
    startedAt: room.startedAt ? new Date(room.startedAt) : null,
    participants: seated
      .map((m, seat) => {
        const r = results[seat] || {};
        const leftEarly = Boolean(m.bot && left.has(m.id));
        const forfeit = leftEarly && leavers.has(m.id); // left with other people still playing: a loss
        return {
          playerId: m.id,
          name: String(m.name || 'Player').slice(0, 32),
          seat,
          score: Number.isFinite(r.score) ? Math.round(r.score) : 0,
          // The finishing place, when the game knows it (Property Rivals: elimination order). Null: ranked by score.
          place: Number.isFinite(r.place) ? Math.round(r.place) : null,
          // A leaver never wins or draws, penalised or not. A draw is neither a win nor a loss.
          isWinner: leftEarly ? false : Boolean(r.winner),
          isDraw: leftEarly ? false : Boolean(r.draw),
          isBot: Boolean(m.bot) && !leftEarly,
          leftEarly,
          forfeit,
        };
      })
      // In an abandoned game (a second person left) the players who stayed get no result at all: not played, not a loss.
      .filter((p) => !(room.abandoned && !p.leftEarly && !p.isBot)),
  };
}

/**
 * The record for a table that closed before its game finished. Only people who left with others still playing are
 * written, as losses; nobody else gets a result. Returns null when nobody forfeited.
 */
function buildForfeitRecord(room) {
  const leavers = room.forfeits || new Set();
  if (room.abandoned || !leavers.size || !room.matchKey) return null;
  const seated = room.seated || room.members;
  return {
    matchKey: room.matchKey,
    roomCode: room.code,
    gameId: room.gameId,
    seats: room.seats,
    options: room.options || {},
    startedAt: room.startedAt ? new Date(room.startedAt) : null,
    participants: seated
      .map((m, seat) => ({ m, seat }))
      .filter(({ m }) => leavers.has(m.id))
      .map(({ m, seat }) => ({
        playerId: m.id,
        name: String(m.name || 'Player').slice(0, 32),
        seat,
        score: 0,
        isWinner: false,
        isDraw: false,
        isBot: false,
        leftEarly: true,
        forfeit: true,
      })),
  };
}

module.exports = { buildMatchRecord, buildForfeitRecord };
