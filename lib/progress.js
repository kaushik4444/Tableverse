'use strict';
/**
 * A player's progress from stored match rows, and the XP each finished match gave. Pure: no database.
 * Rules are in docs/PROGRESS_LEVELS.md.
 *
 * Two kinds of XP, kept apart everywhere they are shown:
 *  - ACCOUNT XP (overall progress): 1 XP per full minute of active play. It drives the one overall level.
 *  - GAME XP (per game): the skill points of that game (lib/gameSkill.js), summed. There are no levels per game.
 *
 * `rows` are the participant rows of every match the player took part in (all participants of each match, because a
 * game's points compare players with each other): { matchId, gameId, seat, playerId, score, place, isWinner, isDraw,
 * isBot, leftEarly, forfeit, secondsPlayed }, oldest match first. `playerId` is the account id or null.
 */
const { gameSkillPoints, ruleKindOf } = require('./gameSkill');
const { timeXp, levelProgress } = require('./xp');

// a seat number is the key: bots and deleted accounts have no id, and two people never share a seat
const seatKey = (r) => 's' + r.seat;

/** The game points of every ranked seat in one match, keyed by seat key. Unranked seats (bots, unpenalised leaves) are absent. */
function pointsOfMatch(gameId, participants) {
  return gameSkillPoints(gameId, participants.map((r) => ({
    playerId: seatKey(r), score: r.score, place: r.place, isWinner: r.isWinner, isDraw: r.isDraw, isBot: r.isBot, leftEarly: r.leftEarly, forfeit: r.forfeit,
  })));
}

function computeProgress(rows, playerId) {
  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, []);
    byMatch.get(r.matchId).push(r);
  }
  let seconds = 0;
  let xp = 0;
  let leaves = 0;
  const games = {};
  for (const list of byMatch.values()) {
    const mine = list.find((r) => r.playerId === playerId && !r.isBot);
    if (!mine) continue;
    xp += timeXp(mine.secondsPlayed);
    seconds += Number(mine.secondsPlayed) || 0;
    if (mine.forfeit) leaves++;
    const points = pointsOfMatch(mine.gameId, list);
    // an unpenalised leave is not ranked: it gets no game XP entry (its time above still counts)
    if (!(seatKey(mine) in points)) continue;
    const g = (games[mine.gameId] = games[mine.gameId] || { points: 0, played: 0, rule: ruleKindOf(mine.gameId) });
    g.points += points[seatKey(mine)];
    g.played += 1;
  }
  return {
    account: { ...levelProgress(xp), minutes: Math.floor(seconds / 60) },
    games,
    penalisedLeaves: leaves,
  };
}

/**
 * The XP one finished match gave each seat, from its record (the same rules as computeProgress, so what a game-over
 * screen shows is what is stored). Returns one entry per participant in the record, in seat order:
 *   { seat, isBot, saved, minutes, timeXp, gameXp (number, or null when not ranked), penalised }
 * `saved` is true only for a seat whose player is in `registeredIds` (the signed-in accounts at the table when the game
 * ended); guests and bots are shown but not kept. An id's shape does not prove an account: anonymous players also have ids.
 * Bots earn no time and no game XP. `gameXp` is null for a seat that is not ranked (an unpenalised leave).
 */
function matchXpOf(record, registeredIds = new Set()) {
  const parts = (record && record.participants) || [];
  const points = pointsOfMatch(record.gameId, parts);
  return parts
    .map((r) => ({
      seat: r.seat,
      isBot: Boolean(r.isBot),
      saved: Boolean(r.playerId) && !r.isBot && registeredIds.has(r.playerId),
      minutes: r.isBot ? 0 : Math.floor((Number(r.secondsPlayed) || 0) / 60),
      timeXp: r.isBot ? 0 : timeXp(r.secondsPlayed),
      gameXp: seatKey(r) in points ? points[seatKey(r)] : null,
      penalised: Boolean(r.forfeit),
    }))
    .sort((a, b) => a.seat - b.seat);
}

/**
 * The weekly board for one game: the people who turned it on, ranked by their Game XP in that game over the rows given
 * (the rows should already cover the window, and only that game). Same rules as the profile, so the numbers agree.
 * People with no ranked game in the window are left out. Ties: more games first, then username. Pure: no database.
 */
function boardFor(rows, people, gameId, limit = 10) {
  // Group the rows and score each match once. Recomputing a player's complete progress for every
  // opted-in person made this endpoint O(people × rows), even though it returns at most 10 entries.
  const eligible = new Map(people.map((p) => [p.id, {
    username: p.username, displayName: p.displayName || p.username, points: 0, played: 0,
  }]));
  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, []);
    byMatch.get(r.matchId).push(r);
  }
  for (const participants of byMatch.values()) {
    const matchGame = participants[0] && participants[0].gameId;
    if (matchGame !== gameId) continue;
    const points = pointsOfMatch(gameId, participants);
    for (const r of participants) {
      if (r.isBot || !eligible.has(r.playerId)) continue;
      const earned = points[seatKey(r)];
      if (earned === undefined) continue; // unranked seats do not appear on the board
      const entry = eligible.get(r.playerId);
      entry.points += earned;
      entry.played += 1;
    }
  }
  const out = [...eligible.values()].filter((p) => p.played > 0);
  out.sort((a, b) => b.points - a.points || b.played - a.played || a.username.localeCompare(b.username));
  return out.slice(0, Math.max(0, Math.min(50, Number(limit) || 10)));
}

module.exports = { computeProgress, matchXpOf, boardFor };
