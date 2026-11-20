'use strict';
const pacing = require('../pacing');
/**
 * Take 5: the rules only (no sockets, no timers; the walk-time holds go through games/pacing.js).
 *
 * 2-8 players, a deck of the numbers 1 to 104. Every number carries penalty points (see penaltyOf). Each round every
 * player gets 10 cards and four cards start four rows. In each of the 10 turns everybody secretly picks one card; when
 * all have picked, the cards are revealed and played from the lowest number up:
 *   - a card goes onto the row whose last card is the highest number still below it (the closest from beneath);
 *   - a card that fits no row (lower than every row's last card) forces its player to take a row of their choice, and
 *     their card starts that row again;
 *   - a row holds five cards: the sixth card takes the five and starts the row again.
 * Cards you take are your penalty points. After the 10 turns the round is scored and a new one is dealt, until someone
 * reaches the target. The lowest total wins (ties share the win).
 *
 * This is our own implementation of a well-known type of game. The rules of a game are not protected, but the names,
 * artwork and wording of published games are, so nothing here reuses them (see docs/GAME_NAMES.md).
 */
const DECK = 104;
const HAND = 10;
const START_ROWS = 4;
const ROW_LIMIT = 5; // a row holds five cards: the sixth takes it
const TARGETS = { short: 35, standard: 66, long: 100 };
const TARGETS_SIMPLE = { short: 20, standard: 35, long: 50 };
const COUNTDOWN = 66; // Starting score: everyone starts with 66 points, and penalty points are taken away from them // with one point per card the totals grow about half as fast
const ROW_SIZES = [4, 5, 6];
const HAND_SIZES = [6, 8, 10];
const PACE = { slow: 1.6, relaxed: 1.2, normal: 1, quick: 0.6 }; // how long the table lingers on each step, as a factor (slow is the default: people can follow every card) // how long the table lingers on each step, as a factor
const STEP_MS = 900; // a card placed on a row stays on the table this long before the next one is played
const SWEEP_MS = 500; // a row taken (or swept) lingers this much longer, so the cards can be read
const MAX_PLAYERS = 8;

/** Penalty points of a card: 1, plus 1 for a multiple of 5, 1 more for a multiple of 10, 4 more for 11, 22, ... 99. */
function penaltyOf(n) {
  let p = 1;
  if (n % 5 === 0) p += 1;
  if (n % 10 === 0) p += 1;
  if (n % 11 === 0) p += 4;
  return p;
}
const card = (n, simple) => ({ n, p: simple ? 1 : penaltyOf(n) });
const sum = (cards) => cards.reduce((s, c) => s + c.p, 0);
const lastOf = (row) => row[row.length - 1];

function shuffledDeck(rng, simple) {
  const d = Array.from({ length: DECK }, (_, i) => card(i + 1, simple));
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** A public event for the floating feed (kind decides the icon). */
function say(g, by, text, kind) {
  g.logN += 1;
  g.log.push({ n: g.logN, by, card: text, kind });
  if (g.log.length > 40) g.log.shift();
}
const pts = (n) => `${n} point${n === 1 ? '' : 's'}`;
const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
/** Keep the table on a played card for a moment (scaled by the pace option; the server waits for it before the next move). */
function linger(g, ms) { pacing.hold(g, ms * PACE[g.options.pace]); }

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > MAX_PLAYERS) throw new Error(`Take 5 is for 2 to ${MAX_PLAYERS} players`);
  const o = options || {};
  const countdown = o.target === 'countdown';
  const key = countdown || Object.hasOwn(TARGETS, o.target) ? o.target : 'standard';
  const scoring = o.scoring === 'simple' ? 'simple' : 'standard';
  const rowSize = ROW_SIZES.includes(Number(o.rowSize)) ? Number(o.rowSize) : ROW_LIMIT;
  const hand = HAND_SIZES.includes(Number(o.hand)) ? Number(o.hand) : HAND;
  const lowCard = o.lowCard === 'cheapest' ? 'cheapest' : 'choose';
  const pace = Object.hasOwn(PACE, o.pace) ? o.pace : 'slow';
  const g = {
    game: 'penaltyrows',
    n,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    rng,
    options: { target: key, scoring, rowSize, hand, lowCard, pace },
    countdown,
    target: countdown ? COUNTDOWN : (scoring === 'simple' ? TARGETS_SIMPLE : TARGETS)[key],
    losers: [], // countdown only: the players who reached 0 this game
    simple: scoring === 'simple', rowLimit: rowSize, handSize: hand, lowCard,
    history: [], // [{ round, penalties, totals }] one per finished round
    log: [], logN: 0, // public events for the floating feed
    before: [], after: [], // the rows at the start and the end of the last turn, so the table can replay it step by step
    round: 0,
    turn: 0, // 1..HAND within a round
    phase: 'choose', // choose | takeRow | gameOver
    hands: [], rows: [], piles: [], // piles: the cards each player has taken this round
    totals: players.map(() => 0),
    picks: players.map(() => null), // the number each player picked this turn, or null (hidden from the others until all are in)
    reveal: [], // once all picked: [{ by, card }] lowest first, played one at a time
    resolved: 0, // how many of `reveal` are played
    pending: null, // { by, card }: a card that fits no row, waiting for its player to take a row
    lastTurn: [], // what the last resolved turn did, in order (public)
    lastRound: null, // { round, penalties }: the round that just ended (public)
    winners: [],
    seq: 0,
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round += 1;
  const deck = shuffledDeck(g.rng, g.simple);
  g.hands = g.players.map(() => []);
  for (let k = 0; k < g.handSize; k++) for (let i = 0; i < g.n; i++) g.hands[i].push(deck.pop());
  g.hands.forEach((h) => h.sort((a, b) => a.n - b.n));
  g.rows = Array.from({ length: START_ROWS }, () => [deck.pop()]);
  g.piles = g.players.map(() => []);
  g.turn = 1;
  g.picks = g.players.map(() => null);
  g.reveal = []; g.resolved = 0; g.pending = null;
  g.phase = 'choose';
}

/** Players the game is waiting for. */
function awaiting(g) {
  if (g.phase === 'choose') return g.players.filter((_, i) => g.picks[i] === null).map((p) => p.id);
  if (g.phase === 'takeRow' && g.pending) return [g.players[g.pending.by].id];
  return [];
}

function applyAction(g, playerId, action) {
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  const i = indexOf(g, playerId);
  if (i < 0) return { ok: false, error: 'You are not at this table' };
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return { ok: false, error: 'Invalid action' };
  if (action.type === 'pick') return pick(g, i, action);
  if (action.type === 'takeRow') return takeRow(g, i, action);
  return { ok: false, error: 'Unknown action' };
}

function pick(g, i, action) {
  if (g.phase !== 'choose') return { ok: false, error: 'Wait: the cards are being played' };
  if (!Number.isInteger(action.card) || !g.hands[i].some((c) => c.n === action.card)) return { ok: false, error: 'That card is not in your hand' };
  g.picks[i] = action.card; // until everyone has picked you may change your mind
  if (g.picks.every((x) => x !== null)) reveal(g);
  return { ok: true };
}

/** Everybody has picked: take the cards out of the hands, show them lowest first and play them. */
function reveal(g) {
  g.reveal = g.picks.map((n, by) => ({ by, card: g.hands[by].find((c) => c.n === n) })).sort((a, b) => a.card.n - b.card.n);
  g.hands = g.hands.map((h, i) => h.filter((c) => c.n !== g.picks[i]));
  g.resolved = 0; g.lastTurn = [];
  g.before = g.rows.map((r) => r.map((c) => ({ n: c.n, p: c.p })));
  play(g);
}

/** Plays the revealed cards in order until one needs a decision (a row to take) or all are down. */
function play(g) {
  while (g.resolved < g.reveal.length) {
    const r = g.reveal[g.resolved];
    let best = -1;
    for (let k = 0; k < g.rows.length; k++) {
      const end = lastOf(g.rows[k]).n;
      if (end < r.card.n && (best < 0 || end > lastOf(g.rows[best]).n)) best = k;
    }
    if (best < 0) {
      if (g.lowCard === 'cheapest') { // variant: the row that costs least is taken for you
        let row = 0;
        for (let k = 1; k < g.rows.length; k++) if (sum(g.rows[k]) < sum(g.rows[row])) row = k;
        takeIt(g, r.by, row, r.card);
        g.resolved += 1;
        continue;
      }
      g.phase = 'takeRow'; g.pending = { by: r.by, card: r.card }; return; // fits no row: its player chooses
    }
    if (g.rows[best].length >= g.rowLimit) {
      const taken = g.rows[best];
      g.piles[r.by].push(...taken);
      g.rows[best] = [r.card];
      g.lastTurn.push({ by: r.by, n: r.card.n, p: r.card.p, row: best, kind: 'sweep', took: sum(taken) });
      say(g, g.players[r.by].name, `played the ${g.rowLimit + 1}th card: took row ${best + 1}, ${pts(sum(taken))}`, 'sweep');
      linger(g, STEP_MS + SWEEP_MS);
    } else {
      g.rows[best].push(r.card);
      g.lastTurn.push({ by: r.by, n: r.card.n, p: r.card.p, row: best, kind: 'place', took: 0 });
      linger(g, STEP_MS);
    }
    g.resolved += 1;
  }
  endTurn(g);
}

/** Player `i` takes row `row`; their card starts it again. */
function takeIt(g, i, row, card) {
  const taken = g.rows[row];
  g.piles[i].push(...taken);
  g.rows[row] = [card];
  g.lastTurn.push({ by: i, n: card.n, p: card.p, row, kind: 'take', took: sum(taken) });
  say(g, g.players[i].name, `${card.n} fits no row: took row ${row + 1}, ${pts(sum(taken))}`, 'take');
  linger(g, STEP_MS + SWEEP_MS);
}

function takeRow(g, i, action) {
  if (g.phase !== 'takeRow' || !g.pending) return { ok: false, error: 'Nothing to take now' };
  if (g.pending.by !== i) return { ok: false, error: 'Another player is choosing a row' };
  if (!Number.isInteger(action.row) || action.row < 0 || action.row >= g.rows.length) return { ok: false, error: 'Choose one of the rows' };
  takeIt(g, i, action.row, g.pending.card);
  g.pending = null; g.resolved += 1; g.phase = 'choose';
  play(g);
  return { ok: true };
}

function endTurn(g) {
  g.phase = 'choose';
  g.reveal = []; g.resolved = 0;
  g.picks = g.players.map(() => null);
  g.seq += 1;
  g.after = g.rows.map((r) => r.map((c) => ({ n: c.n, p: c.p })));
  if (g.turn < g.handSize) { g.turn += 1; return; }
  // the round is over: score it
  const penalties = g.piles.map(sum);
  g.totals = g.totals.map((t, i) => t + penalties[i]);
  g.lastRound = { round: g.round, penalties };
  g.history.push({ round: g.round, penalties: penalties.slice(), totals: g.totals.slice() });
  say(g, 'Table', `Round ${g.round} is over`, 'roundEnd');
  if (g.countdown) {
    // the round has been played out; now whoever has reached 0 loses, and the most points left wins
    g.losers = g.totals.map((t, i) => (t >= COUNTDOWN ? i : -1)).filter((i) => i >= 0);
    if (g.losers.length) {
      const left = g.totals.map((t, i) => (g.losers.includes(i) ? 0 : COUNTDOWN - t));
      const best = Math.max(...left);
      g.winners = best > 0 ? left.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0) : [];
      g.phase = 'gameOver';
      say(g, g.losers.map((i) => g.players[i].name).join(' & '), 'reached 0 and lose', 'win');
      if (g.winners.length) say(g, g.winners.map((i) => g.players[i].name).join(' & '), g.winners.length > 1 ? 'share the win!' : 'wins!', 'win');
      return;
    }
  } else if (Math.max(...g.totals) >= g.target) {
    const low = Math.min(...g.totals);
    g.winners = g.totals.map((t, i) => (t === low ? i : -1)).filter((i) => i >= 0);
    g.phase = 'gameOver';
    say(g, g.winners.map((i) => g.players[i].name).join(' & '), g.winners.length > 1 ? 'share the win!' : 'wins!', 'win');
    return;
  }
  startRound(g);
}

/** The cost of playing `n` now, for a bot: what it would take. Lower is better. */
function costOf(g, n) {
  let best = -1;
  for (let k = 0; k < g.rows.length; k++) {
    const end = lastOf(g.rows[k]).n;
    if (end < n && (best < 0 || end > lastOf(g.rows[best]).n)) best = k;
  }
  if (best < 0) return Math.min(...g.rows.map(sum)) + 1; // it must take the cheapest row
  const row = g.rows[best];
  if (row.length >= g.rowLimit) return sum(row); // the sixth card takes the row
  // otherwise it is free now, but a nearly full row and a wide gap make it risky when others play in between
  const gap = n - lastOf(row).n;
  return (row.length === g.rowLimit - 1 ? 1.5 : 0) + gap / 40;
}

function botAction(g, playerId) {
  const i = indexOf(g, playerId);
  if (i < 0) return null;
  if (g.phase === 'takeRow' && g.pending && g.pending.by === i) {
    let row = 0;
    for (let k = 1; k < g.rows.length; k++) if (sum(g.rows[k]) < sum(g.rows[row])) row = k;
    return { type: 'takeRow', row };
  }
  if (g.phase !== 'choose' || g.picks[i] !== null || !g.hands[i].length) return null;
  let bestCard = g.hands[i][0]; let bestCost = Infinity;
  for (const c of g.hands[i]) {
    const cost = costOf(g, c.n) + g.rng() * 0.6; // a little noise so bots are not all identical
    if (cost < bestCost) { bestCost = cost; bestCard = c; }
  }
  return { type: 'pick', card: bestCard.n };
}

/** The last card in a hand is not a choice: the server plays it after a short pause. */
function forcedPlay(g) {
  if (g.phase !== 'choose') return null;
  for (let i = 0; i < g.n; i++) {
    if (g.picks[i] === null && g.hands[i].length === 1) return { playerId: g.players[i].id, action: { type: 'pick', card: g.hands[i][0].n } };
  }
  return null;
}

/** What one player sees. Other players' hands and picks are never included until the cards are revealed. */
function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const waiting = awaiting(g);
  const over = g.phase === 'gameOver';
  return {
    game: 'penaltyrows',
    phase: g.phase,
    batch: `${g.round}:${g.turn}`, // each simultaneous turn is its own batch for the time limit
    round: g.round,
    turn: over ? g.handSize : g.turn,
    handSize: g.handSize,
    rowLimit: g.rowLimit,
    options: { ...g.options },
    paceK: PACE[g.options.pace],
    history: g.history.map((h) => ({ round: h.round, penalties: h.penalties.slice(), totals: h.totals.slice() })),
    log: g.log.slice(-30),
    before: g.before, after: g.after,
    target: g.target,
    countdown: g.countdown,
    losers: g.losers.slice(),
    me,
    myTurn: me >= 0 && waiting.includes(playerId),
    players: g.players.map((p, i) => ({
      id: p.id, name: p.name,
      picked: g.picks[i] !== null || g.reveal.length > 0, // has chosen this turn (public; the card is not)
      cards: g.hands[i].length,
      penalty: sum(g.piles[i]), // taken so far this round
      total: g.totals[i],
      left: g.countdown ? Math.max(0, COUNTDOWN - g.totals[i]) : null, // countdown: points left
    })),
    rows: g.rows.map((r) => r.map((c) => ({ n: c.n, p: c.p }))),
    rowPenalty: g.rows.map(sum),
    hand: me >= 0 ? g.hands[me].map((c) => ({ n: c.n, p: c.p })) : [],
    myPick: me >= 0 ? g.picks[me] : null,
    reveal: g.reveal.map((r) => ({ by: r.by, n: r.card.n, p: r.card.p })),
    resolved: g.resolved,
    pending: g.pending ? { by: g.pending.by, n: g.pending.card.n, p: g.pending.card.p } : null,
    lastTurn: g.lastTurn.map((e) => ({ ...e })),
    lastRound: g.lastRound ? { round: g.lastRound.round, penalties: g.lastRound.penalties.slice() } : null,
    winners: g.winners.slice(),
    seq: g.seq,
  };
}

function results(g) {
  // score is the negative total, so a higher score is better like in every other game (and ranks the places)
  return g.players.map((_, i) => ({ score: -g.totals[i], winner: g.phase === 'gameOver' && g.winners.includes(i) }));
}

module.exports = { DECK, HAND, START_ROWS, ROW_LIMIT, TARGETS, TARGETS_SIMPLE, ROW_SIZES, HAND_SIZES, PACE, STEP_MS, SWEEP_MS, MAX_PLAYERS, penaltyOf, createGame, applyAction, awaiting, botAction, forcedPlay, viewFor, results };
