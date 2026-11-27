'use strict';
/**
 * Bot skill, shared by the games. A bot is a little less sharp than a careful person: on some turns it plays a random
 * legal move instead of its best one (a slip), and it sometimes forgets a card it has seen. Every rate is set here, in one
 * place. Bots still finish every game and never play an illegal move; they only play worse.
 *
 * Each game's botAction takes the rng it is given (the table's seeded random source) so a game stays repeatable.
 */

/** The chance that a bot plays a random legal move instead of its best one. */
const SLIP = 0.25;
/** The chance that a bot forgets a card it has seen (memory games). */
const FORGET = 0.3;
/** Sudoku writes a wrong number this often: a bot grid makes mistakes, and each one costs a life. Kept low. */
const SUDOKU_SLIP = 0.03;

/** True when the bot slips on this turn. */
const slips = (rng, rate = SLIP) => rng() < rate;
/** A random element of a non-empty list. */
const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];

module.exports = { SLIP, FORGET, SUDOKU_SLIP, slips, pickOne };
