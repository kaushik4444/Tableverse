'use strict';
/**
 * 29 (Twenty-Nine) — pure rules engine.
 *
 * 4 players in 2 teams (seats 0+2 vs 1+3), 32 cards (7..A in 4 suits).
 * Card order high->low: J, 9, A, 10, K, Q, 8, 7.  Points: J=3, 9=2, A=1, 10=1 (28 in total, +1 for the last trick = 29).
 * Each hand: deal 4 cards, bid (15-28), the bidder secretly picks trump, deal 4 more, play 8 tricks.
 * The trump suit stays hidden until someone who cannot follow suit asks for it to be shown.
 */

const SUITS = ['S', 'H', 'D', 'C']; // spades, hearts, diamonds, clubs
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J']; // low -> high
const POINTS = { J: 3, 9: 2, A: 1, 10: 1, K: 0, Q: 0, 8: 0, 7: 0 };
const MIN_BID = 15;
const MAX_BID = 28;

function buildDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ id: s + r, suit: s, rank: r, pts: POINTS[r], ord: RANKS.indexOf(r) });
  return d;
}
function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sortHand = (h) => h.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || b.ord - a.ord);
const team = (seat) => seat % 2;

function ledSuit(trick) {
  return trick.length ? trick[0].card.suit : null;
}

/**
 * Winner (seat) of a trick. Entries carry `trump: true` when the card was played after the trump was
 * revealed and is of the trump suit; trump cards played earlier were just discards.
 */
function trickWinner(trick) {
  const led = ledSuit(trick);
  const cutters = trick.filter((t) => t.trump && t.card.suit !== led);
  const pool = cutters.length ? cutters : trick.filter((t) => t.card.suit === led);
  return pool.reduce((a, b) => (b.card.ord > a.card.ord ? b : a)).player;
}

function createGame(playerList, options = {}, rng = Math.random) {
  if (playerList.length !== 4) throw new Error('29 needs exactly 4 players');
  const target = [3, 6, 9].includes(Number(options.target)) ? Number(options.target) : 6;
  const g = {
    rng,
    n: 4,
    options: {
      target,
      // Off by default: the classic scoring. Each one changes the result of a hand (see finishHand and bidTarget).
      allTwentyNine: options.allTwentyNine === true,
      halfFailDouble: options.halfFailDouble === true,
      marriageBid: options.marriageBid === true,
      doubleChallenge: options.doubleChallenge === true,
    },
    players: playerList.map((p) => ({ id: p.id, name: p.name, hand: [] })),
    dealer: Math.floor(rng() * 4),
    handNo: 0,
    teamScore: [0, 0],
    history: [],
    phase: 'bidding',
    log: [],
  };
  startHand(g);
  return g;
}

function startHand(g) {
  if (g.handNo > 0) g.dealer = (g.dealer + 1) % 4;
  g.handNo++;
  const deck = shuffle(buildDeck(), g.rng);
  for (const p of g.players) p.hand = sortHand(deck.splice(0, 4));
  g.stock = deck; // 16 cards, dealt after trump is chosen
  g.phase = 'bidding';
  g.turn = (g.dealer + 1) % 4;
  g.activeBidders = [g.turn, (g.turn + 1) % 4]; // only two seats compete at a time; a pass opens a seat for the next player
  g.bids = [null, null, null, null]; // latest action: null, 'pass', or current bid
  g.passed = [false, false, false, false]; // passing is permanent for this auction
  g.highBid = 0;
  g.highBidder = -1;
  g.trumpSuit = null;
  g.trumpRevealed = false;
  g.revealer = -1;
  g.trick = [];
  g.lastTrick = null;
  g.tricksPlayed = 0;
  g.handPoints = [0, 0];
  g.trickPoints = [0, 0]; // card points won in tricks only (no marriage bonus); together they make 29
  g.tricksWon = [0, 0];
  g.marriageDeclared = false;
  g.marriageTeam = -1; // team that declared the marriage this hand (marriageBid option only)
  g.multiplier = 1; // 2 after the other team doubles the bid, 4 after the bidding team redoubles (doubleChallenge option)
}

/**
 * The points the bidding team must reach. With the marriage-bid option, a marriage by the bidding team
 * lowers the bid by 4 (never below 15); a marriage by the other team raises it by 4.
 */
function bidTarget(g) {
  if (g.highBidder < 0) return null;
  if (!g.options.marriageBid || g.marriageTeam < 0) return g.highBid;
  return g.marriageTeam === team(g.highBidder) ? Math.max(MIN_BID, g.highBid - 4) : g.highBid + 4;
}

function minBid(g) {
  return Math.max(MIN_BID, g.highBid + 1);
}
function canPass(g) {
  // The dealer must open at 15 if everybody else has passed without a bid.
  return !(g.turn === g.dealer && g.highBidder < 0);
}

function nextActiveBidder(g, fromSeat) {
  for (let step = 1; step <= 4; step++) {
    const seat = (fromSeat + step) % 4;
    if (g.activeBidders.includes(seat)) return seat;
  }
  return -1;
}

function advanceBidding(g, actedSeat) {
  if (g.highBid === MAX_BID) {
    if (g.highBidder >= 0) { g.phase = 'chooseTrump'; g.turn = g.highBidder; }
    return;
  }
  // Keep the auction heads-up. When someone passes, the next player clockwise
  // takes the vacant seat; players who passed never return.
  let incomingBidder = -1;
  if (g.passed[actedSeat]) {
    g.activeBidders = g.activeBidders.filter((seat) => seat !== actedSeat);
    for (let step = 1; step <= 4; step++) {
      const seat = (actedSeat + step) % 4;
      if (!g.passed[seat] && !g.activeBidders.includes(seat)) {
        g.activeBidders.push(seat);
        incomingBidder = seat;
        break;
      }
    }
  }
  if (g.activeBidders.length <= 1) {
    if (g.highBidder >= 0) {
      g.phase = 'chooseTrump';
      g.turn = g.highBidder;
    } else {
      // The dealer is the final player when everyone else has passed and must open at 15.
      g.turn = g.dealer;
    }
    return;
  }
  // The replacement challenger responds to the incumbent's standing bid first.
  g.turn = incomingBidder >= 0 ? incomingBidder : nextActiveBidder(g, actedSeat);
}

function legalCards(g, seat) {
  const hand = g.players[seat].hand;
  if (!g.trick.length) return hand.slice();
  const led = ledSuit(g.trick);
  const follow = hand.filter((c) => c.suit === led);
  if (follow.length) return follow;
  // cannot follow: after asking for the trump to be shown you must play trump if you have it
  if (g.revealer === seat) {
    const trumps = hand.filter((c) => c.suit === g.trumpSuit);
    if (trumps.length) return trumps;
  }
  return hand.slice();
}

function canReveal(g, seat) {
  if (g.phase !== 'playing' || g.trumpRevealed || seat !== g.turn || !g.trick.length || g.revealer === seat) return false;
  const led = ledSuit(g.trick);
  return !g.players[seat].hand.some((c) => c.suit === led);
}

// Standard 29 marriage: the player holds both K and Q of revealed trump and their team has won a trick.
function canDeclareMarriage(g, seat) {
  if (g.phase !== 'playing' || !g.trumpRevealed || seat !== g.turn || g.marriageDeclared) return false;
  if (!g.tricksWon || g.tricksWon[team(seat)] < 1) return false;
  const hand = g.players[seat].hand;
  return hand.some((c) => c.suit === g.trumpSuit && c.rank === 'K') && hand.some((c) => c.suit === g.trumpSuit && c.rank === 'Q');
}

/**
 * Last trick of a hand: everybody holds one card. After the first card is down the rest play automatically,
 * except a player who may still ask for the trump to be shown (that choice can change the winner).
 */
function forcedPlay(g) {
  if (g.phase !== 'playing' || !g.trick.length) return null;
  const p = g.players[g.turn];
  if (!p || p.hand.length !== 1 || canReveal(g, g.turn) || canDeclareMarriage(g, g.turn)) return null;
  return { playerId: p.id, action: { type: 'play', cardId: p.hand[0].id } };
}

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });

function finishHand(g) {
  const bidderTeam = team(g.highBidder);
  const pts = g.handPoints.slice();
  const target = bidTarget(g);
  const made = pts[bidderTeam] >= target;
  // Game points for this hand: 1 normally. All 29 taken by the bidding team makes a made bid worth 2;
  // a missed bid with less than half the points (under 14.5 of 29) costs 2.
  let game = 1;
  if (made && g.options.allTwentyNine && g.trickPoints[bidderTeam] === 29) game = 2;
  if (!made && g.options.halfFailDouble && pts[bidderTeam] * 2 < 29) game = 2;
  game *= g.multiplier || 1; // doubled hands are worth 2x, redoubled 4x
  g.teamScore[bidderTeam] += made ? game : -game;
  g.history.push({ hand: g.handNo, dealer: g.dealer, bidder: g.highBidder, bid: g.highBid, target, game: made ? game : -game, multiplier: g.multiplier || 1, trumpSuit: g.trumpSuit, points: pts, made, marriageDeclared: g.marriageDeclared, score: g.teamScore.slice() });
  const [a, b] = g.teamScore;
  const t = g.options.target;
  if (a >= t || b <= -t) g.winnerTeam = 0;
  else if (b >= t || a <= -t) g.winnerTeam = 1;
  g.phase = g.winnerTeam === undefined ? 'handEnd' : 'gameOver';
}

function applyAction(g, playerId, action) {
  if (!action || typeof action.type !== 'string') return fail('Invalid action');
  const seat = playerId === null ? -1 : g.players.findIndex((p) => p.id === playerId);
  if (playerId !== null && seat < 0) return fail('You are not in this game');

  switch (action.type) {
    case 'bid': {
      if (g.phase !== 'bidding') return fail('Not bidding now');
      if (seat !== g.turn) return fail('Not your turn');
      if (g.passed[seat]) return fail('You have already passed and cannot re-enter the auction');
      if (action.pass === true) {
        if (!canPass(g)) return fail('Everyone else passed, so the dealer must open at 15');
        g.passed[seat] = true;
        g.bids[seat] = 'pass';
        g.log.push({ by: g.players[seat].name, card: 'passes', kind: 'bid' });
      } else {
        const amt = action.amount;
        if (!Number.isInteger(amt) || amt < minBid(g) || amt > MAX_BID) return fail(`Bid between ${minBid(g)} and ${MAX_BID}`);
        g.bids[seat] = amt;
        g.highBid = amt;
        g.highBidder = seat;
        g.log.push({ by: g.players[seat].name, card: `bids ${amt}`, kind: 'bid' });
      }
      advanceBidding(g, seat);
      return ok();
    }
    case 'chooseTrump': {
      if (g.phase !== 'chooseTrump') return fail('Not choosing trump now');
      if (seat !== g.highBidder) return fail('Only the bidder chooses trump');
      if (!SUITS.includes(action.suit)) return fail('Invalid suit');
      if (!g.players[seat].hand.some((c) => c.suit === action.suit)) return fail('Choose a suit you hold');
      g.trumpSuit = action.suit;
      for (const p of g.players) p.hand = sortHand(p.hand.concat(g.stock.splice(0, 4)));
      if (g.options.doubleChallenge) {
        // The other team (starting left of the bidder) may double the bid before the first card is played.
        g.phase = 'challenge';
        g.turn = (g.highBidder + 1) % 4;
        return ok();
      }
      g.phase = 'playing';
      g.turn = g.highBidder; // the winning bidder leads the first trick
      return ok();
    }
    case 'double':
    case 'redouble':
    case 'accept': {
      if (g.phase !== 'challenge') return fail('There is no challenge to answer');
      if (seat !== g.turn) return fail('Not your turn');
      const bidderSide = team(seat) === team(g.highBidder);
      if (action.type === 'double') {
        if (bidderSide || g.multiplier !== 1) return fail('Only the other team can double, once');
        g.multiplier = 2;
        g.turn = g.highBidder;
        g.log.push({ by: g.players[seat].name, card: 'doubles the bid (×2)', kind: 'bid' });
        return ok();
      }
      if (action.type === 'redouble') {
        if (!bidderSide || g.multiplier !== 2) return fail('Only the bidding team can redouble a double');
        g.multiplier = 4;
        g.log.push({ by: g.players[seat].name, card: 'redoubles (×4)', kind: 'bid' });
      } else {
        g.log.push({ by: g.players[seat].name, card: 'accepts', kind: 'bid' });
      }
      g.phase = 'playing';
      g.turn = g.highBidder; // the bidder leads the first trick
      return ok();
    }
    case 'reveal': {
      if (!canReveal(g, seat)) return fail('You cannot ask for the trump now');
      g.trumpRevealed = true;
      g.revealer = seat;
      return ok();
    }
    case 'marriage': {
      if (!canDeclareMarriage(g, seat)) return fail('You cannot declare a trump marriage now');
      g.marriageDeclared = true;
      if (g.options.marriageBid) {
        g.marriageTeam = team(seat);
        const byBidder = team(seat) === team(g.highBidder);
        g.log.push({ by: g.players[seat].name, card: byBidder ? 'declares the trump King–Queen marriage (bid lowered by 4)' : 'declares the trump King–Queen marriage (bid raised by 4)', kind: 'marriage' });
      } else {
        g.handPoints[team(seat)] += 4;
        g.log.push({ by: g.players[seat].name, card: 'declares the trump King–Queen marriage (+4 points)', kind: 'marriage' });
      }
      return ok();
    }
    case 'play': {
      if (g.phase !== 'playing') return fail('Not playing now');
      if (seat !== g.turn) return fail('Not your turn');
      const hand = g.players[seat].hand;
      const ci = hand.findIndex((c) => c.id === action.cardId);
      if (ci < 0) return fail('Card not in your hand');
      if (!legalCards(g, seat).includes(hand[ci])) return fail(g.revealer === seat ? 'You must play a trump card' : 'You must follow suit');
      const [card] = hand.splice(ci, 1);
      g.trick.push({ player: seat, card, trump: g.trumpRevealed && card.suit === g.trumpSuit });
      g.log.push({ by: g.players[seat].name, card: `plays ${card.rank} of ${SUIT_NAMES[card.suit]}`, kind: 'play' });
      g.revealer = -1;
      if (g.trick.length < 4) {
        g.turn = (g.turn + 1) % 4;
        return ok();
      }
      const winner = trickWinner(g.trick);
      g.tricksPlayed++;
      let pts = g.trick.reduce((s, t) => s + t.card.pts, 0);
      if (g.tricksPlayed === 8) pts += 1; // last trick bonus
      g.handPoints[team(winner)] += pts;
      g.trickPoints[team(winner)] += pts;
      g.tricksWon[team(winner)]++;
      g.lastTrick = { cards: g.trick, winner, points: pts };
      g.trick = [];
      g.turn = winner;
      if (g.tricksPlayed === 8) finishHand(g);
      return ok();
    }
    case 'continue': {
      if (g.phase !== 'handEnd') return fail('The hand is not over');
      startHand(g);
      return ok();
    }
    default:
      return fail('Unknown action');
  }
}

function awaiting(g) {
  return g.phase === 'bidding' || g.phase === 'chooseTrump' || g.phase === 'challenge' || g.phase === 'playing' ? [g.players[g.turn].id] : [];
}

function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const myTurn = awaiting(g).includes(playerId);
  const knowsTrump = g.trumpRevealed || (me >= 0 && me === g.highBidder && g.trumpSuit !== null) || g.phase === 'gameOver' || g.phase === 'handEnd';
  return {
    game: 'twentynine',
    phase: g.phase,
    handNo: g.handNo,
    dealer: g.dealer,
    turn: g.phase === 'handEnd' || g.phase === 'gameOver' ? null : g.turn,
    multiplier: g.multiplier || 1,
    canDouble: g.phase === 'challenge' && me === g.turn && (g.multiplier || 1) === 1 && team(me) !== team(g.highBidder),
    canRedouble: g.phase === 'challenge' && me === g.turn && g.multiplier === 2 && team(me) === team(g.highBidder),
    me,
    myTurn,
    options: g.options,
    players: g.players.map((p) => ({ id: p.id, name: p.name, cards: p.hand.length })),
    hand: me >= 0 ? g.players[me].hand : [],
    legal: g.phase === 'playing' && me === g.turn ? legalCards(g, me).map((c) => c.id) : [],
    canReveal: me >= 0 && canReveal(g, me),
    canDeclareMarriage: me >= 0 && canDeclareMarriage(g, me),
    marriageDeclared: g.marriageDeclared,
    mustTrump: g.revealer === me && me >= 0,
    bids: g.bids,
    highBid: g.highBid,
    highBidder: g.highBidder,
    bidTarget: bidTarget(g),
    marriageTeam: g.marriageTeam === undefined ? -1 : g.marriageTeam,
    minBid: g.phase === 'bidding' ? minBid(g) : null,
    maxBid: MAX_BID,
    canPass: g.phase === 'bidding' && me === g.turn ? canPass(g) : false,
    passed: (g.passed || [false, false, false, false]).slice(),
    activeBidders: (g.activeBidders || []).slice(),
    trumpSet: g.trumpSuit !== null,
    trumpSuit: knowsTrump ? g.trumpSuit : null,
    trumpRevealed: g.trumpRevealed,
    trick: g.trick,
    trickLeader: g.trick.length && g.phase === 'playing' ? trickWinner(g.trick) : null, // who is winning the trick so far (public info only)
    trickNo: g.tricksPlayed,
    autoPlay: me >= 0 && me === g.turn && forcedPlay(g) !== null,
    lastTrick: g.lastTrick,
    tricksPlayed: g.tricksPlayed,
    handPoints: g.handPoints,
    teamScore: g.teamScore,
    history: g.history,
    log: g.log.slice(-60),
    winnerTeam: g.winnerTeam === undefined ? null : g.winnerTeam,
  };
}

// ---------------------------------------------------------------- bot

function handStrength(hand) {
  let v = hand.reduce((s, c) => s + c.pts, 0);
  const bySuit = {};
  for (const c of hand) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  for (const cs of Object.values(bySuit)) {
    if (cs.length >= 3) v += 1;
    if (cs.some((c) => c.rank === 'J') && cs.some((c) => c.rank === '9')) v += 2;
    if (cs.some((c) => c.rank === 'J') && cs.length >= 2) v += 1;
  }
  return v;
}

function bestTrump(hand) {
  const score = (suit) => {
    const cs = hand.filter((c) => c.suit === suit);
    return cs.length * 3 + cs.reduce((s, c) => s + c.pts, 0) + (cs.some((c) => c.rank === 'J') ? 3 : 0);
  };
  const owned = SUITS.filter((s) => hand.some((c) => c.suit === s));
  return owned.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function botAction(g, playerId) {
  const seat = g.players.findIndex((p) => p.id === playerId);
  const hand = g.players[seat].hand;
  if (g.phase === 'bidding') {
    const want = 14 + handStrength(hand);
    const min = minBid(g);
    if (want >= min) return { type: 'bid', amount: Math.min(want, Math.max(min, Math.min(MAX_BID, 20))) };
    if (!canPass(g)) return { type: 'bid', amount: MIN_BID };
    return { type: 'bid', pass: true };
  }
  if (g.phase === 'chooseTrump') return { type: 'chooseTrump', suit: bestTrump(hand) };
  if (g.phase === 'challenge') {
    const strength = handStrength(hand);
    if (g.multiplier === 1) return team(seat) !== team(g.highBidder) && strength >= 20 ? { type: 'double' } : { type: 'accept' };
    return strength >= 22 ? { type: 'redouble' } : { type: 'accept' };
  }
  if (g.phase === 'handEnd') return { type: 'continue' };
  if (g.phase === 'playing' && canDeclareMarriage(g, seat)) return { type: 'marriage' };

  // playing
  const iKnowTrump = g.trumpRevealed || seat === g.highBidder;
  const trump = iKnowTrump ? g.trumpSuit : null;
  const legal = legalCards(g, seat);
  const partner = (seat + 2) % 4;
  const lowest = (cs) => cs.reduce((a, b) => (b.pts < a.pts || (b.pts === a.pts && b.ord < a.ord) ? b : a));
  const value = (c) => c.pts * 10 + c.ord;

  if (!g.trick.length) {
    const nonTrump = legal.filter((c) => c.suit !== trump);
    const pool = nonTrump.length ? nonTrump : legal;
    return { type: 'play', cardId: pool.reduce((a, b) => (value(b) > value(a) ? b : a)).id };
  }
  const winning = trickWinner(g.trick);
  const partnerWinning = winning === partner;
  if (canReveal(g, seat)) {
    const holdsTrump = seat === g.highBidder && hand.some((c) => c.suit === g.trumpSuit);
    const trickPts = g.trick.reduce((s, t) => s + t.card.pts, 0);
    if (!partnerWinning && (holdsTrump || seat !== g.highBidder) && (trickPts > 0 || g.tricksPlayed >= 5 || seat !== g.highBidder)) return { type: 'reveal' };
  }
  const beats = (c) => {
    const probe = g.trick.concat({ player: seat, card: c, trump: g.trumpRevealed && c.suit === g.trumpSuit });
    return trickWinner(probe) === seat;
  };
  const winners = legal.filter(beats);
  let pick;
  if (partnerWinning) pick = legal.reduce((a, b) => (b.pts > a.pts || (b.pts === a.pts && b.ord > a.ord) ? b : a)); // feed points to partner
  else if (winners.length) pick = winners.reduce((a, b) => (b.ord < a.ord ? b : a));
  else pick = lowest(legal);
  return { type: 'play', cardId: pick.id };
}

module.exports = { forcedPlay, SUITS, RANKS, buildDeck, createGame, applyAction, awaiting, viewFor, botAction, trickWinner, legalCards, canReveal, canDeclareMarriage, finishHand, bidTarget, MIN_BID, MAX_BID };
