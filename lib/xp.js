'use strict';
/**
 * Two separate progress systems. Pure: no database, so the rules are easy to test and to change.
 *
 * 1. Account level (overall progress in Tableverse). It only measures time: 1 XP per full minute spent in a game,
 *    whether you won, lost, drew or left. It is not a ranking and has nothing to do with results or penalties.
 *
 * 2. Game level (one per game, skill). It is based on how you finished: every game scores higher as better (checked
 *    for all games in games/*), so the finishing position comes from the score. Ties share a position.
 *      - Finishing a game: 10 points, plus up to 20 for the position (1st gets 20, last gets 0).
 *      - Leaving with others still playing (a penalised leave, see lib/leavePolicy.js): -15 for that game.
 *      - A game's points never go below zero in total.
 *
 * Both use the same level curve: level n starts at 100 * n * (n-1) / 2, so each level needs 100 more than the one before
 * (level 2 at 100, level 3 at 300, level 4 at 600, ...).
 */

const FINISH_POINTS = 10;
const POSITION_POINTS = 20;
const LEAVE_POINTS = -15;
const LEVEL_STEP = 100;

/** Account XP for time in a game: 1 per full minute. Negative or missing time counts as nothing. */
function timeXp(seconds) {
  return Math.max(0, Math.floor((Number(seconds) || 0) / 60));
}

/**
 * The skill points each counted participant earns in one game, keyed by playerId. `participants` is the record's list
 * (score, isBot, leftEarly, forfeit). Players who left without a penalty are not in the game ranking at all.
 */
function gameSkillPoints(participants) {
  const counted = participants.filter((p) => !p.leftEarly || p.forfeit);
  const ranked = counted.filter((p) => !p.forfeit);
  const n = ranked.length;
  const out = {};
  for (const p of counted) {
    if (p.forfeit) { out[p.playerId] = LEAVE_POINTS; continue; }
    const position = 1 + ranked.filter((q) => q.score > p.score).length;
    const bonus = n <= 1 ? POSITION_POINTS : Math.round((POSITION_POINTS * (n - position)) / (n - 1));
    out[p.playerId] = FINISH_POINTS + bonus;
  }
  return out;
}

/** Running total across games, never below zero. */
function runningTotal(gains) {
  let total = 0;
  for (const g of gains) total = Math.max(0, total + g);
  return total;
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

module.exports = {
  FINISH_POINTS, POSITION_POINTS, LEAVE_POINTS, LEVEL_STEP,
  timeXp, gameSkillPoints, runningTotal, levelStart, levelProgress,
};
