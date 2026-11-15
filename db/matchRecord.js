'use strict';
const { secondsPlayed } = require('../lib/playTime');

/**
 * How the table was filled at the start, from the record of who left: a leaver's seat has a bot now but was a person then,
 * so it still counts as a human. Stored with the match, because stayers are not kept as participants of an abandoned game.
 */
function tableShape(room) {
  const seated = room.seated || room.members;
  const left = room.leftEarly || new Set();
  const humans = seated.filter((m) => !m.bot || left.has(m.id)).length;
  return { tableHumans: humans, tableBots: seated.length - humans };
}

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
    // When the game ended, captured now: a record that is queued and replayed after an outage must not count the delay as play time
    finishedAt: new Date(),
    completed: true,
    ...tableShape(room),
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
          // active playing time (null when the room has no play-time record: the stored rule then applies)
          secondsPlayed: secondsPlayed(room, m.id), // a leaver keeps the time up to the leave; a bot seat has none
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
    // When the game ended, captured now: a record that is queued and replayed after an outage must not count the delay as play time
    finishedAt: new Date(),
    // Only the leavers are written, so this is not a finished game: table analytics leave it out, and each leaver's loss counts
    completed: false,
    ...tableShape(room),
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
        secondsPlayed: secondsPlayed(room, m.id),
      })),
  };
}

/**
 * The records for running tables when the server shuts down: each people-who-left-with-others-still-playing record, so a
 * loss is not lost with the table. Unfinished games are not recorded as finished. Returns an array (possibly empty).
 */
function buildShutdownForfeitRecords(rooms) {
  const out = [];
  for (const room of rooms) {
    if (room.status !== 'playing') continue;
    const rec = buildForfeitRecord(room);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * True when a participant list is only people who left a table that closed mid-game (no stayer, no bot). Used for records
 * with no completed flag (spooled by an older version): the same rule migration 026 applies to stored rows.
 */
function isForfeitOnly(participants) {
  return Array.isArray(participants) && participants.length > 0 && participants.every((p) => p.forfeit && !p.isBot);
}

module.exports = { buildMatchRecord, buildForfeitRecord, buildShutdownForfeitRecords, isForfeitOnly };
