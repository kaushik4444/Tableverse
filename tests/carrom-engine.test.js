'use strict';
// Carrom rules for two to four players: sides and teams, rotated shots, turns, validation, pockets, extra shots, fouls, the
// queen, winning, resignation, the bot and piece conservation.
require('./helpers/env');
const assert = require('node:assert/strict');
const E = require('../games/carrom/engine');
const P = require('../games/carrom/physics');
const games = require('../games');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 14; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const names = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const four = () => E.createGame(names(4));
const two = () => E.createGame(names(2));
const coin = (id, colour, x, y) => ({ id, kind: 'coin', colour, x, y, r: P.RADIUS.coin });
const queen = (x, y) => ({ id: 'q', kind: 'queen', colour: null, x, y, r: P.RADIUS.queen });
const flick = (x, power = 0.05, angle = 0) => ({ type: 'flick', x, angle, power });
// a flick names the board it was aimed at (the view's seq), as the browser sends it
const act = (g, who, a) => E.applyAction(g, who, a && a.type === 'flick' ? { ...a, seq: g.seq } : a);
const onBoard = (g, colour) => g.coins.filter((c) => c.colour === colour).length;
const pl = (g, seat, a) => E.plan(g, seat, a);

/** The first angle (searched in steps) that pockets something the predicate accepts, found by the engine itself. */
function findShot(g, seat, x, want) {
  for (let deg = -70; deg <= 70; deg += 2) {
    const a = flick(x, 1, (deg * Math.PI) / 180);
    const p = pl(g, seat, a);
    if (!p.error && want(p.shot)) return a;
  }
  throw new Error('no shot found');
}

test('sides and colours: two players sit opposite; three and four take the sides in turn; partners share a colour', () => {
  assert.deepEqual(two().sides, [0, 2]);
  assert.deepEqual(four().sides, [0, 1, 2, 3]);
  assert.deepEqual(four().players.map((p) => p.colour), ['w', 'b', 'w', 'b']);
  assert.deepEqual(E.createGame(names(3)).sides, [0, 1, 2]);
});

test('opening: 19 pieces, nine of each colour, the queen in the centre, no overlaps', () => {
  const g = four();
  assert.equal(g.coins.length, 19);
  assert.equal(onBoard(g, 'w'), 9);
  assert.equal(onBoard(g, 'b'), 9);
  const q = g.coins.find((c) => c.kind === 'queen');
  assert.ok(Math.abs(q.x - 0.5) < 1e-9 && Math.abs(q.y - 0.5) < 1e-9);
  for (let i = 0; i < g.coins.length; i++) for (let j = i + 1; j < g.coins.length; j++) {
    const a = g.coins[i], b = g.coins[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-9);
  }
});

test('turns go round all four seats in order, and a miss passes the turn', () => {
  const g = four();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(g.turn);
    assert.deepEqual(act(g, 'p' + g.turn, flick(0.5, 0.05)), { ok: true });
  }
  assert.deepEqual(seen, [0, 1, 2, 3]);
  assert.equal(g.turn, 0);
  assert.deepEqual(act(g, 'p1', flick(0.5)), { ok: false, error: 'Not your turn' });
});

test('a shot from another side is rotated into its frame: the striker travels across the board, not up it', () => {
  const g = four();
  g.turn = 1; // the right-hand side
  act(g, 'p1', flick(0.5, 1, 0));
  const frames = g.shot.keyframes;
  const first = frames[0].d.find((d) => d[0] === 'striker');
  const later = frames[Math.min(frames.length - 1, 12)].d.find((d) => d[0] === 'striker');
  assert.ok(Math.abs(first[1] - 0.88) < 1e-3 && Math.abs(first[2] - 0.5) < 1e-3, 'starts on the right baseline');
  assert.ok(later[1] < first[1] - 0.05, 'moves towards the left, away from its own side');
});

test('a flick aimed at an earlier board is rejected, even when the same player is to shoot again', () => {
  const g = four();
  const stale = { ...flick(0.5), seq: g.seq };
  assert.equal(E.applyAction(g, 'p0', { ...stale }).ok, true);
  g.turn = 0; // as if the same player keeps the turn (their own colour was pocketed)
  const shots = g.shots;
  const r = E.applyAction(g, 'p0', stale);
  assert.equal(r.ok, false);
  assert.match(r.error, /aim again/);
  assert.equal(g.shots, shots, 'the duplicate did not play a second shot');
});

test('a striker placed on a piece is rejected by the overlap check, and nothing changes', () => {
  const g = four();
  const coin = g.coins[0];
  coin.x = 0.5; coin.y = E.BASE_Y;
  const before = JSON.stringify([g.coins, g.turn, g.shots, g.seq]);
  const r = act(g, 'p0', flick(0.5));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'The striker overlaps a piece');
  assert.equal(JSON.stringify([g.coins, g.turn, g.shots, g.seq]), before);
});

test('validation: bad x, angle, power, overlapping striker and invalid action are rejected without change', () => {
  const g = four();
  const before = JSON.stringify(g.coins);
  assert.equal(act(g, 'p0', flick(0.1)).ok, false);
  assert.equal(act(g, 'p0', flick(0.5, 0.5, 1.4)).ok, false);
  assert.equal(act(g, 'p0', flick(0.5, 0)).ok, false);
  assert.equal(act(g, 'p0', flick(0.5, 1.5)).ok, false);
  assert.equal(act(g, 'p0', { type: 'flick', x: NaN, angle: 0, power: 0.5 }).ok, false);
  assert.equal(act(g, 'p0', null).ok, false);
  assert.equal(act(g, 'p0', { type: 'dance' }).ok, false);
  assert.equal(JSON.stringify(g.coins), before);
  assert.equal(g.turn, 0);
});

test('pocketing your own coin gives an extra shot, and the coin counts for your team', () => {
  const g = four();
  g.coins = [coin('w1', 'w', 0.035, 0.035), coin('b1', 'b', 0.6, 0.6), coin('b2', 'b', 0.9, 0.9)];
  assert.equal(act(g, 'p0', flick(0.2, 0.05)).ok, true);
  assert.equal(g.score.w, 1);
  assert.equal(g.turn, 0, 'the same seat shoots again');
  assert.equal(onBoard(g, 'b'), 2);
});

test('a partner (seat 2, White) pockets for the White team, and the turn goes on to the next seat', () => {
  const g = four();
  g.turn = 2;
  g.coins = [coin('w1', 'w', 0.035, 0.035)]; // inside a pocket: pocketed on the first step of any shot
  act(g, 'p2', flick(0.5, 0.05));
  assert.equal(g.score.w, 1, 'the partner scores for White');
  assert.equal(g.score.b, 0);
  assert.equal(g.turn, 2, 'a pocket gives the same seat another shot');
});

test('pocketing the other colour sends it back and passes the turn', () => {
  const g = four();
  g.coins = [coin('b1', 'b', 0.035, 0.035)];
  act(g, 'p0', flick(0.2, 0.05));
  assert.equal(g.score.w, 0);
  assert.equal(g.turn, 1);
  assert.equal(onBoard(g, 'b'), 1);
});

test('a foul when the striker is pocketed: the coins of that shot go back, and one held coin goes back too', () => {
  const g = four();
  g.coins = [coin('w1', 'w', 0.6, 0.6)];
  g.score = { w: 2, b: 0 };
  const a = findShot(g, 0, 0.3, (s) => s.foul);
  act(g, 'p0', a);
  assert.equal(g.score.w, 1, 'one held coin went back');
  assert.equal(onBoard(g, 'w'), 2);
  assert.equal(g.turn, 1);
  assert.match(g.log.at(-1), /foul/);
});

test('an uncovered queen goes back to the centre', () => {
  const g = four();
  g.coins = [queen(0.035, 0.035)];
  act(g, 'p0', flick(0.2, 0.05));
  assert.equal(g.queenHeld, null);
  assert.ok(g.coins.some((c) => c.kind === 'queen'));
});

test('the queen is covered by the team pocketing one of its coins in the same shot', () => {
  const g = four();
  // the queen and a white coin each sit inside a different corner pocket, so one shot takes both
  g.coins = [queen(0.035, 0.035), coin('w1', 'w', 0.965, 0.035)];
  act(g, 'p0', flick(0.5, 0.05));
  assert.equal(g.queenHeld, 'w');
});

test('winning: a team with all nine coins and the queen wins, and the team is named', () => {
  const g = four();
  g.coins = [queen(0.035, 0.035)];
  g.score = { w: 9, b: 0 };
  act(g, 'p0', flick(0.2, 0.05));
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 'w');
  assert.equal(g.reason, 'all nine coins');
  assert.equal(E.viewFor(g, 'p2').winnerNames, 'P0 & P2');
  assert.equal(E.viewFor(g, 'p2').winner, 'w');
});

test('a team with nine coins is not stuck: the queen still covers when it goes in alone', () => {
  const g = four();
  g.coins = [queen(0.035, 0.035)];
  g.score = { w: 9, b: 0 };
  act(g, 'p0', flick(0.2, 0.05));
  assert.equal(g.winner, 'w');
});

test('a returned disc never shares an id with a disc already on the board (the opening uses c1 to c18)', () => {
  const g = four();
  g.coins = [...E.opening(), coin('b99', 'b', 0.035, 0.035)]; // a black coin in a pocket goes back to the centre
  assert.equal(act(g, 'p0', flick(0.2, 0.05)).ok, true);
  const ids = g.coins.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'every disc on the board has its own id');
  assert.equal(onBoard(g, 'b'), 10, 'the returned black coin is back on the board');
});

test('resignation: the other team wins', () => {
  const g = four();
  assert.equal(act(g, 'p0', { type: 'resign' }).ok, true);
  assert.equal(g.winner, 'b');
  assert.equal(g.reason, 'resignation');
  assert.equal(act(g, 'p1', flick(0.5)).error, 'The game is over');
});

test('resignation is allowed for any seated player, not only the one to move', () => {
  const g = four();
  assert.equal(g.turn, 0);
  assert.equal(act(g, 'p2', { type: 'resign' }).ok, true, 'seat 2 may resign while seat 0 is to play');
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 'b', 'seat 2 is White, so Black wins');
});

test('resignation in a three-player game: the winner is the opposite colour, not the next seat (which can share the colour)', () => {
  const g = E.createGame(names(3));
  g.turn = 2;
  assert.equal(act(g, 'p2', { type: 'resign' }).ok, true);
  assert.equal(g.winner, 'b', 'seat 2 (White) resigned: Black wins, even though seat 0 is also White');
});

test('a stranger cannot resign, and an unknown player is rejected before anything else', () => {
  const g = four();
  assert.equal(act(g, 'nobody', { type: 'resign' }).ok, false);
  assert.equal(g.phase, 'playing');
});

test('view: only the seat to move has myTurn; the board, team scores and the last shot are shown', () => {
  const g = four();
  act(g, 'p0', flick(0.5, 0.05));
  const v = E.viewFor(g, 'p1');
  assert.equal(v.myTurn, true);
  assert.equal(E.viewFor(g, 'p0').myTurn, false);
  assert.equal(v.board.length, g.coins.length);
  assert.equal(v.shot.seat, 0);
  assert.ok(v.shot.keyframes.length > 1);
  assert.equal(v.mySide, 1);
  assert.equal(E.viewFor(g, 'nobody').myTurn, false);
});

test('the bot always returns a flick the rules accept, from any seat', () => {
  const rng = mulberry32(5);
  const g = four();
  for (let i = 0; i < 8; i++) {
    const seat = g.turn;
    const a = E.botAction(g, seat, rng);
    assert.equal(a.type, 'flick');
    assert.equal(act(g, 'p' + seat, a).ok, true, JSON.stringify(a));
  }
});

test('a four-player bot game keeps the pieces consistent: each colour has nine between board and team, the queen is never duplicated', () => {
  const rng = mulberry32(11);
  const g = four();
  for (let turn = 0; turn < 60 && g.phase === 'playing'; turn++) {
    const seat = g.turn;
    assert.equal(act(g, 'p' + seat, E.botAction(g, seat, rng)).ok, true);
    assert.equal(onBoard(g, 'w') + g.score.w, 9, 'white coins: board plus held');
    assert.equal(onBoard(g, 'b') + g.score.b, 9, 'black coins: board plus held');
    const queens = g.coins.filter((c) => c.kind === 'queen').length;
    assert.equal(queens + (g.queenHeld === null ? 0 : 1), 1, 'the queen is on the board or held, never both');
  }
});

test('registry: carrom is registered and its plugin never throws on bad input', () => {
  assert.equal(games.get('carrom').id, 'carrom');
  const plugin = require('../games/carrom');
  const inst = plugin.create(names(4), {}, mulberry32(2));
  assert.deepEqual(inst.awaiting(), ['p0']);
  assert.equal(inst.act('p0', { type: 'flick', x: 'nope' }).ok, false);
  assert.equal(inst.act('p0', undefined).ok, false);
});

test('results: each seat is judged by its own colour, and a resignation gives the other colour the win', () => {
  const plugin = require('../games/carrom');
  const players = names(2);
  const first = plugin.create(players, {}, () => 0.5);
  first.act('p0', { type: 'resign' });
  const r = first.results();
  assert.equal(r[1].winner, true); assert.equal(r[1].score, 1);
  assert.equal(r[0].winner, false); assert.equal(r[0].score, 0);
  const second = plugin.create(players, {}, () => 0.5);
  second.act('p1', { type: 'resign' });
  const r2 = second.results();
  assert.equal(r2[0].winner, true); assert.equal(r2[0].score, 1);
  assert.equal(r2[1].winner, false); assert.equal(r2[1].score, 0);
});

test('scrubbing a deleted player keeps the phase (a player named like a field), and only the name changes', () => {
  const plugin = require('../games/carrom');
  const players = [{ id: 'p0', name: 'playing' }, { id: 'p1', name: 'Bo' }];
  const inst = plugin.create(players, {}, () => 0.5);
  inst.scrub(['playing'], 'Deleted player');
  const v = inst.view('p1');
  assert.equal(v.phase, 'playing');
  assert.equal(v.players[0].name, 'Deleted player');
  assert.equal(v.players[1].name, 'Bo');
});

test('account deletion scrubs names only: a player named like a colour keeps the colours', () => {
  const players = [{ id: 'a', name: 'w' }, { id: 'b', name: 'Bo' }];
  const instance = games.get('carrom').create(players, {}, () => 0.5);
  const colours = () => JSON.stringify(instance.view('a')).match(/"colour":"[wb]"/g);
  const before = colours();
  instance.scrub(['w', 'Bo'], 'Someone');
  assert.deepEqual(colours(), before, 'the seat colours are unchanged');
  assert.equal(players[0].name, 'Someone');
});

test('a shot holds the next bot turn until it has been played out', () => {
  const pacing = require('../games/pacing');
  const g = two();
  const a = E.botAction(g, g.turn, mulberry32(7));
  assert.equal(a.type, 'flick');
  assert.equal(act(g, 'p' + g.turn, a).ok, true);
  assert.ok(pacing.remaining(g) > 0, 'a bot waits after a shot, so people can follow it');
});

console.log(`\n${passed} carrom engine tests passed`);
