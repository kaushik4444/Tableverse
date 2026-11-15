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
// only an account has a UUID id; a guest's or a bot's seat id is not stored, so its XP is not kept
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * `saved` is true only for an account (its XP is kept); guests and bots are shown but not kept.
 * Bots earn no time and no game XP. `gameXp` is null for a seat that is not ranked (an unpenalised leave).
 */
function matchXpOf(record) {
  const parts = (record && record.participants) || [];
  const points = pointsOfMatch(record.gameId, parts);
  return parts
    .map((r) => ({
      seat: r.seat,
      isBot: Boolean(r.isBot),
      saved: ACCOUNT_ID.test(String(r.playerId || '')) && !r.isBot,
      minutes: r.isBot ? 0 : Math.floor((Number(r.secondsPlayed) || 0) / 60),
      timeXp: r.isBot ? 0 : timeXp(r.secondsPlayed),
      gameXp: seatKey(r) in points ? points[seatKey(r)] : null,
      penalised: Boolean(r.forfeit),
    }))
    .sort((a, b) => a.seat - b.seat);
}

module.exports = { computeProgress, matchXpOf };
