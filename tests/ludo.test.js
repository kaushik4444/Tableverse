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
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\\n' + e.stack); process.exitCode = 1; }
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

test('createGame: 2-6 players, 4 tokens each in the yard, phase ready', async () => {
  for (const n of [2, 3, 4, 5, 6]) {
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
  assert.throws(() => E.createGame(people(7), {}, mulberry32(1)));
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
  assert.deepEqual(g.log.at(-1), { by: 'P0', card: 'rolled a 1 — no legal moves, turn passed', kind: 'miss' });

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
  // p0 token at abs 6, p1 token at abs 7. abs 7 is not safe. (Two players sit opposite: p1 enters at abs 26.)
  g.tokens[0] = [6, -1, -1, -1];
  g.tokens[1] = [33, -1, -1, -1]; // abs (26+33)%52 = 7
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
  // abs 13 is a start square (safe). p1 waits there; p0 rolls onto it.
  g.tokens[0] = [12, -1, -1, -1]; // abs 12
  g.tokens[1] = [39, -1, -1, -1]; // p1 at abs (26+39)%52 = 13 (safe)
  g.phase = 'rolling';
  g.turn = 0;
  g.dice = null;
  g.sixes = 0;
  g.rng = rollOne;
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 1);
  must(g, 'p0', { type: 'move', token: 0 });
  assert.equal(g.tokens[0][0], 13);
  assert.equal(g.tokens[1][0], 39, 'p1 token stays on a safe square');
});

test('home column: exact count needed to finish; overshoot is illegal', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  // three tokens already home, the last one is on its final ring square (position 50)
  g.tokens[0] = [56, 56, 56, 50];
  g.phase = 'rolling';
  g.turn = 0;
  g.dice = null;
  g.sixes = 0;
  g.rng = rollOne; // dice 1 -> into the home column at 51
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 1);
  must(g, 'p0', { type: 'move', token: 3 });
  assert.equal(g.tokens[0][3], 51, 'into the home column');

  // end the turn so p0 rolls again
  g.turn = 0;
  g.phase = 'rolling';
  g.dice = null;
  g.sixes = 0;
  // a 6 would overshoot (51 + 6 = 57): exact count needed, so the roll passes the turn
  g.rng = alwaysSix;
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.turn, 1, 'overshoot: no legal move, turn passes');
  assert.equal(g.tokens[0][3], 51);
  g.turn = 0; g.phase = 'rolling'; g.dice = null; g.sixes = 0;
  g.rng = () => 0.7; // dice 5: exactly home
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.dice, 5);
  must(g, 'p0', { type: 'move', token: 3 });
  assert.equal(g.tokens[0][3], 56, 'finished by exact count');
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
  assert.equal(g.log.at(-1).kind, 'miss');
  assert.match(g.log.at(-1).card, /three sixes/);
});


test('finished players are skipped, including when finishing on a six', async () => {
  const g = E.createGame(people(3), {}, mulberry32(1));
  readyAll(g);
  // p0 has finished; p2 completes a non-six move. Turn rotation must skip p0.
  g.tokens[0] = [56, 56, 56, 56];
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
  h.tokens[0] = [56, 56, 56, 50];
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
  g.tokens[0] = [56, 56, 56, 56];
  g.tokens[1] = [50, -1, -1, -1];
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
  g.tokens[0] = [-1, 0, 51, 56];
  g.phase = 'moving';
  g.turn = 0;
  g.dice = 6;
  const own = E.viewFor(g, 'p0');
  assert.deepEqual(own.legalTokens, [0, 1], 'a six brings a token out or moves one on; the home-column token would overshoot');
  assert.deepEqual(E.viewFor(g, 'p1').legalTokens, [], 'opponents never receive selectable tokens');
  g.dice = 5;
  assert.deepEqual(E.viewFor(g, 'p0').legalTokens, [1, 2], 'home-column token is selectable when it can finish by exact count');
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
    toolbarSeed: (midHTML, leaveKey, cls) => `<div class="${cls || 'row'}"${cls ? '' : ' style="gap:6px"'}>${cardTable.sound.button()}${cardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button>${midHTML}<button class="btn ghost small" data-${leaveKey}="leave" aria-label="Leave table">✕</button></div>`,
    register: (id, renderer) => { if (id === 'ludo') registered = renderer; },
  };
  const window = { CardTable: cardTable, innerWidth: 900 };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/games/ludo.js'), 'utf8'), {
    window, CardTable: cardTable,
  });
  assert.ok(registered, 'Ludo renderer registered');
  const root = { style: { setProperty() {} }, innerHTML: '', onclick: null, querySelectorAll: () => [], offsetWidth: 0 };
  const view = {
    n: 2, me: 0, phase: 'moving', turn: 0, canMove: true, canRoll: false,
    myTurn: true, dice: 6, sixes: 1, winner: null, finishedOrder: [],
    legalTokens: [0, 1, 2],
    players: [
      { id: 'p0', name: 'Me', color: '🔴', seat: 0, ready: true, tokens: [-1, 0, 51, 56] },
      { id: 'p1', name: 'Opponent', color: '🟡', seat: 2, ready: true, tokens: [39, -1, -1, -1] },
    ],
  };
  registered.render(root, view, { isHost: true, act() {}, showRules() {}, rematch() {}, leave() {} });
  for (const token of [0, 1, 2]) assert.ok(root.innerHTML.includes(`data-lt="tok:${token}"`), `token ${token} is selectable`);
  assert.ok(root.innerHTML.includes('Bring token 1 out'));
  assert.ok(root.innerHTML.includes('Move home-column token 3'));
  assert.ok(!root.innerHTML.includes('tok:3'), 'finished tokens cannot be selected');
  assert.ok(!root.innerHTML.includes('tok:4'), 'opponent tokens cannot be selected');
});

test('renderer: 5-6 players get the hexagon board, every token lands inside it', async () => {
  const reg = {};
  const cardTable = { esc: (x) => String(x), toast() {}, sound: { button: () => '' }, chat: { button: () => '' },
    toolbarSeed: (mid) => mid, register: (id, r) => { reg[id] = r; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/games/ludo.js'), 'utf8'), { window: { CardTable: cardTable, innerWidth: 900 }, CardTable: cardTable });
  const registered = reg.ludo;
  for (const n of [4, 5, 6]) {
    const g = E.createGame(people(n), {}, mulberry32(9));
    const v = E.viewFor(g, 'p0');
    v.players.forEach((p) => { p.tokens = [-1, 0, g.geo.lap - 1, g.geo.finished]; });
    const html = { innerHTML: '', querySelectorAll: () => [], onclick: null, offsetWidth: 0 };
    registered.render(html, v, { isHost: false, act() {}, showRules() {}, rematch() {}, leave() {} });
    assert.equal(html.innerHTML.includes('ludo-board hex'), n >= 5, `${n} players: hexagon only for 5-6`);
    const left = [...html.innerHTML.matchAll(/left:([-\d.]+)%;top:([-\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.equal(left.length, n * 4, 'four tokens per player');
    assert.ok(left.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100), 'tokens sit on the board');
  }
});

test('geometry: a lap is 51 ring squares, then a 5-square home column, then home (56)', async () => {
  assert.equal(E.LAP, 51); assert.equal(E.HOME_COL, 5); assert.equal(E.FINISHED, 56);
  const g = E.createGame(people(2), {}, mulberry32(1));
  assert.equal(E.newPosFor(g, 0, 50, 1), 51, 'the ring square before the turn leads into the home column');
  assert.equal(E.newPosFor(g, 0, 50, 6), 56, 'exactly home from the last ring square');
  assert.equal(E.newPosFor(g, 0, 50, 7), null, 'overshoot');
  assert.equal(E.newPosFor(g, 0, 55, 1), 56);
  assert.equal(E.newPosFor(g, 0, 55, 2), null);
  assert.equal(E.newPosFor(g, 0, 56, 1), null, 'a finished token never moves');
});

test('seats: two players sit opposite each other, colours follow the board clockwise', async () => {
  const two = E.createGame(people(2), {}, mulberry32(1));
  assert.deepEqual(two.players.map((p) => p.seat), [0, 2]);
  assert.deepEqual(two.players.map((p) => p.color), ['🔴', '🟡']);
  const four = E.createGame(people(4), {}, mulberry32(1));
  assert.deepEqual(four.players.map((p) => p.color), ['🔴', '🟢', '🟡', '🔵']);
  assert.deepEqual(E.viewFor(four, 'p1').players.map((p) => p.seat), [0, 1, 2, 3]);
  assert.equal(E.absPos(two, 1, 0), 26, 'the second player of a two-player game enters at the opposite corner');
});

test('bonus rolls: captures and getting home earn another roll only in the generous variant', async () => {
  for (const [mode, expectRoll] of [['classic', false], ['generous', true]]) {
    const g = E.createGame(people(2), { bonusRolls: mode }, mulberry32(1));
    readyAll(g);
    g.tokens[0] = [6, -1, -1, -1]; g.tokens[1] = [33, -1, -1, -1]; // p0 captures on abs 7
    g.phase = 'moving'; g.turn = 0; g.dice = 1; g.sixes = 0;
    must(g, 'p0', { type: 'move', token: 0 });
    assert.equal(g.tokens[1][0], -1, 'captured');
    assert.deepEqual(g.lastMove.captured, [{ player: 1, token: 0 }], 'the last move records what was captured');
    assert.equal(g.turn === 0 && g.phase === 'rolling', expectRoll, `${mode}: bonus roll after a capture`);
    const h = E.createGame(people(2), { bonusRolls: mode }, mulberry32(1));
    readyAll(h);
    h.tokens[0] = [51, -1, -1, -1];
    h.phase = 'moving'; h.turn = 0; h.dice = 5; h.sixes = 0;
    must(h, 'p0', { type: 'move', token: 0 });
    assert.equal(h.turn === 0 && h.phase === 'rolling', expectRoll, `${mode}: bonus roll after getting home`);
  }
});

test('a single possible move is played for you; a real choice is not', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.tokens[1] = [-1, -1, -1, -1];
  g.phase = 'moving'; g.turn = 0; g.sixes = 0;
  g.tokens[0] = [10, -1, -1, -1]; g.dice = 3; // only token 0 can move (the others need a six)
  assert.deepEqual(E.forcedPlay(g), { playerId: 'p0', action: { type: 'move', token: 0 } });
  assert.equal(E.viewFor(g, 'p0').autoPlay, true, 'the player is told the move is automatic');
  g.tokens[0] = [-1, -1, -1, -1]; g.dice = 6; // every token would leave the yard to the same square
  assert.equal(E.forcedPlay(g).action.type, 'move', 'four identical yard moves are one move');
  g.tokens[0] = [10, -1, -1, -1]; g.dice = 6; // a token on the board or a new one: a real choice
  assert.equal(E.forcedPlay(g), null);
  g.tokens[0] = [10, 20, -1, -1]; g.dice = 3; // two tokens can move
  assert.equal(E.forcedPlay(g), null);
  assert.equal(E.viewFor(g, 'p0').autoPlay, false);
  g.tokens[0] = [-1, -1, -1, -1]; g.dice = 3; g.phase = 'rolling';
  assert.equal(E.forcedPlay(g), null, 'nothing to play while rolling');
});

test('bot: finishes a token first, then captures, then brings a token out, and never makes an illegal move', async () => {
  const g = E.createGame(people(2), {}, mulberry32(1));
  readyAll(g);
  g.tokens[0] = [51, 6, -1, -1]; g.tokens[1] = [-1, -1, -1, -1];
  g.phase = 'moving'; g.turn = 0; g.dice = 5;
  assert.deepEqual(E.botAction(g, 'p0'), { type: 'move', token: 0 }, 'getting home beats everything');
  g.tokens[0] = [6, -1, -1, -1]; g.tokens[1] = [33, -1, -1, -1]; g.dice = 1;
  assert.deepEqual(E.botAction(g, 'p0'), { type: 'move', token: 0 }, 'captures when it can');
  g.tokens[0] = [10, -1, -1, -1]; g.tokens[1] = [-1, -1, -1, -1]; g.dice = 6;
  assert.deepEqual(E.botAction(g, 'p0'), { type: 'move', token: 1 }, 'a six brings a new token out');
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

test('hexagon: 5-6 players share a 60-square ring with a seat at each corner', async () => {
  for (const n of [5, 6]) {
    const g = E.createGame(people(n), {}, mulberry32(7));
    assert.equal(g.geo.track, 60); assert.equal(g.geo.lap, 59); assert.equal(g.geo.finished, 64);
    assert.deepEqual(g.players.map((p) => p.seat), [0, 1, 2, 3, 4, 5].slice(0, n));
    assert.equal(g.players[n - 1].color, E.SEAT_COLORS[n - 1]);
    assert.equal(E.absPos(g, 1, 0), 10, 'the second seat enters at the second corner');
    assert.equal(E.absPos(g, 0, 59 - 1), 58, 'the seat walks 59 squares, ending just before its own start');
    assert.ok(g.geo.safe.has(5) && g.geo.safe.has(0) && !g.geo.safe.has(4), 'safe squares: corners and side middles');
  }
  const six = E.createGame(people(6), {}, mulberry32(3));
  six.phase = 'moving'; six.turn = 0; six.dice = 6;
  six.tokens[0][0] = 0; six.tokens[0][1] = 2;
  six.tokens[1][0] = 2; // 2 squares past seat 0's start: capturable
  const r = E.applyAction(six, six.players[0].id, { type: 'move', token: 0 });
  assert.ok(r.ok, 'move ok');
  assert.equal(E.newPosFor(six, 0, 58, 1), 59, 'the last ring square before home');
  assert.equal(E.newPosFor(six, 0, 59, 5), 64, 'exactly home from the last ring square');
  assert.equal(E.newPosFor(six, 0, 59, 6), null, 'overshoot is illegal');
});

test('playOut: full bot-only game finishes for 2 to 6 players', async () => {
  for (const n of [2, 3, 4, 5, 6]) {
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
    assert.deepEqual(scores, Array.from({ length: n }, (_, i) => i + 1), 'scores are 1..n by placement');
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

test('roll and token move events identify the player, die result and token', async () => {
  const g = E.createGame(people(2), {}, alwaysSix);
  readyAll(g);
  must(g, 'p0', { type: 'roll' });
  assert.equal(g.event.type, 'rolled');
  assert.equal(g.event.by, 0);
  assert.equal(g.event.dice, 6);
  assert.equal(g.log.at(-1).kind, 'roll');
  assert.match(g.log.at(-1).card, /rolled a 6/);
  must(g, 'p0', { type: 'move', token: 0 });
  assert.equal(g.event.type, 'moved');
  assert.equal(g.event.by, 0);
  assert.equal(g.event.token, 0);
  assert.equal(g.event.dice, 6);
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
