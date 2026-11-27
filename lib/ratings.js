'use strict';
/**
 * Skill ratings per game (Elo). Pure: no database, no clock except the one passed in.
 * Design: design/scoring-skill-ratings.md in the Tableverse project.
 *
 * Every rating starts at START. A match changes ratings by K * weight * (actual - expected), where:
 *  - "pairwise" families (1v1, placing games): each player is compared with every opponent; the expected and actual
 *    scores are averaged over the opponents, so a 6-player game does not swing more than a 2-player game.
 *  - "team" (Twenty-nine): a team's rating is the mean of its members; every member gets the team's change.
 *  - "cooperative" (Mind): the whole table against a fixed reference rating; every player gets the same change.
 * Pairwise and team changes are zero-sum across the match (teams of equal size): each pair uses the average of the two
 * players' K factors, so a transfer is the same in both directions whatever their experience. Cooperative changes are
 * not zero-sum: the reference is not a player, so the table's total change is not zero by design. Everyone at a table
 * gets the same cooperative change.
 *
 * Values are not rounded here; display rounds them, so totals stay exact.
 */

const START = 1000;
const K_NEW = 40; // first NEW_GAMES rated games in a game
const K_BASE = 24;
const NEW_GAMES = 10;
const COOP_REFERENCE = 1000;
const DAILY_CAP = 60; // most a rating in one game can move in one UTC day

// The same pair in the same game within a rolling 24 hours: the first FULL matches count in full, the next HALF_UNTIL at
// half, and any after that count 0 (they are still recorded, unrated).
const PAIR_FULL = 3;
const PAIR_HALF_UNTIL = 5;

// Family and weight per game. Unknown games use the placing family at full weight, like lib/gameSkill.js does.
const GAMES = {
  tictactoe: { family: 'pairwise', weight: 1 },
  fourinarow: { family: 'pairwise', weight: 1 },
  chess: { family: 'pairwise', weight: 1 },
  carrom: { family: 'pairwise', weight: 1 },
  wizard: { family: 'pairwise', weight: 1 },
  stagerummy: { family: 'pairwise', weight: 1 },
  poker: { family: 'pairwise', weight: 1 },
  propertyrivals: { family: 'pairwise', weight: 1 },
  penaltyrows: { family: 'pairwise', weight: 1 },
  colorclash: { family: 'pairwise', weight: 1 },
  hiddenminers: { family: 'pairwise', weight: 1 },
  ludo: { family: 'pairwise', weight: 0.5 },
  snakesladders: { family: 'pairwise', weight: 0.5 },
  gofish: { family: 'pairwise', weight: 0.5 },
  bingo: { family: 'pairwise', weight: 0.5 }, // mostly luck, like Go Fish
  sudoku: { family: 'pairwise', weight: 0.5 }, // a race: mostly the player's own speed
  dotsboxes: { family: 'pairwise', weight: 1 },
  seabattle: { family: 'pairwise', weight: 1 }, // skill: the shots that land and the ships sunk
  memorymatch: { family: 'pairwise', weight: 1 },
  fallingblocks: { family: 'pairwise', weight: 1 }, // the rows you clear: skill, with the same blocks for everybody
  twentynine: { family: 'team', weight: 1 },
  themind: { family: 'cooperative', weight: 0.5 },
};

function gameRule(gameId) {
  return Object.prototype.hasOwnProperty.call(GAMES, gameId) ? GAMES[gameId] : { family: 'pairwise', weight: 1 };
}

/** Elo expected score of a player rated `a` against one rated `b`. */
function expectedScore(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** K factor for a player with `ratedGames` rated games in this game so far. */
function kFor(ratedGames) {
  return ratedGames < NEW_GAMES ? K_NEW : K_BASE;
}

/** 1 for a win over an opponent, 0.5 for a tie, 0 for a loss, comparing two values where higher is better. */
function compare(a, b) {
  if (a > b) return 1;
  if (a < b) return 0;
  return 0.5;
}

/** Share of a match that counts for a pair, from how many matches they already had in the last 24 hours. */
function pairMultiplier(priorMatchesIn24h) {
  if (priorMatchesIn24h < PAIR_FULL) return 1;
  if (priorMatchesIn24h < PAIR_HALF_UNTIL) return 0.5;
  return 0;
}

/**
 * Pairwise changes. `players`: [{ playerId, rating, value, ratedGames }]. `value` is higher-is-better (a win is 1 for a
 * win-lose game, or -place for a placing game). Returns { playerId: delta }.
 */
function pairwiseDeltas(players, weight, pairFactor = () => 1) {
  const out = {};
  for (const p of players) {
    const others = players.filter((q) => q.playerId !== p.playerId);
    if (others.length === 0) {
      out[p.playerId] = 0;
      continue;
    }
    // Each pair uses the average of the two K factors, so the transfer between two players is the same in both
    // directions (a newcomer's win costs a veteran exactly what it gives the newcomer). That keeps the match zero-sum.
    let change = 0;
    for (const q of others) {
      const kPair = (kFor(p.ratedGames) + kFor(q.ratedGames)) / 2;
      // pairFactor(p, q) must be symmetric (the same for both directions): then each pair stays antisymmetric and the match
      // stays zero-sum. It is how the pair limit (pairMultiplier) reduces a repeated pair's matches.
      change += pairFactor(p, q) * kPair * (compare(p.value, q.value) - expectedScore(p.rating, q.rating));
    }
    out[p.playerId] = (weight * change) / others.length;
  }
  return out;
}

/**
 * Team changes. `teams`: [{ teamId, value, members: [{ playerId, rating, ratedGames }] }]. A team's rating is the mean of
 * its members, and every member gets the team's change (with each member's own K).
 */
function teamDeltas(teams, weight) {
  const ratingOf = (t) => t.members.reduce((s, m) => s + m.rating, 0) / t.members.length;
  const kOf = (t) => t.members.reduce((s, m) => s + kFor(m.ratedGames), 0) / t.members.length;
  // Each pair of teams transfers the same amount in both directions, as in pairwiseDeltas.
  const transfer = new Map();
  for (const t of teams) {
    let change = 0;
    for (const u of teams) {
      if (u.teamId === t.teamId) continue;
      const kPair = (kOf(t) + kOf(u)) / 2;
      change += kPair * (compare(t.value, u.value) - expectedScore(ratingOf(t), ratingOf(u)));
    }
    transfer.set(t.teamId, teams.length > 1 ? (weight * change) / (teams.length - 1) : 0);
  }
  // A team's transfer is shared by its members. Teams of unequal size (a player who left without a penalty is not in
  // the match) are scaled by the average team size, so the total still balances to zero; equal teams are unchanged.
  const averageSize = teams.reduce((s, t) => s + t.members.length, 0) / teams.length;
  const out = {};
  for (const t of teams) {
    const each = (transfer.get(t.teamId) * averageSize) / t.members.length;
    for (const m of t.members) out[m.playerId] = each;
  }
  return out;
}

/**
 * Cooperative change (Mind). The table either cleared (`cleared`: every seat's value is above 0) or lost. Everyone gets the
 * same change, against the fixed reference rating, using the table's mean rating and mean K. Not zero-sum by design.
 */
function cooperativeDeltas(players, weight) {
  const cleared = players.every((p) => Number.isFinite(p.value) && p.value > 0);
  const outcome = cleared ? 1 : 0;
  const meanRating = players.reduce((s, p) => s + p.rating, 0) / players.length;
  const meanK = players.reduce((s, p) => s + kFor(p.ratedGames), 0) / players.length;
  const shared = meanK * weight * (outcome - expectedScore(meanRating, COOP_REFERENCE));
  const out = {};
  for (const p of players) out[p.playerId] = shared;
  return out;
}

/**
 * Rating changes for one finished, rated match.
 *  - `gameId`: the game (its family and weight come from GAMES).
 *  - `players`: [{ playerId, rating, ratedGames, value, teamId? }], for the players in the rated match only
 *    (use eligibility() to build this). `value` is higher-is-better; for placing games use -place.
 *    Team games give `teamId` and each team's `value`.
 * `options.pairFactor(p, q)`: optional symmetric factor for one pair (see pairMultiplier). Used by pairwise games only.
 * Returns { playerId: delta }, with 0 for a player in a match with no opponents.
 */
function matchDeltas(gameId, players, { pairFactor } = {}) {
  const rule = gameRule(gameId);
  if (rule.family === 'team') {
    const byTeam = new Map();
    // A team's value is its lowest member's value, so a penalised leave makes the team lose whatever the member order.
    for (const p of players) {
      if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, { teamId: p.teamId, value: Infinity, members: [] });
      const team = byTeam.get(p.teamId);
      team.value = Math.min(team.value, p.value);
      team.members.push(p);
    }
    return teamDeltas([...byTeam.values()], rule.weight);
  }
  if (rule.family === 'cooperative') return cooperativeDeltas(players, rule.weight);
  return pairwiseDeltas(players, rule.weight, pairFactor);
}

/**
 * Which people in a finished match are rated, and how. `participants` as stored for a match:
 * { playerId, isBot, isGuest, leftEarly, forfeit, isWinner, isDraw, place, score }.
 * - Bot and guest seats are not rated and do not count: the humans rate each other, so a match with two or more
 *   humans is rated. A guest or removed account has no stored rating, so it is treated like a bot.
 * - A penalised leave (leftEarly and forfeit) is a loss against everyone still in the game: it gets the lowest value.
 * - A leave without a penalty is not rated for that person; the match still counts for the others if at least two remain.
 * - Unfinished matches are unrated.
 * Returns { rated, reason, players } where players are the entries to pass to matchDeltas (value and teamId not set).
 */
function eligibility(participants, { finished = true } = {}) {
  if (!finished) return { rated: false, reason: 'unfinished', players: [] };
  const humans = participants.filter((p) => !p.isBot && !p.isGuest);
  const kept = humans.filter((p) => !(p.leftEarly && !p.forfeit));
  if (kept.length < 2) return { rated: false, reason: 'too-few-players', players: [] };
  return { rated: true, reason: null, players: kept };
}

/** The value a participant brings to matchDeltas: higher is better, a penalised leave is the lowest. */
function valueOf(p, { byPlace = false } = {}) {
  if (p.leftEarly && p.forfeit) return -Infinity;
  if (byPlace) return -p.place;
  return p.isDraw ? 0.5 : p.isWinner ? 1 : 0;
}

/**
 * Caps a player's change for one game on one day. `todayTotal` is what has already moved today (signed).
 * Returns the delta actually allowed.
 */
function cappedDelta(todayTotal, delta) {
  const after = todayTotal + delta;
  if (after > DAILY_CAP) return Math.max(0, DAILY_CAP - todayTotal);
  if (after < -DAILY_CAP) return Math.min(0, -DAILY_CAP - todayTotal);
  return delta;
}

/** Calendar month of a date, in UTC, as 'YYYY-MM'. Monthly ratings use this as their scope. */
function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = {
  START,
  K_NEW,
  K_BASE,
  NEW_GAMES,
  COOP_REFERENCE,
  DAILY_CAP,
  PAIR_FULL,
  PAIR_HALF_UNTIL,
  GAMES,
  gameRule,
  expectedScore,
  kFor,
  compare,
  pairMultiplier,
  matchDeltas,
  eligibility,
  valueOf,
  cappedDelta,
  monthKey,
};
