'use strict';
// Leaving a game: with other people still playing it is a loss for the leaver; against bots only it is not; in an
// abandoned game (a second person left) the people who stayed get no result. Pure record logic, no database.
const assert = require('node:assert/strict');
const { buildMatchRecord, buildForfeitRecord, buildShutdownForfeitRecords } = require('../db/matchRecord');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }

// four seats: A, B, C human; D a bot from the start
function room(extra = {}) {
  const members = [
    { id: 'A', name: 'Ann', bot: false },
    { id: 'B', name: 'Ben', bot: false },
    { id: 'C', name: 'Cem', bot: false },
    { id: 'D', name: 'Bot', bot: true },
  ];
  return { code: 'ROOM01', gameId: 'wizard', seats: 4, members, seated: members, matchKey: 'key-1', startedAt: 1, options: {}, leftEarly: new Set(), forfeits: new Set(), abandoned: false, ...extra };
}
const results = [{ score: 40, winner: true }, { score: 10 }, { score: 5 }, { score: 0 }];
const game = { results: () => results };
const byId = (rec) => Object.fromEntries(rec.participants.map((p) => [p.playerId, p]));

test('a player who leaves while others play is a loss, even if the table would have won', () => {
  const r = room();
  r.members[1].bot = true; r.leftEarly.add('B'); r.forfeits.add('B'); // Ben left, a bot took his seat
  const rec = buildMatchRecord(r, { results: () => [{ score: 40, winner: true }, { score: 0, winner: true }, { score: 5 }, { score: 0 }] });
  const b = byId(rec)['B'];
  assert.equal(b.leftEarly, true); assert.equal(b.forfeit, true);
  assert.equal(b.isWinner, false, 'a leaver never wins');
  assert.equal(b.isDraw, false);
  assert.equal(byId(rec)['A'].isWinner, true, 'the player who stayed keeps the real result');
  assert.equal(byId(rec)['A'].forfeit, false);
});

test('leaving against bots only is not a loss: the leaver is excluded, as before', () => {
  const r = room();
  r.members[0].bot = true; r.members[2].bot = true; r.leftEarly.add('A'); // Ann alone with bots; nobody else human
  const rec = buildMatchRecord(r, game);
  const a = byId(rec)['A'];
  assert.equal(a.leftEarly, true); assert.equal(a.forfeit, false);
});

test('an abandoned game gives the players who stayed no result, and reverts the first leaver\'s loss', () => {
  const r = room({ abandoned: true });
  r.members[0].bot = true; r.members[1].bot = true; // Ann left first, Ben left later
  r.leftEarly.add('A'); r.leftEarly.add('B'); r.forfeits.add('A'); r.forfeits.add('B');
  const rec = buildMatchRecord(r, game);
  const ids = rec.participants.map((p) => p.playerId);
  assert.ok(!ids.includes('C'), 'Cem stayed: his game is not counted');
  assert.equal(byId(rec)['A'].forfeit, false, 'Ann\'s loss is reverted: the game was abandoned');
  assert.equal(byId(rec)['B'].forfeit, false, 'Ben is not a loss either');
  assert.equal(byId(rec)['A'].isWinner, false);
  assert.equal(byId(rec)['B'].isWinner, false);
});

test('a first leaver whose game finishes without a second leaver is a loss', () => {
  const r = room(); // Ann left, nobody else did, the game ran to the end
  r.members[0].bot = true; r.leftEarly.add('A'); r.forfeits.add('A');
  const rec = buildMatchRecord(r, game);
  assert.equal(byId(rec)['A'].forfeit, true);
  assert.equal(byId(rec)['A'].isWinner, false);
});

test('an abandoned table closed mid-game writes nothing', () => {
  const r = room({ abandoned: true });
  r.members[0].bot = true; r.members[1].bot = true; r.leftEarly.add('A'); r.leftEarly.add('B'); r.forfeits.add('A'); r.forfeits.add('B');
  assert.equal(buildForfeitRecord(r), null);
});

test('a table closed mid-game writes only the people who forfeited, as losses', () => {
  const r = room();
  r.members[1].bot = true; r.leftEarly.add('B'); r.forfeits.add('B');
  const rec = buildForfeitRecord(r);
  assert.equal(rec.matchKey, 'key-1');
  assert.deepEqual(rec.participants.map((p) => p.playerId), ['B']);
  assert.equal(rec.participants[0].forfeit, true);
  assert.equal(rec.participants[0].isWinner, false);
});

test('a table closed mid-game with no forfeit writes nothing', () => {
  assert.equal(buildForfeitRecord(room()), null);
});

test('the record carries the completion time, so a replay after an outage keeps the real game length', () => {
  const before = Date.now();
  const rec = buildMatchRecord(room(), { results: () => [{ score: 3, winner: true }, { score: 2 }, { score: 1 }, { score: 0 }] });
  assert.ok(rec.finishedAt instanceof Date && rec.finishedAt.getTime() >= before && rec.finishedAt.getTime() <= Date.now());
  // it survives the queue's JSON round trip as an ISO string
  assert.equal(new Date(JSON.parse(JSON.stringify(rec)).finishedAt).getTime(), rec.finishedAt.getTime());
});

test('shutdown saves the leavers of running tables only, and skips tables with nobody who left', () => {
  const left = room();
  left.members[1].bot = true; left.leftEarly.add('B'); left.forfeits.add('B');
  const quiet = room({ code: 'ROOM02', matchKey: 'key-2' });
  const lobby = room({ code: 'ROOM03', matchKey: 'key-3', status: 'lobby' });
  lobby.members[1].bot = true; lobby.leftEarly.add('B'); lobby.forfeits.add('B');
  const running = [{ ...left, status: 'playing' }, { ...quiet, status: 'playing' }, { ...lobby, status: 'lobby' }];
  const recs = buildShutdownForfeitRecords(running);
  assert.deepEqual(recs.map((r) => r.matchKey), ['key-1']);
  assert.equal(recs[0].completed, false);
  assert.deepEqual(recs[0].participants.map((p) => [p.playerId, p.forfeit]), [['B', true]]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
