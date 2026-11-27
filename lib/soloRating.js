'use strict';
/**
 * Solo rating: a player alone at a Sudoku table gets a rating per difficulty, separate from race play.
 *
 * It is an Elo-style rating against a fixed par rating (the starting rating), not against other players, so a solo game
 * never moves another player. Outcome per finished solo game:
 *   - solved within the par time for the difficulty: 1
 *   - solved later: 0.5
 *   - game over (out of lives) or a penalised leave: 0
 * A solo game that is left without a penalty is not rated. Scopes are 'solo-easy', 'solo-medium' and 'solo-hard' (lifetime only).
 *
 * PAR_SECONDS are placeholders to tune from real solve times; changing them changes future ratings only if the history is
 * replayed.
 */

const R = require('./ratings');

const SOLO_GAMES = new Set(['sudoku']);
const PAR_SECONDS = { easy: 420, medium: 720, hard: 1080 };
const K = 32;
const PAR_RATING = R.START;

/** Whether a finished match is a solo game (one seat), so it takes the solo path and not the pairwise one. */
function appliesTo(m) {
  return SOLO_GAMES.has(m.gameId) && m.participants.length === 1;
}

/**
 * The solo result for a finished solo match: { rated: true, playerId, scope, outcome } or { rated: false, reason }.
 * A winner's score is the seconds they took (see games/sudoku/engine.js results()).
 */
function soloResult(m) {
  if (m.completed === false) return { rated: false, reason: 'unfinished' };
  const p = m.participants[0];
  if (!p.playerId || p.isBot) return { rated: false, reason: 'bot' };
  if (p.isGuest) return { rated: false, reason: 'guest' }; // a guest seat is not rated, like a guest in a multi-player match
  if (p.leftEarly && !p.forfeit) return { rated: false, reason: 'too-few-players' };
  const difficulty = m.options && m.options.difficulty;
  if (!Object.hasOwn(PAR_SECONDS, difficulty)) return { rated: false, reason: 'solo-difficulty' };
  let outcome = 0;
  if (!p.forfeit && p.isWinner) outcome = Number(p.score) <= PAR_SECONDS[difficulty] ? 1 : 0.5;
  return { rated: true, playerId: p.playerId, scope: `solo-${difficulty}`, outcome };
}

/** The rating change for one solo game against the par rating. */
function soloDelta(rating, outcome) {
  const expected = 1 / (1 + Math.pow(10, (PAR_RATING - rating) / 400));
  return K * (outcome - expected);
}

module.exports = { SOLO_GAMES, PAR_SECONDS, K, PAR_RATING, appliesTo, soloResult, soloDelta };
