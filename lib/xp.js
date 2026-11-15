'use strict';
/**
 * Two progress systems and the shared level curve. Pure: no database.
 *
 * 1. Account level (overall progress in Tableverse). It only measures time: 1 XP per full minute spent in a game.
 *    Wins, losses, draws and leaves make no difference, and there are no penalties.
 *
 * 2. Game level (one per game, skill). Each game has its own rule for how a finished game counts; see lib/gameSkill.js.
 *    Points can be negative. A game's level is worked out from its running total.
 *
 * Both levels use one curve: level n starts at 50 * n * (n-1) / 2 XP, so level 2 starts at 50, level 3 at 150,
 * level 4 at 300, level 5 at 500, and each level needs 50 more than the one before.
 */

const { gameSkillPoints, WIN, LOSS, LEAVE } = require('./gameSkill');

const LEVEL_STEP = 50;

/** Account XP for time in a game: 1 per full minute. Negative or missing time counts as nothing. */
function timeXp(seconds) {
  return Math.max(0, Math.floor((Number(seconds) || 0) / 60));
}

/** The running total of a list of gains (points or XP). Account XP never goes below zero; game points may. */
function runningTotal(gains, { floor = false } = {}) {
  let total = 0;
  for (const g of gains) total = total + g;
  return floor ? Math.max(0, total) : total;
}

/** The XP where level n starts. */
function levelStart(n) {
  return (LEVEL_STEP * n * (n - 1)) / 2;
}

/** { level, xp, into, need }: `into` is how far through the current level, `need` is that level's size. */
function levelProgress(xp) {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (levelStart(level + 1) <= total) level++;
  const start = levelStart(level);
  return { level, xp: total, into: total - start, need: levelStart(level + 1) - start };
}

module.exports = { LEVEL_STEP, WIN, LOSS, LEAVE, gameSkillPoints, timeXp, runningTotal, levelStart, levelProgress };
