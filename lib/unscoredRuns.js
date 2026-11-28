'use strict';
/**
 * A solo Falling Blocks run has no winner: it is kept in the history, but it is neither a win nor a loss, so it does not
 * count against anyone's record. One place decides which runs those are, for the profile, the account list and the stats.
 *
 * "Solo" means one HUMAN player. The table's capacity (seats) is not used: empty seats are filled with bots at start, so a
 * solo run can have more than one seat. A record without a stored human count (table_humans is NULL, written before the
 * column existed) is treated as scored, because its number of humans is unknown.
 * The SQL twin (UNSCORED_SQL) must match this rule.
 */
const isUnscoredRun = (gameId, humans) => gameId === 'fallingblocks' && Number(humans) === 1;

// Used in SQL on a joined `matches m`: the same rule as isUnscoredRun.
// COALESCE: a NULL human count (old record) must be FALSE, not NULL, so NOT (...) keeps the run scored.
const UNSCORED_SQL = "COALESCE((m.game_id = 'fallingblocks' AND m.table_humans = 1), FALSE)";

module.exports = { isUnscoredRun, UNSCORED_SQL };
