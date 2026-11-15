'use strict';
// Leaving a running game, end to end through the same steps the server takes (lib/leavePolicy.js, the seat change,
// then db/matchRecord.js when the game ends or the table closes). No database, no sockets.
const assert = require('node:assert/strict');
const { leaveRunningGame } = require('../lib/leavePolicy');
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
