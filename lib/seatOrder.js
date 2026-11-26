'use strict';
/**
 * Seats for a new game. By default players sit in the order they joined. When the table's shuffleSeats option is on
 * and the game offers that option, the seats are shuffled (Fisher–Yates, using crypto.randomInt by default).
 * The members array is never changed.
 */
const crypto = require('crypto');

function seatPlayers(members, { shuffle = false, offered = false, randomInt = crypto.randomInt } = {}) {
  // bots are marked so a game can tell them from people (Bingo's bots mark and call Bingo on their own)
  const seats = members.map((m) => ({ id: m.id, name: m.name, ...(m.bot ? { bot: true } : {}) }));
  if (!shuffle || !offered) return seats;
  for (let i = seats.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  return seats;
}

/**
 * The members in the order given by `ids` (every member id exactly once), or null when the list is not exactly the table's
 * members. The host uses this to put players in seats that match the teams (29), or to swap two players.
 */
function arrangeMembers(members, ids) {
  if (!Array.isArray(ids) || ids.length !== members.length) return null;
  const byId = new Map(members.map((m) => [m.id, m]));
  if (new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) return null;
  return ids.map((id) => byId.get(id));
}

/** The members in a random order (Fisher–Yates). The members array is not changed. */
function shuffleMembers(members, randomInt = crypto.randomInt) {
  const out = members.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

module.exports = { seatPlayers, arrangeMembers, shuffleMembers };
