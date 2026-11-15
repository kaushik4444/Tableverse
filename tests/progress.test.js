'use strict';
// Progress from stored rows: the one overall level from time only, game XP per game (no game levels), penalised leaves counted. No database.
require('./helpers/env'); // first: no test may reach a real database
const assert = require('node:assert/strict');
const { computeProgress, matchXpOf } = require('../lib/progress');
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
  await test('a game has game XP only: a win is +20, a loss -20, a placing game uses the ladder', () => {
    const p = computeProgress([
      row('1', 'tictactoe', 0, 'me', { isWinner: true }), row('1', 'tictactoe', 1, 'x'),
      row('2', 'wizard', 0, 'me', { score: 100 }), row('2', 'wizard', 1, 'x', { score: 50 }), row('2', 'wizard', 2, 'y', { score: 0 }),
    ], 'me');
    assert.equal(p.games.tictactoe.points, 20);
    assert.equal(p.games.wizard.points, 20);
    assert.equal(p.games.wizard.played, 1);
  });
  await test('game XP can go negative and there is no game level', () => {
    const p = computeProgress([row('1', 'tictactoe', 0, 'me'), row('1', 'tictactoe', 1, 'x', { isWinner: true })], 'me');
    assert.equal(p.games.tictactoe.points, -20); assert.equal(p.games.tictactoe.level, undefined, 'no per-game level');
  });
  await test('a penalised leave is -30, counts as a leave, and gives no time', () => {
    const p = computeProgress([row('1', 'twentynine', 0, 'me', { leftEarly: true, forfeit: true, secondsPlayed: 0 }), row('1', 'twentynine', 1, 'x', { isWinner: true })], 'me');
    assert.equal(p.games.twentynine.points, -30); assert.equal(p.penalisedLeaves, 1); assert.equal(p.account.minutes, 0);
  });
  await test('an unpenalised leave gives no game XP entry, but the time still counts for the account', () => {
    const p = computeProgress([row('1', 'wizard', 0, 'me', { leftEarly: true, secondsPlayed: 0 }), row('1', 'wizard', 1, 'x', { score: 5 }), row('1', 'wizard', 2, 'y', { score: 3 })], 'me');
    assert.deepEqual(p.games, {}, 'no Wizard level from an abandoned game');
    const q = computeProgress([row('1', 'wizard', 0, 'me', { leftEarly: true, secondsPlayed: 180 }), row('1', 'wizard', 1, 'x', { score: 5 })], 'me');
    assert.equal(q.account.minutes, 3);
  });
  await test('memory store: minutes do not keep growing between reads, and a future finish time is clamped', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    await dbMatches.recordMatch({ matchKey: 'k2', roomCode: 'BBBBBB', gameId: 'tictactoe', seats: 2, options: {}, startedAt: new Date(Date.now() - 600000), finishedAt: new Date(Date.now() + 3600000),
      participants: [{ playerId: id, name: 'A', seat: 0, score: 1, isWinner: true }, { playerId: 'c', name: 'C', seat: 1, score: 0 }] });
    const first = (await dbMatches.getProgress(id)).account.minutes;
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await dbMatches.getProgress(id)).account.minutes, first);
    assert.ok(first >= 9 && first <= 10, 'ten minutes, not an hour: ' + first);
  });
  await test('a new account sees its level before the first game (the empty profile keeps the progress card)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.match(src, /if \(!s \|\| !s\.played\) return progressHTML\(s && s\.progress\) \+ emptyState\(/);
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
  await test('a game reports its scoring rule, so the profile can explain how its XP is earned', () => {
    const p = computeProgress([row('m1', 'wizard', 0, 'me', { score: 9 }), row('m1', 'wizard', 1, 'other', { score: 3 })], 'me');
    assert.equal(p.games.wizard.rule, 'placing');
    const t = computeProgress([row('m2', 'tictactoe', 0, 'me', { isWinner: true }), row('m2', 'tictactoe', 1, 'other')], 'me');
    assert.equal(t.games.tictactoe.rule, 'win-lose');
  });

  await test('the match XP breakdown matches the stored rules: time per seat, game XP, bots and unranked leavers', () => {
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: 'me', score: 0, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 600 },
      { seat: 1, playerId: null, score: 0, isWinner: false, isBot: true, leftEarly: false, forfeit: false, secondsPlayed: 0 },
    ] };
    const out = matchXpOf(rec);
    // 'me' is not an account id, so this seat is a guest: shown, but not kept
    assert.deepEqual(out[0], { seat: 0, isBot: false, saved: false, minutes: 10, timeXp: 10, gameXp: 20, penalised: false });
    assert.deepEqual(out[1], { seat: 1, isBot: true, saved: false, minutes: 0, timeXp: 0, gameXp: null, penalised: false });
  });

  await test('a penalised leaver gets the leave points and the time up to leaving', () => {
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: 'me', score: 0, isWinner: false, isBot: false, leftEarly: true, forfeit: true, secondsPlayed: 125 },
      { seat: 1, playerId: 'other', score: 0, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 300 },
    ] };
    const out = matchXpOf(rec);
    assert.equal(out[0].gameXp, -30);
    assert.equal(out[0].minutes, 2);
    assert.equal(out[0].penalised, true);
    assert.equal(out[1].gameXp, 20);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
