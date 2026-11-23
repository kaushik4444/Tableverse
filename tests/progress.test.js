'use strict';
// Progress from stored rows: the one overall level from time only, games played per game (no game points or levels), penalised leaves counted. No database.
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
  await test('a game reports games played and its rule, and a placing game is counted the same way', () => {
    const p = computeProgress([
      row('1', 'tictactoe', 0, 'me', { isWinner: true }), row('1', 'tictactoe', 1, 'x'),
      row('2', 'wizard', 0, 'me', { score: 100 }), row('2', 'wizard', 1, 'x', { score: 50 }), row('2', 'wizard', 2, 'y', { score: 0 }),
    ], 'me');
    assert.deepEqual(p.games.tictactoe, { played: 1, rule: 'win-lose' });
    assert.deepEqual(p.games.wizard, { played: 1, rule: 'placing' });
  });
  await test('there is no per-game level and no per-game points in the progress output', () => {
    const p = computeProgress([row('1', 'tictactoe', 0, 'me'), row('1', 'tictactoe', 1, 'x', { isWinner: true })], 'me');
    assert.equal(p.games.tictactoe.level, undefined, 'no per-game level');
    assert.equal(p.games.tictactoe.points, undefined, 'no per-game points');
    assert.equal(JSON.stringify(p).includes('"points"'), false, 'no points anywhere in the output');
  });
  await test('Player Progress is time only: game results never change the overall level', () => {
    const game = (matchId, seat, playerId, extra) => row(matchId, 'tictactoe', seat, playerId, { secondsPlayed: 600, ...extra });
    // both play two 10-minute games; one loses both, the other wins both
    const loser = computeProgress([game('1', 0, 'me'), game('1', 1, 'x', { isWinner: true }), game('2', 0, 'me'), game('2', 1, 'x', { isWinner: true })], 'me');
    const winner = computeProgress([game('1', 0, 'me', { isWinner: true }), game('1', 1, 'x'), game('2', 0, 'me', { isWinner: true }), game('2', 1, 'x')], 'me');
    assert.equal(loser.account.xp, 20, '20 minutes = 20 Player Progress');
    assert.equal(winner.account.xp, 20);
    assert.equal(loser.account.level, winner.account.level, 'the same level whatever the results');
    assert.equal(loser.games.tictactoe.played, 2);
    assert.equal(winner.games.tictactoe.played, 2);
  });
  await test('history is re-scored from the stored rows: the time is unchanged and the game counts once', () => {
    const p = computeProgress([row('1', 'tictactoe', 0, 'me', { secondsPlayed: 300 }), row('1', 'tictactoe', 1, 'x', { isWinner: true, secondsPlayed: 300 })], 'me');
    assert.equal(p.games.tictactoe.played, 1);
    assert.equal(p.account.minutes, 5);
    assert.equal(p.account.xp, 5);
  });
  await test('a penalised leave counts as a leave and a game played, and gives no time', () => {
    const p = computeProgress([row('1', 'twentynine', 0, 'me', { leftEarly: true, forfeit: true, secondsPlayed: 0 }), row('1', 'twentynine', 1, 'x', { isWinner: true })], 'me');
    assert.equal(p.games.twentynine.played, 1); assert.equal(p.penalisedLeaves, 1); assert.equal(p.account.minutes, 0);
  });
  await test('an unpenalised leave is not a game played, but the time still counts for the account', () => {
    const p = computeProgress([row('1', 'wizard', 0, 'me', { leftEarly: true, secondsPlayed: 0 }), row('1', 'wizard', 1, 'x', { score: 5 }), row('1', 'wizard', 2, 'y', { score: 3 })], 'me');
    assert.deepEqual(p.games, {}, 'no Wizard game from an abandoned game');
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
    assert.match(src, /if \(!s \|\| !s\.played\) return progressHTML\(s && s\.progress, interactive\) \+ emptyState\(/);
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
    assert.equal(p.games.tictactoe.played, 1);
    assert.equal(p.games.tictactoe.points, undefined);
    assert.ok(p.account.minutes >= 19 && p.account.minutes <= 20);
  });
  await test('a game reports its scoring rule, so the profile can explain how it is ranked', () => {
    const p = computeProgress([row('m1', 'wizard', 0, 'me', { score: 9 }), row('m1', 'wizard', 1, 'other', { score: 3 })], 'me');
    assert.equal(p.games.wizard.rule, 'placing');
    const t = computeProgress([row('m2', 'tictactoe', 0, 'me', { isWinner: true }), row('m2', 'tictactoe', 1, 'other')], 'me');
    assert.equal(t.games.tictactoe.rule, 'win-lose');
  });

  await test('the match XP breakdown matches the stored rules: time per seat, bots and unranked leavers, and no game points', () => {
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: 'me', score: 0, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 600 },
      { seat: 1, playerId: null, score: 0, isWinner: false, isBot: true, leftEarly: false, forfeit: false, secondsPlayed: 0 },
    ] };
    const out = matchXpOf(rec);
    // 'me' is not an account id, so this seat is a guest: shown, but not kept
    assert.deepEqual(out[0], { seat: 0, isBot: false, saved: false, minutes: 10, timeXp: 10, penalised: false });
    assert.deepEqual(out[1], { seat: 1, isBot: true, saved: false, minutes: 0, timeXp: 0, penalised: false });
  });

  await test('only a registered account is saved: a UUID alone (anonymous or deleted player) is not', () => {
    const uuid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: uuid, score: 0, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 60 },
      { seat: 1, playerId: uuid.replace('6f1c', '7a2d'), score: 0, isWinner: false, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 60 },
    ] };
    const out = matchXpOf(rec, new Set([uuid]));
    assert.equal(out[0].saved, true, 'a registered account keeps its XP');
    assert.equal(out[1].saved, false, 'an id that is not registered is not kept, even if it looks like a UUID');
    assert.equal(matchXpOf(rec)[0].saved, false, 'with no registered set nothing is kept');
  });

  await test('a registered player who left mid-game is still kept (their record is not a bot seat)', () => {
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: 'leaver', score: 0, isWinner: false, isBot: false, leftEarly: true, forfeit: true, secondsPlayed: 125 },
      { seat: 1, playerId: 'other', score: 0, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 300 },
    ] };
    const out = matchXpOf(rec, new Set(['leaver', 'other']));
    assert.equal(out[0].saved, true);
    assert.equal('gameXp' in out[0], false, 'no game points in the breakdown');
    assert.equal(out[0].penalised, true);
  });

  await test('a UUID alone does not make a seat an account: anonymous and deleted players are not kept', () => {
    const uuid = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: uuid, score: 1, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 300 }, // anonymous: an id, not an account
      { seat: 1, playerId: 'deleted', score: 0, isWinner: false, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 300 },
    ] };
    // registered = the accounts at the table when the game began; the deleted player was removed from it by the deletion
    const registered = new Set(['deleted']);
    registered.delete('deleted');
    const out = matchXpOf(rec, registered);
    assert.equal(out[0].saved, false, 'an anonymous player with a UUID is not kept');
    assert.equal(out[1].saved, false, 'a deleted account is not kept');
    assert.ok(out[0].timeXp >= 0, 'the guest still sees the XP it earned');
  });

  await test('a penalised leaver gets the time up to leaving and the penalty flag, with no game points', () => {
    const rec = { gameId: 'tictactoe', participants: [
      { seat: 0, playerId: 'me', score: 0, isWinner: false, isBot: false, leftEarly: true, forfeit: true, secondsPlayed: 125 },
      { seat: 1, playerId: 'other', score: 0, isWinner: true, isBot: false, leftEarly: false, forfeit: false, secondsPlayed: 300 },
    ] };
    const out = matchXpOf(rec);
    assert.equal(out[0].minutes, 2);
    assert.equal(out[0].penalised, true);
    assert.equal('gameXp' in out[1], false, 'the winner has no game points either');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
