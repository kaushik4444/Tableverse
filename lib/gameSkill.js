'use strict';
/**
 * Game skill points: how one finished game counts towards that game's own level. Pure.
 *
 * Each game is judged from its own perspective. Two kinds of result, each with its own rule:
 *
 *  - Placings (Wizard, Poker, Property Rivals, Go Fish, Ludo, Snakes & Ladders, Take 5, Stage 10): players are ranked by their score,
 *    ties share a place. 1st gets +20, the last place gets -10, and places in between go down in a straight line.
 *  - Win or lose (Twenty-nine, Carrom, Tic-Tac-Toe, Four in a Row, Mind): a win is +20, a draw 0, a loss -10. Twenty-nine and Mind
 *    are played as teams or together, so everyone on the winning side gets the same points.
 *
 * A penalised leave (leaving while others were still playing, see lib/leavePolicy.js) is -30 in every game, so it is
 * always worse than finishing last. A leave without a penalty is not in the game ranking at all.
 *
 * Points can go negative. A game's XP is its running total of these points: there are no per-game levels (see docs/PROGRESS_LEVELS.md).
 */

// Win +20, loss -10 (a loss costs less than a win earns, so trying is worth it), a penalised leave -30 (always worse than last).
const WIN = 20;
const LOSS = -10;
const LEAVE = -30;

/**
 * +20 for the best place, -10 for the last occupied place, a straight line between (for four ranked players: +20, +10, 0, -10).
 * `last` is the lowest place actually used (with ties, places are e.g. 1, 2, 2: the last is 2), so the lowest place always
 * gets -10 whether or not it is shared. A lone player gets 0 (nobody to compare with).
 */
function ladder(place, last) {
  if (last <= 1) return 0;
  return Math.round(WIN + ((LOSS - WIN) * (place - 1)) / (last - 1));
}

/**
 * The order key for a player: a game's own place when it has one (Property Rivals: elimination order, Poker: the final
 * standing), otherwise the score (higher is better, so it is negated). Lower keys are better.
 */
function rankKey(p) {
  return Number.isFinite(p.place) ? p.place : -p.score;
}

/**
 * Places among the players who are ranked (bots and penalised or unpenalised leavers are not), so the numbers are
 * relative to them, not to the seats. Ties share a place.
 */
function relativePlaces(ranked) {
  const places = {};
  for (const p of ranked) places[p.playerId] = 1 + ranked.filter((q) => rankKey(q) < rankKey(p)).length;
  return places;
}

function placingPoints(ranked) {
  const places = relativePlaces(ranked);
  const last = Math.max(1, ...Object.values(places));
  const out = {};
  for (const p of ranked) out[p.playerId] = ladder(places[p.playerId], last);
  return out;
}

function winLosePoints(ranked) {
  const out = {};
  for (const p of ranked) out[p.playerId] = p.isDraw ? 0 : p.isWinner ? WIN : LOSS;
  return out;
}

const RULES = {
  wizard: placingPoints,
  poker: placingPoints,
  propertyrivals: placingPoints,
  gofish: placingPoints,
  ludo: placingPoints,
  snakesladders: placingPoints,
  penaltyrows: placingPoints,
  stagerummy: placingPoints,
  twentynine: winLosePoints,
  carrom: winLosePoints,
  tictactoe: winLosePoints,
  fourinarow: winLosePoints,
  themind: winLosePoints,
};

/**
 * The skill points each participant earns in one finished game, keyed by playerId.
 * `participants` is the record's list (playerId, score, isWinner, isDraw, leftEarly, forfeit, isBot).
 * Bots and players who left without a penalty are not in the game ranking at all.
 * A game with no rule of its own is ranked by placings, so a new game is never left without a rule.
 */
function gameSkillPoints(gameId, participants) {
  const forfeited = participants.filter((p) => p.forfeit);
  const ranked = participants.filter((p) => !p.leftEarly && !p.isBot);
  const rule = RULES[gameId] || placingPoints;
  const out = rule(ranked);
  for (const p of forfeited) out[p.playerId] = LEAVE;
  return out;
}

/** How a game's game XP is earned, for the player's profile: 'placing' or 'win-lose' (see RULES). */
function ruleKindOf(gameId) {
  return RULES[gameId] === winLosePoints ? 'win-lose' : 'placing';
}

module.exports = { gameSkillPoints, ladder, ruleKindOf, WIN, LOSS, LEAVE, RULES };
