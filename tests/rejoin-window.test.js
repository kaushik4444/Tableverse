'use strict';
// Rejoin window for running games: a voluntary leave can be undone for a short, fixed window that starts at the first
// departure; active play time is counted per stretch; spectators and bots never earn time. Pure logic, no database.
const assert = require('node:assert/strict');
const { voluntaryLeave, reclaimSeat, rejoinDecision, rejoinGraceMs } = require('../lib/leavePolicy');
const { startPlay, stopPlay, stopAllPlay, secondsPlayed } = require('../lib/playTime');
const { buildMatchRecord } = require('../db/matchRecord');
const { timeXp } = require('../lib/xp');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

const GRACE = 120000; // the default window
const T0 = 1000000; // the game's start (ms)

// A four-seat table: A, B and C are people, D is a bot from the start. Starting the game mirrors server.js.
function startedTable() {
  const members = [
    { id: 'A', name: 'Ann', bot: false }, { id: 'B', name: 'Ben', bot: false },
    { id: 'C', name: 'Cem', bot: false }, { id: 'D', name: 'Bot', bot: true },
  ];
  const room = { code: 'T1', gameId: 'wizard', seats: 4, members, seated: members, matchKey: 'k1', status: 'playing', options: {},
    startedAt: T0, leftEarly: new Set(), forfeits: new Set(), abandoned: false, leaveDeadlines: new Map(), playTime: { open: new Map(), total: new Map() } };
  for (const m of room.seated) if (!m.bot) startPlay(room, m.id, T0);
  return room;
}
const member = (room, id) => room.members.find((m) => m.id === id);
const leave = (room, id, now) => voluntaryLeave(room, member(room, id), now, GRACE);
const rejoin = (room, id, now) => reclaimSeat(room, member(room, id), now);
// Ends the game at `now` the way server.js does (play time closes, then the record is built).
function finish(room, now) {
  room.status = 'finished';
  stopAllPlay(room, now);
  return buildMatchRecord(room, { results: () => room.seated.map((m, i) => ({ score: 10 - i, winner: i === 0 })) });
}
const byId = (rec) => Object.fromEntries(rec.participants.map((p) => [p.playerId, p]));

test('the grace period comes from REJOIN_GRACE_SECONDS: default 120 s, bad values use the default, the range is 0 to 600 s', () => {
  assert.equal(rejoinGraceMs(undefined), 120000);
  assert.equal(rejoinGraceMs('abc'), 120000);
  assert.equal(rejoinGraceMs('30'), 30000);
  assert.equal(rejoinGraceMs('-5'), 0);
  assert.equal(rejoinGraceMs('9999'), 600000);
});

test('rejoining just before the deadline takes the seat back, removes the pending loss, and the game counts no loss', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 60000);
  const d = rejoin(r, 'A', T0 + 60000 + GRACE - 100);
  assert.equal(d.seat, true);
  assert.equal(member(r, 'A').bot, false);
  assert.equal(r.forfeits.has('A'), false);
  assert.equal(r.leftEarly.has('A'), false);
  const rec = finish(r, T0 + 300000);
  assert.equal(byId(rec).A.forfeit, false, 'no loss');
  assert.equal(byId(rec).A.leftEarly, false);
});

test('rejoining exactly at the deadline is still in time; one millisecond after is refused', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 10000);
  assert.equal(rejoinDecision(r, 'A', T0 + 10000 + GRACE).seat, true, 'the deadline itself is in time');
  const late = startedTable();
  leave(late, 'A', T0 + 10000);
  assert.equal(rejoin(late, 'A', T0 + 10000 + GRACE + 1).seat, false);
});

test('an attempt just after the deadline is refused: the bot keeps the seat and the loss stands', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 10000);
  const d = rejoin(r, 'A', T0 + 10000 + GRACE + 500);
  assert.equal(d.seat, false);
  assert.equal(d.reason, 'expired');
  assert.equal(member(r, 'A').bot, true);
  const rec = finish(r, T0 + 300000);
  assert.equal(byId(rec).A.forfeit, true, 'the penalty remains');
  assert.equal(byId(rec).A.isWinner, false);
});

test('repeated leave and rejoin attempts cannot extend the deadline', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 10000);
  const deadline = r.leaveDeadlines.get('A');
  rejoin(r, 'A', T0 + 20000);
  leave(r, 'A', T0 + 30000);
  rejoin(r, 'A', T0 + 40000);
  leave(r, 'A', T0 + 100000);
  assert.equal(r.leaveDeadlines.get('A'), deadline, 'the window still ends at the first departure plus the grace period');
  assert.equal(rejoin(r, 'A', deadline + 1).seat, false, 'after that deadline, no rejoin');
});

test('leave, rejoin and leave again inside the window: the second leave is penalised again', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 10000);
  rejoin(r, 'A', T0 + 20000);
  assert.equal(r.forfeits.has('A'), false, 'the first loss is gone after the rejoin');
  leave(r, 'A', T0 + 30000);
  assert.equal(r.forfeits.has('A'), true);
  const rec = finish(r, T0 + 300000);
  assert.equal(byId(rec).A.forfeit, true, 'the second departure counts');
});

test('a network drop pauses play time and the reconnect resumes it: it is not a departure', () => {
  const r = startedTable();
  stopPlay(r, 'A', T0 + 30000); // the connection drops at 30 s
  startPlay(r, 'A', T0 + 90000); // back at 90 s
  assert.equal(r.leaveDeadlines.has('A'), false, 'no rejoin window is started by a drop');
  assert.equal(member(r, 'A').bot, false, 'the seat stays with the player');
  const rec = finish(r, T0 + 200000);
  assert.equal(byId(rec).A.forfeit, false);
  assert.equal(byId(rec).A.secondsPlayed, 140, 'play time: 30 s before the drop and 110 s after the reconnect');
});

test('a person who drops and never returns: time stops at the drop and nobody is penalised', () => {
  const r = startedTable();
  stopPlay(r, 'B', T0 + 50000);
  const rec = finish(r, T0 + 200000);
  assert.equal(byId(rec).B.secondsPlayed, 50);
  assert.equal(byId(rec).B.forfeit, false);
});

test('a spectator after expiry may watch; a spectator never earns play time', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 10000);
  assert.equal(rejoin(r, 'A', T0 + 10000 + GRACE + 1000).seat, false);
  assert.equal(secondsPlayed(r, 'S'), 0, 'a spectator has no play time at all');
  assert.equal(r.playTime.open.has('S') || r.playTime.total.has('S'), false, 'a spectator is never in the play-time record');
});

test('XP follows actual active time across stretches: 60 s, a leave, a rejoin, then 110 s to the end = 170 s = 2 XP', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 60000);
  rejoin(r, 'A', T0 + 90000);
  const rec = finish(r, T0 + 200000);
  const a = byId(rec).A;
  assert.equal(a.secondsPlayed, 170);
  assert.equal(timeXp(a.secondsPlayed), 2, 'one XP per full minute of play');
});

test('a late seat is not credited with the whole match: the bot seat before a human takes it counts nothing', () => {
  const r = startedTable();
  const rec = finish(r, T0 + 300000);
  assert.equal(byId(rec).D.secondsPlayed, 0, 'bot');
  assert.equal(byId(rec).B.secondsPlayed, 300, 'a person who stayed the whole game plays the whole game');
});

test('a leaver who never returns keeps the time up to the leave, and the loss stands', () => {
  const r = startedTable();
  leave(r, 'C', T0 + 45000);
  const rec = finish(r, T0 + 300000);
  assert.equal(byId(rec).C.secondsPlayed, 45);
  assert.equal(byId(rec).C.forfeit, true);
});

test('an abandoned game gives nobody a seat back, and a finished game cannot erase its penalty', () => {
  const r = startedTable();
  leave(r, 'A', T0 + 10000);
  leave(r, 'B', T0 + 20000); // second leaver: abandoned
  assert.equal(rejoin(r, 'A', T0 + 30000).seat, false);
  const done = startedTable();
  leave(done, 'A', T0 + 10000);
  finish(done, T0 + 300000);
  assert.equal(reclaimSeat(done, member(done, 'A'), T0 + 300001).reason, 'not-playing');
  assert.equal(done.forfeits.has('A'), true, 'the penalty was not erased after the game ended');
});

test('a person who never left has no window, so a bot seat is never theirs to take back', () => {
  const r = startedTable();
  assert.equal(rejoinDecision(r, 'D', T0 + 1000).reason, 'not-a-leaver');
});

test('a shutdown snapshot keeps the leaver\'s active time up to the leave', () => {
  const { buildShutdownForfeitRecords } = require('../db/matchRecord');
  const r = startedTable();
  leave(r, 'A', T0 + 75000);
  const recs = buildShutdownForfeitRecords([r]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].participants[0].secondsPlayed, 75);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
