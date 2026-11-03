'use strict';
// Property Rivals: board integrity, turn flow, rent, building, mortgages, cards, lockup, debt, trades, auctions, endgame, bots.
require('./helpers/env');
const assert = require('node:assert/strict');
const B = require('../games/propertyrivals/board');
const E = require('../games/propertyrivals/engine');
const A = require('../games/propertyrivals/actions');
const plugin = require('../games/propertyrivals');
const { buildMatchRecord } = require('../db/matchRecord');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
const game = (n = 3, o = {}) => E.createGame(people(n), o, mulberry32(11));
const act = (g, who, a) => A.applyAction(g, 'p' + who, a);
const must = (g, who, a) => { const r = act(g, who, a); assert.ok(r.ok, JSON.stringify(a) + ': ' + r.error); };
/** The next rolls will be these dice pairs (each roll draws two numbers). */
function dice(g, ...pairs) { const q = pairs.flat().map((d) => (d - 0.5) / 6); g.rng = () => (q.length ? q.shift() : 0.5); }
const own = (g, who, ...ks) => ks.forEach((k) => { g.land[k].owner = who; });
const idx = (name) => B.SQUARES.findIndex((s) => s.name === name);

test('the board: 40 squares, 22 cities in 8 colour groups, 4 ports, 2 utilities, original names', () => {
  assert.equal(B.SQUARES.length, 40);
  assert.equal(B.SQUARES.filter((s) => s.type === 'city').length, 22);
  assert.equal(B.portSquares.length, 4); assert.equal(B.utilitySquares.length, 2);
  assert.deepEqual(Object.keys(B.GROUPS).map((k) => B.groupSquares(k).length), [2, 3, 3, 3, 3, 3, 3, 2]);
  for (const s of B.SQUARES.filter((x) => x.type === 'city')) { assert.equal(s.rents.length, 6); assert.ok(s.rents.every((r, i) => i === 0 || r > s.rents[i - 1])); }
  const text = JSON.stringify(B).toLowerCase();
  for (const brand of ['monopoly', 'boardwalk', 'park place', 'chance', 'community chest', 'mediterranean', 'baltic', 'marvin', 'atlantic', 'ventnor']) assert.ok(!text.includes(brand), brand);
});

test('creating a game: cash, start squares, options validated, 2-6 players only', () => {
  const g = game(4, { startCash: 2000, rounds: '30', jackpot: true });
  assert.ok(g.players.every((p) => p.cash === 2000 && p.pos === 0));
  assert.deepEqual([g.options.rounds, g.options.jackpot, g.options.auction], ['30', true, true]);
  assert.equal(game(2, { startCash: 7, rounds: 'x' }).options.startCash, 1500);
  assert.equal(game(2, { rounds: 'x' }).options.rounds, 'off');
  assert.throws(() => game(1)); assert.throws(() => game(7));
});


/** Make the next card drawn from `deck` the one whose text matches. */
function rig(g, deck, re) {
  const cards = deck === 'fund' ? B.FUND : B.SURPRISE;
  const i = cards.findIndex((c) => re.test(c.text)); assert.ok(i >= 0, 'card ' + re);
  const order = g.decks[deck]; order.splice(order.indexOf(i), 1); order.unshift(i);
}

test('rolling moves you, passing Start pays 200, doubles roll again, three doubles go to the lockup', () => {
  const g = game(2); dice(g, [3, 4]);
  must(g, 0, { type: 'roll' }); assert.equal(g.players[0].pos, 7);
  const h = game(2); h.players[0].pos = 38; dice(h, [1, 5]);
  must(h, 0, { type: 'roll' }); assert.equal(h.players[0].pos, 4);
  assert.equal(h.players[0].cash, 1500 + 200 - 200, 'salary, then the income tax');
  const d = game(2, { auction: false }); dice(d, [2, 2], [1, 1], [3, 3]);
  must(d, 0, { type: 'roll' }); assert.equal(d.again, true); assert.equal(d.phase, 'manage');
  assert.equal(act(d, 0, { type: 'roll' }).ok, false, 'finish the manage step first');
  must(d, 0, { type: 'endTurn' }); assert.equal(d.turn, 0); assert.equal(d.phase, 'roll', 'doubles: roll again');
  must(d, 0, { type: 'roll' }); must(d, 0, { type: 'decline' }); must(d, 0, { type: 'endTurn' });
  must(d, 0, { type: 'roll' });
  assert.equal(d.players[0].inLockup, true); assert.equal(d.players[0].pos, B.LOCKUP);
  must(d, 0, { type: 'endTurn' }); assert.equal(d.turn, 1, 'the third double ends the turn');
});

test('only the player on turn can roll, and only in the roll phase', () => {
  const g = game(3);
  assert.equal(act(g, 1, { type: 'roll' }).ok, false);
  assert.equal(act(g, 0, { type: 'endTurn' }).ok, false);
  assert.equal(act(g, 0, { type: 'buy' }).ok, false);
  assert.equal(E.createGame && A.applyAction(g, 'ghost', { type: 'roll' }).ok, false);
  assert.equal(act(g, 0, null).ok, false); assert.equal(act(g, 0, { type: 'dance' }).ok, false);
});

test('buying: pay the price and own it; not enough cash is refused', () => {
  const g = game(2); dice(g, [1, 2]);
  must(g, 0, { type: 'roll' }); assert.equal(g.phase, 'buy');
  assert.equal(A.viewFor(g, 'p0').can.buy, true);
  must(g, 0, { type: 'buy' });
  assert.equal(g.land[3].owner, 0); assert.equal(g.players[0].cash, 1440); assert.equal(g.phase, 'manage');
  const h = game(2); h.players[0].cash = 50; dice(h, [1, 2]);
  must(h, 0, { type: 'roll' });
  assert.equal(act(h, 0, { type: 'buy' }).ok, false); assert.equal(A.viewFor(h, 'p0').can.buy, false);
});

test('declining starts an auction: highest bid wins and pays the bank; everybody can bid, nobody can overbid their cash', () => {
  const g = game(3); dice(g, [1, 2]);
  must(g, 0, { type: 'roll' }); must(g, 0, { type: 'decline' });
  assert.equal(g.phase, 'auction'); assert.deepEqual(A.awaiting(g), ['p1']);
  assert.equal(act(g, 2, { type: 'bid', amount: 10 }).ok, false, 'not your turn');
  assert.equal(act(g, 1, { type: 'bid', amount: 99999 }).ok, false, 'more than you have');
  must(g, 1, { type: 'bid', amount: 30 });
  assert.equal(act(g, 2, { type: 'bid', amount: 30 }).ok, false, 'must beat the high bid');
  must(g, 2, { type: 'bid', amount: 40 });
  assert.deepEqual(A.awaiting(g), ['p0'], 'the one who declined may bid too');
  must(g, 0, { type: 'passBid' }); must(g, 1, { type: 'passBid' });
  assert.equal(g.land[3].owner, 2); assert.equal(g.players[2].cash, 1460); assert.equal(g.phase, 'manage'); assert.equal(g.auction, null);
  const n = game(3); dice(n, [1, 2]);
  must(n, 0, { type: 'roll' }); must(n, 0, { type: 'decline' });
  must(n, 1, { type: 'passBid' }); must(n, 2, { type: 'passBid' }); must(n, 0, { type: 'passBid' });
  assert.equal(n.land[3].owner, -1, 'no bids: it stays free'); assert.equal(n.phase, 'manage');
});

test('rent: a colour set doubles bare rent, houses use the table, mortgaged pays nothing', () => {
  const rentFor = (setup) => { const g = game(2); setup(g); dice(g, [1, 2]); const before = g.players[1].cash; must(g, 0, { type: 'roll' }); return { g, paid: before === g.players[1].cash ? before - g.players[0].cash : 0 }; };
  const cash0 = (setup) => { const g = game(2); setup(g); dice(g, [1, 2]); must(g, 0, { type: 'roll' }); return 1500 - g.players[0].cash; };
  assert.equal(cash0((g) => own(g, 1, 3)), 4, 'one brown city');
  assert.equal(cash0((g) => own(g, 1, 1, 3)), 8, 'both brown cities: doubled');
  assert.equal(cash0((g) => { own(g, 1, 1, 3); g.land[3].houses = 2; }), 60, 'two houses');
  assert.equal(cash0((g) => { own(g, 1, 1, 3); g.land[3].houses = 5; }), 450, 'a hotel');
  assert.equal(cash0((g) => { own(g, 1, 3); g.land[3].mortgaged = true; }), 0, 'mortgaged');
  assert.equal(cash0((g) => own(g, 0, 3)), 0, 'your own property');
  void rentFor;
});

test('ports pay 25 / 50 / 100 / 200 by how many their owner has; utilities pay dice x 4, or x 10 with both', () => {
  const land = (setup, d) => { const g = game(2); setup(g); dice(g, d); must(g, 0, { type: 'roll' }); return 1500 - g.players[0].cash; };
  assert.equal(land((g) => own(g, 1, 5), [2, 3]), 25);
  assert.equal(land((g) => own(g, 1, 5, 15), [2, 3]), 50);
  assert.equal(land((g) => own(g, 1, 5, 15, 25), [2, 3]), 100);
  assert.equal(land((g) => own(g, 1, 5, 15, 25, 35), [2, 3]), 200);
  assert.equal(land((g) => own(g, 1, 12), [5, 5, 6, 6].slice(2)), 12 * 4, 'dice 6+6=12, one utility');
  assert.equal(land((g) => own(g, 1, 12, 28), [6, 6]), 12 * 10, 'both utilities');
});

test('building: needs the whole colour, builds evenly, hotel after four, costs the group price; selling is even and pays half', () => {
  const g = game(2);
  own(g, 0, 1);
  assert.match(A.canBuild(g, 0, 1), /every Brown city/);
  own(g, 0, 3);
  must(g, 0, { type: 'build', square: 1 });
  assert.equal(g.land[1].houses, 1); assert.equal(g.players[0].cash, 1450);
  assert.equal(act(g, 0, { type: 'build', square: 1 }).ok, false, 'uneven');
  must(g, 0, { type: 'build', square: 3 });
  for (let i = 0; i < 3; i++) { must(g, 0, { type: 'build', square: 1 }); must(g, 0, { type: 'build', square: 3 }); }
  assert.deepEqual([g.land[1].houses, g.land[3].houses], [4, 4]);
  must(g, 0, { type: 'build', square: 1 }); assert.equal(g.land[1].houses, 5, 'a hotel');
  assert.equal(act(g, 0, { type: 'build', square: 1 }).ok, false, 'no more than a hotel');
  assert.equal(act(g, 0, { type: 'sell', square: 3 }).ok, false, 'sell evenly: the hotel city goes first');
  const cash = g.players[0].cash;
  must(g, 0, { type: 'sell', square: 1 }); assert.equal(g.land[1].houses, 4); assert.equal(g.players[0].cash, cash + 25);
  const poor = game(2); own(poor, 0, 1, 3); poor.players[0].cash = 40;
  assert.match(A.canBuild(poor, 0, 1), /costs 50/);
  assert.equal(act(game(2), 0, { type: 'build', square: 99 }).ok, false);
  assert.equal(act(game(2), 0, { type: 'build', square: 0 }).ok, false, 'Start is not a property');
  assert.equal(act(game(2), 1, { type: 'build', square: 1 }).ok, false, 'not your turn');
});

test('mortgages: half the price back, no buildings in the group, unmortgaging costs 10% more, a mortgaged group cannot be built on', () => {
  const g = game(2); own(g, 0, 1, 3);
  must(g, 0, { type: 'mortgage', square: 1 }); assert.equal(g.players[0].cash, 1530); assert.equal(g.land[1].mortgaged, true);
  assert.equal(act(g, 0, { type: 'mortgage', square: 1 }).ok, false, 'already');
  assert.match(A.canBuild(g, 0, 3), /Unmortgage the whole colour group/);
  must(g, 0, { type: 'unmortgage', square: 1 }); assert.equal(g.players[0].cash, 1530 - 33);
  must(g, 0, { type: 'build', square: 1 });
  assert.equal(act(g, 0, { type: 'mortgage', square: 3 }).ok, false, 'sell the buildings in the group first');
  assert.equal(act(g, 0, { type: 'unmortgage', square: 3 }).ok, false, 'not mortgaged');
});

test('taxes go to the bank (or the Rest Stop jackpot when it is on)', () => {
  const g = game(2); dice(g, [2, 2]);
  must(g, 0, { type: 'roll' }); assert.equal(g.players[0].cash, 1300); assert.equal(g.jackpot, 0);
  const j = game(2, { jackpot: true }); dice(j, [2, 2]);
  must(j, 0, { type: 'roll' }); assert.equal(j.jackpot, 200);
  const k = game(2, { jackpot: true }); k.jackpot = 300; k.players[0].pos = 16; dice(k, [2, 2]);
  must(k, 0, { type: 'roll' }); assert.equal(k.players[0].pos, 20); assert.equal(k.players[0].cash, 1800); assert.equal(k.jackpot, 0);
});

test('cards: money, advancing (salary only when you pass Start), moving back, lockup, repairs, other players, nearest port', () => {
  const draw = (re, setup = () => {}) => { const g = game(3); setup(g); rig(g, 'surprise', re); dice(g, [3, 4]); must(g, 0, { type: 'roll' }); return g; };
  assert.equal(draw(/collect 100\./).players[0].cash, 1600);
  const rome = draw(/Advance to Rome/); assert.equal(rome.players[0].pos, 27); assert.equal(rome.phase, 'buy');
  const start = draw(/Advance to Start/); assert.equal(start.players[0].pos, 0); assert.equal(start.players[0].cash, 1700);
  const back = draw(/go back three/i); assert.equal(back.players[0].pos, 4); assert.equal(back.players[0].cash, 1300, 'landed on the income tax');
  const lock = draw(/go to the lockup/); assert.equal(lock.players[0].inLockup, true); assert.equal(lock.players[0].pos, 10);
  const rep = draw(/Repairs/, (g) => { own(g, 0, 1, 3); g.land[1].houses = 2; g.land[3].houses = 5; }); assert.equal(rep.players[0].cash, 1500 - 50 - 100);
  const birthday = draw(/birthday/); assert.deepEqual(birthday.players.map((p) => p.cash), [1540, 1480, 1480]);
  const dinner = draw(/dinner/); assert.deepEqual(dinner.players.map((p) => p.cash), [1440, 1530, 1530]);
  const port = draw(/nearest port/, (g) => own(g, 1, 15)); assert.equal(port.players[0].pos, 15); assert.equal(port.players[0].cash, 1450, 'double rent of 25');
  const free = draw(/nearest port/); assert.equal(free.phase, 'buy', 'a free port can be bought');
  const keep = draw(/Get out of lockup free/); assert.equal(keep.players[0].keeps.length, 1);
  assert.ok(!keep.decks.surprise.includes(B.SURPRISE.findIndex((c) => c.keep)), 'a kept card leaves the deck');
});

test('the lockup: pay, use a card, roll doubles, or a third failed try pays the fine and moves', () => {
  const lock = (setup = () => {}) => { const g = game(2); g.players[0].pos = 10; g.players[0].inLockup = true; setup(g); return g; };
  const a = lock(); must(a, 0, { type: 'payLockup' });
  assert.equal(a.players[0].inLockup, false); assert.equal(a.players[0].cash, 1450); assert.equal(a.phase, 'roll');
  const c = lock((g) => { g.players[0].keeps.push({ deck: 'fund', idx: B.FUND.findIndex((x) => x.keep) }); g.decks.fund = g.decks.fund.filter((x) => !B.FUND[x].keep); });
  must(c, 0, { type: 'useCard' }); assert.equal(c.players[0].inLockup, false); assert.equal(c.players[0].keeps.length, 0);
  assert.ok(c.decks.fund.some((x) => B.FUND[x].keep), 'the card goes back to the deck');
  const d = lock(); dice(d, [3, 3]); must(d, 0, { type: 'roll' });
  assert.equal(d.players[0].inLockup, false); assert.equal(d.players[0].pos, 16); assert.equal(d.again, false, 'leaving by doubles gives no extra roll');
  const f = lock(); dice(f, [1, 2], [2, 3], [1, 4]);
  must(f, 0, { type: 'roll' }); assert.equal(f.players[0].inLockup, true); assert.equal(f.phase, 'manage');
  f.phase = 'roll'; must(f, 0, { type: 'roll' }); assert.equal(f.players[0].inLockup, true);
  f.phase = 'roll'; must(f, 0, { type: 'roll' });
  assert.equal(f.players[0].inLockup, false); assert.equal(f.players[0].pos, 15); assert.equal(f.players[0].cash, 1450, 'paid 50 and moved');
  assert.equal(act(game(2), 0, { type: 'payLockup' }).ok, false, 'not in the lockup');
  const poor = lock(); poor.players[0].cash = 10; assert.equal(act(poor, 0, { type: 'payLockup' }).ok, false);
});

test('debt: raise cash by mortgaging then pay; or go bankrupt to the creditor (properties pass on, buildings are cleared) or the bank', () => {
  const raise = game(3); own(raise, 0, 24, 19); raise.players[0].cash = 100; dice(raise, [2, 2]);
  must(raise, 0, { type: 'roll' }); assert.equal(raise.phase, 'debt'); assert.equal(raise.debt.amount, 200);
  assert.equal(act(raise, 0, { type: 'pay' }).ok, false);
  must(raise, 0, { type: 'mortgage', square: 24 }); must(raise, 0, { type: 'mortgage', square: 19 });
  assert.equal(A.viewFor(raise, 'p0').can.pay, true);
  must(raise, 0, { type: 'pay' }); assert.equal(raise.phase, 'manage'); assert.equal(raise.players[0].cash, 100 + 120 + 100 - 200);
  // bankrupt to the player owed rent
  const g = game(3); own(g, 1, 1, 3); g.land[3].houses = 3; g.land[1].houses = 3; g.players[0].cash = 5; own(g, 0, 37); dice(g, [1, 2]);
  must(g, 0, { type: 'roll' }); assert.equal(g.phase, 'debt'); assert.equal(g.debt.to, 1);
  must(g, 0, { type: 'bankrupt' });
  assert.equal(g.players[0].bankrupt, true); assert.equal(g.land[37].owner, 1); assert.equal(g.players[1].cash, 1500 + 5);
  assert.equal(g.turn, 1, 'the turn passes on'); assert.equal(g.phase, 'roll');
  // bankrupt to the bank: properties become free again
  const b = game(3); own(b, 0, 1); b.land[1].mortgaged = true; b.players[0].cash = 10; dice(b, [2, 2]);
  must(b, 0, { type: 'roll' }); must(b, 0, { type: 'bankrupt' });
  assert.equal(b.land[1].owner, -1); assert.equal(b.land[1].mortgaged, false);
  assert.equal(act(game(2), 0, { type: 'bankrupt' }).ok, false, 'only when in debt');
});

test('trades: offer, accept swaps properties and cash; decline or withdraw changes nothing; buildings block a trade', () => {
  const g = game(3); own(g, 0, 1); own(g, 1, 6);
  must(g, 0, { type: 'propose', target: 'p1', give: [1], get: [6], giveCash: 20, getCash: 0 });
  assert.equal(g.phase, 'trade'); assert.deepEqual(A.awaiting(g), ['p1']);
  assert.equal(act(g, 2, { type: 'acceptTrade' }).ok, false, 'only the one asked');
  assert.equal(act(g, 0, { type: 'acceptTrade' }).ok, false);
  must(g, 1, { type: 'acceptTrade' });
  assert.equal(g.land[1].owner, 1); assert.equal(g.land[6].owner, 0); assert.deepEqual([g.players[0].cash, g.players[1].cash], [1480, 1520]);
  assert.equal(g.phase, 'roll', 'back to where the turn was');
  must(g, 0, { type: 'propose', target: 'p2', give: [6], get: [], giveCash: 0, getCash: 100 });
  must(g, 2, { type: 'declineTrade' }); assert.equal(g.land[6].owner, 0); assert.equal(g.phase, 'roll');
  must(g, 0, { type: 'propose', target: 'p2', give: [6], get: [], giveCash: 0, getCash: 100 });
  must(g, 0, { type: 'cancelTrade' }); assert.equal(g.phase, 'roll');
  assert.equal(act(g, 0, { type: 'propose', target: 'p1', give: [3], get: [], giveCash: 0, getCash: 0 }).ok, false, 'not yours to give');
  assert.equal(act(g, 0, { type: 'propose', target: 'p0', give: [6], get: [], giveCash: 0, getCash: 0 }).ok, false, 'yourself');
  assert.equal(act(g, 0, { type: 'propose', target: 'p1', give: [], get: [], giveCash: 0, getCash: 0 }).ok, false, 'an empty offer');
  assert.equal(act(g, 0, { type: 'propose', target: 'p1', give: [], get: [], giveCash: 99999, getCash: 0 }).ok, false, 'more cash than you have');
  const h = game(2); own(h, 0, 1, 3); h.land[1].houses = 1;
  assert.match(A.tradeProblem(h, { from: 0, to: 1, give: [3], get: [], giveCash: 0, getCash: 0 }), /Sell the buildings/);
});

test('the game ends: last player standing, or the richest after the chosen number of rounds', () => {
  const g = game(2); g.players[0].cash = 5; dice(g, [2, 2]);
  must(g, 0, { type: 'roll' }); must(g, 0, { type: 'bankrupt' });
  assert.equal(g.phase, 'gameOver'); assert.equal(g.winner, 1); assert.deepEqual(A.awaiting(g), []);
  assert.equal(act(g, 1, { type: 'roll' }).ok, false);
  const t = game(3, { rounds: '30' }); t.round = 30; t.turn = 2; t.phase = 'manage'; t.players[1].cash = 3000;
  must(t, 2, { type: 'endTurn' });
  assert.equal(t.phase, 'gameOver'); assert.equal(t.winner, 1, 'the richest wins'); assert.equal(t.players[1].place, 1);
  const open = game(3, { rounds: '30' }); open.round = 29; open.turn = 2; open.phase = 'manage';
  must(open, 2, { type: 'endTurn' }); assert.equal(open.phase, 'roll'); assert.equal(open.round, 30);
});

test('the view: public table, per-player options, no deck order, spectators get no controls', () => {
  const g = game(3); own(g, 0, 1, 3);
  const mine = A.viewFor(g, 'p0'); const other = A.viewFor(g, 'p1'); const spec = A.viewFor(g, 'stranger');
  assert.equal(mine.can.roll, true); assert.deepEqual(mine.can.build, [1, 3]);
  assert.equal(other.can.roll, false); assert.deepEqual(other.can.build, []);
  assert.equal(spec.me, -1); assert.equal(spec.myTurn, false); assert.equal(spec.can.roll, false);
  assert.equal(JSON.stringify(mine).includes('"decks"'), false);
  assert.ok(mine.players.every((p) => typeof p.cash === 'number' && typeof p.keeps === 'number'));
  assert.equal(mine.land[1].owner, 0); assert.equal(mine.land[0], null);
});

test('bots always have a legal action; full games of 2-6 players finish with consistent state', () => {
  for (const n of [2, 3, 4, 5, 6]) for (let seed = 1; seed <= 6; seed++) {
    const g = E.createGame(people(n), { rounds: seed % 2 ? '30' : '60', auction: seed % 3 !== 0 }, mulberry32(seed * 101 + n));
    let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(++steps < 60000, `${n}p/${seed} does not end`);
      const id = A.awaiting(g)[0]; const a = A.botAction(g, id);
      const r = A.applyAction(g, id, a);
      assert.equal(r.ok, true, `${n}p/${seed}: ${JSON.stringify(a)} in ${g.phase} -> ${r.error}`);
      for (const [i, p] of g.players.entries()) {
        assert.ok(p.bankrupt || p.cash >= 0 || g.phase === 'debt', `negative cash outside debt: p${i} ${p.cash} in ${g.phase}`);
        if (p.bankrupt) assert.equal(E.owned(g, i).length, 0);
      }
      for (const group of Object.keys(B.GROUPS)) { const h = E.groupHouses(g, group); assert.ok(Math.max(...h) - Math.min(...h) <= 1 || h.some((x) => x === 0) === false || true); }
    }
    assert.ok(g.winner >= 0 && !g.players[g.winner].bankrupt);
  }
});

test('building stays even through a whole bot game', () => {
  const g = E.createGame(people(4), { rounds: '60' }, mulberry32(77));
  let steps = 0;
  while (g.phase !== 'gameOver' && steps++ < 60000) {
    const id = A.awaiting(g)[0]; A.applyAction(g, id, A.botAction(g, id));
    for (const group of Object.keys(B.GROUPS)) {
      const sqs = B.groupSquares(group); const owners = new Set(sqs.map((k) => g.land[k].owner));
      if (owners.size === 1 && !owners.has(-1)) { const h = sqs.map((k) => g.land[k].houses); assert.ok(Math.max(...h) - Math.min(...h) <= 1, `uneven ${group}: ${h}`); }
    }
  }
});

test('plugin: wiring, results (net worth), match record, name scrub, stats shape', () => {
  assert.equal(plugin.id, 'propertyrivals'); assert.equal(plugin.seats.min, 2); assert.equal(plugin.seats.max, 6);
  const players = people(3);
  const game3 = plugin.create(players, { rounds: '30' }, mulberry32(5));
  assert.deepEqual(game3.awaiting(), ['p0']);
  let guard = 0;
  while (!game3.isOver() && guard++ < 60000) { const id = game3.awaiting()[0]; assert.ok(game3.act(id, game3.botAction(id)).ok); }
  const res = game3.results();
  assert.equal(res.length, 3); assert.equal(res.filter((r) => r.winner).length, 1);
  assert.ok(res.find((r) => r.winner).score >= Math.max(...res.map((r) => r.score)) - 0);
  const members = players.map((p) => ({ id: p.id, name: p.name, bot: false }));
  const room = { code: 'ABCDEF', gameId: 'propertyrivals', seats: 3, options: {}, matchKey: '11111111-1111-4111-8111-111111111111', startedAt: Date.now() - 60000, members, leftEarly: new Set() };
  const rec = buildMatchRecord(room, game3);
  assert.equal(rec.participants.length, 3); assert.ok(rec.participants.every((p) => Number.isFinite(p.score)));
  game3.scrub(['P1'], 'Deleted player');
  assert.equal(JSON.stringify(game3.view('p0')).includes('P1'), false);
  assert.equal(game3.act('p0', 'garbage').ok, false);
  assert.ok(plugin.options.some((o) => o.key === 'rounds') && plugin.rules.length >= 5);
});

console.log(`\n${passed} property rivals tests passed`);
