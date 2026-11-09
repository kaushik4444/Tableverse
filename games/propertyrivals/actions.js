'use strict';
/** Property Rivals: player actions, building and mortgages, trades, auctions, bots and the per-player view. */
const B = require('./board');
const E = require('./engine');
const { sq, say, emit } = E;

const idxOf = E.indexOf;
const costOf = (k) => B.GROUPS[sq(k).group].house;
const isInt = (x) => Number.isInteger(x);
const okSquare = (g, k) => isInt(k) && k >= 0 && k < B.SIZE && g.land[k];

// ---- building and mortgages (the current player, before or after rolling, or while raising cash)

function canBuild(g, i, k) {
  const l = g.land[k]; const s = sq(k);
  if (!l || l.owner !== i || s.type !== 'city') return 'You can only build on your own cities';
  if (!E.ownsGroup(g, i, s.group)) return `You need every ${B.GROUPS[s.group].name} city first`;
  if (B.groupSquares(s.group).some((x) => g.land[x].mortgaged)) return 'Unmortgage the whole colour group first';
  if (l.houses >= E.MAX_HOUSES) return 'That city already has a hotel';
  if (l.houses > Math.min(...E.groupHouses(g, s.group))) return 'Build evenly: add to the cities with fewer houses first';
  if (g.players[i].cash < costOf(k)) return `A ${l.houses === 4 ? 'hotel' : 'house'} costs ${costOf(k)}`;
  return null;
}
function canSell(g, i, k) {
  const l = g.land[k]; const s = sq(k);
  if (!l || l.owner !== i || s.type !== 'city' || l.houses === 0) return 'There is nothing to sell there';
  if (l.houses < Math.max(...E.groupHouses(g, s.group))) return 'Sell evenly: sell from the cities with more houses first';
  return null;
}
function canMortgage(g, i, k) {
  const l = g.land[k]; const s = sq(k);
  if (!l || l.owner !== i) return 'That is not yours';
  if (l.mortgaged) return 'Already mortgaged';
  if (s.type === 'city' && E.hasBuildings(g, s.group)) return 'Sell the buildings in this colour group first';
  return null;
}
function canUnmortgage(g, i, k) {
  const l = g.land[k];
  if (!l || l.owner !== i || !l.mortgaged) return 'That is not mortgaged';
  if (g.players[i].cash < B.unmortgageCost(k)) return `Unmortgaging costs ${B.unmortgageCost(k)}`;
  return null;
}

// ---- trades

function tradeProblem(g, t) {
  const a = g.players[t.from]; const b = g.players[t.to];
  if (!b || b.bankrupt || t.from === t.to) return 'Pick another player';
  if (!t.give.length && !t.get.length && !t.giveCash && !t.getCash) return 'Offer something';
  if (a.cash < t.giveCash || b.cash < t.getCash) return 'Not enough cash for that offer';
  for (const [list, owner] of [[t.give, t.from], [t.get, t.to]]) {
    for (const k of list) {
      const l = g.land[k];
      if (!l || l.owner !== owner) return 'A property in the offer changed hands';
      const s = sq(k);
      if (s.type === 'city' && E.hasBuildings(g, s.group)) return `Sell the buildings in the ${B.GROUPS[s.group].name} group before trading it`;
    }
  }
  return null;
}
function cleanList(g, list) { return isInt(list && list[0]) || (Array.isArray(list) && list.length === 0) ? [...new Set(list.filter((k) => okSquare(g, k)))] : null; }

// ---- auctions

function startAuction(g, k) {
  const alive = E.active(g);
  let cur = g.turn;
  do { cur = (cur + 1) % g.n; } while (g.players[cur].bankrupt);
  g.auction = { sq: k, high: 0, highBy: -1, out: [], cur };
  g.phase = 'auction';
  emit(g, { type: 'auction', square: k });
  say(g, g.turn, `put ${sq(k).name} up for auction`, 'auction');
  return alive;
}
function auctionNext(g) {
  const a = g.auction;
  const remaining = E.active(g).filter((k) => !a.out.includes(k));
  if (remaining.length === 0 || (remaining.length === 1 && a.highBy === remaining[0])) {
    if (a.highBy >= 0) {
      E.transfer(g, a.highBy, -1, a.high);
      g.land[a.sq].owner = a.highBy;
      emit(g, { type: 'sold', by: a.highBy, square: a.sq, amount: a.high });
      say(g, a.highBy, `won ${sq(a.sq).name} at auction for ${a.high}`, 'auction');
    } else say(g, g.turn, `${sq(a.sq).name} found no buyer`, 'auction');
    g.auction = null; g.phase = 'manage';
    return;
  }
  let c = a.cur;
  do { c = (c + 1) % g.n; } while (g.players[c].bankrupt || a.out.includes(c) || c === a.highBy);
  a.cur = c;
}

// ---- the action dispatcher

function applyAction(g, playerId, action) {
  const who = idxOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  const p = g.players[who];
  const mine = who === g.turn;
  g.version++;
  const bad = (error) => ({ ok: false, error });
  const manageable = () => mine && ['roll', 'manage', 'debt'].includes(g.phase);

  switch (action.type) {
    case 'roll': {
      if (!mine || g.phase !== 'roll') return bad('Not your turn to roll');
      E.doRoll(g, who);
      return { ok: true };
    }
    case 'payLockup': {
      if (!mine || g.phase !== 'roll' || !p.inLockup) return bad('You are not in the lockup');
      if (p.cash < B.LOCKUP_FINE) return bad(`The fine is ${B.LOCKUP_FINE}`);
      E.transfer(g, who, -3, B.LOCKUP_FINE); p.inLockup = false; p.lockTries = 0;
      say(g, who, `paid ${B.LOCKUP_FINE} to leave the lockup`, 'lockup');
      emit(g, { type: 'free', by: who });
      return { ok: true };
    }
    case 'useCard': {
      if (!mine || g.phase !== 'roll' || !p.inLockup || !p.keeps.length) return bad('You have no card to use');
      const kc = p.keeps.pop(); g.decks[kc.deck].push(kc.idx);
      p.inLockup = false; p.lockTries = 0;
      say(g, who, 'used a get-out-of-lockup card', 'lockup');
      emit(g, { type: 'free', by: who });
      return { ok: true };
    }
    case 'buy': {
      if (!mine || g.phase !== 'buy') return bad('Nothing to buy');
      const s = sq(p.pos);
      if (p.cash < s.price) return bad(`${s.name} costs ${s.price}`);
      E.transfer(g, who, -1, s.price); g.land[p.pos].owner = who; g.phase = 'manage';
      emit(g, { type: 'bought', by: who, square: p.pos, amount: s.price });
      say(g, who, `bought ${s.name} for ${s.price}`, 'buy');
      return { ok: true };
    }
    case 'decline': {
      if (!mine || g.phase !== 'buy') return bad('Nothing to decline');
      say(g, who, `did not buy ${sq(p.pos).name}`, 'info');
      if (g.options.auction && E.active(g).length > 1) startAuction(g, p.pos); else g.phase = 'manage';
      return { ok: true };
    }
    case 'endTurn': {
      if (!mine || g.phase !== 'manage') return bad('You cannot end your turn yet');
      if (g.again) { g.phase = 'roll'; emit(g, { type: 'again', by: who }); } else E.advance(g);
      return { ok: true };
    }
    case 'build': case 'sell': case 'mortgage': case 'unmortgage': {
      if (!manageable()) return bad('Not now');
      const k = action.square;
      if (!okSquare(g, k)) return bad('Pick a property');
      const why = { build: canBuild, sell: canSell, mortgage: canMortgage, unmortgage: canUnmortgage }[action.type](g, who, k);
      if (why) return bad(why);
      const l = g.land[k]; const s = sq(k);
      if (action.type === 'build') { E.transfer(g, who, -1, costOf(k)); l.houses++; say(g, who, `built ${l.houses === 5 ? 'a hotel' : 'a house'} in ${s.name}`, 'build'); }
      else if (action.type === 'sell') { p.cash += costOf(k) / 2; l.houses--; say(g, who, `sold ${l.houses === 4 ? 'a hotel' : 'a house'} in ${s.name}`, 'build'); }
      else if (action.type === 'mortgage') { p.cash += B.mortgageValue(k); l.mortgaged = true; say(g, who, `mortgaged ${s.name} for ${B.mortgageValue(k)}`, 'mortgage'); }
      else { E.transfer(g, who, -1, B.unmortgageCost(k)); l.mortgaged = false; say(g, who, `paid off the mortgage on ${s.name}`, 'mortgage'); }
      emit(g, { type: action.type, by: who, square: k });
      return { ok: true };
    }
    case 'pay': {
      if (!mine || g.phase !== 'debt' || !g.debt) return bad('You owe nothing');
      const r = E.settleDebt(g);
      if (r.ok && g.afterDebtMove) { const steps = g.afterDebtMove; g.afterDebtMove = null; E.pass(g, who, steps); E.land(g, who); }
      return r;
    }
    case 'bankrupt': {
      if (!mine || g.phase !== 'debt') return bad('You can only give up when you owe more than you can pay');
      E.bankrupt(g, who);
      return { ok: true };
    }
    case 'propose': {
      if (!mine || !['roll', 'manage'].includes(g.phase)) return bad('You can propose a trade on your turn');
      const to = idxOf(g, action.target);
      const give = cleanList(g, action.give || []); const get = cleanList(g, action.get || []);
      if (to < 0 || give === null || get === null) return bad('Invalid offer');
      const t = { from: who, to, give, get, giveCash: Math.max(0, Math.floor(Number(action.giveCash) || 0)), getCash: Math.max(0, Math.floor(Number(action.getCash) || 0)), prev: g.phase };
      const why = tradeProblem(g, t);
      if (why) return bad(why);
      g.trade = t; g.phase = 'trade';
      emit(g, { type: 'offer', by: who, to });
      say(g, who, `offered ${g.players[to].name} a trade`, 'trade');
      return { ok: true };
    }
    case 'acceptTrade': {
      const t = g.trade;
      if (g.phase !== 'trade' || !t || who !== t.to) return bad('No offer for you');
      const why = tradeProblem(g, t);
      if (why) { g.phase = t.prev; g.trade = null; return bad(why); }
      for (const k of t.give) g.land[k].owner = t.to;
      for (const k of t.get) g.land[k].owner = t.from;
      g.players[t.from].cash += t.getCash - t.giveCash; g.players[t.to].cash += t.giveCash - t.getCash;
      g.phase = t.prev; g.trade = null;
      emit(g, { type: 'traded', by: t.from, to: t.to });
      say(g, who, 'accepted the trade', 'trade');
      return { ok: true };
    }
    case 'declineTrade': case 'cancelTrade': {
      const t = g.trade;
      if (g.phase !== 'trade' || !t) return bad('No offer');
      if (action.type === 'declineTrade' ? who !== t.to : who !== t.from) return bad('Not yours to answer');
      g.phase = t.prev; g.trade = null;
      emit(g, { type: 'declined', by: who });
      say(g, who, action.type === 'declineTrade' ? 'declined the trade' : 'withdrew the offer', 'trade');
      return { ok: true };
    }
    case 'bid': case 'passBid': {
      const a = g.auction;
      if (g.phase !== 'auction' || !a || who !== a.cur) return bad('Not your turn to bid');
      if (action.type === 'bid') {
        const amt = action.amount;
        if (!isInt(amt) || amt <= a.high || amt > p.cash) return bad(amt > p.cash ? 'You do not have that much' : `Bid more than ${a.high}`);
        a.high = amt; a.highBy = who;
        say(g, who, `bid ${amt}`, 'auction');
      } else {
        if (a.highBy === who) return bad('You are the highest bidder');
        a.out.push(who);
        say(g, who, 'passed', 'auction');
      }
      auctionNext(g);
      return { ok: true };
    }
    default: return bad('Unknown action');
  }
}

const awaiting = (g) => {
  if (g.phase === 'gameOver') return [];
  if (g.phase === 'auction' && g.auction) return [g.players[g.auction.cur].id];
  if (g.phase === 'trade' && g.trade) return [g.players[g.trade.to].id];
  return [g.players[g.turn].id];
};

// ---- bots: simple, sensible and only ever use public information

const worthBuying = (g, i, k) => {
  const s = sq(k); const cash = g.players[i].cash;
  if (cash < s.price) return false;
  const completes = s.type === 'city' && B.groupSquares(s.group).filter((x) => g.land[x].owner === i).length === B.groupSquares(s.group).length - 1;
  const rivalsBlock = s.type === 'city' && B.groupSquares(s.group).some((x) => g.land[x].owner >= 0 && g.land[x].owner !== i);
  return completes || cash - s.price >= (rivalsBlock ? 300 : 150);
};

function botAction(g, playerId) {
  const who = idxOf(g, playerId);
  if (who < 0 || g.phase === 'gameOver') return null;
  const p = g.players[who];
  if (g.phase === 'auction' && g.auction && g.auction.cur === who) {
    const a = g.auction; const s = sq(a.sq);
    const ceiling = Math.min(p.cash - 100, Math.floor(s.price * (worthBuying(g, who, a.sq) ? 1.1 : 0.7)));
    const next = a.high + Math.max(10, Math.round(s.price / 20 / 10) * 10);
    return next <= ceiling ? { type: 'bid', amount: next } : { type: 'passBid' };
  }
  if (g.phase === 'trade' && g.trade && g.trade.to === who) {
    const t = g.trade; const val = (list) => list.reduce((x, k) => x + sq(k).price, 0);
    return { type: val(t.give) + t.giveCash >= (val(t.get) + t.getCash) * 1.2 ? 'acceptTrade' : 'declineTrade' };
  }
  if (who !== g.turn) return null;
  if (g.phase === 'roll') {
    if (p.inLockup) {
      if (p.keeps.length) return { type: 'useCard' };
      if (p.cash >= 400 && g.land.some((l, k) => l && l.owner < 0 && B.buyable(sq(k)))) return { type: 'payLockup' };
    }
    return { type: 'roll' };
  }
  if (g.phase === 'buy') return { type: worthBuying(g, who, p.pos) ? 'buy' : 'decline' };
  if (g.phase === 'debt') {
    if (p.cash >= g.debt.amount) return { type: 'pay' };
    for (const k of E.owned(g, who)) if (!canSell(g, who, k)) return { type: 'sell', square: k };
    const order = E.owned(g, who).sort((a, b) => sq(a).price - sq(b).price);
    for (const k of order) if (!canMortgage(g, who, k)) return { type: 'mortgage', square: k };
    return { type: 'bankrupt' };
  }
  if (g.phase === 'manage') {
    for (const k of E.owned(g, who)) if (!canUnmortgage(g, who, k) && p.cash > B.unmortgageCost(k) + 400) return { type: 'unmortgage', square: k };
    const builds = E.owned(g, who).filter((k) => !canBuild(g, who, k) && p.cash - costOf(k) >= 250);
    if (builds.length) return { type: 'build', square: builds.sort((a, b) => g.land[a].houses - g.land[b].houses)[0] };
    return { type: 'endTurn' };
  }
  return null;
}

// ---- the view: the whole table is public; `can` lists what the viewer may do right now

function viewFor(g, playerId) {
  const me = idxOf(g, playerId);
  const turn = g.turn;
  const myTurn = g.phase !== 'gameOver' && me >= 0 && awaiting(g)[0] === playerId;
  const p = me >= 0 ? g.players[me] : null;
  const onTurn = me >= 0 && me === turn && ['roll', 'manage', 'debt'].includes(g.phase);
  const list = (fn) => (onTurn ? E.owned(g, me).filter((k) => !fn(g, me, k)) : []);
  const sqr = g.phase === 'buy' && me === turn ? sq(g.players[me].pos) : null;
  return {
    game: 'propertyrivals',
    squares: B.SQUARES, groups: B.GROUPS, // static board data, so the client needs no copy of it
    // Figures the client shows on a card, computed here so the rules live in one place: mortgage value, unmortgage cost,
    // the cost of each house or hotel, and the rent a city charges right now (0 while mortgaged).
    info: B.SQUARES.map((s, k) => ({
      mortgage: B.mortgageValue(k), unmortgage: B.unmortgageCost(k),
      house: s.type === 'city' ? B.GROUPS[s.group].house : null,
      rentNow: s.type === 'city' ? E.rentOf(g, k, 1) : null,
    })),
    me, n: g.n, options: { ...g.options },
    phase: g.phase, turn, round: g.round, jackpot: g.jackpot,
    dice: g.dice, doubles: g.doubles, again: g.again,
    players: g.players.map((q, i) => ({ id: q.id, name: q.name, token: q.token, cash: q.cash, pos: q.pos, inLockup: q.inLockup, keeps: q.keeps.length, bankrupt: q.bankrupt, netWorth: E.netWorth(g, i), place: q.place })),
    land: g.land.map((l) => (l ? { ...l } : null)),
    debt: g.debt ? { ...g.debt } : null,
    trade: g.trade ? { ...g.trade, give: g.trade.give.slice(), get: g.trade.get.slice() } : null,
    auction: g.auction ? { ...g.auction, out: g.auction.out.slice() } : null,
    lastCard: g.lastCard, event: g.event, winner: g.winner,
    myTurn,
    can: {
      roll: me === turn && g.phase === 'roll',
      payLockup: me === turn && g.phase === 'roll' && !!p && p.inLockup && p.cash >= B.LOCKUP_FINE,
      useCard: me === turn && g.phase === 'roll' && !!p && p.inLockup && p.keeps.length > 0,
      buy: !!sqr && p.cash >= sqr.price,
      decline: !!sqr,
      endTurn: me === turn && g.phase === 'manage',
      pay: me === turn && g.phase === 'debt' && !!g.debt && p.cash >= g.debt.amount,
      bankrupt: me === turn && g.phase === 'debt',
      propose: me === turn && ['roll', 'manage'].includes(g.phase),
      build: list(canBuild), sell: list(canSell), mortgage: list(canMortgage), unmortgage: list(canUnmortgage),
    },
    log: g.log.slice(-40),
  };
}

const forcedPlay = () => null;

module.exports = { applyAction, awaiting, botAction, viewFor, forcedPlay, canBuild, canSell, canMortgage, canUnmortgage, tradeProblem };
