'use strict';
/**
 * Seats for a new game. By default players sit in the order they joined. When the table's shuffleSeats option is on
 * and the game offers that option, the seats are shuffled (Fisher–Yates, using crypto.randomInt by default).
 * The members array is never changed.
 */
const crypto = require('crypto');

function seatPlayers(members, { shuffle = false, offered = false, randomInt = crypto.randomInt } = {}) {
  const seats = members.map((m) => ({ id: m.id, name: m.name }));
  if (!shuffle || !offered) return seats;
  for (let i = seats.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  return seats;
}

module.exports = { seatPlayers };
