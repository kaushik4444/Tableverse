'use strict';
// Ludo — pure rules engine (no I/O, no timers).
// 2-4 players, 4 tokens each. Roll a 6 to bring a token out; move around the board,
// send opponents home by landing on them (not on safe squares), then race up your
// home column by exact count. First to get all 4 tokens home wins.

const TOKENS = 4;
const TRACK = 52; // squares around the board
const HOME_COL = 6; // squares in each home column
const FINISHED = 58; // internal position: token is home
const STARTS = [0, 13, 26, 39]; // each player's entry square on the track
// Safe squares on the track (0-indexed): the four starts plus four safe spots.
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const COLORS = ['🔴', '🟡', '🟢', '🔵'];

function indexOf(g, id) { return g.players.findIndex((p) => p.id === id); }
function bump(g) { g.version++; }
function emit(g, ev) { g.seq++; g.event = Object.assign({ seq: g.seq }, ev); }

function absPos(playerIdx, p) {
  // absolute board square (0-51) for a token at internal track position p
  return (STARTS[playerIdx] + p) % TRACK;
}

function newPosFor(g, playerIdx, p, dice) {
  // internal position after moving a token at `p` by `dice`, or null if illegal
  const start = STARTS[playerIdx];
  if (p === -1) {
    // in home: only a 6 brings a token out to the start square
    return dice === 6 ? 0 : null;
  }
  if (p >= 0 && p <= TRACK - 1) {
    const np = p + dice;
    if (np <= TRACK - 1) return np;
    const excess = np - TRACK; // passed the start square after a lap
    if (excess < HOME_COL) return TRACK + excess; // into the home column
    if (excess === HOME_COL) return FINISHED; // exactly home
    return null; // overshot the finish: exact count needed
  }
  if (p >= TRACK && p < TRACK + HOME_COL) {
    const np = p + dice;
    if (np < TRACK + HOME_COL) return np; // further up the home column
    if (np === TRACK + HOME_COL) return FINISHED; // exactly home
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

function applyMove(g, playerIdx, tokenIdx, np) {
  const old = g.tokens[playerIdx][tokenIdx];
  g.tokens[playerIdx][tokenIdx] = np;

  // Capture: landing on a non-safe track square occupied by opponent(s) sends them home.
  if (np >= 0 && np <= TRACK - 1 && !SAFE.has(absPos(playerIdx, np))) {
    const at = absPos(playerIdx, np);
    for (let i = 0; i < g.n; i++) {
      if (i === playerIdx) continue;
      for (let t = 0; t < TOKENS; t++) {
        const tp = g.tokens[i][t];
        if (tp >= 0 && tp <= TRACK - 1 && absPos(i, tp) === at) {
          g.tokens[i][t] = -1;
          g.log.push({ by: g.players[playerIdx].name, card: `sent ${g.players[i].name} home`, kind: 'capture' });
        }
      }
    }
  }

  if (np === FINISHED) {
    g.log.push({ by: g.players[playerIdx].name, card: 'got a token home', kind: 'home' });
  }
  emit(g, { type: 'moved', by: playerIdx, token: tokenIdx, from: old, to: np, dice: g.dice });
  if (g.tokens[playerIdx].every((x) => x === FINISHED)) {
    finishPlayer(g, playerIdx);
  }
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
  if (n < 2 || n > 4) throw new Error('Ludo needs 2-4 players');
  const g = {
    game: 'ludo',
    n,
    players: playerList.map((p, i) => ({ id: p.id, name: p.name, color: COLORS[i % COLORS.length] })),
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
      applyMove(g, who, token, np);
      g.dice = null;
      if (g.phase === 'gameOver') { bump(g); return { ok: true }; }
      if (g.finishedOrder.includes(who)) {
        // A player who has brought all four tokens home cannot use a bonus six.
        endTurn(g);
      } else if (justSix && g.sixes > 0 && g.sixes < 3) {
        // a 6 earns another roll for the same player
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

function botAction(g, playerId) {
  const who = indexOf(g, playerId);
  if (g.phase === 'ready') return { type: 'ready' };
  if (g.phase === 'rolling') return { type: 'roll' };
  if (g.phase === 'moving') {
    const moves = legalMoves(g, who);
    if (moves.length) return { type: 'move', token: moves[0].token };
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
      ready: g.ready.has(i),
      tokens: g.tokens[i].slice(),
      finished: g.tokens[i].every((x) => x === FINISHED),
    })),
    turn: g.turn,
    phase: g.phase,
    dice: g.dice,
    sixes: g.sixes,
    hand: myTokens, // for the shared card/hand UI conventions
    myTurn: !over && me >= 0 && g.turn === me,
    canRoll: !over && me >= 0 && g.phase === 'rolling' && g.turn === me,
    canMove: !over && me >= 0 && g.phase === 'moving' && g.turn === me,
    legalTokens: !over && me >= 0 && g.phase === 'moving' && g.turn === me
      ? legalMoves(g, me).map((move) => move.token)
      : [],
    winner: g.winner,
    finishedOrder: g.finishedOrder.slice(),
    event: g.event,
    log: g.log ? g.log.slice(-30) : [],
  };
}

module.exports = {
  TOKENS, TRACK, HOME_COL, FINISHED, STARTS, SAFE, COLORS,
  createGame, applyAction, awaitingList, botAction, viewFor, newPosFor, legalMoves,
};
