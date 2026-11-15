'use strict';
/**
 * A player's progress from stored match rows. Pure: no database. Rules are in docs/PROGRESS_LEVELS.md.
 *
 * `rows` are the participant rows of every match the player took part in (all participants of each match, because a
 * game level compares players with each other): { matchId, gameId, seat, playerId, score, place, isWinner, isDraw,
 * isBot, leftEarly, forfeit, secondsPlayed }, oldest match first. `playerId` is the account id or null.
 */
const { gameSkillPoints, timeXp, levelProgress } = require('./xp');

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
    // a seat number is the key: bots and deleted accounts have no id, and two people never share a seat
    const key = (r) => 's' + r.seat;
    const points = gameSkillPoints(mine.gameId, list.map((r) => ({
      playerId: key(r), score: r.score, place: r.place, isWinner: r.isWinner, isDraw: r.isDraw, isBot: r.isBot, leftEarly: r.leftEarly, forfeit: r.forfeit,
    })));
    const g = (games[mine.gameId] = games[mine.gameId] || { points: 0, played: 0 });
    g.points += points[key(mine)] ?? 0;
    g.played += 1;
  }
  for (const g of Object.values(games)) Object.assign(g, levelProgress(g.points));
  return {
    account: { ...levelProgress(xp), minutes: Math.floor(seconds / 60) },
    games,
    penalisedLeaves: leaves,
  };
}

module.exports = { computeProgress };
