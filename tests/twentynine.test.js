'use strict';
const assert = require('node:assert/strict');
const E = require('../games/twentynine/engine');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const people = () => [0, 1, 2, 3].map((i) => ({ id: 'p' + i, name: 'P' + i }));
const card = (suit, rank) => E.buildDeck().find((c) => c.suit === suit && c.rank === rank);
const entry = (player, c, trump = false) => ({ player, card: c, trump });

console.log('29 rules');

test('32 cards worth 28 points; order J > 9 > A > 10 > K > Q > 8 > 7', () => {
  const d = E.buildDeck();
  assert.equal(d.length, 32);
  assert.equal(d.reduce((s, c) => s + c.pts, 0), 28);
  const spades = d.filter((c) => c.suit === 'S').sort((a, b) => b.ord - a.ord).map((c) => c.rank);
  assert.deepEqual(spades, ['J', '9', 'A', '10', 'K', 'Q', '8', '7']);
});

test('trick winner: highest of lead suit; revealed trump cuts; hidden-trump discards do not', () => {
  assert.equal(E.trickWinner([entry(0, card('H', '10')), entry(1, card('H', 'J')), entry(2, card('S', 'J')), entry(3, card('H', '7'))]), 1);
  // spade played while trump hidden is only a discard
  assert.equal(E.trickWinner([entry(0, card('H', '10')), entry(1, card('S', 'J'), false), entry(2, card('H', 'K')), entry(3, card('H', '7'))]), 0);
  // spade played after the trump was shown cuts
  assert.equal(E.trickWinner([entry(0, card('H', 'J')), entry(1, card('S', '7'), true), entry(2, card('H', '9')), entry(3, card('S', '8'), true)]), 3);
  // trump suit led: ordinary comparison among the led suit
  assert.equal(E.trickWinner([entry(0, card('S', '9'), false), entry(1, card('S', 'J'), true), entry(2, card('H', 'J'), false), entry(3, card('S', '7'), true)]), 1);
});

test('bidding is heads-up: a pass opens the seat for the next player clockwise', () => {
  const g = E.createGame(people(), {}, mulberry32(19));
  const first = (g.dealer + 1) % 4;
  const id = (s) => g.players[s % 4].id;
  assert.deepEqual(g.activeBidders, [first, (first + 1) % 4]);
  assert.equal(g.turn, first);
  assert.equal(E.applyAction(g, id(first), { type: 'bid', amount: 15 }).ok, true);
  assert.equal(g.turn, (first + 1) % 4);
  assert.deepEqual(g.activeBidders, [first, (first + 1) % 4]);
  assert.equal(E.applyAction(g, id(first + 1), { type: 'bid', pass: true }).ok, true);
  assert.deepEqual(g.activeBidders.sort((a,b)=>a-b), [first, (first + 2) % 4].sort((a,b)=>a-b));
  assert.equal(g.turn, (first + 2) % 4);
  assert.equal(E.applyAction(g, id(first + 2), { type: 'bid', amount: 16 }).ok, true);
  assert.equal(g.turn, first);
  assert.equal(E.applyAction(g, id(first), { type: 'bid', pass: true }).ok, true);
  assert.equal(g.turn, (first + 3) % 4, 'the incoming challenger gets the first response');
  assert.equal(E.applyAction(g, id(first + 1), { type: 'bid', amount: 17 }).ok, false, 'a passed player cannot re-enter');
  assert.equal(E.applyAction(g, id(first + 3), { type: 'bid', amount: 17 }).ok, true);
  assert.equal(g.turn, (first + 2) % 4, 'the incumbent responds to the incoming challenger');
  assert.equal(E.applyAction(g, id(first + 2), { type: 'bid', amount: 18 }).ok, true);
  assert.equal(g.turn, (first + 3) % 4);
});

test('bidding: ascending bids 15-28, pass, dealer forced to bid when all pass, 28 ends it', () => {
  const g = E.createGame(people(), {}, mulberry32(1));
  const first = (g.dealer + 1) % 4;
  assert.equal(g.turn, first);
  const id = (s) => g.players[s % 4].id;
  assert.equal(E.applyAction(g, id(first + 1), { type: 'bid', amount: 15 }).ok, false); // not your turn
  assert.equal(E.applyAction(g, id(first), { type: 'bid', amount: 14 }).ok, false); // below minimum
  assert.equal(E.applyAction(g, id(first), { type: 'bid', amount: 29 }).ok, false); // above maximum
  assert.equal(E.applyAction(g, id(first), { type: 'bid', amount: 15.5 }).ok, false);
  assert.equal(E.applyAction(g, id(first), { type: 'bid', pass: true }).ok, true);
  assert.equal(E.applyAction(g, id(first + 2), { type: 'bid', pass: true }).ok, true);
  assert.equal(g.turn, (first + 3) % 4, 'the dealer is the next challenger');
  assert.equal(E.viewFor(g, id(first + 3)).canPass, false); // dealer must bid
  assert.equal(E.applyAction(g, id(first + 3), { type: 'bid', pass: true }).ok, false);
  assert.equal(E.applyAction(g, id(first + 3), { type: 'bid', amount: 15 }).ok, true);
  assert.equal(g.phase, 'bidding', 'the other active bidder still gets a chance to raise');
  assert.equal(g.turn, (first + 1) % 4);
  assert.equal(E.applyAction(g, id(first + 1), { type: 'bid', pass: true }).ok, true);
  assert.equal(g.phase, 'chooseTrump');
  assert.equal(g.turn, g.dealer);

  const h = E.createGame(people(), {}, mulberry32(2));
  const f = (h.dealer + 1) % 4;
  assert.equal(E.applyAction(h, h.players[f].id, { type: 'bid', amount: 20 }).ok, true);
  assert.equal(E.applyAction(h, h.players[(f + 1) % 4].id, { type: 'bid', amount: 20 }).ok, false); // must beat it
  assert.equal(E.applyAction(h, h.players[(f + 1) % 4].id, { type: 'bid', amount: 28 }).ok, true);
  assert.equal(h.phase, 'chooseTrump'); // 28 ends the bidding at once
  assert.equal(h.highBidder, (f + 1) % 4);
});

test('open auction lets active bidders raise across rounds; passing is permanent and highest bidder wins', () => {
  const g = E.createGame(people(), {}, mulberry32(21));
  const f = (g.dealer + 1) % 4;
  const act = (seat, action) => E.applyAction(g, g.players[seat].id, action);
  assert.equal(act(f, { type: 'bid', amount: 15 }).ok, true);
  const second = (f + 1) % 4, third = (f + 2) % 4, dealer = g.dealer;
  assert.equal(act(second, { type: 'bid', pass: true }).ok, true);
  assert.equal(act(third, { type: 'bid', amount: 17 }).ok, true);
  assert.equal(g.turn, f);
  assert.equal(act(f, { type: 'bid', amount: 18 }).ok, true);
  assert.equal(g.turn, third);
  assert.equal(act(second, { type: 'bid', amount: 19 }).ok, false, 'the passed second player cannot re-enter');
  assert.equal(act(third, { type: 'bid', amount: 19 }).ok, true);
  assert.equal(g.turn, f);
  assert.equal(act(f, { type: 'bid', pass: true }).ok, true);
  assert.equal(g.turn, dealer, 'the newly-entered dealer responds to the incumbent');
  assert.equal(g.activeBidders.includes(dealer), true, 'dealer enters only after the first active bidder passes');
  assert.equal(act(dealer, { type: 'bid', pass: true }).ok, true);
  assert.equal(g.phase, 'chooseTrump');
  assert.equal(g.highBidder, third);
  assert.equal(g.highBid, 19);
});

function toPlaying(seed) {
  const g = E.createGame(people(), {}, mulberry32(seed));
  const f = (g.dealer + 1) % 4;
  E.applyAction(g, g.players[f].id, { type: 'bid', amount: 16 });
  for (let k = 1; k < 4; k++) E.applyAction(g, g.players[(f + k) % 4].id, { type: 'bid', pass: true });
  const bidder = g.players[g.highBidder];
  const suit = bidder.hand[0].suit;
  const other = ['S', 'H', 'D', 'C'].find((s) => !bidder.hand.some((c) => c.suit === s));
  if (other) assert.equal(E.applyAction(g, bidder.id, { type: 'chooseTrump', suit: other }).ok, false); // must hold the suit
  assert.equal(E.applyAction(g, g.players[(g.highBidder + 1) % 4].id, { type: 'chooseTrump', suit }).ok, false);
  assert.equal(E.applyAction(g, bidder.id, { type: 'chooseTrump', suit }).ok, true);
  return g;
}

test('after trump is chosen everybody has 8 cards and the highest bidder leads', () => {
  const g = toPlaying(3);
  assert.equal(g.phase, 'playing');
  for (const p of g.players) assert.equal(p.hand.length, 8);
  assert.equal(g.turn, g.highBidder);
  assert.equal(new Set(g.players.flatMap((p) => p.hand.map((c) => c.id))).size, 32);
});

test('must follow suit; may only ask for trump when void; asker must play trump if holding it', () => {
  const g = toPlaying(5);
  g.players.forEach((p, i) => { p.hand = []; });
  g.trumpSuit = 'S'; g.trumpRevealed = false;
  g.players[0].hand = [card('H', '7'), card('D', '8')];
  g.players[1].hand = [card('H', '8'), card('S', '9')];
  g.players[2].hand = [card('D', '9'), card('S', 'J'), card('S', '7')];
  g.players[3].hand = [card('H', 'J'), card('C', '7')];
  g.turn = 0; g.trick = []; g.revealer = -1;
  assert.equal(E.applyAction(g, 'p0', { type: 'play', cardId: 'H7' }).ok, true);
  assert.equal(E.applyAction(g, 'p1', { type: 'reveal' }).ok, false); // can follow, cannot ask
  assert.equal(E.applyAction(g, 'p1', { type: 'play', cardId: 'S9' }).ok, false); // must follow hearts
  assert.equal(E.applyAction(g, 'p1', { type: 'play', cardId: 'H8' }).ok, true);
  assert.equal(E.viewFor(g, 'p2').canReveal, true);
  assert.equal(E.applyAction(g, 'p2', { type: 'reveal' }).ok, true);
  assert.equal(g.trumpRevealed, true);
  assert.deepEqual(E.viewFor(g, 'p2').legal.sort(), ['S7', 'SJ']); // must trump
  assert.equal(E.applyAction(g, 'p2', { type: 'play', cardId: 'D9' }).ok, false);
  assert.equal(E.applyAction(g, 'p2', { type: 'play', cardId: 'S7' }).ok, true);
  assert.equal(E.applyAction(g, 'p3', { type: 'play', cardId: 'H8' }).ok, false); // not in hand
  assert.equal(E.applyAction(g, 'p3', { type: 'play', cardId: 'H' + 'J' }).ok, true);
  assert.equal(g.lastTrick.winner, 2); // the cut wins
});

test('trump suit is hidden from everyone but the bidder until revealed', () => {
  const g = toPlaying(7);
  const bidder = g.players[g.highBidder].id;
  for (const p of g.players) {
    const v = E.viewFor(g, p.id);
    assert.equal(v.trumpSet, true);
    if (p.id === bidder) assert.equal(v.trumpSuit, g.trumpSuit);
    else assert.equal(v.trumpSuit, null);
    assert.equal(v.hand.length, 8);
  }
  const json = JSON.stringify(E.viewFor(g, g.players[(g.highBidder + 1) % 4].id));
  assert.ok(!json.includes(`"trumpSuit":"${g.trumpSuit}"`));
  assert.equal(E.viewFor(g, 'p0').players.every((p) => p.hand === undefined), true);
});

test('last trick is forced after the first card, unless the player may still ask for the trump', () => {
  const g = toPlaying(5);
  g.players.forEach((p) => { p.hand = []; });
  g.trumpSuit = 'S'; g.trumpRevealed = false; g.revealer = -1;
  g.players[0].hand = [card('H', '7')];
  g.players[1].hand = [card('H', '8')];
  g.players[2].hand = [card('D', '9')]; // void in hearts, trump still hidden: may ask for the trump
  g.players[3].hand = [card('H', 'J')];
  g.turn = 0; g.trick = [];
  assert.equal(E.forcedPlay(g), null);
  assert.equal(E.applyAction(g, 'p0', { type: 'play', cardId: 'H7' }).ok, true);
  assert.equal(E.viewFor(g, 'p2').trickLeader, 0);
  assert.equal(E.forcedPlay(g).playerId, 'p1');
  E.applyAction(g, 'p1', E.forcedPlay(g).action);
  assert.equal(E.viewFor(g, 'p1').trickLeader, 1);
  assert.equal(E.forcedPlay(g), null); // p2 can still reveal
  assert.equal(E.viewFor(g, 'p2').autoPlay, false);
  assert.equal(E.viewFor(g, 'spectator').me, -1);
});

test('trump King–Queen marriage adds four points once after trump reveal and a team trick win', () => {
  const g = toPlaying(31);
  g.trumpSuit = 'S'; g.trumpRevealed = true; g.tricksWon = [1, 0]; g.tricksPlayed = 1; g.marriageDeclared = false; g.turn = 0;
  g.players[0].hand = [card('S', 'K'), card('S', 'Q'), card('H', '7')];
  assert.equal(E.viewFor(g, 'p0').canDeclareMarriage, true);
  assert.equal(E.applyAction(g, 'p1', { type: 'marriage' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'marriage' }).ok, true);
  assert.equal(g.handPoints[0], 4);
  assert.equal(g.marriageDeclared, true);
  assert.equal(E.viewFor(g, 'p0').canDeclareMarriage, false);
  assert.equal(E.applyAction(g, 'p0', { type: 'marriage' }).ok, false);
  assert.equal(g.log.at(-1).kind, 'marriage');
});

// Scoring options (all off by default). finishHand is the hand-end scorer; these set the hand state it reads.
function endHand(g, { bidder, bid, points, trick }) {
  g.highBidder = bidder; g.highBid = bid; g.handPoints = points.slice(); g.trickPoints = (trick || points).slice();
  g.teamScore = [0, 0]; g.history = []; g.marriageTeam = g.marriageTeam ?? -1;
  E.finishHand(g);
  return g.teamScore[bidder % 2];
}

test('scoring options are off by default and keep the classic +1 / -1', () => {
  const g = E.createGame(people(), {}, mulberry32(5));
  assert.deepEqual(g.options, { target: 6, allTwentyNine: false, halfFailDouble: false, marriageBid: false, doubleChallenge: false });
  assert.equal(endHand(E.createGame(people(), {}, mulberry32(5)), { bidder: 0, bid: 16, points: [29, 0] }), 1);
  assert.equal(endHand(E.createGame(people(), {}, mulberry32(5)), { bidder: 0, bid: 20, points: [14, 15] }), -1);
});

test('All 29 doubles the win: all 29 points taken and bid made gives +2, otherwise +1', () => {
  const on = (o) => { const g = E.createGame(people(), { allTwentyNine: true }, mulberry32(5)); return g; };
  assert.equal(endHand(on(), { bidder: 0, bid: 16, points: [29, 0] }), 2);
  assert.equal(endHand(on(), { bidder: 1, bid: 16, points: [0, 29] }), 2, 'bidder on the odd team');
  assert.equal(endHand(on(), { bidder: 0, bid: 16, points: [28, 1], trick: [27, 1] }), 1, '28 points is not all 29');
  assert.equal(endHand(on(), { bidder: 0, bid: 16, points: [33, 0], trick: [29, 0] }), 2, 'marriage bonus does not stop an all-29 win');
  const g = E.createGame(people(), {}, mulberry32(5));
  assert.equal(endHand(g, { bidder: 0, bid: 16, points: [29, 0] }), 1, 'option off: +1');
});

test('Double loss below half: a missed bid under half the points (14 or fewer of 29) is -2', () => {
  const on = () => E.createGame(people(), { halfFailDouble: true }, mulberry32(5));
  assert.equal(endHand(on(), { bidder: 0, bid: 20, points: [14, 15] }), -2);
  assert.equal(endHand(on(), { bidder: 0, bid: 20, points: [15, 14] }), -1, '15 is at least half of 29');
  assert.equal(endHand(on(), { bidder: 0, bid: 20, points: [19, 10] }), -1, 'close miss stays -1');
  assert.equal(endHand(on(), { bidder: 0, bid: 16, points: [16, 13] }), 1, 'a made bid is +1');
  // A marriage bonus is not card points: 14 card points plus the 4-point bonus still falls under half.
  const bonus = E.createGame(people(), { halfFailDouble: true }, mulberry32(5));
  bonus.trickPoints = [14, 15];
  assert.equal(endHand(bonus, { bidder: 0, bid: 20, points: [18, 15], trick: [14, 15] }), -2, 'marriage bonus does not lift a team over half');
});

test('Marriage changes the bid: bidding team marriage lowers by 4 (min 15); other team raises by 4', () => {
  const on = () => { const g = E.createGame(people(), { marriageBid: true }, mulberry32(5)); return g; };
  let g = on(); g.marriageTeam = 0;
  assert.equal(E.bidTarget(Object.assign(g, { highBidder: 0, highBid: 20 })), 16);
  g = on(); g.marriageTeam = 0; g.highBidder = 0; g.highBid = 16;
  assert.equal(E.bidTarget(g), 15, 'never below 15');
  g = on(); g.marriageTeam = 1; g.highBidder = 0; g.highBid = 16;
  assert.equal(E.bidTarget(g), 20, 'other team marriage raises the bid');
  assert.equal(endHand(on(), { bidder: 0, bid: 16, points: [16, 13] }), 1, 'no marriage: no change');
  g = on(); g.marriageTeam = 1;
  assert.equal(endHand(g, { bidder: 0, bid: 16, points: [16, 13] }), -1, 'raised bid of 20 is missed with 16');
  g = on(); g.marriageTeam = 0;
  assert.equal(endHand(g, { bidder: 0, bid: 20, points: [17, 12] }), 1, 'lowered bid of 16 is made with 17');
  g = on(); g.marriageTeam = 0;
  assert.equal(endHand(g, { bidder: 0, bid: 20, points: [15, 14] }), -1, 'lowered bid of 16 is missed with 15, so -1 not the half rule');
});

test('marriage with the bid option adds no hand points and is still declared once per hand', () => {
  const g = toPlaying(31);
  g.options.marriageBid = true;
  g.trumpSuit = 'S'; g.trumpRevealed = true; g.tricksWon = [1, 0]; g.tricksPlayed = 1; g.marriageDeclared = false; g.turn = 0;
  g.players[0].hand = [card('S', 'K'), card('S', 'Q'), card('H', '7')];
  assert.equal(E.applyAction(g, 'p0', { type: 'marriage' }).ok, true);
  assert.equal(g.handPoints[0], 0);
  assert.equal(g.marriageTeam, 0);
  assert.equal(g.log.at(-1).card.includes('bid lowered by 4'), g.highBidder % 2 === 0);
  assert.equal(E.applyAction(g, 'p0', { type: 'marriage' }).ok, false);
});

test('double and redouble: off by default; when on, the other team doubles before play and the bidder may redouble', () => {
  const off = toPlaying(31);
  assert.equal(off.phase, 'playing', 'option off: no challenge phase');
  const g = E.createGame(people(), { doubleChallenge: true }, mulberry32(31));
  const f = (g.dealer + 1) % 4;
  E.applyAction(g, g.players[f].id, { type: 'bid', amount: 16 });
  for (let k = 1; k < 4; k++) E.applyAction(g, g.players[(f + k) % 4].id, { type: 'bid', pass: true });
  const bidder = g.highBidder;
  const suit = g.players[bidder].hand[0].suit;
  assert.equal(E.applyAction(g, g.players[bidder].id, { type: 'chooseTrump', suit }).ok, true);
  assert.equal(g.phase, 'challenge');
  assert.equal(g.turn, (bidder + 1) % 4, 'the other team answers first, left of the bidder');
  const other = g.players[(bidder + 1) % 4].id;
  assert.equal(E.viewFor(g, other).canDouble, true);
  assert.equal(E.applyAction(g, g.players[bidder].id, { type: 'double' }).ok, false, 'the bidding team cannot double its own bid');
  assert.equal(E.applyAction(g, other, { type: 'double' }).ok, true);
  assert.equal(g.multiplier, 2);
  assert.equal(E.applyAction(g, other, { type: 'double' }).ok, false, 'only once');
  assert.equal(E.viewFor(g, g.players[bidder].id).canRedouble, true);
  assert.equal(E.applyAction(g, g.players[bidder].id, { type: 'redouble' }).ok, true);
  assert.equal(g.multiplier, 4);
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, bidder, 'the bidder leads');
});

test('double and redouble: any player on the answering side may double, and any on the bidding side may redouble', () => {
  const g = E.createGame(people(), { doubleChallenge: true }, mulberry32(34));
  const f = (g.dealer + 1) % 4;
  E.applyAction(g, g.players[f].id, { type: 'bid', amount: 16 });
  for (let k = 1; k < 4; k++) E.applyAction(g, g.players[(f + k) % 4].id, { type: 'bid', pass: true });
  const bidder = g.highBidder;
  E.applyAction(g, g.players[bidder].id, { type: 'chooseTrump', suit: g.players[bidder].hand[0].suit });
  const partner = g.players[(bidder + 3) % 4].id; // the other seat on the answering side, not the one left of the bidder
  const awaitingIds = E.awaiting(g);
  assert.equal(awaitingIds.length, 2, 'both players on the answering side are asked');
  assert.ok(awaitingIds.includes(partner) && awaitingIds.includes(g.players[(bidder + 1) % 4].id));
  assert.equal(E.viewFor(g, partner).myTurn, true);
  assert.equal(E.viewFor(g, partner).canDouble, true);
  assert.equal(E.applyAction(g, partner, { type: 'double' }).ok, true, 'the partner doubles for the team');
  assert.equal(g.multiplier, 2);
  assert.equal(E.viewFor(g, g.players[bidder].id).myTurn, true, 'the bidding side is asked to redouble');
  assert.equal(E.applyAction(g, g.players[(bidder + 2) % 4].id, { type: 'redouble' }).ok, true, 'any bidding player may redouble');
  assert.equal(g.multiplier, 4);
  assert.equal(g.phase, 'playing');
});

test('double and redouble: accepting ends the challenge without changing the multiplier', () => {
  const g = E.createGame(people(), { doubleChallenge: true }, mulberry32(32));
  const f = (g.dealer + 1) % 4;
  E.applyAction(g, g.players[f].id, { type: 'bid', amount: 16 });
  for (let k = 1; k < 4; k++) E.applyAction(g, g.players[(f + k) % 4].id, { type: 'bid', pass: true });
  const bidder = g.highBidder;
  E.applyAction(g, g.players[bidder].id, { type: 'chooseTrump', suit: g.players[bidder].hand[0].suit });
  assert.equal(E.applyAction(g, g.players[(bidder + 1) % 4].id, { type: 'accept' }).ok, true);
  assert.equal(g.multiplier, 1);
  assert.equal(g.phase, 'playing');
});

test('double and redouble: hands are worth 2x and 4x in game points', () => {
  const g = E.createGame(people(), { doubleChallenge: true, allTwentyNine: true }, mulberry32(33));
  g.multiplier = 2;
  assert.equal(endHand(g, { bidder: 0, bid: 16, points: [29, 0] }), 4, 'all 29 (+2) doubled');
  const h = E.createGame(people(), { doubleChallenge: true }, mulberry32(34));
  h.multiplier = 4;
  assert.equal(endHand(h, { bidder: 0, bid: 20, points: [10, 19] }), -4, 'missed redoubled bid is -4');
});

console.log('29 simulation');

test('200 full games: every hand distributes exactly 29 points and scores add up (options on and off)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const opts = seed % 2 ? {} : { allTwentyNine: true, halfFailDouble: true, marriageBid: true, doubleChallenge: true };
    const g = E.createGame(people(), { ...opts, target: [3, 6, 9][seed % 3] }, mulberry32(seed * 13));
    let steps = 0;
    while (g.phase !== 'gameOver') {
      assert.ok(++steps < 20000, 'game did not terminate');
      if (g.phase === 'handEnd') { assert.equal(E.applyAction(g, null, { type: 'continue' }).ok, true); continue; }
      const who = E.awaiting(g)[0];
      assert.ok(who);
      // The bot rarely doubles, so on every third seed the challenge is taken up whenever it is legal.
      const a = seed % 3 === 0 && g.phase === 'challenge' ? { type: g.multiplier === 1 ? 'double' : 'redouble' } : E.botAction(g, who);
      const res = E.applyAction(g, who, a);
      assert.equal(res.ok, true, `${res.error} ${JSON.stringify(a)} phase ${g.phase}`);
    }
    let a = 0, b = 0;
    for (const h of g.history) {
      // The 29 card points still total 29; a declared trump marriage adds a separate 4-point bonus.
      // With the marriage-bid option the marriage adds no hand points, so the 4-point bonus only applies when it is off.
      const bonus = h.marriageDeclared && !g.options.marriageBid ? 4 : 0;
      assert.equal(h.points[0] + h.points[1] - bonus, 29);
      const t = h.bidder % 2;
      assert.ok([1, 2, 4, 8].includes(Math.abs(h.game)), `game ${h.game}`);
      if (h.made) { assert.ok(h.points[t] >= h.target); assert.ok(h.game > 0); } else { assert.ok(h.points[t] < h.target); assert.ok(h.game < 0); }
      assert.ok(h.multiplier === 1 || g.options.doubleChallenge);
      if (h.multiplier === 1 && Math.abs(h.game) === 2) { assert.ok(g.options.allTwentyNine && h.made && h.points[t] === 29 || g.options.halfFailDouble && !h.made && h.points[t] * 2 < 29); }
      if (h.multiplier === 1 && Math.abs(h.game) === 1) assert.ok(!(g.options.allTwentyNine && h.made && h.points[t] === 29));
      t === 0 ? (a += h.game) : (b += h.game);
    }
    assert.deepEqual(g.teamScore, [a, b]);
    const t = g.options.target;
    assert.ok(g.teamScore.some((s) => s >= t || s <= -t));
    assert.ok(g.winnerTeam === 0 || g.winnerTeam === 1);
  }
});

console.log(`\n${passed} twenty-nine tests passed`);
