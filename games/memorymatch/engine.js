'use strict';
/**
 * Memory Match (2 to 4 players), rules only: no sockets, no timers.
 *
 * Cards are dealt face down in pairs. On your turn you turn over two cards. If they match you keep the pair and play
 * again; if not, they turn back over and the turn passes to the next seat. When every pair is found, the player with the
 * most pairs wins; a tie for the most is a draw.
 *
 * The symbols stay on the server until a card is turned over. Once turned over, a card is known to the whole table (it
 * is shown to everyone), and the bots only use what the table has seen. Option `size`: '4x4' (default), '4x6' or '6x6'.
 * Cards are numbered row by row, 0..N-1.
 */

const SIZES = { '4x4': [4, 4], '4x6': [4, 6], '6x6': [6, 6] };
// Generic fruit, plants and creatures (not a brand, not a character): one symbol per pair.
const SYMBOLS = ['🍎', '🍐', '🍊', '🍋', '🍉', '🍇', '🍓', '🍒', '🍑', '🥝', '🌽', '🥕', '🍄', '🌵', '🌻', '🍀', '🌙', '⭐', '🐸', '🦋', '🐢', '🐙', '🦊', '🐝'];

const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind = 'info') => { g.log.push({ by: g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function createGame(players, options = {}, rng = Math.random) {
  if (players.length < 2 || players.length > 4) throw new Error('Memory Match is for 2 to 4 players');
  const size = Object.prototype.hasOwnProperty.call(SIZES, options.size) ? options.size : '4x4';
  const [rows, cols] = SIZES[size];
  const total = rows * cols;
  const symbols = shuffle(SYMBOLS, rng).slice(0, total / 2);
  const cards = shuffle([...symbols, ...symbols], rng);
  return {
    game: 'memorymatch', rng, rows, cols, total, options: { size },
    players: players.map((p) => ({ id: p.id, name: p.name })),
    cards, // hidden until turned over: never sent to a view unless revealed
    matched: Array(total).fill(false), owner: Array(total).fill(null),
    known: new Map(), // index -> symbol, for every card the table has seen (bots use only this)
    pending: null, // the first card of this turn, while the second is still to come
    peek: null, // a missed pair, shown face up until the next move
    pairs: Array(players.length).fill(0), matchedCount: 0,
    turn: 0, phase: 'playing', winner: null, draw: false,
    last: null, event: null, log: [], seq: 0, version: 0,
  };
}

function applyAction(g, playerId, action) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (g.turn !== who) return { ok: false, error: 'Not your turn' };
  if (!action || typeof action !== 'object' || action.type !== 'flip') return { ok: false, error: 'Unknown action' };
  const i = action.index;
  if (!Number.isInteger(i) || i < 0 || i >= g.total) return { ok: false, error: 'No such card' };
  if (g.matched[i]) return { ok: false, error: 'That card is already matched' };
  if (g.pending === i) return { ok: false, error: 'That card is already face up' };

  g.last = i; g.version++; // a missed pair stays face up until the next turn's second card is turned (see below)
  g.known.set(i, g.cards[i]);
  if (g.pending === null) {
    g.pending = i;
    emit(g, { type: 'flip', by: who, index: i, symbol: g.cards[i] });
    return { ok: true };
  }

  const a = g.pending;
  g.pending = null;
  g.peek = null; // the missed pair has been seen by the players who turned the next pair
  if (g.cards[a] === g.cards[i]) {
    g.matched[a] = g.matched[i] = true; g.owner[a] = g.owner[i] = who;
    g.pairs[who]++; g.matchedCount += 2;
    emit(g, { type: 'match', by: who, a, b: i, symbol: g.cards[i] });
    say(g, who, `found a pair of ${g.cards[i]}`, 'win');
    if (g.matchedCount === g.total) {
      g.phase = 'gameOver';
      const top = Math.max(...g.pairs);
      const leaders = g.pairs.map((p, s) => (p === top ? s : -1)).filter((s) => s >= 0);
      g.winner = leaders.length === 1 ? leaders[0] : null;
      g.draw = leaders.length > 1;
      emit(g, { type: 'over', by: who, winner: g.winner, draw: g.draw });
      say(g, who, g.draw ? 'found the last pair: a draw' : 'found the last pair', g.draw ? 'draw' : 'win');
    }
    return { ok: true };
  }
  // a miss: both cards stay face up for everyone to see, then the turn passes
  g.peek = { a, b: i, sa: g.cards[a], sb: g.cards[i] };
  g.turn = (who + 1) % g.players.length;
  emit(g, { type: 'miss', by: who, a, b: i, sa: g.cards[a], sb: g.cards[i] });
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);

/** Results: score is the number of pairs; the top scorer wins, a tie is a draw. */
function results(g) {
  const top = Math.max(...g.pairs);
  return g.players.map((_, s) => ({ score: g.pairs[s], winner: g.winner === s, draw: g.draw && g.pairs[s] === top }));
}

// ------------------------------------------------------------------------------------------------ bots (only what the table has seen)

function faceDown(g) {
  const out = [];
  for (let k = 0; k < g.total; k++) if (!g.matched[k] && k !== g.pending) out.push(k);
  return out;
}

function botAction(g, playerId, rng = Math.random) {
  const down = faceDown(g);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (g.pending !== null) {
    // second card: its known partner if the table has seen it, otherwise an unseen card
    const partner = down.find((k) => g.known.has(k) && g.known.get(k) === g.cards[g.pending]);
    if (partner !== undefined) return { type: 'flip', index: partner };
    const unseen = down.filter((k) => !g.known.has(k));
    return { type: 'flip', index: pick(unseen.length ? unseen : down) };
  }
  // first card: a known pair on the table, otherwise an unseen card
  const bySymbol = new Map();
  for (const k of down) if (g.known.has(k)) { const s = g.known.get(k); if (!bySymbol.has(s)) bySymbol.set(s, []); bySymbol.get(s).push(k); }
  for (const list of bySymbol.values()) if (list.length >= 2) return { type: 'flip', index: list[0] };
  const unseen = down.filter((k) => !g.known.has(k));
  return { type: 'flip', index: pick(unseen.length ? unseen : down) };
}

/** What a seat sees: matched pairs and the card in play face up; every other card face down, and a missed pair for a moment. */
function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const board = [];
  for (let k = 0; k < g.total; k++) {
    if (g.matched[k]) board.push({ symbol: g.cards[k], owner: g.owner[k] });
    else if (g.pending === k || (g.peek && (g.peek.a === k || g.peek.b === k))) board.push({ symbol: g.cards[k], owner: null });
    else board.push({ symbol: null, owner: null });
  }
  return {
    me, phase: g.phase, rows: g.rows, cols: g.cols, options: { ...g.options },
    players: g.players.map((p, s) => ({ id: p.id, name: p.name, pairs: g.pairs[s] })),
    turn: g.turn, myTurn: me >= 0 && me === g.turn && g.phase === 'playing',
    pending: g.pending, board, last: g.last,
    left: g.total - g.matchedCount,
    winner: g.winner, draw: g.draw,
    event: g.event ? { ...g.event } : null,
    log: g.log.slice(-30),
  };
}

module.exports = { SIZES, SYMBOLS, createGame, applyAction, awaiting, botAction, viewFor, results };
