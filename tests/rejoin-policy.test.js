'use strict';
// Rejoin grace period and active playing time (lib/rejoinPolicy.js) and what the match record stores from them.
// Pure logic with explicit times; no database, no sockets. The socket path (take the seat / watch after the deadline) is
// exercised by the server suites in CI, since this sandbox cannot load the server's native dependency.
const assert = require('node:assert/strict');
const P = require('../lib/rejoinPolicy');
const { buildMatchRecord } = require('../db/matchRecord');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const S = 1000; // one second in ms
function room(ids = ['A', 'B']) { const r = { code: 'R1', gameId: 'wizard', seats: 4, members: [], seated: [], matchKey: 'k', forfeits: new Set(), leftEarly: new Set(), abandoned: false, startedAt: 0, options: {} }; P.startActivity(r, ids, 0); return r; }

test('rejoin just before the 2-minute deadline is allowed', () => {
  const r = room(); P.leftSeat(r, 'A', 0);
  assert.equal(P.canReclaimSeat(r, 'A', 120 * S - 1), true);
  assert.equal(P.canReclaimSeat(r, 'A', 120 * S), true, 'the deadline second itself still counts');
});

test('attempt just after the deadline is refused', () => {
  const r = room(); P.leftSeat(r, 'A', 0);
  assert.equal(P.canReclaimSeat(r, 'A', 120 * S + 1), false);
  assert.equal(P.canReclaimSeat(r, 'A', 3600 * S), false, 'never allowed again later in the same game');
});

test('repeated leave and rejoin inside the window cannot extend the deadline', () => {
  const r = room(); P.leftSeat(r, 'A', 0);
  P.reclaimSeat(r, 'A', 30 * S);      // back at 30 s
  P.leftSeat(r, 'A', 60 * S);         // left again at 60 s
  assert.equal(P.canReclaimSeat(r, 'A', 100 * S), true, 'still inside the original window');
  assert.equal(P.canReclaimSeat(r, 'A', 121 * S), false, 'the window did not restart at 60 s');
});

test('leave, rejoin, leave again: the second leave does not restart the grace period', () => {
  const r = room(); P.leftSeat(r, 'A', 10 * S);
  P.reclaimSeat(r, 'A', 20 * S); P.leftSeat(r, 'A', 25 * S);
  assert.equal(P.canReclaimSeat(r, 'A', 130 * S), true, 'deadline is 130 s (10 s + 120 s)');
  assert.equal(P.canReclaimSeat(r, 'A', 130 * S + 1), false);
});

test('a player who is already back in the seat cannot be reclaimed again', () => {
  const r = room(); P.leftSeat(r, 'A', 0); P.reclaimSeat(r, 'A', 5 * S);
  assert.equal(P.canReclaimSeat(r, 'A', 6 * S), false);
});

test('a player who never left has no grace period to use', () => {
  const r = room();
  assert.equal(P.canReclaimSeat(r, 'A', 1 * S), false);
  assert.equal(P.canReclaimSeat(r, 'Z', 1 * S), false, 'unknown id (spectator or deleted seat)');
});

test('active time adds up across intervals: leave, rejoin, play to the end', () => {
  const r = room(); P.leftSeat(r, 'A', 50 * S); P.reclaimSeat(r, 'A', 70 * S);
  assert.equal(P.playedSeconds(r, 'A', 200 * S), 50 + 130);
});

test('a leaver who does not come back is credited only for the time before leaving', () => {
  const r = room(); P.leftSeat(r, 'A', 50 * S);
  assert.equal(P.playedSeconds(r, 'A', 200 * S), 50);
});

test('a late return after the deadline does not earn the time the bot played', () => {
  const r = room(); P.leftSeat(r, 'A', 10 * S);
  assert.equal(P.canReclaimSeat(r, 'A', 150 * S), false);
  assert.equal(P.playedSeconds(r, 'A', 200 * S), 10);
});

test('bots and spectators have no active time', () => {
  const r = room(); P.startActivity(r, ['A'], 0);
  assert.equal(P.playedSeconds(r, 'bot-1', 200 * S), 0);
  assert.equal(P.playedSeconds(r, 'spectator', 200 * S), 0);
});

test('a single game is capped at six hours of active time', () => {
  const r = room(['A']);
  assert.equal(P.playedSeconds(r, 'A', 100 * 3600 * S), 6 * 3600);
});

test('a game that ends while the player is in the seat counts up to the end', () => {
  const r = room(['A']);
  assert.equal(P.playedSeconds(r, 'A', 90 * S), 90);
});

test('the match record stores each person\'s active seconds (leaver, stayer, bot)', () => {
  const now = Date.now();
  const members = [{ id: 'A', name: 'Ann', bot: false }, { id: 'B', name: 'Ben', bot: false }, { id: 'D', name: 'Bot', bot: true }];
  const r = { code: 'R2', gameId: 'wizard', seats: 3, members, seated: members, matchKey: 'k2', startedAt: now - 300 * S,
    forfeits: new Set(['B']), leftEarly: new Set(['B']), abandoned: false, options: {} };
  r.members[1].bot = true; // Ben left and a bot plays his seat
  P.startActivity(r, ['A', 'B'], now - 300 * S);
  P.leftSeat(r, 'B', now - 200 * S);  // Ben left after 100 s
  const rec = buildMatchRecord(r, { results: () => [{ score: 40, winner: true }, { score: 0 }, { score: 0 }] });
  const by = Object.fromEntries(rec.participants.map((p) => [p.playerId, p]));
  assert.ok(Math.abs(by.A.secondsPlayed - 300) <= 1, 'stayer: the whole game');
  assert.equal(by.B.secondsPlayed, 100, 'leaver: the time before leaving, not the whole game');
  assert.equal(by.D.secondsPlayed, 0, 'bot');
});

test('a rejoin cannot change a record that is already built', () => {
  const now = Date.now();
  const members = [{ id: 'A', name: 'Ann', bot: false }, { id: 'B', name: 'Ben', bot: false }];
  const r = { code: 'R3', gameId: 'wizard', seats: 2, members, seated: members, matchKey: 'k3', startedAt: now - 300 * S,
    forfeits: new Set(['B']), leftEarly: new Set(['B']), abandoned: false, options: {} };
  r.members[1].bot = true;
  P.startActivity(r, ['A', 'B'], now - 300 * S); P.leftSeat(r, 'B', now - 250 * S);
  const rec = buildMatchRecord(r, { results: () => [{ score: 1, winner: true }, { score: 0 }] });
  const before = JSON.stringify(rec.participants);
  P.reclaimSeat(r, 'B', now); // a late rejoin after the record was built (the game is over)
  assert.equal(JSON.stringify(rec.participants), before, 'the finished record is not rewritten');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
