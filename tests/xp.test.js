'use strict';
// Account XP (time only) and game skill points (finish and penalties), plus the shared level curve. Pure, no database.
const assert = require('node:assert/strict');
const xp = require('../lib/xp');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const p = (playerId, score, extra = {}) => ({ playerId, score, isBot: false, leftEarly: false, forfeit: false, ...extra });

test('account XP is 1 per full minute, whatever the result', () => {
  assert.equal(xp.timeXp(0), 0);
  assert.equal(xp.timeXp(59), 0);
  assert.equal(xp.timeXp(60), 1);
  assert.equal(xp.timeXp(615), 10);
  assert.equal(xp.timeXp(-30), 0);
  assert.equal(xp.timeXp(undefined), 0);
});

test('game skill: the winner gets the most, the last place the least, ties share a position', () => {
  const pts = xp.gameSkillPoints([p('A', 50), p('B', 30), p('C', 10), p('D', 10)]);
  assert.equal(pts.A, 10 + 20);
  assert.equal(pts.B, 10 + Math.round((20 * 2) / 3));
  assert.equal(pts.C, pts.D, 'tied players get the same points');
  assert.equal(pts.C, 10 + Math.round(20 / 3), 'two players tie for 3rd of 4: position 3');
  assert.ok(pts.A > pts.B && pts.B > pts.C);
});

test('a penalised leaver loses game points for that game', () => {
  const pts = xp.gameSkillPoints([p('A', 50), p('B', 30, { leftEarly: true, forfeit: true }), p('C', 10)]);
  assert.equal(pts.B, xp.LEAVE_POINTS);
  assert.equal(pts.A, 10 + 20);
});

test('a leave without a penalty is not in the game ranking at all', () => {
  const pts = xp.gameSkillPoints([p('A', 50), p('B', 30, { leftEarly: true }), p('C', 10)]);
  assert.equal(pts.B, undefined);
  assert.equal(Object.keys(pts).length, 2);
});

test('a lone player in a game earns the full position bonus', () => {
  assert.equal(xp.gameSkillPoints([p('A', 5)]).A, 10 + 20);
});

test('game points never go below zero in total', () => {
  assert.equal(xp.runningTotal([-15, -15]), 0);
  assert.equal(xp.runningTotal([30, -15, -15]), 0);
  assert.equal(xp.runningTotal([30, -15]), 15);
  assert.equal(xp.runningTotal([]), 0);
});

test('levels: each level needs more than the one before', () => {
  assert.equal(xp.levelStart(1), 0);
  assert.equal(xp.levelStart(2), 100);
  assert.equal(xp.levelStart(3), 300);
  assert.equal(xp.levelStart(4), 600);
  const steps = [2, 3, 4, 5, 6].map((n) => xp.levelStart(n + 1) - xp.levelStart(n));
  assert.deepEqual(steps, [200, 300, 400, 500, 600], 'each level needs 100 more than the previous one');
});

test('levelProgress reports the level, how far in it, and its size', () => {
  assert.deepEqual(xp.levelProgress(0), { level: 1, xp: 0, into: 0, need: 100 });
  assert.deepEqual(xp.levelProgress(99), { level: 1, xp: 99, into: 99, need: 100 });
  assert.deepEqual(xp.levelProgress(100), { level: 2, xp: 100, into: 0, need: 200 });
  assert.deepEqual(xp.levelProgress(450), { level: 3, xp: 450, into: 150, need: 300 });
  assert.equal(xp.levelProgress(-5).level, 1, 'negative XP reads as level 1');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
