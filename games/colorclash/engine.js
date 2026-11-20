'use strict';
/**
 * Color Clash: the rules only (no sockets, no timers). An original shedding game for 2-8 players.
 *
 * Deck (104 cards): four colours (Ruby, Sun, Leaf, Sea), each with the numbers 1 to 9 twice, and two each of Stop, Flip and
 * Take 2. Plus four Wild and four Wild Take 4 cards. Everyone gets 7 cards. On your turn play a card that matches the top
 * card by colour, by number or by action, or draw one. A drawn card may be played at once if it fits. Stop skips the next
 * player, Flip reverses the direction (with two players it skips), Take 2 and Wild Take 4 make the next player draw and
 * miss their turn, and a Wild picks the colour. The first player to empty their hand ends the round and scores the points
 * left in the other hands (numbers count their value, Stop, Flip and Take 2 are 20, Wilds 50). First to the target wins.
 */
const COLOURS = ['R', 'Y', 'G', 'B'];
const COLOUR_NAMES = { R: 'Ruby', Y: 'Sun', G: 'Leaf', B: 'Sea' };
const ACTIONS = ['stop', 'flip', 'take2'];
const ACTION_NAMES = { stop: 'Stop', flip: 'Flip', take2: 'Take 2', wild: 'Wild', take4: 'Wild Take 4' };
const HAND = 7;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const TARGETS = { round: 0, '100': 100, '200': 200, '300': 300 };

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind) => { g.log.push({ by: by === null ? 'Table' : g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };
const points = (c) => (c.k === 'n' ? c.v : c.k === 'wild' || c.k === 'take4' ? 50 : 20);
const label = (c) => (c.k === 'n' ? `${COLOUR_NAMES[c.c]} ${c.v}` : c.k === 'wild' || c.k === 'take4' ? ACTION_NAMES[c.k] : `${COLOUR_NAMES[c.c]} ${ACTION_NAMES[c.k]}`);
const pub = (c) => ({ id: c.id, c: c.c, k: c.k, v: c.v });

function buildDeck() {
  const d = [];
  for (const c of COLOURS) {
    for (let v = 1; v <= 9; v++) for (const copy of ['a', 'b']) d.push({ id: `${c}${v}${copy}`, c, k: 'n', v });
    for (const k of ACTIONS) for (const copy of ['a', 'b']) d.push({ id: `${c}${k}${copy}`, c, k, v: null });
  }
  for (let i = 1; i <= 4; i++) { d.push({ id: `W${i}`, c: 'W', k: 'wild', v: null }); d.push({ id: `T${i}`, c: 'W', k: 'take4', v: null }); }
  return d;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const colourOrder = (c) => (c.c === 'W' ? COLOURS.length : COLOURS.indexOf(c.c));
const sortHand = (h) => h.sort((a, b) => colourOrder(a) - colourOrder(b) || (a.k === 'n' ? a.v : 20) - (b.k === 'n' ? b.v : 20) || a.k.localeCompare(b.k) || a.id.localeCompare(b.id));

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('Color Clash is for 2 to 8 players');
  const target = options && Object.hasOwn(TARGETS, options.target) ? options.target : '200';
  const g = {
    game: 'colorclash',
    n,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    rng,
    options: { target },
    scores: players.map(() => 0),
    round: 0,
    stock: [],
    discard: [],
    hands: [],
    colour: 'R',
    dir: 1,
    turn: 0,
    drawn: null, // the id of the card this player has just drawn and may still play (or keep by passing)
    phase: 'playing', // playing | gameOver
    event: null,
    lastDraw: null, // { seq, by, card }: only the player who drew sees the card
    roundResult: null, // { round, winner, gains: [points per player], hands: [[cards] per player], total }
    winners: [],
    log: [],
    seq: 0,
    version: 0,
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round++;
  g.stock = shuffle(buildDeck(), g.rng);
  g.discard = [];
  g.hands = g.players.map(() => []);
  for (let k = 0; k < HAND; k++) for (let i = 0; i < g.n; i++) g.hands[i].push(g.stock.pop());
  g.hands.forEach(sortHand);
  // the first card is a number card: anything else goes back under the stock
  let first = g.stock.pop();
  const under = [];
  while (first.k !== 'n') { under.push(first); first = g.stock.pop(); }
  g.stock.unshift(...under);
  g.discard.push(first);
  g.colour = first.c;
  g.dir = 1;
  g.turn = (g.round - 1) % g.n; // the first turn moves round the table with each round
  g.drawn = null;
  say(g, null, `Round ${g.round} begins with ${label(first)}`, 'round');
}

const step = (g, from, by = 1) => (((from + g.dir * by) % g.n) + g.n) % g.n;
const top = (g) => g.discard[g.discard.length - 1];

/** A card may be played when it is a Wild, or matches the colour in play, the number, or the action on top. */
function playable(g, c) {
  if (c.k === 'wild' || c.k === 'take4') return true;
  const t = top(g);
  if (c.c === g.colour) return true;
  if (c.k === 'n') return t.k === 'n' && t.v === c.v;
  return t.k === c.k;
}

/** Draws up to `count` cards for a player, turning the discards (all but the top card) into a new stock when it runs out. */
function drawCards(g, who, count) {
  const got = [];
  for (let k = 0; k < count; k++) {
    if (!g.stock.length && g.discard.length > 1) {
      const keep = g.discard.pop();
      g.stock = shuffle(g.discard.splice(0), g.rng);
      g.discard.push(keep);
      say(g, null, 'The discards were shuffled into a new stock', 'shuffle');
    }
    if (!g.stock.length) break;
    got.push(g.stock.pop());
  }
  g.hands[who].push(...got);
  sortHand(g.hands[who]);
  return got;
}

function endRound(g, who) {
  const gains = g.players.map(() => 0);
  const hands = g.hands.map((h) => h.map(pub));
  let total = 0;
  g.hands.forEach((h, i) => { if (i !== who) total += h.reduce((s, c) => s + points(c), 0); });
  gains[who] = total;
  g.scores[who] += total;
  g.roundResult = { round: g.round, winner: who, gains, hands, total };
  say(g, who, `went out and scored ${total}`, 'out');
  const limit = TARGETS[g.options.target];
  const best = Math.max(...g.scores);
  if (limit === 0 || best >= limit) {
    g.phase = 'gameOver';
    g.winners = g.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    emit(g, { type: 'over', by: who, winners: g.winners.slice(), round: g.round });
    return;
  }
  emit(g, { type: 'roundEnd', by: who, round: g.round, total });
  startRound(g);
}

/** Moves the turn on after a play or a pass, applying the effect of the card that was played. */
function advance(g, who, card) {
  g.drawn = null;
  let next = step(g, who);
  if (card) {
    if (card.k === 'flip') {
      g.dir = -g.dir;
      next = g.n === 2 ? who : step(g, who);
    } else if (card.k === 'stop') {
      next = step(g, who, 2);
      g.event.skipped = step(g, who);
    } else if (card.k === 'take2' || card.k === 'take4') {
      const victim = step(g, who);
      const got = drawCards(g, victim, card.k === 'take2' ? 2 : 4);
      g.event.penalised = { target: victim, count: got.length };
      say(g, who, `made ${g.players[victim].name} draw ${got.length}`, 'penalty');
      next = step(g, who, 2);
    }
  }
  g.turn = next;
}

/** action: { type: 'play', card: id, colour?: 'R'|'Y'|'G'|'B' (Wilds) } | { type: 'draw' } | { type: 'pass' } (keep the card you drew) */
function applyAction(g, playerId, action) {
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  const who = indexOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (who !== g.turn) return { ok: false, error: 'Not your turn' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  g.version++;
  if (action.type === 'draw') return draw(g, who);
  if (action.type === 'pass') return pass(g, who);
  if (action.type === 'play') return play(g, who, action);
  return { ok: false, error: 'Unknown action' };
}

function play(g, who, action) {
  const card = typeof action.card === 'string' ? g.hands[who].find((c) => c.id === action.card) : null;
  if (!card) return { ok: false, error: 'You do not have that card' };
  if (g.drawn && card.id !== g.drawn) return { ok: false, error: 'You drew a card: play that one or keep it' };
  if (!playable(g, card)) return { ok: false, error: 'That card does not match' };
  const wild = card.k === 'wild' || card.k === 'take4';
  if (wild && !COLOURS.includes(action.colour)) return { ok: false, error: 'Pick a colour' };
  g.hands[who] = g.hands[who].filter((c) => c.id !== card.id);
  g.discard.push(card);
  g.colour = wild ? action.colour : card.c;
  emit(g, { type: 'play', by: who, card: pub(card), colour: g.colour, left: g.hands[who].length });
  say(g, who, `played ${label(card)}${wild ? ` and chose ${COLOUR_NAMES[g.colour]}` : ''}`, 'play');
  if (g.hands[who].length === 0) {
    g.drawn = null;
    endRound(g, who);
    return { ok: true };
  }
  if (g.hands[who].length === 1) { g.event.last = true; say(g, who, 'has one card left', 'last'); }
  advance(g, who, card);
  return { ok: true };
}

function draw(g, who) {
  if (g.drawn) return { ok: false, error: 'You have already drawn' };
  const got = drawCards(g, who, 1);
  if (!got.length) { emit(g, { type: 'draw', by: who, count: 0 }); say(g, who, 'could not draw (no cards left)', 'draw'); advance(g, who, null); return { ok: true }; }
  const card = got[0];
  g.lastDraw = { seq: g.seq + 1, by: who, card };
  emit(g, { type: 'draw', by: who, count: 1 });
  say(g, who, 'drew a card', 'draw');
  if (playable(g, card)) g.drawn = card.id; // may be played now, or kept
  else advance(g, who, null);
  return { ok: true };
}

function pass(g, who) {
  if (!g.drawn) return { ok: false, error: 'Draw a card first' };
  emit(g, { type: 'pass', by: who });
  say(g, who, 'kept the card and passed', 'pass');
  advance(g, who, null);
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);

/** Bots see only their hand and the table. They play the highest-scoring card that fits, saving Wilds, and pick the colour they hold most of. */
function botAction(g, playerId) {
  const who = indexOf(g, playerId);
  if (g.phase !== 'playing' || who !== g.turn) return null;
  const hand = g.hands[who];
  const fits = hand.filter((c) => playable(g, c) && (!g.drawn || c.id === g.drawn));
  if (!fits.length) return g.drawn ? { type: 'pass' } : { type: 'draw' };
  const next = step(g, who);
  const threat = g.hands[next].length <= 2;
  const score = (c) => (c.k === 'wild' || c.k === 'take4' ? (threat ? 25 : -5) : c.k === 'n' ? c.v : threat && c.k !== 'flip' ? 40 : 18) + g.rng();
  const card = fits.slice().sort((a, b) => score(b) - score(a))[0];
  const action = { type: 'play', card: card.id };
  if (card.k === 'wild' || card.k === 'take4') {
    const count = (col) => hand.filter((c) => c.c === col).length;
    action.colour = COLOURS.slice().sort((a, b) => count(b) - count(a) || g.rng() - 0.5)[0];
  }
  return action;
}

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const over = g.phase === 'gameOver';
  const myTurn = !over && me >= 0 && me === g.turn;
  const mine = me >= 0 ? g.hands[me] : [];
  const draw = g.lastDraw && g.lastDraw.by === me ? g.lastDraw : null;
  return {
    game: 'colorclash',
    me,
    n: g.n,
    options: { ...g.options },
    phase: g.phase,
    round: g.round,
    target: TARGETS[g.options.target],
    turn: g.turn,
    myTurn,
    dir: g.dir,
    colour: g.colour,
    top: pub(top(g)),
    stock: g.stock.length,
    discards: g.discard.length,
    hand: mine.map((c) => ({ ...pub(c), ok: myTurn && playable(g, c) && (!g.drawn || c.id === g.drawn) })),
    drawn: myTurn ? g.drawn : null,
    canDraw: myTurn && !g.drawn,
    players: g.players.map((p, i) => ({ id: p.id, name: p.name, cards: g.hands[i].length, score: g.scores[i] })),
    event: g.event ? { ...g.event } : null,
    myDraw: draw ? { seq: draw.seq, card: pub(draw.card) } : null,
    roundResult: g.roundResult ? { ...g.roundResult } : null,
    winners: over ? g.winners.slice() : [],
  };
}

/** Higher total wins. `score` is the running total; everyone at the top shares the win. */
function results(g) {
  return g.players.map((_, i) => ({ score: g.scores[i], winner: g.phase === 'gameOver' && g.winners.includes(i) }));
}

module.exports = { COLOURS, COLOUR_NAMES, ACTION_NAMES, HAND, MIN_PLAYERS, MAX_PLAYERS, TARGETS, points, label, buildDeck, playable, createGame, applyAction, awaiting, botAction, viewFor, results };
