'use strict';
// Leaving a running game, end to end through the same steps the server takes (lib/leavePolicy.js, the seat change,
// then db/matchRecord.js when the game ends or the table closes). No database, no sockets.
const assert = require('node:assert/strict');
const { leaveRunningGame, leaveStateOf } = require('../lib/leavePolicy');
const { buildMatchRecord, buildForfeitRecord } = require('../db/matchRecord');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

// Human ids and bots as the seat list. The game's results are indexed by seat.
function table(humans, bots) {
  const members = [...humans.map((id) => ({ id, name: id, bot: false })), ...bots.map((id) => ({ id, name: id, bot: true }))];
  return { code: 'T1', gameId: 'wizard', seats: members.length, members, seated: members, matchKey: 'key-1', startedAt: 1, options: {}, status: 'playing', leftEarly: new Set(), forfeits: new Set(), abandoned: false };
}
// What the server does when a player leaves a running game.
function leave(room, id) {
  const outcome = leaveRunningGame(room, id);
  const m = room.members.find((x) => x.id === id);
  m.bot = true; room.leftEarly.add(id);
  return outcome;
}
// What the server does when a player who left takes their seat back.
function rejoin(room, id) {
  const m = room.members.find((x) => x.id === id);
  m.bot = false; room.leftEarly.delete(id); room.forfeits.delete(id);
}
function finish(room) {
  const results = room.seated.map((m, i) => ({ score: 10 - i, winner: i === 0 }));
  return buildMatchRecord(room, { results: () => results });
}
const finishRecord = (room) => finish(room);
const byId = (rec) => Object.fromEntries(rec.participants.map((p) => [p.playerId, p]));

test('one player leaves with others playing; the game finishes: the leaver is a loss', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  const rec = finish(r);
  assert.equal(byId(rec).A.forfeit, true);
  assert.equal(byId(rec).A.isWinner, false);
  assert.equal(byId(rec).B.forfeit, false);
  assert.equal(byId(rec).B.leftEarly, false);
});

test('a leaver whose seat was winning still loses', () => {
  const r = table(['A', 'B'], ['C']);
  leave(r, 'A');
  const rec = buildMatchRecord(r, { results: () => [{ score: 50, winner: true }, { score: 0 }, { score: 0 }] });
  assert.equal(byId(rec).A.isWinner, false);
  assert.equal(byId(rec).A.forfeit, true);
});

test('leaving a game played only against bots is not penalised', () => {
  const r = table(['A'], ['B', 'C']);
  const outcome = leave(r, 'A');
  assert.deepEqual(outcome, { penalised: false, abandoned: false });
  const rec = finish(r);
  assert.equal(byId(rec).A.forfeit, false);
  assert.equal(byId(rec).A.leftEarly, true);
});

test('a second person leaves: the game is abandoned, the first leaver is not a loss, the stayers get no result', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  const second = leave(r, 'B');
  assert.deepEqual(second, { penalised: false, abandoned: true });
  const rec = finish(r);
  assert.equal(byId(rec).A.forfeit, false, 'the first leaver\'s loss is reverted');
  assert.equal(byId(rec).B.forfeit, false);
  assert.ok(!('C' in byId(rec)), 'the player who stayed has no result');
});

test('two humans: the second leaver (nobody else human) still abandons the game', () => {
  const r = table(['A', 'B'], ['C', 'D']);
  leave(r, 'A');
  const second = leave(r, 'B');
  assert.equal(second.abandoned, true, 'B leaving must not leave A penalised');
  assert.equal(buildForfeitRecord(r), null, 'the table closing writes nothing for an abandoned game');
  const rec = finish(r);
  assert.equal(byId(rec).A.forfeit, false);
});

test('the first leaver rejoins before anyone else leaves: a normal game, no loss', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  rejoin(r, 'A');
  assert.equal(r.abandoned, false);
  const rec = finish(r);
  assert.equal(byId(rec).A.forfeit, false);
  assert.equal(byId(rec).A.leftEarly, false);
  assert.equal(byId(rec).A.isBot, false);
});

test('a penalised leaver rejoins, and a later leave is the first leave again (not abandoned)', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  rejoin(r, 'A');
  const again = leave(r, 'B');
  assert.deepEqual(again, { penalised: true, abandoned: false });
  const rec = finish(r);
  assert.equal(byId(rec).B.forfeit, true);
});

test('an abandoned game stays abandoned for the rest of it, even after a rejoin', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  leave(r, 'B');
  rejoin(r, 'A');
  const third = leave(r, 'C');
  assert.equal(third.penalised, false, 'no penalties in an abandoned game');
  const rec = finish(r);
  assert.equal(rec.participants.some((p) => p.forfeit), false);
});

test('a table closed mid-game writes the losses of the players who left, and only them', () => {
  const r = table(['A', 'B'], ['C']);
  leave(r, 'A');
  const fr = buildForfeitRecord(r);
  assert.deepEqual(fr.participants.map((p) => p.playerId), ['A']);
  assert.equal(fr.participants[0].forfeit, true);
});

test('a table closed mid-game with nobody penalised writes nothing', () => {
  const r = table(['A'], ['B', 'C']);
  leave(r, 'A');
  assert.equal(buildForfeitRecord(r), null);
});

test('a finished game with nobody leaving is recorded normally', () => {
  const r = table(['A', 'B'], ['C']);
  const rec = finish(r);
  assert.ok(rec.participants.every((p) => !p.forfeit && !p.leftEarly));
});

test('the leave prompt state: counts, then abandons after a first leaver, then abandoned', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  assert.equal(leaveStateOf(r), 'counts');
  leave(r, 'A');
  assert.equal(leaveStateOf(r), 'abandons', 'the next leaver abandons the game');
  leave(r, 'B');
  assert.equal(leaveStateOf(r), 'abandoned');
});

test('the record says the game finished and how the table was filled, leavers included', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  const rec = finish(r);
  assert.equal(rec.completed, true);
  assert.equal(rec.tableHumans, 3, 'Ann was a person when the game started');
  assert.equal(rec.tableBots, 1);
});

test('an abandoned game keeps the true table shape although the players who stayed are not in it', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A'); leave(r, 'B');
  const rec = finish(r);
  assert.equal(rec.tableHumans, 3, 'three people sat down: two left, one stayed');
  assert.equal(rec.tableBots, 1);
  assert.ok(!rec.participants.some((p) => p.playerId === 'C'), 'the player who stayed has no result');
});

test('a table closed mid-game is stored as incomplete, with its table shape', () => {
  const r = table(['A', 'B', 'C'], ['D']);
  leave(r, 'A');
  const rec = buildForfeitRecord(r);
  assert.equal(rec.completed, false);
  assert.equal(rec.tableHumans, 3);
  assert.equal(rec.tableBots, 1);
});

// ---- third leave is final; rejoining inside the window still works
const { voluntaryLeave, reclaimSeat, rejoinDecision, startRejoinWindow, leaveCountOf, FINAL_LEAVE } = require('../lib/leavePolicy');
const WINDOW_MS = 120000;
// Drives the same functions the server uses for a departure and for taking the seat back.
function departure(room, id, now) {
  const m = room.members.find((x) => x.id === id);
  voluntaryLeave(room, m, now, WINDOW_MS);
}
function takeSeatBack(room, id, now) {
  return reclaimSeat(room, room.members.find((x) => x.id === id), now);
}
function playingTable(humans, bots) {
  const r = table(humans, bots);
  return r;
}

test('the first and second leave are penalties a rejoin cancels; the third is final', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  const t0 = 1000;
  departure(r, 'A', t0);
  assert.equal(leaveCountOf(r, 'A'), 1);
  assert.equal(takeSeatBack(r, 'A', t0 + 1000).seat, true, 'first leave: rejoin inside the window');
  assert.equal(r.forfeits.has('A'), false, 'rejoin cancels the first penalty');
  departure(r, 'A', t0 + 2000);
  assert.equal(leaveCountOf(r, 'A'), 2, 'rejoining does not reset the count');
  assert.equal(takeSeatBack(r, 'A', t0 + 3000).seat, true, 'second leave: still rejoinable');
  assert.equal(r.forfeits.has('A'), false, 'rejoin cancels the second penalty');
  departure(r, 'A', t0 + 4000);
  assert.equal(leaveCountOf(r, 'A'), FINAL_LEAVE, 'third leave');
  assert.equal(r.forfeits.has('A'), true, 'third leave penalises directly');
  assert.equal(r.finalForfeits.has('A'), true);
});

test('a rejoin after the third leave keeps the penalty, and the seat is given back inside the window', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  const t0 = 1000;
  for (let i = 0; i < 3; i += 1) { departure(r, 'A', t0 + i * 1000); if (i < 2) takeSeatBack(r, 'A', t0 + i * 1000 + 500); }
  assert.equal(takeSeatBack(r, 'A', t0 + 5000).seat, true, 'the rejoin option is still there after the third leave');
  assert.equal(r.forfeits.has('A'), true, 'the final penalty stays');
  const rec = finishRecord(r);
  assert.equal(byId(rec).A.forfeit, true);
});

test('the 2-minute window is total: it starts at the first departure and later leaves do not extend it', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  const t0 = 1000;
  departure(r, 'A', t0);
  takeSeatBack(r, 'A', t0 + 10000);
  departure(r, 'A', t0 + 100000);
  assert.equal(rejoinDecision(r, 'A', t0 + WINDOW_MS + 1).seat, false, 'closed at the first departure plus 2 minutes');
  assert.equal(rejoinDecision(r, 'A', t0 + WINDOW_MS).seat, true, 'open at the deadline itself');
});

test('after the window closes the person can only watch: no seat, no rejoin', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  departure(r, 'A', 1000);
  assert.equal(rejoinDecision(r, 'A', 1000 + WINDOW_MS + 1).reason, 'expired');
});

test('a fourth leave by the same person is not an abandonment, and the others are not penalised by it', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  for (let i = 0; i < 4; i += 1) { departure(r, 'A', 1000 + i * 1000); if (i < 3) takeSeatBack(r, 'A', 1500 + i * 1000); }
  assert.equal(r.abandoned, false, 'the game is not abandoned by its own leaver');
  assert.equal(r.forfeits.has('B'), false);
});

test('a final penalty still counts when another person later abandons the game', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  for (let i = 0; i < 3; i += 1) { departure(r, 'A', 1000 + i * 1000); if (i < 2) takeSeatBack(r, 'A', 1500 + i * 1000); }
  departure(r, 'B', 9000);
  assert.equal(r.abandoned, true, 'a second person leaving abandons the game');
  const rec = finishRecord(r);
  assert.equal(byId(rec).A.forfeit, true, 'the third leave is final even in an abandoned game');
  assert.equal(byId(rec).B.forfeit, false, 'a non-final leaver is not penalised in an abandoned game');
});

test('the leave prompt state for a player: others pending means abandons; their own final penalty does not', () => {
  const r = playingTable(['A', 'B', 'C'], ['D']);
  for (let i = 0; i < 3; i += 1) { departure(r, 'A', 1000 + i * 1000); if (i < 2) takeSeatBack(r, 'A', 1500 + i * 1000); }
  takeSeatBack(r, 'A', 9000);
  assert.equal(leaveStateOf(r, 'A'), 'counts', 'A does not abandon the game by its own pending penalty');
  assert.equal(leaveStateOf(r, 'B'), 'abandons', 'B would abandon the game');
});


console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
