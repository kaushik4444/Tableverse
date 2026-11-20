'use strict';
/**
 * Chess for two players. Rules live in rules.js; this file turns them into a table game: who plays White, what each
 * player may see, which actions are legal now, the end of the game and a simple bot.
 *
 * An action is { type: 'move', from, to, promo? } with board indices (0–63, see rules.js), or { type: 'resign' }.
 * Nothing is hidden in chess, but a player is only offered the legal moves of the side to move.
 */
const rules = require('./rules');

const COLOUR_OPTION = {
  key: 'colour', type: 'select', label: 'Who plays White', default: 'random',
  choices: [
    { value: 'random', label: 'Random', desc: 'White, which moves first, is chosen by chance.' },
    { value: 'host', label: 'First seat', desc: 'The first seat plays White.' },
    { value: 'guest', label: 'Second seat', desc: 'The second seat plays White.' },
  ],
};

const isIndex = (n) => Number.isInteger(n) && n >= 0 && n < 64;

function createGame(players, options, rng) {
  const choice = options && options.colour;
  const white = choice === 'host' ? 0 : choice === 'guest' ? 1 : rng() < 0.5 ? 0 : 1;
  return {
    players: players.map((p) => ({ id: p.id, name: p.name })),
    white,
    pos: rules.initial(),
    reps: { [rules.keyOf(rules.initial())]: 1 }, // how often each position has occurred
    log: [],       // standard notation of each move, in order
    taken: { w: [], b: [] }, // pieces each colour has captured (letters of the pieces taken)
    last: null,    // { from, to } of the last move
    phase: 'playing',
    winner: null,  // seat index of the winner, or null
    draw: false,
    reason: null,
    seq: 0,
    event: null,   // { seq, type, from, to, capture, check } for animation and sound
    rng,
  };
}

const colourOfSeat = (g, seat) => (seat === g.white ? 'w' : 'b');
const seatOfColour = (g, c) => (c === 'w' ? g.white : 1 - g.white);
const seatOf = (g, playerId) => g.players.findIndex((p) => p.id === playerId);
const turnSeat = (g) => seatOfColour(g, g.pos.turn);

function viewFor(g, playerId) {
  const me = seatOf(g, playerId);
  const myTurn = g.phase === 'playing' && me >= 0 && me === turnSeat(g);
  const legal = myTurn ? rules.legalMoves(g.pos).map((m) => [m.from, m.to, m.promo || null]) : [];
  const check = rules.inCheck(g.pos) ? rules.kingCell(g.pos.board, g.pos.turn) : null;
  return {
    game: 'chess',
    name: 'Chess',
    phase: g.phase,
    players: g.players,
    me,
    myTurn,
    turn: turnSeat(g),                // seat to move
    turnColour: g.pos.turn,
    colours: [colourOfSeat(g, 0), colourOfSeat(g, 1)],
    board: g.pos.board.slice(),       // 64 cells: a piece letter or null (index = rank * 8 + file)
    legal,                            // [from, to, promo] for the player to move; [] otherwise
    check,                            // index of the king in check, or null
    last: g.last,
    log: g.log.slice(),
    taken: { w: g.taken.w.slice(), b: g.taken.b.slice() },
    winner: g.phase === 'gameOver' ? g.winner : null,
    draw: g.phase === 'gameOver' && g.draw,
    reason: g.reason,
    event: g.event,
  };
}

function applyAction(g, playerId, action) {
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  if (g.phase !== 'playing') return { ok: false, error: 'The game is over' };
  const seat = seatOf(g, playerId);
  if (seat < 0) return { ok: false, error: 'Not a player in this game' };
  // either seated player may resign at any time; only moves wait for their turn
  if (action.type === 'resign') {
    finish(g, { over: true, reason: 'resignation', winner: colourOfSeat(g, 1 - seat) }, 'resign');
    return { ok: true };
  }
  if (seat !== turnSeat(g)) return { ok: false, error: 'Not your turn' };
  if (action.type !== 'move' || !isIndex(action.from) || !isIndex(action.to)) return { ok: false, error: 'Invalid move' };
  if (action.promo !== undefined && action.promo !== null && !rules.PROMOTIONS.includes(action.promo)) return { ok: false, error: 'Invalid promotion' };
  const legal = rules.legalMoves(g.pos);
  const matches = legal.filter((m) => m.from === action.from && m.to === action.to);
  if (matches.length === 0) return { ok: false, error: 'Illegal move' };
  const m = matches.find((x) => (x.promo || null) === (action.promo || null));
  if (!m) return { ok: false, error: matches[0].promo ? 'Choose a promotion piece' : 'Illegal move' };

  const notation = rules.san(g.pos, m, legal);
  const next = rules.apply(g.pos, m);
  const key = rules.keyOf(next);
  g.reps[key] = (g.reps[key] || 0) + 1;
  const mover = g.pos.turn;
  if (m.captured) g.taken[mover].push(m.captured);
  g.pos = next;
  g.last = { from: m.from, to: m.to };
  g.log.push(notation);
  const st = rules.status(next, g.reps[key]);
  g.event = { seq: ++g.seq, type: 'move', from: m.from, to: m.to, capture: !!m.captured, check: rules.inCheck(next), over: st.over };
  if (st.over) finish(g, st, null);
  return { ok: true };
}

function finish(g, st, eventType) {
  g.phase = 'gameOver';
  g.winner = st.winner === null || st.winner === undefined ? null : seatOfColour(g, st.winner);
  g.draw = st.winner === null || st.winner === undefined;
  g.reason = st.reason;
  if (eventType) g.event = { seq: ++g.seq, type: eventType, over: true };
}

/** A simple bot: take the most valuable piece it can, prefer checks and queen promotions, break ties at random. */
function botAction(g) {
  const legal = rules.legalMoves(g.pos);
  if (legal.length === 0) return { type: 'resign' };
  let best = null, bestScore = -Infinity;
  for (const m of legal) {
    let score = (m.captured ? rules.VALUE[m.captured.toUpperCase()] * 10 : 0) + (m.promo === 'Q' ? 9 : 0);
    if (rules.inCheck(rules.apply(g.pos, m))) score += 2;
    score += g.rng() * 0.5;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return { type: 'move', from: best.from, to: best.to, promo: best.promo || null };
}

module.exports = { COLOUR_OPTION, createGame, viewFor, applyAction, botAction, seatOf, turnSeat };
