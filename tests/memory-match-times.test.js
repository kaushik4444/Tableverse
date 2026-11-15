'use strict';
// The in-memory match store (no database) must survive a record with an unusable finish time: it falls back to the time
// the record was written, and never turns a bad value into an Invalid Date that breaks the profile or the progress.
// Runs without a database.
require('./helpers/env'); // clears any inherited database setting before db/matches is loaded
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

  await test('games are ordered by completion time, not by the order they were recorded', async () => {
    // a newer win is recorded first, then an older loss: the profile must date and order them by when they finished
    const newer = new Date(Date.now() - 10 * 60000);
    const older = new Date(Date.now() - 60 * 60000);
    await matches.recordMatch(game('11111111-0000-0000-0000-000000000003', newer, 'mem-c'));
    await matches.recordMatch({ ...game('11111111-0000-0000-0000-000000000004', older, 'mem-c'),
      participants: [part('mem-c', { isWinner: false, score: 1 }), part('other')] });
    const profile = await matches.getPlayerProfile('mem-c');
    assert.equal(new Date(profile.lastPlayed).getTime(), newer.getTime(), 'lastPlayed is the newer finish time');
    assert.equal(profile.recent[0].won, true, 'the newest result is first');
    assert.equal(profile.recent[1].won, false, 'the older loss is second');
    assert.equal(profile.streak.current, 1, 'the current streak comes from the newest result');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
