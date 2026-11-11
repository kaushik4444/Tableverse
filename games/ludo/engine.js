'use strict';
// Ludo — pure rules engine (no I/O, no timers).
// 2-6 players, 4 tokens each. Roll a 6 to bring a token out; move clockwise around the board,
// send opponents back to their yard by landing on them (not on safe squares), then climb your home column
// by exact count. First to get all 4 tokens home wins.
//
// Geometry depends on the number of players (see GEOMETRY below). A token enters on its colour's start square,
// walks all the ring squares except the one just before its start (the last of them is the one before its home
// column), then climbs five home-column squares and reaches home.

const pacing = require('../pacing');
const BOARD = require('./board');
// Milliseconds the clients take to walk a token one square, to send a captured token home, and the pause after (public/games/ludo.js)
const WALK = { step: 400, capture: 800, settle: 1300 };
const TOKENS = 4;
const HOME_COL = 5; // squares in each home column
// Board shapes. 'square' is the classic cross board for 2-4 players: a ring of 52 squares, the seats at 13-square
// spacing. 'hex' is the six-arm board for 5-6 players: a ring of 60 squares around six arms.
// Star (safe) squares are the seat starts plus the square eight steps after a start on the cross, or on the six-arm
// board the start and the notch between two arms. Ring positions are counted from the seat's own start square.
const GEOMETRY = {
  square: { track: 52, lap: 51, starts: [0, 13, 26, 39], safe: [0, 8, 13, 21, 26, 34, 39, 47] },
  // Six arms, as on the reference board: each arm is a block of 10 ring squares (its left side outwards, the tip,
  // its right side inwards, then the notch to the next arm). A seat starts on the middle of its own arm's tip.
  hex: { track: BOARD.TRACK, lap: BOARD.TRACK - 1, starts: BOARD.STARTS, safe: [...BOARD.SAFE] }, // the six-arm board, see board.js
};
// Lookup with the safe squares as a Set. Built once per shape; never sent to clients.
const GEO_CACHE = {};
function geometryFor(n) {
  const key = n >= 5 ? 'hex' : 'square';
  if (!GEO_CACHE[key]) { const d = GEOMETRY[key]; GEO_CACHE[key] = Object.assign({}, d, { finished: d.lap + HOME_COL, safe: new Set(d.safe) }); }
  return GEO_CACHE[key];
}
// The 4-player board, kept under the old names for the tests and any code that imports them.
const TRACK = GEOMETRY.square.track; // squares on the shared ring
const LAP = GEOMETRY.square.lap; // squares a token walks on the ring (internal positions 0..lap-1)
const FINISHED = LAP + HOME_COL; // 56: token is home
const STARTS = GEOMETRY.square.starts; // ring square where each board seat enters
const SAFE = new Set(GEOMETRY.square.safe);
const SEAT_COLORS = ['🔴', '🟢', '🟡', '🔵', '🟠', '🟣']; // seats clockwise from the top-left; the 5th and 6th seats are the last two arms of the six-arm board
const COLORS = SEAT_COLORS;
// Which board seats are used for n players. Two players sit opposite each other, as on a real board.
const SEATS_FOR = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };

function indexOf(g, id) { return g.players.findIndex((p) => p.id === id); }
function bump(g) { g.version++; }
function emit(g, ev) { g.seq++; g.event = Object.assign({ seq: g.seq }, ev); }

function absPos(g, playerIdx, p) {
  // absolute ring square for a token at internal track position p (0..lap-1)
  return (g.geo.starts[g.players[playerIdx].seat] + p) % g.geo.track;
}

function newPosFor(g, playerIdx, p, dice) {
  // internal position after moving a token at `p` by `dice`, or null if illegal
  const { lap, finished } = g.geo;
  if (p === -1) {
    // in home: only a 6 brings a token out to the start square
    return dice === 6 ? 0 : null;
  }
  if (p >= 0 && p <= lap - 1) {
    const np = p + dice;
    if (np <= lap - 1) return np;
    const excess = np - lap; // squares past the last ring square: into the home column
    if (excess < HOME_COL) return lap + excess;
    if (excess === HOME_COL) return finished; // exactly home
    return null; // overshot the finish: exact count needed
  }
  if (p >= lap && p < finished) {
    const np = p + dice;
    if (np <= finished) return np; // further up the home column, or exactly home
    return null; // overshot: exact count needed
  }
  return null; // already finished
}

function legalMoves(g, playerIdx) {
  const dice = g.dice;
  if (dice === null) return [];
  const out = [];
  for (let t = 0; t < TOKENS; t++) {
    const np = newPosFor(g, playerIdx, g.tokens[playerIdx][t], dice);
    if (np !== null) out.push({ token: t, to: np });
  }
  return out;
}

/**
 * When the roll leaves exactly one possible move (tokens that stand on the same square and would land on the same
 * square count as one), the server plays it. Returns { playerId, action } or null.
 */
function forcedPlay(g) {
  if (g.phase !== 'moving') return null;
  const who = g.turn;
  const moves = legalMoves(g, who);
  if (!moves.length) return null;
  const distinct = new Set(moves.map((m) => g.tokens[who][m.token] + '>' + m.to));
  if (distinct.size !== 1) return null;
  return { playerId: g.players[who].id, action: { type: 'move', token: moves[0].token } };
}

function applyMove(g, playerIdx, tokenIdx, np) {
  const { lap, finished, safe } = g.geo;
  const old = g.tokens[playerIdx][tokenIdx];
  g.tokens[playerIdx][tokenIdx] = np;
  const captured = [];

  // Capture: landing on a non-safe ring square occupied by opponent(s) sends them back to their yard.
  if (np >= 0 && np <= lap - 1 && !safe.has(absPos(g, playerIdx, np))) {
    const at = absPos(g, playerIdx, np);
    for (let i = 0; i < g.n; i++) {
      if (i === playerIdx) continue;
      for (let t = 0; t < TOKENS; t++) {
        const tp = g.tokens[i][t];
        if (tp >= 0 && tp <= lap - 1 && absPos(g, i, tp) === at) {
          g.tokens[i][t] = -1;
          captured.push({ player: i, token: t });
          g.log.push({ by: g.players[playerIdx].name, card: `sent ${g.players[i].name} home`, kind: 'capture' });
        }
      }
    }
  }

  if (np === finished) {
    g.log.push({ by: g.players[playerIdx].name, card: 'got a token home', kind: 'home' });
  }
  pacing.hold(g, (old < 0 ? 1 : Math.abs(np - old)) * WALK.step + (captured.length ? WALK.capture : 0) + WALK.settle);
  g.lastMove = { player: playerIdx, token: tokenIdx, from: old, to: np, dice: g.dice, captured };
  g.log.push({ by: g.players[playerIdx].name, card: `moved token ${tokenIdx + 1} by ${g.dice}`, kind: 'move' });
  emit(g, { type: 'moved', by: playerIdx, token: tokenIdx, from: old, to: np, dice: g.dice, captured });
  if (g.tokens[playerIdx].every((x) => x === finished)) {
    finishPlayer(g, playerIdx);
  }
  return { captured: captured.length > 0, home: np === finished };
}

function finishPlayer(g, playerIdx) {
  if (g.finishedOrder.includes(playerIdx)) return;
  g.finishedOrder.push(playerIdx);
  if (g.finishedOrder.length === g.n - 1) {
    // the last remaining player is also done by elimination
    const last = g.players.findIndex((_, i) => !g.finishedOrder.includes(i));
    if (last >= 0) g.finishedOrder.push(last);
  }
  if (g.finishedOrder.length === g.n) {
    g.winner = g.finishedOrder[0];
    g.phase = 'gameOver';
    emit(g, { type: 'won', by: playerIdx });
  } else {
    emit(g, { type: 'finished', by: playerIdx, place: g.finishedOrder.length });
  }
}

function endTurn(g) {
  // Players who have finished all four tokens are removed from the turn rotation.
  for (let step = 0; step < g.n; step++) {
    g.turn = (g.turn + 1) % g.n;
    if (!g.finishedOrder.includes(g.turn)) break;
  }
  g.phase = 'rolling';
  g.dice = null;
  g.sixes = 0;
  emit(g, { type: 'turn', by: g.turn });
}

function createGame(playerList, options = {}, rng = Math.random) {
  const n = playerList.length;
  if (n < 2 || n > 6) throw new Error('Ludo needs 2-6 players');
  const g = {
    game: 'ludo',
    n,
    geo: geometryFor(n),
    players: playerList.map((p, i) => ({ id: p.id, name: p.name, seat: SEATS_FOR[n][i], color: SEAT_COLORS[SEATS_FOR[n][i]] })),
    bonus: options.bonusRolls === 'generous' ? 'generous' : 'classic',
    lastMove: null,
    rng,
    tokens: playerList.map(() => Array.from({ length: TOKENS }, () => -1)),
    ready: new Set(),
    turn: 0,
    dice: null,
    sixes: 0,
    phase: 'ready', // ready | rolling | moving | gameOver
    finishedOrder: [],
    winner: null,
    log: [],
    seq: 0,
    version: 0,
  };
  return g;
}

function applyAction(g, playerId, action) {
  const who = indexOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Bad action' };

  switch (action.type) {
    case 'ready': {
      if (g.phase !== 'ready') return { ok: false, error: 'The game has already started' };
      g.ready.add(who);
      if (g.ready.size >= g.n) {
        g.phase = 'rolling';
        g.turn = 0;
        emit(g, { type: 'start' });
      }
      bump(g);
      return { ok: true };
    }
    case 'roll': {
      if (g.phase !== 'rolling' || g.turn !== who) return { ok: false, error: 'Not your turn to roll' };
      const d = Math.floor(g.rng() * 6) + 1;
      // A third consecutive six forfeits that roll and ends the turn immediately.
      // Do not let the player move on the third six.
      if (d === 6 && g.sixes === 2) {
        g.log.push({ by: g.players[who].name, card: 'rolled three sixes — turn forfeited', kind: 'miss' });
        g.dice = null;
        g.sixes = 0;
        endTurn(g);
        bump(g);
        return { ok: true };
      }
      g.dice = d;
      g.sixes = d === 6 ? g.sixes + 1 : 0;
      const moves = legalMoves(g, who);
      if (moves.length === 0) {
        g.log.push({ by: g.players[who].name, card: `rolled a ${d} — no legal moves, turn passed`, kind: 'miss' });
        g.dice = null;
        endTurn(g);
      } else {
        g.phase = 'moving';
        g.log.push({ by: g.players[who].name, card: `rolled a ${d}`, kind: 'roll' });
        emit(g, { type: 'rolled', by: who, dice: d });
      }
      bump(g);
      return { ok: true };
    }
    case 'move': {
      if (g.phase !== 'moving' || g.turn !== who) return { ok: false, error: 'Not your turn to move' };
      const token = action.token;
      if (!Number.isInteger(token) || token < 0 || token >= TOKENS) return { ok: false, error: 'Bad token' };
      const np = newPosFor(g, who, g.tokens[who][token], g.dice);
      if (np === null) return { ok: false, error: 'Cannot move that token' };
      const justSix = g.dice === 6;
      const result = applyMove(g, who, token, np);
      g.dice = null;
      if (g.phase === 'gameOver') { bump(g); return { ok: true }; }
      if (g.finishedOrder.includes(who)) {
        // A player who has brought all four tokens home cannot use a bonus six.
        endTurn(g);
      } else if ((justSix && g.sixes > 0 && g.sixes < 3) || (g.bonus === 'generous' && (result.captured || result.home))) {
        // a 6 earns another roll for the same player (and, in the generous variant, so does a capture or getting home)
        g.phase = 'rolling';
      } else {
        endTurn(g);
      }
      bump(g);
      return { ok: true };
    }
    default:
      return { ok: false, error: 'Unknown action' };
  }
}

function awaitingList(g) {
  if (g.phase === 'ready') return g.players.filter((_, i) => !g.ready.has(i)).map((p) => p.id);
  if (g.phase === 'rolling' || g.phase === 'moving') return [g.players[g.turn].id];
  return [];
}

/**
 * Bot strategy: finish a token, then capture, then bring a token out, then move to safety, otherwise advance the token
 * that is furthest along. Squares an opponent could hit next turn count against a move. Deterministic for a given state.
 */
function scoreMove(g, who, move) {
  const { lap, finished, track, safe } = g.geo;
  const from = g.tokens[who][move.token];
  const to = move.to;
  let score = 0;
  if (to === finished) score += 100;
  if (to >= lap && to < finished) score += 25; // into the safe home column
  if (from === -1) score += 40; // bring a token out
  if (to >= 0 && to <= lap - 1) {
    const at = absPos(g, who, to);
    if (!safe.has(at)) {
      let hits = 0;
      for (let i = 0; i < g.n; i++) {
        if (i === who) continue;
        for (let t = 0; t < TOKENS; t++) {
          const tp = g.tokens[i][t];
          if (tp >= 0 && tp <= lap - 1 && absPos(g, i, tp) === at) hits++;
        }
      }
      score += hits * 80; // capture
      // danger: an opponent token 1-6 squares behind could land on us
      let danger = 0;
      for (let i = 0; i < g.n; i++) {
        if (i === who) continue;
        for (let t = 0; t < TOKENS; t++) {
          const tp = g.tokens[i][t];
          if (tp < 0 || tp > lap - 1) continue;
          const gap = (at - absPos(g, i, tp) + track) % track;
          if (gap >= 1 && gap <= 6) danger++;
        }
      }
      score -= danger * 12;
    } else score += 15; // safe square
    if (from >= 0 && from <= lap - 1 && !safe.has(absPos(g, who, from))) {
      // leaving a square that was under threat is good
      for (let i = 0; i < g.n; i++) {
        if (i === who) continue;
        for (let t = 0; t < TOKENS; t++) {
          const tp = g.tokens[i][t];
          if (tp < 0 || tp > lap - 1) continue;
          const gap = (absPos(g, who, from) - absPos(g, i, tp) + track) % track;
          if (gap >= 1 && gap <= 6) score += 10;
        }
      }
    }
  }
  return score + to / 10; // prefer the token that is furthest along
}

function botAction(g, playerId) {
  const who = indexOf(g, playerId);
  if (g.phase === 'ready') return { type: 'ready' };
  if (g.phase === 'rolling') return { type: 'roll' };
  if (g.phase === 'moving') {
    const moves = legalMoves(g, who);
    if (moves.length) {
      let best = moves[0];
      let bestScore = -Infinity;
      for (const m of moves) { const sc = scoreMove(g, who, m); if (sc > bestScore) { best = m; bestScore = sc; } }
      return { type: 'move', token: best.token };
    }
  }
  return null;
}

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const over = g.phase === 'gameOver';
  const myTokens = me >= 0 ? g.tokens[me].slice() : [];
  return {
    game: 'ludo',
    me,
    n: g.n,
    players: g.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      seat: p.seat,
      ready: g.ready.has(i),
      tokens: g.tokens[i].slice(),
      finished: g.tokens[i].every((x) => x === g.geo.finished),
    })),
    turn: g.turn,
    phase: g.phase,
    board: g.n >= 5 ? BOARD.boardView() : null, // the six-arm board for 5-6 players, drawn from this
    dice: g.dice,
    sixes: g.sixes,
    hand: myTokens, // for the shared card/hand UI conventions
    myTurn: !over && me >= 0 && g.turn === me,
    canRoll: !over && me >= 0 && g.phase === 'rolling' && g.turn === me,
    canMove: !over && me >= 0 && g.phase === 'moving' && g.turn === me,
    autoPlay: !over && me >= 0 && g.turn === me && forcedPlay(g) !== null, // the only possible move is played for you
    legalTokens: !over && me >= 0 && g.phase === 'moving' && g.turn === me
      ? legalMoves(g, me).map((move) => move.token)
      : [],
    winner: g.winner,
    finishedOrder: g.finishedOrder.slice(),
    event: g.event,
    lastMove: g.lastMove,
    bonus: g.bonus,
    log: g.log ? g.log.slice(-30) : [],
  };
}

module.exports = {
  TOKENS, TRACK, LAP, HOME_COL, FINISHED, STARTS, SAFE, COLORS, SEAT_COLORS, SEATS_FOR, GEOMETRY, geometryFor, absPos,
  createGame, applyAction, awaitingList, botAction, viewFor, newPosFor, legalMoves, forcedPlay,
};
