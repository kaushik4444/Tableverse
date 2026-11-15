'use strict';
// Progress from stored rows: account level from time only, a level per game from skill, penalised leaves counted. No database.
const assert = require('node:assert/strict');
const { computeProgress } = require('../lib/progress');
const dbMatches = require('../db/matches');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const row = (matchId, gameId, seat, playerId, over = {}) => ({ matchId, gameId, seat, playerId, score: 0, place: null, isWinner: false, isDraw: false, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 600, ...over });

(async () => {
  await test('no games: level 1, no minutes, no leaves', () => {
    const p = computeProgress([], 'me');
    assert.equal(p.account.level, 1); assert.equal(p.account.minutes, 0); assert.equal(p.penalisedLeaves, 0); assert.deepEqual(p.games, {});
  });
  await test('account XP is time only: a loss gives the same XP as a win', () => {
    const win = computeProgress([row('1', 'twentynine', 0, 'me', { isWinner: true, secondsPlayed: 3000 }), row('1', 'twentynine', 1, 'x')], 'me');
    const loss = computeProgress([row('1', 'twentynine', 0, 'me', { secondsPlayed: 3000 }), row('1', 'twentynine', 1, 'x', { isWinner: true })], 'me');
    assert.equal(win.account.xp, 50); assert.equal(win.account.level, 2); assert.equal(win.account.minutes, 50);
    assert.equal(loss.account.xp, 50);
  });
  await test('a game level is skill: a win is +20, a loss -20, a placing game uses the ladder', () => {
    const p = computeProgress([
      row('1', 'tictactoe', 0, 'me', { isWinner: true }), row('1', 'tictactoe', 1, 'x'),
      row('2', 'wizard', 0, 'me', { score: 100 }), row('2', 'wizard', 1, 'x', { score: 50 }), row('2', 'wizard', 2, 'y', { score: 0 }),
    ], 'me');
    assert.equal(p.games.tictactoe.points, 20);
    assert.equal(p.games.wizard.points, 20);
    assert.equal(p.games.wizard.played, 1);
  });
  await test('points can go negative and the level stays at 1', () => {
    const p = computeProgress([row('1', 'tictactoe', 0, 'me'), row('1', 'tictactoe', 1, 'x', { isWinner: true })], 'me');
    assert.equal(p.games.tictactoe.points, -20); assert.equal(p.games.tictactoe.level, 1);
  });
  await test('a penalised leave is -30, counts as a leave, and gives no time', () => {
    const p = computeProgress([row('1', 'twentynine', 0, 'me', { leftEarly: true, forfeit: true, secondsPlayed: 0 }), row('1', 'twentynine', 1, 'x', { isWinner: true })], 'me');
    assert.equal(p.games.twentynine.points, -30); assert.equal(p.penalisedLeaves, 1); assert.equal(p.account.minutes, 0);
  });
  await test('bots and other people never count as me, and a match I was not in is ignored', () => {
    const p = computeProgress([row('1', 'tictactoe', 0, 'bot', { isBot: true, isWinner: true }), row('1', 'tictactoe', 1, 'x')], 'me');
    assert.deepEqual(p.games, {});
  });
  await test('the in-memory store gives progress through the same path', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await dbMatches.recordMatch({ matchKey: 'k1', roomCode: 'AAAAAA', gameId: 'tictactoe', seats: 2, options: {}, startedAt: new Date(Date.now() - 1200000), participants: [
      { playerId: id, name: 'A', seat: 0, score: 1, isWinner: true }, { playerId: 'b', name: 'B', seat: 1, score: 0 } ] });
    const p = await dbMatches.getProgress(id);
    assert.equal(p.games.tictactoe.points, 20);
    assert.ok(p.account.minutes >= 19 && p.account.minutes <= 20);
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
