'use strict';
// Ludo engine tests: ready/roll/move flow, captures, home column, three sixes,
// and full-game play-outs with bots for every player count.
require('./helpers/env'); // first: NODE_ENV=test, no .env loading, no DATABASE_URL (memory-mode test)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../games/ludo/engine');
const plugin = require('../games/ludo');
const { buildMatchRecord } = require('../db/matchRecord');
const { computeProfile } = require('../db/stats');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const must = (g, id, a) => { const r = E.applyAction(g, id, a); assert.ok(r.ok, JSON.stringify(a) + ': ' + r.error); };
const readyAll = (g) => g.players.forEach((p) => must(g, p.id, { type: 'ready' }));
const rollOne = () => 0;      // forces dice = 1
const alwaysSix = () => 0.999999; // forces dice = 6

console.log('engine');

test('createGame: 2-4 players, 4 tokens each in the yard, phase ready', async () => {
  for (const n of [2, 3, 4]) {
    const g = E.createGame(people(n), {}, mulberry32(1));
    assert.equal(g.n, n);
    assert.equal(g.phase, 'ready');
    assert.equal(g.dice, null);
    assert.equal(g.tokens.length, n);
    assert.ok(g.tokens.every((ts) => ts.length === 4 && ts.every((p) => p === -1)));
    assert.equal(g.players.length, n);
    assert.equal(g.finishedOrder.length, 0);
    assert.equal(g.winner, null);
  }
  assert.throws(() => E.createGame(people(1), {}, mulberry32(1)));
  assert.throws(() => E.createGame(people(5), {}, mulberry32(1)));
});

test('roll gives 1-6, six earns another roll, non-six passes the turn', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.rng = rollOne; // dice 1: no token can come out
  must(g, 'p0', { type: 'roll' });
  // no legal move with a 1 and nothing out -> turn passes, dice cleared inside roll
  assert.equal(g.turn, 1);
  assert.equal(g.dice, null);
  assert.equal(g.sixes, 0);
  assert.equal(g.phase, 'rolling');

  // a six keeps the same player rolling
  g.rng = alwaysSix;
  must(g, 'p1', { type: 'roll' });
  assert.equal(g.dice, 6);
  assert.equal(g.sixes, 1);
  assert.equal(g.phase, 'moving', 'a roll with legal moves enters the moving phase');
  assert.equal(g.turn, 1, 'same player keeps the turn after a six');
});

test('roll requires your turn in the rolling phase', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  assert.ok(!E.applyAction(g, 'p1', { type: 'roll' }).ok, 'p1 cannot roll on p0 turn');
  g.rng = rollOne;
  must(g, 'p0', { type: 'roll' });
  assert.ok(!E.applyAction(g, 'p0', { type: 'roll' }).ok, 'cannot roll twice without moving');
});

test('move: a 6 brings a token out; other dice need a token already out', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.rng = alwaysSix;
  must(g, 'p0', { type: 'roll' });
  assert.deepEqual(E.legalMoves(g, 0), [{ token: 0, to: 0 }, { token: 1, to: 0 }, { token: 2, to: 0 }, { token: 3, to: 0 }]);
  must(g, 'p0', { type: 'move', token: 0 });
  assert.equal(g.tokens[0][0], 0);
  assert.equal(g.phase, 'rolling', 'six -> roll again');

  g.rng = rollOne; // dice 1
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 1);
  must(g, 'p0', { type: 'move', token: 0 });
  assert.equal(g.tokens[0][0], 1);
  assert.equal(g.turn, 1, 'non-six ends the turn');
});

test('capture: landing on an opponent on a non-safe square sends them home', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  // p0 token at abs 6, p1 token at abs 7. abs 7 is not safe.
  g.tokens[0] = [6, -1, -1, -1];
  g.tokens[1] = [46, -1, -1, -1]; // abs (13+46)%52 = 7
  g.phase = 'rolling';
  g.turn = 0;
  g.dice = null;
  g.sixes = 0;
  g.rng = rollOne;
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 1);
  must(g, 'p0', { type: 'move', token: 0 });
  assert.equal(g.tokens[0][0], 7);
  assert.equal((0 + g.tokens[0][0]) % 52, 7, 'p0 lands on abs 7');
  assert.equal(g.tokens[1][0], -1, 'p1 token sent home');
  assert.ok(g.log.some((e) => e.kind === 'capture'), 'capture logged');
});

test('safe squares protect from capture', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  // abs 13 is p1's start and is a safe square. p0 rolls onto it.
  g.tokens[0] = [12, -1, -1, -1]; // abs 12
  g.tokens[1] = [0, -1, -1, -1];  // p1 at abs 13 (safe)
  g.phase = 'rolling';
  g.turn = 0;
  g.dice = null;
  g.sixes = 0;
  g.rng = rollOne;
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 1);
  must(g, 'p0', { type: 'move', token: 0 });
  assert.equal(g.tokens[0][0], 13);
  assert.equal(g.tokens[1][0], 0, 'p1 token stays on a safe square');
});

test('home column: exact count needed to finish; overshoot is illegal', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  // three tokens already home, the last one is one step before the home column
  g.tokens[0] = [58, 58, 58, 51];
  g.phase = 'rolling';
  g.turn = 0;
  g.dice = null;
  g.sixes = 0;
  g.rng = rollOne; // dice 1 -> into home column at 52
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 1);
  must(g, 'p0', { type: 'move', token: 3 });
  assert.equal(g.tokens[0][3], 52, 'into the home column');

  // end the turn so p0 rolls again
  g.turn = 0;
  g.phase = 'rolling';
  g.dice = null;
  g.sixes = 0;
  // roll exactly 6 to finish
  g.rng = alwaysSix;
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 6);
  must(g, 'p0', { type: 'move', token: 3 });
  assert.equal(g.tokens[0][3], 58, 'finished by exact count');
  assert.ok(g.finishedOrder.includes(0));
  assert.equal(g.winner, 0);
  assert.equal(g.phase, 'gameOver');
});

test('third consecutive six forfeits the roll and ends the turn immediately', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.tokens[0] = [0, -1, -1, -1];
  g.phase = 'rolling';
  g.turn = 0;
  g.dice = null;
  g.sixes = 0;
  g.rng = alwaysSix;
  for (let seq = 1; seq <= 2; seq++) {
    must(g, 'p0', { type: 'roll' });
    assert.equal(g.dice, 6);
    must(g, 'p0', { type: 'move', token: 0 });
    assert.equal(g.tokens[0][0], 6 * seq);
    assert.equal(g.phase, 'rolling');
    assert.equal(g.turn, 0);
  }
  const beforeThird = g.tokens[0][0];
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.turn, 1, 'third six forfeits the roll and passes the turn');
  assert.equal(g.phase, 'rolling');
  assert.equal(g.dice, null);
  assert.equal(g.tokens[0][0], beforeThird, 'no token moves on the third six');
  assert.equal(g.sixes, 0);
});


test('finished players are skipped, including when finishing on a six', async () => {
  const g = E.createGame(people(3), {}, mulberry32(1));
  readyAll(g);
  // p0 has finished; p2 completes a non-six move. Turn rotation must skip p0.
  g.tokens[0] = [58, 58, 58, 58];
  g.tokens[2] = [0, -1, -1, -1];
  g.finishedOrder = [0];
  g.phase = 'moving';
  g.turn = 2;
  g.dice = 1;
  g.sixes = 0;
  must(g, 'p2', { type: 'move', token: 0 });
  assert.equal(g.turn, 1, 'next turn skips the finished p0');
  assert.deepEqual(g.awaiting ? g.awaiting() : E.awaitingList(g), ['p1']);

  // A player who finishes all four tokens on a six must not receive the bonus roll.
  const h = E.createGame(people(3), {}, mulberry32(2));
  readyAll(h);
  h.tokens[0] = [58, 58, 58, 52];
  h.phase = 'moving';
  h.turn = 0;
  h.dice = 6;
  h.sixes = 1;
  must(h, 'p0', { type: 'move', token: 3 });
  assert.deepEqual(h.finishedOrder, [0]);
  assert.equal(h.turn, 1);
  assert.equal(h.phase, 'rolling');
});

test('game over: no more actions allowed', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.tokens[0] = [58, 58, 58, 58];
  g.tokens[1] = [51, -1, -1, -1];
  g.phase = 'gameOver';
  g.winner = 0;
  assert.ok(!E.applyAction(g, 'p0', { type: 'roll' }).ok);
  assert.ok(!E.applyAction(g, 'p0', { type: 'move', token: 0 }).ok);
});

test('viewFor: hand mirrors own tokens, myTurn/canRoll/canMove flags correct', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  const v0 = E.viewFor(g, 'p0');
  assert.equal(v0.me, 0);
  assert.equal(v0.n, 2);
  assert.deepEqual(v0.hand, g.tokens[0]);
  assert.deepEqual(v0.players.map((p) => p.tokens), g.tokens, 'all public token positions are available under each player');
  // with 2 players, turn is 0 after readying, so p0's turn
  assert.equal(v0.myTurn, true);
  assert.equal(v0.canRoll, true);
  g.rng = rollOne;
  must(g, 'p0', { type: 'roll' });
  // a non-six with nothing able to move passes the turn to p1, dice cleared
  assert.equal(E.viewFor(g, 'p0').myTurn, false);
  assert.equal(E.viewFor(g, 'p0').canRoll, false);
  assert.equal(E.viewFor(g, 'p1').myTurn, true);
  assert.equal(E.viewFor(g, 'p1').canRoll, true);
  assert.equal(E.viewFor(g, 'p1').dice, null);
});


test('viewFor exposes only the current player legal token indexes', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.tokens[0] = [-1, 0, 52, 58];
  g.phase = 'moving';
  g.turn = 0;
  g.dice = 6;
  const own = E.viewFor(g, 'p0');
  assert.deepEqual(own.legalTokens, [0, 1, 2], 'yard, track and home-column tokens can move on a six');
  assert.deepEqual(E.viewFor(g, 'p1').legalTokens, [], 'opponents never receive selectable tokens');
  g.dice = 1;
  assert.deepEqual(E.viewFor(g, 'p0').legalTokens, [1, 2], 'home-column token is selectable when it can move');
});

test('viewFor exposes each player ready status', async () => {
  const g = E.createGame(people(3), {}, mulberry32(1));
  const v0 = E.viewFor(g, 'p0');
  assert.ok(v0.players.every((pl) => pl.ready === false), 'nobody ready at start');
  must(g, 'p0', { type: 'ready' });
  const v1 = E.viewFor(g, 'p0');
  assert.equal(v1.players[0].ready, true);
  assert.equal(v1.players[1].ready, false);
  assert.equal(v1.players[2].ready, false);
});


test('renderer exposes clickable own yard, track and home tokens only when legal', async () => {
  let registered;
  const cardTable = {
    esc: (s) => String(s),
    toast: () => {},
    sound: { button: () => '' },
    chat: { button: () => '' },
    register: (id, renderer) => { if (id === 'ludo') registered = renderer; },
  };
  const window = { CardTable: cardTable, innerWidth: 900 };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/games/ludo.js'), 'utf8'), {
    window, CardTable: cardTable,
  });
  assert.ok(registered, 'Ludo renderer registered');
  const root = { style: { setProperty() {} }, innerHTML: '', onclick: null };
  const view = {
    n: 2, me: 0, phase: 'moving', turn: 0, canMove: true, canRoll: false,
    myTurn: true, dice: 6, sixes: 1, winner: null, finishedOrder: [],
    legalTokens: [0, 1, 2],
    players: [
      { id: 'p0', name: 'Me', color: '🔴', ready: true, tokens: [-1, 0, 52, 58] },
      { id: 'p1', name: 'Opponent', color: '🟡', ready: true, tokens: [39, -1, -1, -1] },
    ],
  };
  registered.render(root, view, { isHost: true, act() {}, showRules() {}, rematch() {}, leave() {} });
  for (const token of [0, 1, 2]) assert.ok(root.innerHTML.includes(`data-lt="tok:${token}"`), `token ${token} is selectable`);
  assert.ok(root.innerHTML.includes('Bring token 1 out'));
  assert.ok(root.innerHTML.includes('Move home-column token 3'));
  assert.ok(!root.innerHTML.includes('tok:3'), 'finished tokens cannot be selected');
  assert.ok(!root.innerHTML.includes('tok:4'), 'opponent tokens cannot be selected');
});

test('plugin: create/view/act/awaiting/botAction/results wiring', async () => {
  const players = people(3);
  const g = plugin.create(players, {}, mulberry32(5));
  assert.equal(g.view('p0').me, 0);
  assert.equal(g.view('p1').me, 1);
  assert.equal(g.awaiting().length, 3, 'everyone must ready up first');
  assert.ok(g.act(players[0].id, { type: 'ready' }).ok);
  assert.equal(g.awaiting().length, 2);
  assert.ok(g.act(players[1].id, { type: 'ready' }).ok);
  assert.ok(g.act(players[2].id, { type: 'ready' }).ok);
  assert.equal(g.awaiting().length, 1, 'only the first roller waits');
  const roll = g.botAction(players[0].id);
  assert.equal(roll.type, 'roll');
  assert.ok(g.act(players[0].id, roll).ok);
  const move = g.botAction(players[0].id);
  assert.ok(move, 'there is always a bot move when rolling gave dice');
  if (move.type === 'move') assert.ok(g.act(players[0].id, move).ok);
  const res = g.results();
  assert.equal(res.length, 3);
  assert.ok(res.every((r) => Number.isFinite(r.score) && typeof r.winner === 'boolean'));
});

test('playOut: full bot-only game finishes for 2, 3 and 4 players', async () => {
  for (const n of [2, 3, 4]) {
    const players = people(n);
    const g = plugin.create(players, {}, mulberry32(100 + n));
    let steps = 0;
    while (!g.isOver() && steps++ < 200000) {
      const waiting = g.awaiting();
      if (waiting.length) {
        const who = waiting[0];
        assert.ok(g.act(who, g.botAction(who)).ok, `${n}p: ${who} stuck`);
      } else {
        const auto = g.autoAction();
        assert.ok(auto, `${n}p: stuck with nobody to act`);
        assert.ok(g.act(null, auto).ok);
      }
    }
    assert.ok(g.isOver(), `${n} players: game should finish`);
    const res = g.results();
    assert.equal(res.length, n);
    const winners = res.filter((r) => r.winner);
    assert.equal(winners.length, 1, 'exactly one winner');
    assert.equal(winners[0].score, n, 'winner scores n (first place)');
    const scores = res.map((r) => r.score).sort((a, b) => a - b);
    assert.deepEqual(scores, [1, 2, 3, 4].slice(0, n), 'scores are 1..n by placement');
    assert.ok(res.some((r) => r.score === 1), 'last place scores 1');
  }
});

console.log('match record');
(async () => {
  await 
test('profile stats rank first place as the best Ludo finish', async () => {
  const rows = [
    { gameId: 'ludo', isWinner: false, score: 1, seats: 4, finishedAt: new Date() },
    { gameId: 'ludo', isWinner: true, score: 4, seats: 4, finishedAt: new Date() },
    { gameId: 'ludo', isWinner: false, score: 2, seats: 4, finishedAt: new Date() },
  ];
  const stats = computeProfile(rows, { metrics: (id) => id === 'ludo' ? plugin.stats : null });
  assert.equal(stats.perGame[0].best, -1, 'first place is the highest (least negative) rank');
  assert.equal(stats.perGame[0].bestText, '1', 'first place is shown as best finish');
});

test('buildMatchRecord: ludo produces one record with all seats and scores', async () => {
    const players = people(4);
    const g = plugin.create(players, {}, mulberry32(21));
    while (!g.isOver()) {
      const waiting = g.awaiting();
      if (waiting.length) assert.ok(g.act(waiting[0], g.botAction(waiting[0])).ok);
      else { const auto = g.autoAction(); assert.ok(g.act(null, auto).ok); }
    }
    const members = players.map((p) => ({ id: p.id, name: p.name, bot: false }));
    const room = { code: 'ABC123', gameId: 'ludo', seats: 4, options: {}, matchKey: '11111111-1111-4111-8111-111111111111', startedAt: Date.now() - 60000, members, leftEarly: new Set() };
    const rec = buildMatchRecord(room, g);
    assert.equal(rec.participants.length, 4);
    assert.equal(rec.participants.filter((p) => p.isWinner).length, 1);
    const scores = rec.participants.map((p) => p.score);
    assert.ok(scores.every((s) => Number.isFinite(s)));
  });
})().then(() => {
  console.log(`\n${passed} ludo tests passed`);
}, (e) => { console.error(e); process.exitCode = 1; });
