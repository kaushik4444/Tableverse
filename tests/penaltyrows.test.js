'use strict';
// Penalty Rows: the rules, with hand-built positions so each rule is checked on its own. Pure, no sockets.
const assert = require('node:assert/strict');
const e = require('../games/penaltyrows/engine');
const def = require('../games/penaltyrows');
const pacing = require('../games/pacing');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }

const rngFor = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const c = (n) => ({ n, p: e.penaltyOf(n) });
const cards = (...ns) => ns.map(c);
const pen = (...ns) => ns.reduce((s, n) => s + e.penaltyOf(n), 0);

/** A game with the position set by hand: rows (arrays of numbers) and hands (arrays of numbers), turn 1 of round 1. */
function setup(n, rows, hands, options = {}) {
  const g = e.createGame(people(n), options, rngFor(5));
  g.rows = rows.map((r) => cards(...r));
  g.hands = hands.map((h) => cards(...h));
  g.picks = people(n).map(() => null);
  return g;
}
const pick = (g, i, n) => e.applyAction(g, 'p' + i, { type: 'pick', card: n });

test('penalty points: 1, +1 for a multiple of 5, +1 more for a multiple of 10, +4 for 11, 22 ... 99', () => {
  assert.deepEqual([1, 5, 10, 11, 22, 55, 100, 99, 7].map(e.penaltyOf), [1, 2, 3, 5, 5, 6, 3, 5, 1]);
});

test('the deal: 10 cards each, four one-card rows, and no number appears twice', () => {
  for (const n of [2, 5, 8]) {
    const g = e.createGame(people(n), {}, rngFor(n));
    assert.equal(g.rows.length, 4);
    assert.ok(g.rows.every((r) => r.length === 1));
    assert.ok(g.hands.every((h) => h.length === 10));
    const all = [...g.rows.flat(), ...g.hands.flat()].map((x) => x.n);
    assert.equal(new Set(all).size, all.length, 'every number is unique');
    assert.ok(all.every((x) => x >= 1 && x <= 104));
  }
});

test('2 to 8 players only', () => {
  assert.throws(() => e.createGame(people(1), {}, rngFor(1)));
  assert.throws(() => e.createGame(people(9), {}, rngFor(1)));
});

test('a card goes onto the row whose last card is the closest number below it', () => {
  const g = setup(2, [[10], [30], [50], [70]], [[40, 99], [75, 98]]);
  pick(g, 0, 40); pick(g, 1, 75);
  assert.deepEqual(g.rows[1].map((x) => x.n), [30, 40], '40 joins 30, not 10');
  assert.deepEqual(g.rows[3].map((x) => x.n), [70, 75], '75 joins 70');
  assert.deepEqual(g.rows[0].map((x) => x.n), [10]);
});

test('cards are played from the lowest number up, whoever picked first', () => {
  const g = setup(2, [[10], [30], [50], [70]], [[45, 99], [41, 98]]);
  pick(g, 0, 45); pick(g, 1, 41);
  // 41 is played first and joins 30; 45 then joins 41 (now the closest number below it)
  assert.deepEqual(g.rows[1].map((x) => x.n), [30, 41, 45]);
  assert.deepEqual(g.lastTurn.map((x) => x.n), [41, 45]);
});

test('picks are secret until all are in, and a pick can be changed before then', () => {
  const g = setup(3, [[10], [30], [50], [70]], [[40, 41], [42, 43], [44, 45]]);
  pick(g, 0, 40);
  const seen = e.viewFor(g, 'p1');
  assert.equal(JSON.stringify(seen).includes('"myPick":40'), false, 'player 1 does not see player 0\'s card');
  assert.equal(seen.players[0].picked, true, 'but sees that player 0 has chosen');
  assert.deepEqual(seen.reveal, [], 'nothing is revealed yet');
  assert.deepEqual(e.awaiting(g), ['p1', 'p2']);
  assert.equal(pick(g, 0, 41).ok, true, 'changing the pick is allowed');
  assert.equal(e.viewFor(g, 'p0').myPick, 41);
  pick(g, 1, 42); pick(g, 2, 44);
  assert.equal(g.turn, 2, 'all picked: the turn was played');
});

test('a card lower than every row makes its player take a row of their choice', () => {
  const g = setup(2, [[10], [30], [50, 60], [70]], [[5, 99], [80, 98]]);
  pick(g, 0, 5); pick(g, 1, 80);
  assert.equal(g.phase, 'takeRow');
  assert.deepEqual(e.awaiting(g), ['p0']);
  assert.equal(e.viewFor(g, 'p1').pending.n, 5, 'everyone can see which card is waiting');
  assert.equal(e.applyAction(g, 'p1', { type: 'takeRow', row: 0 }).ok, false, 'only the player whose card it is');
  assert.equal(e.applyAction(g, 'p0', { type: 'takeRow', row: 4 }).ok, false, 'a real row');
  assert.equal(e.applyAction(g, 'p0', { type: 'takeRow', row: 'x' }).ok, false);
  assert.equal(e.applyAction(g, 'p0', { type: 'takeRow', row: 2 }).ok, true);
  assert.deepEqual(g.rows[2].map((x) => x.n), [5], 'their card starts the row again');
  assert.equal(g.piles[0].length, 2);
  assert.equal(e.viewFor(g, 'p0').players[0].penalty, pen(50, 60));
  assert.equal(g.phase, 'choose', 'the remaining card (80) was played and the next turn began');
  assert.deepEqual(g.rows[3].map((x) => x.n), [70, 80]);
});

test('the sixth card takes the five and starts the row again', () => {
  const g = setup(2, [[10, 11, 12, 13, 14], [30], [50], [70]], [[20, 99], [80, 98]]);
  pick(g, 0, 20); pick(g, 1, 80);
  assert.deepEqual(g.rows[0].map((x) => x.n), [20]);
  assert.equal(g.piles[0].map((x) => x.n).join(), '10,11,12,13,14');
  assert.equal(e.viewFor(g, 'p0').players[0].penalty, pen(10, 11, 12, 13, 14));
  assert.equal(g.lastTurn[0].kind, 'sweep');
});

test('a fifth card is simply added', () => {
  const g = setup(2, [[10, 11, 12, 13], [30], [50], [70]], [[20, 99], [80, 98]]);
  pick(g, 0, 20); pick(g, 1, 80);
  assert.equal(g.rows[0].length, 5);
  assert.equal(g.piles[0].length, 0);
});

test('two cards for one row in one turn: the second can be the sixth', () => {
  const g = setup(2, [[10, 11, 12, 13], [30], [50], [70]], [[20, 99], [25, 98]]);
  pick(g, 0, 20); pick(g, 1, 25);
  // 20 becomes the fifth card; 25 is then the sixth and sweeps the row
  assert.equal(g.piles[1].length, 5);
  assert.deepEqual(g.rows[0].map((x) => x.n), [25]);
});

test('after 10 turns the round is scored and a new round is dealt', () => {
  const g = e.createGame(people(2), { target: 'long' }, rngFor(3));
  for (let i = 0; i < 400 && g.round === 1; i++) {
    for (const id of e.awaiting(g)) { const a = e.botAction(g, id); e.applyAction(g, id, a); }
  }
  assert.equal(g.round, 2);
  assert.ok(g.lastRound && g.lastRound.round === 1);
  assert.deepEqual(g.totals, g.lastRound.penalties);
  assert.ok(g.hands.every((h) => h.length === 10), 'a fresh deal');
  assert.ok(g.piles.every((p) => p.length === 0), 'piles are empty again');
});

test('below the target the game goes on', () => {
  const g = setup(3, [[10], [30], [50], [70]], [[5], [45], [60]], { target: 'short' });
  g.turn = 10; g.totals = [30, 20, 20];
  pick(g, 0, 5); pick(g, 1, 45); pick(g, 2, 60);
  assert.equal(g.phase, 'takeRow');
  e.applyAction(g, 'p0', { type: 'takeRow', row: 0 }); // takes the 10 (1 point... 3): 30 + 3 = 33, not yet 35
  assert.notEqual(g.phase, 'gameOver');
});

test('game over: lowest total wins, equal totals share, and results rank by negative total', () => {
  const g = setup(3, [[10], [30], [50], [70]], [[5], [45], [60]], { target: 'short' });
  g.turn = 10; g.totals = [40, 12, 12];
  pick(g, 0, 5); pick(g, 1, 45); pick(g, 2, 60);
  e.applyAction(g, 'p0', { type: 'takeRow', row: 0 });
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [1, 2]);
  const res = e.results(g);
  assert.deepEqual(res.map((r) => r.winner), [false, true, true]);
  assert.ok(res[1].score > res[0].score, 'a lower total is a higher score');
  assert.equal(res[1].score, -12);
  assert.deepEqual(e.awaiting(g), []);
  assert.equal(e.applyAction(g, 'p1', { type: 'pick', card: 1 }).ok, false, 'nothing after the end');
});

test('the last card in a hand is forced', () => {
  const g = setup(2, [[10], [30], [50], [70]], [[40], [41, 42]]);
  const f = e.forcedPlay(g);
  assert.deepEqual(f, { playerId: 'p0', action: { type: 'pick', card: 40 } });
  pick(g, 0, 40);
  assert.equal(e.forcedPlay(g), null, 'player 1 still has a choice');
});

test('bad actions are rejected and change nothing', () => {
  const g = setup(2, [[10], [30], [50], [70]], [[40, 41], [42, 43]]);
  const before = JSON.stringify(e.viewFor(g, 'p0'));
  for (const bad of [null, 'x', {}, { type: 'pick' }, { type: 'pick', card: 99 }, { type: 'pick', card: '40' }, { type: 'pick', card: 42 }, { type: 'pick', card: 40.5 },
    { type: 'takeRow', row: 0 }, { type: '__proto__' }, { type: 'play', card: { n: 40 } }]) {
    const r = e.applyAction(g, 'p0', bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(e.applyAction(g, 'stranger', { type: 'pick', card: 40 }).ok, false);
  assert.equal(JSON.stringify(e.viewFor(g, 'p0')), before);
});

test('views: a spectator has no hand and no pick; players never carry a hand', () => {
  const g = setup(2, [[10], [30], [50], [70]], [[40, 41], [42, 43]]);
  pick(g, 0, 40);
  const s = e.viewFor(g, '__spectator__');
  assert.equal(s.me, -1);
  assert.deepEqual(s.hand, []);
  assert.equal(s.myPick, null);
  assert.ok(s.players.every((p) => !('hand' in p) && !('pick' in p)));
  assert.equal(JSON.stringify(s).includes('42'), false, 'no hidden number in a spectator view');
});

test('bots always finish a game, at every size', () => {
  for (const n of [2, 3, 8]) {
    const g = e.createGame(people(n), { target: 'short' }, rngFor(n * 11));
    let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(++steps < 20000, 'stuck');
      const aw = e.awaiting(g);
      assert.ok(aw.length, 'someone is awaited');
      const f = e.forcedPlay(g);
      const id = f ? f.playerId : aw[0];
      const r = e.applyAction(g, id, f ? f.action : e.botAction(g, id));
      assert.equal(r.ok, true);
    }
    assert.ok(g.winners.length >= 1);
  }
});

test('the plugin: id, seats, options and a lowest-wins "best" formatter', () => {
  assert.equal(def.id, 'penaltyrows');
  assert.deepEqual([def.seats.min, def.seats.max], [2, 8]);
  assert.ok(def.options.some((o) => o.key === 'target') && def.options.some((o) => o.key === 'timeLimit'));
  assert.equal(def.stats.formatBest(def.stats.bestOf({ score: -23 })), '23');
  const g = def.create(people(3), {}, rngFor(9));
  assert.equal(typeof g.scrub, 'function');
  assert.equal(g.isOver(), false);
});

test('timer: every simultaneous turn is a new batch, and the stamp is a primitive that changes once per finished turn', () => {
  const g = setup(2, [[10], [30], [50], [70]], [[40, 41], [42, 43]]);
  const b1 = e.viewFor(g, null).batch;
  const s1 = def.create(people(2), {}, rngFor(4));
  assert.equal(typeof s1.stamp(), 'number');
  pick(g, 0, 40); pick(g, 1, 42);
  assert.notEqual(e.viewFor(g, null).batch, b1, 'the next turn is a new batch even though the same players are awaited');
  const t = def.create(people(2), {}, rngFor(4));
  const before = t.stamp();
  const [a, b] = ['p0', 'p1'];
  t.act(a, t.botAction(a)); assert.equal(t.stamp(), before, 'a single pick does not change it');
  t.act(b, t.botAction(b)); assert.notEqual(t.stamp(), before, 'a finished turn does');
});

test('table option: four cards per row, so the fifth card takes a full row', () => {
  const g = setup(2, [[10, 11, 12, 13], [30], [50], [70]], [[20, 99], [80, 98]], { rowSize: '4' });
  assert.equal(g.rowLimit, 4);
  pick(g, 0, 20); pick(g, 1, 80);
  assert.equal(g.piles[0].length, 4, 'the four cards on row 1 are taken');
  assert.deepEqual(g.rows[0].map((x) => x.n), [20]);
});

test('table option: six cards per row, so a fifth card is only added', () => {
  const g = setup(2, [[10, 11, 12, 13, 14], [30], [50], [70]], [[20, 99], [80, 98]], { rowSize: '6' });
  pick(g, 0, 20); pick(g, 1, 80);
  assert.equal(g.rows[0].length, 6);
  assert.equal(g.piles[0].length, 0);
});

test('table option: a hand of six cards gives six turns and a new round is dealt with six cards', () => {
  const g = e.createGame(people(2), { hand: '6', target: 'long' }, rngFor(21));
  assert.equal(g.handSize, 6);
  assert.ok(g.hands.every((h) => h.length === 6));
  for (let i = 0; i < 400 && g.round === 1; i++) {
    for (const id of e.awaiting(g)) { const f = e.forcedPlay(g); e.applyAction(g, f ? f.playerId : id, f ? f.action : e.botAction(g, id)); }
  }
  assert.equal(g.round, 2);
  assert.ok(g.hands.every((h) => h.length === 6), 'the next round is dealt six cards too');
});

test('table option: simple scoring is one point per card, and the game length goes with it', () => {
  const g = e.createGame(people(2), { scoring: 'simple', target: 'short' }, rngFor(8));
  assert.equal(g.simple, true);
  assert.equal(g.target, 20);
  assert.ok([...g.rows.flat(), ...g.hands.flat()].every((c) => c.p === 1));
});

test('table option: with the cheapest row, a card below every row takes the cheapest row without asking', () => {
  // rows cost 8 (10 and 11), 3, 3 and 3: the first row that costs least is row 2
  const g = setup(2, [[10, 11], [30], [50], [70]], [[5, 99], [80, 98]], { lowCard: 'cheapest' });
  pick(g, 0, 5); pick(g, 1, 80);
  assert.equal(g.phase, 'choose', 'nobody has to choose');
  assert.deepEqual(g.rows[1].map((x) => x.n), [5], 'the cheapest row restarts with 5');
  assert.equal(g.piles[0].map((x) => x.n).join(), '30');
  assert.deepEqual(g.rows[3].map((x) => x.n), [70, 80]);
});

test('table options: unknown values fall back to the defaults', () => {
  const g = e.createGame(people(2), { rowSize: '7', hand: '9', scoring: 'x', lowCard: 'y', pace: 'slow', target: 'huge' }, rngFor(2));
  assert.deepEqual(g.options, { target: 'standard', scoring: 'standard', rowSize: 5, hand: 10, lowCard: 'choose', pace: 'relaxed' });
  assert.equal(g.handSize, 10);
  assert.equal(g.rowLimit, 5);
});

test('pace: each card on the table holds the table (the server waits for it), and quick holds less than relaxed', () => {
  const held = (pace) => {
    const g = setup(2, [[10], [30], [50], [70]], [[40, 41], [42, 43]], { pace });
    assert.equal(pacing.remaining(g), 0, 'nothing is held before the cards are played');
    pick(g, 0, 40); pick(g, 1, 42);
    return pacing.remaining(g);
  };
  const quick = held('quick');
  const relaxed = held('relaxed');
  assert.ok(quick > 0, 'a played turn is held');
  assert.ok(relaxed > quick, 'relaxed holds longer than quick');
});

test('the plugin exposes every table option, each with a valid default, and the holds are scaled for tests', () => {
  const keys = def.options.map((o) => o.key);
  for (const k of ['target', 'scoring', 'rowSize', 'hand', 'lowCard', 'pace', 'timeLimit']) assert.ok(keys.includes(k), k);
  for (const o of def.options.filter((x) => x.type === 'select')) {
    assert.ok(o.choices.some((c) => c.value === o.default), `${o.key} default is one of its choices`);
  }
  const g = def.create(people(2), {}, rngFor(6));
  assert.equal(typeof g.holdMs, 'function');
  assert.equal(g.holdMs(), 0);
  assert.equal(typeof g.setPacingScale, 'function');
});

/** Plays out the last turn of a round with the given piles (what each player has taken so far) and totals. */
function finishRound(totals, piles, picks) {
  const g = setup(2, [[1], [2], [3], [4]], [[10], [20]], { target: 'countdown' });
  g.totals = totals.slice(); g.piles = piles.map((p) => cards(...p)); g.turn = g.handSize;
  pick(g, 0, picks[0]); pick(g, 1, picks[1]);
  return g;
}

test('Starting score 66: the countdown option is accepted and everyone starts with 66 points', () => {
  const g = e.createGame(people(3), { target: 'countdown' }, rngFor(4));
  assert.equal(g.countdown, true);
  assert.equal(g.target, 66);
  assert.equal(g.options.target, 'countdown');
  assert.equal(e.viewFor(g, 'p0').players[0].left, 66);
});

test('Starting score 66: someone at 0 does not end the game mid-round; the round is played out first', () => {
  const g = setup(2, [[1], [2], [3], [4]], [[10, 30], [20, 40]], { target: 'countdown' });
  g.totals = [60, 0]; g.piles = [cards(55), []]; // 6 points taken now: 66 total would be reached, but the round goes on
  pick(g, 0, 10); pick(g, 1, 20);
  assert.equal(g.phase, 'choose', 'the first turn of the round is not the end of it');
  assert.equal(g.totals[0], 60, 'totals only change when the round is scored');
});

test('Starting score 66: whoever reached 0 loses, and the player with the most points left wins', () => {
  const g = finishRound([60, 10], [[55], []], [10, 20]); // p0 takes 6 more: 66 reached, so p0 is at 0
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.losers, [0]);
  assert.deepEqual(g.winners, [1]);
  const res = e.results(g);
  assert.equal(res[0].winner, false);
  assert.equal(res[1].winner, true);
});

test('Starting score 66: equal points left share the win, and everyone at 0 means nobody wins', () => {
  const shared = finishRound([60, 40], [[55], []], [10, 20]); // p0 at 0, p1 has 26 left
  assert.deepEqual(shared.winners, [1]);
  const all = finishRound([60, 60], [[55], [55]], [10, 20]); // both reach 0
  assert.equal(all.phase, 'gameOver');
  assert.deepEqual(all.losers, [0, 1]);
  assert.deepEqual(all.winners, []);
  assert.deepEqual(e.results(all).map((r) => r.winner), [false, false]);
});

test('Starting score 66: with points left on both sides the game goes on', () => {
  const g = finishRound([30, 20], [[5], []], [10, 20]);
  assert.equal(g.phase, 'choose');
  assert.deepEqual(g.losers, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
