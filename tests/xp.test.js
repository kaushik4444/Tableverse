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

test('level 2 starts at 50 XP, and each level needs 50 more than the one before', () => {
  assert.equal(xp.levelStart(1), 0);
  assert.equal(xp.levelStart(2), 50);
  assert.equal(xp.levelStart(3), 150);
  assert.equal(xp.levelStart(4), 300);
  assert.equal(xp.levelStart(5), 500);
  const steps = [1, 2, 3, 4, 5].map((n) => xp.levelStart(n + 1) - xp.levelStart(n));
  assert.deepEqual(steps, [50, 100, 150, 200, 250]);
});

test('levelProgress reports the level, how far in it, and its size', () => {
  assert.deepEqual(xp.levelProgress(0), { level: 1, xp: 0, into: 0, need: 50 });
  assert.deepEqual(xp.levelProgress(49), { level: 1, xp: 49, into: 49, need: 50 });
  assert.deepEqual(xp.levelProgress(50), { level: 2, xp: 50, into: 0, need: 100 });
  assert.deepEqual(xp.levelProgress(450), { level: 4, xp: 450, into: 150, need: 200 });
  assert.equal(xp.levelProgress(-5).level, 1, 'negative XP reads as level 1');
});

test('Wizard: placings by score; the last player gets a negative', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('B', 30), p('C', 10), p('D', 0)]);
  assert.equal(pts.A, WIN, '1st is the best');
  assert.equal(pts.D, LOSS, 'last place is negative');
  assert.ok(pts.B > 0 && pts.C === 0 && pts.B > pts.C, 'in-between places are in order: +10 then 0 for four players');
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

test('ladder: 1st +20, last -10, in a straight line between; a lone player 0', () => {
  assert.equal(ladder(1, 4), 20);
  assert.equal(ladder(4, 4), -10);
  assert.equal(ladder(2, 3), 5, 'three ranked: +20, +5, -10');
  assert.equal(ladder(1, 1), 0);
});

test('Twenty-nine and Mind: a win is +20, a draw 0, a loss -10 for everyone on that side', () => {
  const pts = gameSkillPoints('twentynine', [w('A'), w('B'), l('C'), l('D')]);
  assert.deepEqual([pts.A, pts.B, pts.C, pts.D], [WIN, WIN, LOSS, LOSS]);
  const drawn = gameSkillPoints('themind', [d('A'), d('B')]);
  assert.equal(drawn.A, 0);
  assert.equal(drawn.B, 0);
});

test('Carrom: a team win is +20 for both partners, a loss -10 for both on the other team', () => {
  assert.equal(RULES.carrom, RULES.twentynine, 'carrom is a win-or-lose game, not placings');
  const pts = gameSkillPoints('carrom', [w('A'), w('C'), l('B'), l('D')]);
  assert.deepEqual([pts.A, pts.C, pts.B, pts.D], [WIN, WIN, LOSS, LOSS]);
});

test('Line Games (the real ids): a win and a loss, also when the opponent forfeits or is a bot', () => {
  for (const id of ['tictactoe', 'fourinarow']) {
    const pts = gameSkillPoints(id, [w('A'), l('B')]);
    assert.equal(pts.A, WIN, id);
    assert.equal(pts.B, LOSS, id);
    // the opponent forfeits: the remaining player is ranked alone but still gets the win
    const solo = gameSkillPoints(id, [w('A'), p('B', 0, { leftEarly: true, forfeit: true })]);
    assert.equal(solo.A, WIN, id + ' win against a forfeit');
    const vsBot = gameSkillPoints(id, [w('A'), p('B', 0, { isBot: true })]);
    assert.equal(vsBot.A, WIN, id + ' win against a bot');
  }
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
  assert.equal(xp.runningTotal([-30, -10]), -40);
  assert.equal(xp.runningTotal([20, -30]), -10);
});

test('account XP accumulates across games', () => {
  assert.equal(xp.runningTotal([xp.timeXp(600), xp.timeXp(900)]), 25);
});

test('a tie at the bottom: the lowest place still gets -10 (places 1, 2, 2 are scaled to 2, not to 3)', () => {
  const pts = gameSkillPoints('wizard', [p('A', 50), p('B', 10), p('C', 10)]);
  assert.equal(pts.A, WIN);
  assert.equal(pts.B, LOSS, 'the shared last place is last');
  assert.equal(pts.C, LOSS);
});

test('a game-supplied place is used instead of score: Property Rivals players out in order get distinct places', () => {
  // four players; all went bankrupt, so every score is 0 (the score alone cannot tell them apart)
  const pts = gameSkillPoints('propertyrivals', [
    p('A', 0, { place: 1 }), p('B', 0, { place: 2 }), p('C', 0, { place: 3 }), p('D', 0, { place: 4 }),
  ]);
  assert.equal(pts.A, WIN);
  assert.equal(pts.D, LOSS, 'the one who went out last keeps the last place, not the same as the others');
  assert.ok(pts.A > pts.B && pts.B > pts.C && pts.C > pts.D, 'each place is distinct');
});

test('Poker: the final standing gives the place, so chips that tie do not share a place', () => {
  const pts = gameSkillPoints('poker', [p('A', 300, { place: 1 }), p('B', 100, { place: 2 }), p('C', 100, { place: 3 })]);
  assert.ok(pts.B > pts.C, 'the standing separates them');
});

test('a bot in 1st place does not push the humans down: places are relative to the ranked players', () => {
  // four seats: a bot won (place 1), two humans are 2nd and 3rd, a human left without penalty (not ranked)
  const pts = gameSkillPoints('propertyrivals', [
    p('bot', 0, { place: 1, isBot: true }), p('H2', 0, { place: 2 }), p('H3', 0, { place: 3 }), p('X', 0, { place: 4, leftEarly: true }),
  ]);
  assert.equal(pts.H2, WIN, 'the best human of those ranked gets +20');
  assert.equal(pts.H3, LOSS, 'the last human ranked gets -10');
  assert.equal(pts.bot, undefined);
  assert.equal(pts.X, undefined);
});

test('a lone ranked player (everyone else left or is a bot) gets 0, not -10', () => {
  const pts = gameSkillPoints('propertyrivals', [p('H2', 0, { place: 2 }), p('bot', 0, { place: 1, isBot: true })]);
  assert.equal(pts.H2, 0);
});

test('every registered game has its own scoring rule (none silently falls back to placings)', () => {
  const games = require('../games');
  const ids = games.list().map((g) => g.id);
  assert.ok(ids.length >= 10, 'the registry lists the games');
  assert.deepEqual(ids.filter((id) => !RULES[id]), [], 'add a rule for each new game in lib/gameSkill.js');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
