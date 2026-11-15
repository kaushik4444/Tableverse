'use strict';
// Account XP (time only), game skill points (each game its own rule), and the shared level curve. Pure, no database.
const assert = require('node:assert/strict');
const xp = require('../lib/xp');
const { gameSkillPoints, ladder, WIN, LOSS, LEAVE, RULES } = require('../lib/gameSkill');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const p = (playerId, score, extra = {}) => ({ playerId, score, isWinner: false, isDraw: false, isBot: false, leftEarly: false, forfeit: false, ...extra });
const w = (playerId, extra = {}) => p(playerId, 0, { isWinner: true, ...extra });
const l = (playerId, extra = {}) => p(playerId, 0, { ...extra });
const d = (playerId, extra = {}) => p(playerId, 0, { isDraw: true, ...extra });

test('account XP is 1 per full minute, whatever the result', () => {
  assert.equal(xp.timeXp(0), 0);
  assert.equal(xp.timeXp(59), 0);
  assert.equal(xp.timeXp(60), 1);
  assert.equal(xp.timeXp(615), 10);
  assert.equal(xp.timeXp(-30), 0);
  assert.equal(xp.timeXp(undefined), 0);
});

test('level 2 starts at 100 XP, and each level needs 100 more than the one before', () => {
  assert.equal(xp.levelStart(1), 0);
  assert.equal(xp.levelStart(2), 100);
  assert.equal(xp.levelStart(3), 300);
  assert.equal(xp.levelStart(4), 600);
  const steps = [2, 3, 4, 5, 6].map((n) => xp.levelStart(n + 1) - xp.levelStart(n));
  assert.deepEqual(steps, [200, 300, 400, 500, 600]);
});

test('levelProgress reports the level, how far in it, and its size', () => {
  assert.deepEqual(xp.levelProgress(0), { level: 1, xp: 0, into: 0, need: 100 });
  assert.deepEqual(xp.levelProgress(99), { level: 1, xp: 99, into: 99, need: 100 });
  assert.deepEqual(xp.levelProgress(100), { level: 2, xp: 100, into: 0, need: 200 });
  assert.deepEqual(xp.levelProgress(450), { level: 3, xp: 450, into: 150, need: 300 });
  assert.equal(xp.levelProgress(-5).level, 1, 'negative XP reads as level 1');
});

test('Wizard: placings by score; the last player gets a negative', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('B', 30), p('C', 10), p('D', 0)]);
  assert.equal(pts.A, WIN, '1st is the best');
  assert.equal(pts.D, LOSS, 'last place is negative');
  assert.ok(pts.B > 0 && pts.C < 0 && pts.B > pts.C, 'in-between places are in order');
  assert.ok(pts.D < 0);
});

test('Wizard: a penalised leave is worse than finishing last', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('B', 10, { leftEarly: true, forfeit: true }), p('C', 5)]);
  assert.equal(pts.B, LEAVE);
  assert.ok(pts.B < LOSS, 'a leave is more negative than last place');
});

test('ties share a place', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('B', 10), p('C', 10), p('D', 0)]);
  assert.equal(pts.B, pts.C);
});

test('ladder: 1st +20, last -20, in a straight line between; a lone player 0', () => {
  assert.equal(ladder(1, 4), 20);
  assert.equal(ladder(4, 4), -20);
  assert.equal(ladder(2, 3), 0);
  assert.equal(ladder(1, 1), 0);
});

test('Twenty-nine and The Mind: a win is +20, a draw 0, a loss -20 for everyone on that side', () => {
  const pts = gameSkillPoints('twentynine', [w('A'), w('B'), l('C'), l('D')]);
  assert.deepEqual([pts.A, pts.B, pts.C, pts.D], [WIN, WIN, LOSS, LOSS]);
  const drawn = gameSkillPoints('themind', [d('A'), d('B')]);
  assert.equal(drawn.A, 0);
  assert.equal(drawn.B, 0);
});

test('Line Games: a win, a draw and a loss', () => {
  const pts = gameSkillPoints('linegames', [w('A'), l('B')]);
  assert.equal(pts.A, WIN);
  assert.equal(pts.B, LOSS);
});

test('a penalised leave costs the same in every game and is worse than losing', () => {
  for (const gameId of Object.keys(RULES)) {
    const pts = gameSkillPoints(gameId, [w('A'), l('B'), p('C', 0, { leftEarly: true, forfeit: true })]);
    assert.equal(pts.C, LEAVE, gameId + ': a penalised leave is -30');
    assert.ok(pts.C < LOSS, gameId + ': worse than losing');
  }
});

test('a leave without a penalty is not in the game ranking at all', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('B', 30, { leftEarly: true }), p('C', 10)]);
  assert.equal(pts.B, undefined);
  assert.equal(Object.keys(pts).length, 2);
});

test('bots are not ranked', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('bot', 99, { isBot: true }), p('C', 10)]);
  assert.equal(pts.bot, undefined);
  assert.equal(pts.A, WIN);
});

test('a game with no rule of its own is ranked by placings', () => {
  const pts = gameSkillPoints('some-new-game', [p('A', 9), p('B', 1)]);
  assert.equal(pts.A, WIN);
  assert.equal(pts.B, LOSS);
});

test('game points can go negative; the running total is not floored', () => {
  assert.equal(xp.runningTotal([-30, -20]), -50);
  assert.equal(xp.runningTotal([20, -30]), -10);
});

test('account XP accumulates across games', () => {
  assert.equal(xp.runningTotal([xp.timeXp(600), xp.timeXp(900)]), 25);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
