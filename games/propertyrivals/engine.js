'use strict';
/**
 * Property Rivals: the rules only (no sockets, no timers). A property-trading game for 2-6 players on the board in
 * board.js. Everything is public information except the order of the card decks, so a view carries the whole table.
 *
 * Turn: roll two dice and move; resolve the square (buy it or auction it, pay rent or tax, draw a card, go to the
 * lockup); then "manage" (build, sell, mortgage, trade) and end the turn. Doubles roll again; three doubles in a row
 * go to the lockup. In the lockup: pay a fine, use a card, or roll for doubles (a third failed try pays the fine).
 * Whoever owes more than they hold must raise cash (mortgage, sell buildings) or go bankrupt to their creditor.
 * The last player standing wins; the "short game" option ends after a set number of rounds on net worth.
 */
const B = require('./board');

const TOKENS = ['🚀', '🚗', '🐘', '⛵', '🎩', '🦊'];
const MAX_HOUSES = 5; // 5 = a hotel

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const active = (g) => g.players.map((p, i) => (p.bankrupt ? -1 : i)).filter((i) => i >= 0);
const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind = 'info') => { g.log.push({ by: g.players[by].name, card: text, kind }); if (g.log.length > 80) g.log.shift(); };
const sq = (i) => B.SQUARES[i];

function shuffled(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > 6) throw new Error('Property Rivals is for 2 to 6 players');
  const o = options || {};
  const startCash = [1000, 1500, 2000].includes(Number(o.startCash)) ? Number(o.startCash) : 1500;
  return {
    game: 'propertyrivals',
    n,
    rng,
    options: { startCash, auction: o.auction !== false, jackpot: o.jackpot === true, rounds: ['30', '60'].includes(String(o.rounds)) ? String(o.rounds) : 'off' },
    players: players.map((p, i) => ({ id: p.id, name: p.name, token: TOKENS[i], cash: startCash, pos: 0, inLockup: false, lockTries: 0, keeps: [], bankrupt: false, place: null })),
    land: B.SQUARES.map((s) => (B.buyable(s) ? { owner: -1, houses: 0, mortgaged: false } : null)),
    turn: 0,
    phase: 'roll', // roll | buy | manage | debt | auction | trade | gameOver
    dice: [0, 0],
    doubles: 0, // doubles rolled in a row this turn
    again: false, // the turn continues with another roll (the last roll was a double)
    decks: { surprise: shuffled(B.SURPRISE.length, rng), fund: shuffled(B.FUND.length, rng) },
    jackpot: 0,
    debt: null, // { from, to (player index | -1 bank | -2 every other player), amount, per }
    trade: null,
    auction: null,
    lastCard: null,
    round: 1,
    winner: -1,
    order: [], // bankruptcies in order
    event: null,
    log: [],
    seq: 0,
    version: 0,
  };
}

// ---- values

const owned = (g, i) => g.land.map((l, k) => (l && l.owner === i ? k : -1)).filter((k) => k >= 0);
const ownsGroup = (g, i, group) => B.groupSquares(group).every((k) => g.land[k].owner === i);
const groupHouses = (g, group) => B.groupSquares(group).map((k) => g.land[k].houses);
const hasBuildings = (g, group) => groupHouses(g, group).some((h) => h > 0);

function rentOf(g, k, dice, mult = 1) { // mult applies to cities and ports; a utility is dice x 4 or x 10
  const s = sq(k); const l = g.land[k];
  if (!l || l.owner < 0 || l.mortgaged) return 0;
  if (s.type === 'city') {
    const base = l.houses > 0 ? s.rents[l.houses] : s.rents[0] * (ownsGroup(g, l.owner, s.group) ? 2 : 1);
    return base * mult;
  }
  if (s.type === 'port') { const c = B.portSquares.filter((p) => g.land[p].owner === l.owner).length; return 25 * 2 ** (c - 1) * mult; }
  const c = B.utilitySquares.filter((p) => g.land[p].owner === l.owner).length;
  return dice * (c === 2 ? 10 : 4);
}

/** What a player would raise by selling every building and mortgaging every property (plus cash). */
function liquidation(g, i) {
  let v = g.players[i].cash;
  for (const k of owned(g, i)) {
    const l = g.land[k]; const s = sq(k);
    if (s.type === 'city') v += l.houses * (B.GROUPS[s.group].house / 2);
    if (!l.mortgaged) v += B.mortgageValue(k);
  }
  return v;
}
function netWorth(g, i) {
  let v = g.players[i].cash;
  for (const k of owned(g, i)) {
    const l = g.land[k]; const s = sq(k);
    v += l.mortgaged ? B.mortgageValue(k) : s.price;
    if (s.type === 'city') v += l.houses * B.GROUPS[s.group].house;
  }
  return v;
}

// ---- money, debt, bankruptcy

/** Move coins. `to` is a player index or -1 (the bank). */
function transfer(g, from, to, amount) {
  g.players[from].cash -= amount;
  if (to >= 0) g.players[to].cash += amount;
  else if (g.options.jackpot && to === -3) g.jackpot += amount; // taxes feed the Rest Stop jackpot when it is on
}

/** `from` owes `amount` to `to` (a player, -1 bank, -3 jackpot-or-bank, -2 every other player). Pays now or enters debt. */
function charge(g, from, to, amount, per = 0) {
  if (amount <= 0) return;
  if (g.players[from].cash >= amount) {
    if (to === -2) { for (const k of active(g)) if (k !== from) transfer(g, from, k, per); } else transfer(g, from, to, amount);
    return;
  }
  g.debt = { from, to, amount, per };
  g.phase = 'debt';
  emit(g, { type: 'debt', by: from, to, amount });
  say(g, from, `owes ${amount} and must raise cash`, 'debt');
}

function settleDebt(g) {
  const d = g.debt;
  if (!d || g.players[d.from].cash < d.amount) return { ok: false, error: 'You do not have enough cash yet' };
  if (d.to === -2) { for (const k of active(g)) if (k !== d.from) transfer(g, d.from, k, d.per); } else transfer(g, d.from, d.to, d.amount);
  say(g, d.from, `paid ${d.amount}`, 'pay');
  g.debt = null;
  g.phase = 'manage';
  return { ok: true };
}

function bankrupt(g, i) {
  const p = g.players[i];
  const to = g.debt && g.debt.from === i ? g.debt.to : -1;
  const heir = to >= 0 && !g.players[to].bankrupt ? to : -1;
  if (heir >= 0) g.players[heir].cash += p.cash;
  p.cash = 0;
  for (const k of owned(g, i)) {
    const l = g.land[k];
    l.houses = 0;
    if (heir >= 0) l.owner = heir; else { l.owner = -1; l.mortgaged = false; }
  }
  for (const kc of p.keeps) { if (heir >= 0) g.players[heir].keeps.push(kc); else g.decks[kc.deck].push(kc.idx); }
  p.keeps = [];
  p.bankrupt = true;
  p.place = active(g).length + 1;
  g.order.push(i);
  g.debt = null;
  emit(g, { type: 'bankrupt', by: i, to: heir });
  say(g, i, heir >= 0 ? `went bankrupt to ${g.players[heir].name}` : 'went bankrupt to the bank', 'bankrupt');
  if (active(g).length <= 1) return finish(g);
  g.phase = 'manage';
  advance(g); // their turn is over
}

// ---- turn flow

function finish(g) {
  g.phase = 'gameOver';
  const alive = active(g);
  g.winner = alive.length === 1 ? alive[0] : alive.sort((a, b) => netWorth(g, b) - netWorth(g, a) || a - b)[0];
  const ranked = alive.sort((a, b) => netWorth(g, b) - netWorth(g, a) || a - b);
  ranked.forEach((k, r) => { g.players[k].place = r + 1; });
  emit(g, { type: 'over', winner: g.winner });
  say(g, g.winner, 'won the game', 'win');
}

/** Pass the turn to the next player still in the game (counting rounds for the short game). */
function advance(g) {
  g.doubles = 0; g.again = false; g.trade = null;
  const prev = g.turn;
  let next = prev;
  do { next = (next + 1) % g.n; } while (g.players[next].bankrupt);
  if (next <= prev) {
    g.round++;
    if (g.options.rounds !== 'off' && g.round > Number(g.options.rounds)) return finish(g);
  }
  g.turn = next;
  g.phase = 'roll';
  emit(g, { type: 'turn', by: next });
}

function pass(g, i, steps) {
  const p = g.players[i];
  const from = p.pos;
  p.pos = (from + steps + B.SIZE) % B.SIZE;
  if (steps > 0 && p.pos < from) { p.cash += B.START_SALARY; say(g, i, `passed Start and collected ${B.START_SALARY}`, 'salary'); }
}

function sendToLockup(g, i) {
  const p = g.players[i];
  p.pos = B.LOCKUP; p.inLockup = true; p.lockTries = 0;
  g.again = false; g.doubles = 0;
  emit(g, { type: 'lockup', by: i });
  say(g, i, 'went to the lockup', 'lockup');
}

function drawCard(g, i, deck) {
  const cards = deck === 'fund' ? B.FUND : B.SURPRISE;
  const order = g.decks[deck];
  const idx = order.shift();
  const c = cards[idx];
  if (c.keep) g.players[i].keeps.push({ deck, idx }); else order.push(idx); // a kept card leaves the deck until it is used
  g.lastCard = { seq: g.seq + 1, deck, text: c.text, by: i };
  emit(g, { type: 'card', by: i, deck, text: c.text });
  say(g, i, `drew: ${c.text}`, 'card');
  const p = g.players[i];
  if (c.gain) p.cash += c.gain;
  else if (c.pay) charge(g, i, -3, c.pay);
  else if (c.goto !== undefined) { const steps = (c.goto - p.pos + B.SIZE) % B.SIZE; pass(g, i, steps); land(g, i, { fromCard: true }); }
  else if (c.back) { pass(g, i, -c.back); land(g, i, { fromCard: true }); }
  else if (c.lockup) sendToLockup(g, i);
  else if (c.nearest) {
    const ports = B.portSquares; const target = ports.find((k) => k > p.pos) ?? ports[0];
    pass(g, i, (target - p.pos + B.SIZE) % B.SIZE);
    land(g, i, { fromCard: true, doubleRent: true });
  } else if (c.repairs) {
    let houses = 0; let hotels = 0;
    for (const k of owned(g, i)) { const h = g.land[k].houses; if (h === MAX_HOUSES) hotels++; else houses += h; }
    charge(g, i, -3, houses * c.repairs[0] + hotels * c.repairs[1]);
  } else if (c.fromEach) {
    for (const k of active(g)) if (k !== i) { const take = Math.min(c.fromEach, g.players[k].cash); transfer(g, k, i, take); }
  } else if (c.toEach) {
    const others = active(g).filter((k) => k !== i).length;
    charge(g, i, -2, c.toEach * others, c.toEach);
  }
}

/** Resolve the square a player is standing on. Leaves the phase on 'buy', 'debt', 'auction' or 'manage'. */
function land(g, i, { fromCard = false, doubleRent = false } = {}) {
  const p = g.players[i]; const s = sq(p.pos); const l = g.land[p.pos];
  g.phase = 'manage';
  if (l) {
    if (l.owner < 0) { g.phase = 'buy'; emit(g, { type: 'landed', by: i, square: p.pos }); return; }
    if (l.owner !== i && !l.mortgaged) {
      const rent = rentOf(g, p.pos, g.dice[0] + g.dice[1]) * (doubleRent ? 2 : 1);
      emit(g, { type: 'rent', by: i, to: l.owner, square: p.pos, amount: rent });
      say(g, i, `paid ${rent} rent to ${g.players[l.owner].name} for ${s.name}`, 'rent');
      charge(g, i, l.owner, rent);
    }
    return;
  }
  if (s.type === 'tax') { say(g, i, `paid ${s.amount} ${s.name.toLowerCase()}`, 'tax'); charge(g, i, -3, s.amount); }
  else if (s.type === 'surprise') drawCard(g, i, 'surprise');
  else if (s.type === 'fund') drawCard(g, i, 'fund');
  else if (s.type === 'golockup') sendToLockup(g, i);
  else if (s.type === 'rest' && g.options.jackpot && g.jackpot > 0) { p.cash += g.jackpot; say(g, i, `collected the ${g.jackpot} jackpot at the Rest Stop`, 'jackpot'); g.jackpot = 0; }
}

const rollDice = (g) => [1 + Math.floor(g.rng() * 6), 1 + Math.floor(g.rng() * 6)];

function doRoll(g, i) {
  const p = g.players[i];
  const dice = rollDice(g);
  g.dice = dice;
  const double = dice[0] === dice[1];
  emit(g, { type: 'roll', by: i, dice, double });
  if (p.inLockup) {
    if (double) { p.inLockup = false; p.lockTries = 0; say(g, i, `rolled doubles (${dice[0]}) and left the lockup`, 'lockup'); g.again = false; pass(g, i, dice[0] + dice[1]); land(g, i); return; }
    p.lockTries++;
    if (p.lockTries >= 3) { // third failed try: pay the fine and move
      p.inLockup = false; p.lockTries = 0;
      say(g, i, `failed three times, paid ${B.LOCKUP_FINE} and left the lockup`, 'lockup');
      g.again = false;
      if (p.cash >= B.LOCKUP_FINE) { transfer(g, i, -3, B.LOCKUP_FINE); pass(g, i, dice[0] + dice[1]); land(g, i); } else { charge(g, i, -3, B.LOCKUP_FINE); g.afterDebtMove = dice[0] + dice[1]; }
      return;
    }
    say(g, i, `rolled ${dice[0]} + ${dice[1]}: no doubles, still in the lockup`, 'lockup');
    g.again = false; g.phase = 'manage';
    return;
  }
  if (double) { g.doubles++; if (g.doubles >= 3) { say(g, i, 'rolled three doubles in a row', 'lockup'); sendToLockup(g, i); g.phase = 'manage'; return; } g.again = true; } else { g.again = false; g.doubles = 0; }
  pass(g, i, dice[0] + dice[1]);
  land(g, i);
}

module.exports = { TOKENS, MAX_HOUSES, createGame, indexOf, active, emit, say, sq, owned, ownsGroup, groupHouses, hasBuildings, rentOf, liquidation, netWorth, transfer, charge, settleDebt, bankrupt, finish, advance, pass, sendToLockup, land, doRoll };
