'use strict';
// The in-memory match store (no database) must survive a record with an unusable finish time: it falls back to the time
// the record was written, and never turns a bad value into an Invalid Date that breaks the profile or the progress.
// Runs without a database.
const assert = require('node:assert/strict');
const matches = require('../db/matches');

let passed = 0; let failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const part = (playerId, extra = {}) => ({ playerId, name: playerId, seat: 0, score: 5, place: null, isWinner: true, isDraw: false, isBot: false, leftEarly: false, forfeit: false, ...extra });
const game = (matchKey, finishedAt, playerId) => ({
  matchKey, roomCode: 'R' + matchKey, gameId: 'wizard', seats: 2, options: {}, startedAt: new Date(Date.now() - 600000),
  finishedAt, participants: [part(playerId), part('other', { isWinner: false, score: 1 })],
});

(async () => {
  await test('an unusable finish time falls back to the record time: the profile and progress still build', async () => {
    await matches.recordMatch(game('11111111-0000-0000-0000-000000000001', 'not-a-date', 'mem-a'));
    const profile = await matches.getPlayerProfile('mem-a');
    assert.ok(profile, 'the profile is built');
    const progress = await matches.getProgress('mem-a');
    assert.ok(progress && typeof progress === 'object', 'progress is built');
  });

  await test('a finish time in the future is clamped to the record time', async () => {
    await matches.recordMatch(game('11111111-0000-0000-0000-000000000002', new Date(Date.now() + 86400000), 'mem-b'));
    const profile = await matches.getPlayerProfile('mem-b');
    assert.ok(new Date(profile.lastPlayed).getTime() <= Date.now() + 1000, 'the game is not dated in the future');
    assert.equal(profile.played, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
