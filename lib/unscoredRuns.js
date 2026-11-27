'use strict';
/**
 * A solo Falling Blocks run has no winner: it is kept in the history, but it is neither a win nor a loss, so it does not
 * count against anyone's record. One place decides which runs those are, for the profile, the account list and the stats.
 * The SQL twin (UNSCORED_SQL) must match this rule.
 */
const isUnscoredRun = (gameId, seats) => gameId === 'fallingblocks' && Number(seats) === 1;

// Used in SQL on a joined `matches m`: the same rule as isUnscoredRun.
const UNSCORED_SQL = "(m.game_id = 'fallingblocks' AND m.seats = 1)";

module.exports = { isUnscoredRun, UNSCORED_SQL };
