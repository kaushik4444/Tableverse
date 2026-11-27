'use strict';
/**
 * Bot skill, shared by the games. A bot is a little less sharp than a careful person: on some turns it plays a random
 * legal move instead of its best one (a slip), and it sometimes forgets a card it has seen. Bots still finish every game
 * and never play an illegal move; they only play worse.
 *
 * ONE setting controls every game: BOT_LEVEL below. Levels are 'low' (the default for now), 'normal' and 'high'. To make the
 * bots stronger, change BOT_LEVEL to 'normal' or 'high' here and nowhere else. Each game's botAction takes the rng it is
 * given (the table's seeded random source) so a game stays repeatable.
 */

const LEVELS = {
  //          slip: random legal move   forget: a seen card   sudoku: wrong digit   star: a wasted star (The Mind)
  low:    { slip: 0.35, forget: 0.4, sudoku: 0.03, star: 0.04 },
  normal: { slip: 0.25, forget: 0.3, sudoku: 0.02, star: 0.02 },
  high:   { slip: 0.12, forget: 0.15, sudoku: 0.005, star: 0.01 },
};
const BOT_LEVEL = 'low';
const LEVEL = LEVELS[BOT_LEVEL];

/** The chance that a bot plays a random legal move instead of its best one. */
const SLIP = LEVEL.slip;
/** The chance that a bot forgets a card it has seen (memory games). */
const FORGET = LEVEL.forget;
/** Sudoku writes a wrong number this often (each one costs a life). */
const SUDOKU_SLIP = LEVEL.sudoku;
/** The Mind throws a star for no reason this often (stars are scarce). */
const STAR_SLIP = LEVEL.star;

/** True when the bot slips on this turn. */
const slips = (rng, rate = SLIP) => rng() < rate;
/** A random element of a non-empty list. */
const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];

module.exports = { BOT_LEVEL, LEVELS, SLIP, FORGET, SUDOKU_SLIP, STAR_SLIP, slips, pickOne };
