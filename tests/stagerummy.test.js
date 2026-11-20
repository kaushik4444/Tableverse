'use strict';
// Stage 10: the rules, with hand-built positions. Pure, no sockets.
const assert = require('node:assert/strict');
const e = require('../games/stagerummy/engine');
const def = require('../games/stagerummy');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }
const rngFor = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
// number cards: colour R/B/G/Y, value; ids are unique per call (first copies 0-95)
const R = (v) => e.makeCard(v - 1), B = (v) => e.makeCard(24 + v - 1), G = (v) => e.makeCard(48 + v - 1), Y = (v) => e.makeCard(72 + v - 1);
const W = (k = 0) => e.makeCard(96 + k);
const S = (k = 0) => e.makeCard(104 + k);
const ids = (cards) => cards.map((c) => c.id);

function setup(n, hands, { stage = 1, options = {} } = {}) {
  const g = e.createGame(people(n), options, rngFor(2));
  g.hands = hands.map((h) => h.slice());
  g.stage = people(n).map(() => stage);
  g.turn = 0; g.phase = 'draw';
  g.stock = [R(11), R(12), B(12)]; g.discard = [Y(12)];
  return g;
}
const act = (g, i, a) => e.applyAction(g, 'p' + i, a);

test('the deck: 108 cards, 96 numbers (two of each in four colours), 8 wild, 4 skip', () => {
  const g = e.createGame(people(2), {}, rngFor(1));
  const all = [...g.stock, ...g.discard, ...g.hands.flat()];
  assert.equal(all.length, 108);
  assert.equal(new Set(all.map((c) => c.id)).size, 108);
  assert.equal(all.filter((c) => c.k === 'w').length, 8);
  assert.equal(all.filter((c) => c.k === 's').length, 4);
  assert.ok(g.hands.every((h) => h.length === 10));
  assert.notEqual(g.discard[0].k, 's', 'the first discard is never a skip');
});

test('2 to 6 players only', () => {
  assert.throws(() => e.createGame(people(1), {}, rngFor(1)));
  assert.throws(() => e.createGame(people(7), {}, rngFor(1)));
});

test('card points: 1-9 five, 10-12 ten, skip 15, wild 25', () => {
  assert.deepEqual([R(1), R(9), R(10), R(12), S(), W()].map(e.points), [5, 5, 10, 10, 15, 25]);
});

test('sets: same number, wild allowed, at least one real number, no skip', () => {
  const set3 = { kind: 'set', size: 3 };
  assert.ok(e.classify([R(5), B(5), G(5)], set3));
  assert.ok(e.classify([R(5), W(), G(5)], set3));
  assert.equal(e.classify([R(5), B(6), G(5)], set3), null);
  assert.equal(e.classify([W(), W(1), W(2)], set3), null, 'wilds only');
  assert.equal(e.classify([R(5), B(5), S()], set3), null);
  assert.equal(e.classify([R(5), B(5)], set3), null, 'wrong size');
});

test('runs: consecutive, wilds fill gaps and extend, no wrapping, distinct numbers', () => {
  const run4 = { kind: 'run', size: 4 };
  const ok = e.classify([R(3), B(4), G(5), Y(6)], run4);
  assert.deepEqual([ok.lo, ok.hi], [3, 6]);
  const gap = e.classify([R(3), W(), G(5), Y(6)], run4);
  assert.equal(gap.cards[1].as, 4);
  const ext = e.classify([R(3), W(), W(1), Y(6)], run4);
  assert.deepEqual([ext.lo, ext.hi], [3, 6]);
  assert.equal(e.classify([R(3), B(3), G(4), Y(5)], run4), null, 'a repeated number');
  assert.equal(e.classify([R(1), B(2), G(3), Y(7)], run4), null, 'too far apart');
  const top = e.classify([R(11), W(), W(1), W(2)], run4);
  assert.deepEqual([top.lo, top.hi], [9, 12], 'wilds extend downwards when the top is reached');
  assert.equal(e.classify([R(12), B(1), G(2), Y(3)], run4), null, 'no wrapping');
});

test('colour groups: one colour (any numbers), wilds allowed', () => {
  const c4 = { kind: 'colour', size: 4 };
  assert.ok(e.classify([R(1), R(7), R(12), W()], c4));
  assert.equal(e.classify([R(1), B(7), R(12), R(3)], c4), null);
});

test('you must draw first, and only from the stock or a non-skip discard', () => {
  const g = setup(2, [[R(1), R(2)], [B(1)]]);
  assert.equal(act(g, 0, { type: 'discard', card: R(1).id }).ok, false, 'not drawn yet');
  assert.equal(act(g, 0, { type: 'draw', from: 'nowhere' }).ok, false);
  g.discard = [S()];
  assert.equal(act(g, 0, { type: 'draw', from: 'discard' }).ok, false, 'a skip cannot be picked up');
  assert.equal(act(g, 0, { type: 'draw', from: 'stock' }).ok, true);
  assert.equal(g.hands[0].length, 3);
  assert.equal(act(g, 0, { type: 'draw', from: 'stock' }).ok, false, 'one draw per turn');
  assert.equal(act(g, 1, { type: 'draw', from: 'stock' }).ok, false, 'not your turn');
});

test('laying down your stage: valid groups leave the hand, a bad grouping changes nothing', () => {
  const hand = [R(5), B(5), G(5), R(2), B(3), G(4), Y(9), Y(10)];
  const g = setup(2, [hand, [B(1)]]);
  act(g, 0, { type: 'draw', from: 'stock' });
  const before = g.hands[0].length;
  assert.equal(act(g, 0, { type: 'lay', groups: [ids([R(5), B(5), G(5)]), ids([R(2), R(5), G(4)])] }).ok, false, 'reuses a card');
  assert.equal(act(g, 0, { type: 'lay', groups: [ids([R(5), B(5), G(5)]), ids([Y(9), Y(10), R(11)])] }).ok, false, 'a card not in hand? (R11 was drawn)');
  assert.equal(g.hands[0].length, before);
  assert.equal(act(g, 0, { type: 'lay', groups: [ids([R(5), B(5), G(5)])] }).ok, false, 'two groups needed');
  const r = act(g, 0, { type: 'lay', groups: [ids([R(5), B(5), G(5)]), ids([R(2), B(3), G(4)])] });
  assert.equal(r.ok, true);
  assert.equal(g.hands[0].length, before - 6);
  assert.equal(g.laid[0].length, 2);
  assert.equal(act(g, 0, { type: 'lay', groups: [ids([R(5), B(5), G(5)]), ids([R(2), B(3), G(4)])] }).ok, false, 'once per round');
});

test('hitting needs a laid stage; sets, runs (either end) and colours take matching cards', () => {
  const g = setup(2, [[R(5), B(5), G(5), R(2), B(3), G(4), Y(5), Y(2), W(), R(6)], [B(1)]]);
  act(g, 0, { type: 'draw', from: 'stock' });
  assert.equal(act(g, 0, { type: 'hit', card: Y(5).id, owner: 0, group: 0 }).ok, false, 'not laid yet');
  act(g, 0, { type: 'lay', groups: [ids([R(5), B(5), G(5)]), ids([R(2), B(3), G(4)])] });
  assert.equal(act(g, 0, { type: 'hit', card: R(6).id, owner: 0, group: 0 }).ok, false, '6 is not a 5');
  assert.equal(act(g, 0, { type: 'hit', card: Y(5).id, owner: 0, group: 0 }).ok, true);
  assert.equal(g.laid[0][0].cards.length, 4);
  assert.equal(act(g, 0, { type: 'hit', card: Y(2).id, owner: 0, group: 1 }).ok, false, 'a 2 does not extend 2-4 (1 or 5 do)');
  assert.equal(act(g, 0, { type: 'hit', card: W().id, owner: 0, group: 1, end: 'low' }).ok, true);
  assert.deepEqual([g.laid[0][1].lo, g.laid[0][1].hi], [1, 4]);
  assert.equal(act(g, 0, { type: 'hit', card: W().id, owner: 0, group: 1, end: 'low' }).ok, false, 'that wild was just used');
});

test('you can hit another player\'s laid groups', () => {
  const g = setup(2, [[B(1)], [R(1)]]);
  g.laid[0] = [e.classify([R(5), B(5), G(5)], { kind: 'set', size: 3 }), e.classify([R(2), B(3), G(4)], { kind: 'run', size: 3 })];
  g.laid[1] = [e.classify([R(7), B(7), G(7)], { kind: 'set', size: 3 }), e.classify([R(8), B(9), G(10)], { kind: 'run', size: 3 })];
  g.turn = 1; g.phase = 'play'; g.hands[1] = [Y(7), R(11), B(2)];
  assert.equal(act(g, 1, { type: 'hit', card: Y(7).id, owner: 0, group: 0 }).ok, false, 'a 7 does not fit the 5s');
  assert.equal(act(g, 1, { type: 'hit', card: R(11).id, owner: 1, group: 1 }).ok, true);
  assert.equal(act(g, 1, { type: 'hit', card: B(2).id, owner: 0, group: 1 }).ok, false, 'a 2 is already inside 2-4');
});

test('discard moves the turn on; a skip makes the next player lose their turn', () => {
  const g = setup(3, [[R(1), S()], [B(1), B(2)], [G(1), G(2)]]);
  act(g, 0, { type: 'draw', from: 'stock' });
  act(g, 0, { type: 'discard', card: R(1).id });
  assert.equal(g.turn, 1);
  g.turn = 1; g.phase = 'play'; g.hands[1] = [S(1), B(1)];
  act(g, 1, { type: 'discard', card: S(1).id });
  assert.equal(g.turn, 0, 'player 2 was skipped: back to player 0');
});

test('with two players a skip gives the discarder another turn', () => {
  const g = setup(2, [[R(1), R(2)], [B(1), B(2)]]);
  g.phase = 'play'; g.hands[0] = [S(), R(1)];
  act(g, 0, { type: 'discard', card: S().id });
  assert.equal(g.turn, 0);
  assert.equal(g.phase, 'draw');
});

test('going out ends the round: leftover points are added, laid players move up, others stay', () => {
  const g = setup(3, [[R(1)], [B(1), W()], [G(1), S(), R(12)]]);
  g.laid[0] = []; g.laid[1] = [e.classify([R(5), B(5), G(5)], { kind: 'set', size: 3 })];
  g.stage = [1, 1, 1]; g.phase = 'play';
  act(g, 0, { type: 'discard', card: R(1).id });
  assert.deepEqual(g.scores, [0, 5 + 25, 5 + 15 + 10]);
  assert.equal(g.lastRound.outBy, 0);
  assert.deepEqual(g.stage, [2, 2, 1]);
  assert.equal(g.round, 2, 'a new round was dealt');
  assert.ok(g.hands.every((h) => h.length === 10));
});

test('game over: results rank by stages then points, winners flagged', () => {
  const g = setup(3, [[R(1)], [B(1), W()], [G(1), R(12)]], { options: { length: 'short' } });
  g.stage = [5, 5, 4]; g.laid[0] = []; g.laid[1] = []; g.laid[2] = []; g.phase = 'play';
  g.scores = [10, 5, 0];
  act(g, 0, { type: 'discard', card: R(1).id });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [0], 'player 0: 10 points; player 1: 5 + 30 = 35');
  const res = e.results(g);
  assert.deepEqual(res.map((r) => r.winner), [true, false, false]);
  assert.ok(res[0].score > res[1].score && res[1].score > res[2].score);
  assert.equal(act(g, 0, { type: 'draw', from: 'stock' }).ok, false);
  assert.deepEqual(e.awaiting(g), []);
});

test('an empty stock is refilled from the discard pile, keeping the top card', () => {
  const g = setup(2, [[R(1)], [B(1)]]);
  g.stock = []; g.discard = [R(2), R(3), R(4), R(5)];
  assert.equal(act(g, 0, { type: 'draw', from: 'stock' }).ok, true);
  assert.equal(g.discard.length, 1);
  assert.equal(g.discard[0].id, R(5).id);
  assert.equal(g.stock.length, 2);
});

test('views: only your own hand, laid groups public, spectators see no hand', () => {
  const g = setup(2, [[R(1), R(2)], [B(7), B(8)]]);
  const mine = e.viewFor(g, 'p0');
  assert.deepEqual(mine.hand.map((c) => c.id), [R(1).id, R(2).id]);
  assert.ok(mine.players.every((p) => !('hand' in p) && typeof p.cards === 'number'));
  const s = e.viewFor(g, 'nobody');
  assert.equal(s.me, -1);
  assert.deepEqual(s.hand, []);
  const json = JSON.stringify(e.viewFor(g, 'p0'));
  assert.equal(json.includes(`"id":${B(7).id},`) && json.includes('"hand":[{"id":' + B(7).id), false);
});

test('bad actions are rejected and change nothing', () => {
  const g = setup(2, [[R(1), R(2)], [B(1)]]);
  const before = JSON.stringify(e.viewFor(g, 'p0'));
  for (const bad of [null, 'x', {}, { type: 'zap' }, { type: 'draw' }, { type: 'lay' }, { type: 'hit', card: 1 }, { type: 'discard', card: 'a' }, { type: '__proto__' }]) {
    assert.equal(act(g, 0, bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(e.applyAction(g, 'stranger', { type: 'draw', from: 'stock' }).ok, false);
  assert.equal(JSON.stringify(e.viewFor(g, 'p0')), before);
});

test('the bot lays down what it can, and a hand with a clear stage is solved', () => {
  const sol = e.solve([R(5), B(5), W(), R(2), B(3), G(4), Y(11)], e.STAGES[0]);
  assert.ok(sol && sol.length === 2);
  assert.equal(e.solve([R(1), B(4), G(7), Y(10)], e.STAGES[0]), null);
});

test('bots finish whole games, at every size and length', () => {
  for (const [n, length] of [[2, 'short'], [3, 'full'], [6, 'short'], [4, 'full']]) {
    const g = e.createGame(people(n), { length }, rngFor(n * 13));
    let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(++steps < 20000, `stuck at ${n} players, ${length}`);
      const id = e.awaiting(g)[0];
      assert.equal(e.applyAction(g, id, e.botAction(g, id)).ok, true);
    }
    assert.ok(g.winners.length >= 1);
  }
});

test('the plugin: id, seats, options and the stage formatter', () => {
  assert.equal(def.id, 'stagerummy');
  assert.deepEqual([def.seats.min, def.seats.max], [2, 6]);
  assert.ok(def.options.some((o) => o.key === 'length') && def.options.some((o) => o.key === 'timeLimit'));
  assert.equal(def.stats.formatBest(def.stats.bestOf({ score: 400000 - 35 })), '4');
  const g = def.create(people(3), {}, rngFor(9));
  assert.equal(typeof g.scrub, 'function');
  assert.equal(g.isOver(), false);
});

test('solver uses wilds to reserve specific natural cards for another group', () => {
  for (const kind of ['set', 'colour']) {
    const hand = kind === 'set'
      ? [R(5), B(5), G(5), W(), W(1), W(2)]
      : [R(5), R(4), R(6), W(), W(1), W(2)];
    const req = [{ kind, size: 3 }, { kind: 'run', size: 3 }];
    const groups = e.solve(hand, req);
    assert.ok(groups, kind);
    assert.equal(new Set(groups.flat()).size, 6);
    groups.forEach((group, i) => assert.ok(e.classify(group.map((id) => hand.find((c) => c.id === id)), req[i])));
    assert.ok(groups[0].includes(W().id));
    assert.ok(groups[1].some((id) => id < 96));
  }
});

test('solver can reserve naturals across three groups and rejects wild-only groups', () => {
  const req = Array.from({ length: 3 }, () => ({ kind: 'set', size: 3 }));
  const hand = [R(5), B(5), G(5), ...Array.from({ length: 6 }, (_, i) => W(i))];
  const groups = e.solve(hand, req);
  assert.ok(groups);
  assert.equal(new Set(groups.flat()).size, 9);
  for (const group of groups) assert.ok(e.classify(group.map((id) => hand.find((c) => c.id === id)), req[0]));
  assert.equal(e.solve([W(), W(1), W(2)], [req[0]]), null);
});

test('solver keeps existing maximum-natural choices ahead of wild substitutions', () => {
  const hand = [R(1), B(1), G(1), R(5), B(5), G(5), W()];
  assert.deepEqual(e.solve(hand, [{ kind: 'set', size: 3 }]), [ids(hand.slice(0, 3))]);
  assert.deepEqual(e.solve(hand, [{ kind: 'colour', size: 2 }]), [ids([R(1), R(5)])]);
});

test('a group named by an inherited property (__proto__) is refused, and no array prototype is changed', () => {
  const g = setup(2, [[Y(5), R(1), W(0)], [R(2), B(3)]]);
  act(g, 0, { type: 'draw', from: 'stock' });
  g.laid = [[{ kind: 'set', num: 5, cards: [R(5), B(5), G(5)] }], []];
  g.phase = 'play';
  const before = Object.getOwnPropertyNames(Array.prototype).length;
  const res = act(g, 0, { type: 'hit', card: Y(5).id, owner: 0, group: '__proto__' });
  assert.equal(res.ok, false, 'refused');
  assert.equal(Object.getOwnPropertyNames(Array.prototype).length, before, 'Array.prototype is unchanged');
  assert.equal(Array.prototype.lo, undefined);
  assert.equal(Array.prototype.hi, undefined);
});

test('scrubbing a deleted player\'s name never changes the internal phase, even when the name is "draw"', () => {
  const game = def.create(people(2), {}, rngFor(4));
  assert.equal(game.view('p0').phase, 'draw', 'the game starts in the draw phase');
  game.scrub(['draw'], 'Removed player');
  assert.equal(game.view('p0').phase, 'draw', 'the phase is still draw after the scrub');
});

test('wild cards off: the stock has 100 cards, none of them wild', () => {
  const g = e.createGame(people(2), { wildCards: false }, rngFor(7));
  const total = g.stock.length + g.hands.flat().length + g.discard.length;
  assert.equal(total, 100, 'the deck is 108 cards minus the 8 wild cards');
  assert.equal([...g.stock, ...g.hands.flat(), ...g.discard].some((c) => c.k === 'w'), false, 'no wild card is dealt');
  assert.equal(e.viewFor(g, 'p0').wildCards, false, 'the view reports the option');
});

test('wild cards on (the default): the deck has all 108 cards', () => {
  const g = e.createGame(people(2), {}, rngFor(7));
  assert.equal(g.stock.length + g.hands.flat().length + g.discard.length, 108);
  assert.equal(e.viewFor(g, 'p0').wildCards, true);
});

test('the view names each stage the table has reached', () => {
  const g = e.createGame(people(3), { length: 'short' }, rngFor(8));
  const v = e.viewFor(g, 'p0');
  assert.deepEqual(v.stageNames, e.STAGE_NAMES.slice(0, g.stageCount), 'names match the stages in this game');
  assert.equal(v.stageNames.length, 5, 'a quick game has five stages');
  assert.equal(v.stageNames[0], 'Trio and run');
});

test('the log names public cards, hides stock draws and records a skip with who lost the turn', () => {
  const pacing = require('../games/pacing');
  const g = setup(3, [[R(3), B(5)], [G(2), Y(9), R(4)], [B(7), G(8)]]);
  act(g, 0, { type: 'draw', from: 'stock' });
  act(g, 0, { type: 'discard', card: B(5).id });
  const draw = g.log[0];
  assert.equal(draw.type, 'draw');
  assert.equal(draw.label, null, 'a stock draw names no card');
  assert.equal(g.log[1].type, 'discard');
  assert.equal(g.log[1].label, 'Blue 5', 'a discard is named in words');
  // player 1 discards a skip card: player 2 loses a turn
  g.turn = 1; g.phase = 'play'; g.hands[1] = [S(0), Y(9)];
  act(g, 1, { type: 'draw', from: 'stock' });
  g.turn = 1; g.phase = 'play';
  act(g, 1, { type: 'discard', card: S(0).id });
  const skip = g.log.find((x) => x.type === 'skip');
  assert.ok(skip, 'the skip is in the log');
  assert.equal(skip.by, 1, 'the player who played it');
  assert.equal(skip.who, 2, 'the player who lost the turn');
  const v = e.viewFor(g, 'p0');
  assert.equal(v.log.length, g.log.length, 'the view carries the log');
  assert.equal(v.log.at(-1).type, 'skip');
  assert.ok(pacing.remaining(g) > 0, 'a bot waits after a skip so the feed can be read');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
