'use strict';
/**
 * Line games: Tic-Tac-Toe and Four in a Row (with a Five in a Row option) on one engine (rules only, no sockets, no timers).
 * Two players take turns putting a piece on a rows x cols grid; the first to get `win` in a straight line (across, down
 * or diagonal) wins, and a full board is a draw. With `gravity` a piece is dropped into a column and falls to the lowest
 * free cell (Four in a Row); otherwise it goes on any free cell.
 *
 * The board is a flat array of length rows*cols (row-major, row 0 on top); each cell is null or the seat (0 or 1).
 * Option `starter`: 'random' (default), 'host' (seat 0) or 'guest' (seat 1) decides who moves first.
 * Option `line` (Four in a Row only): '4' (default, 7x6 grid) or '5' (connect five on a bigger 9x8 grid).
 */
const VARIANTS = {
  tictactoe: { id: 'tictactoe', name: 'Tic-Tac-Toe', rows: 3, cols: 3, win: 3, gravity: false },
  fourinarow: { id: 'fourinarow', name: 'Four in a Row', rows: 6, cols: 7, win: 4, gravity: true },
};
/** Four in a Row with `line: '5'` becomes Five in a Row on a bigger grid. */
const LINE5 = { name: 'Five in a Row', rows: 8, cols: 9, win: 5 };
const variantFor = (id, options) => {
  const v = VARIANTS[id];
  return v && id === 'fourinarow' && options && String(options.line) === '5' ? { ...v, ...LINE5 } : v;
};
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind = 'info') => { g.log.push({ by: g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };

function createGame(variantId, players, options = {}, rng = Math.random) {
  const v = variantFor(variantId, options);
  if (!v) throw new Error('Unknown line game');
  if (players.length !== 2) throw new Error(`${v.name} is for exactly 2 players`);
  const starter = ['host', 'guest'].includes(options && options.starter) ? options.starter : 'random';
  const first = starter === 'host' ? 0 : starter === 'guest' ? 1 : (rng() < 0.5 ? 0 : 1);
  return {
    game: v.id, v, n: 2, rng,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    options: { starter, line: String(v.win) },
    board: Array(v.rows * v.cols).fill(null),
    turn: first, first, moves: 0,
    phase: 'playing', // playing | gameOver
    winner: null, // seat, or null for a draw / while playing
    line: [], last: null, event: null, log: [], seq: 0, version: 0,
  };
}

/** The lowest free cell in a column, or -1 when it is full (or the column does not exist). */
function dropCell(g, col) {
  if (!Number.isInteger(col) || col < 0 || col >= g.v.cols) return -1;
  for (let r = g.v.rows - 1; r >= 0; r--) if (g.board[r * g.v.cols + col] === null) return r * g.v.cols + col;
  return -1;
}

/** The winning cells (at least `win` in a line through `cell`) for the piece on `cell`, or []. */
function lineThrough(board, v, cell) {
  const me = board[cell];
  if (me === null) return [];
  const r0 = Math.floor(cell / v.cols), c0 = cell % v.cols;
  for (const [dr, dc] of DIRS) {
    const run = [cell];
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < v.rows && c >= 0 && c < v.cols && board[r * v.cols + c] === me) { run.push(r * v.cols + c); r += dr * s; c += dc * s; }
    }
    if (run.length >= v.win) return run.sort((a, b) => a - b);
  }
  return [];
}

function legalCells(g) {
  if (g.v.gravity) { const out = []; for (let c = 0; c < g.v.cols; c++) { const k = dropCell(g, c); if (k >= 0) out.push(k); } return out; }
  const out = []; for (let k = 0; k < g.board.length; k++) if (g.board[k] === null) out.push(k); return out;
}

function applyAction(g, playerId, action) {
  const who = indexOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (g.turn !== who) return { ok: false, error: 'Not your turn' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Unknown action' };
  let cell;
  if (g.v.gravity) {
    if (action.type !== 'drop') return { ok: false, error: 'Unknown action' };
    cell = dropCell(g, action.col);
    if (cell < 0) return { ok: false, error: 'That column is full' };
  } else {
    if (action.type !== 'place') return { ok: false, error: 'Unknown action' };
    cell = action.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell >= g.board.length) return { ok: false, error: 'No such square' };
    if (g.board[cell] !== null) return { ok: false, error: 'That square is taken' };
  }
  g.board[cell] = who; g.moves++; g.last = cell;
  g.line = lineThrough(g.board, g.v, cell);
  if (g.line.length) {
    g.phase = 'gameOver'; g.winner = who;
    emit(g, { type: 'win', by: who, cell }); say(g, who, `made ${g.v.win} in a row`, 'win');
  } else if (g.moves === g.board.length) {
    g.phase = 'gameOver'; g.winner = null;
    emit(g, { type: 'draw', by: who, cell }); say(g, who, 'filled the board: a draw', 'draw');
  } else {
    g.turn = 1 - who;
    emit(g, { type: 'move', by: who, cell });
  }
  g.version++;
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);

// ------------------------------------------------------------------------------------------------ bots (public information only)

/** Heuristic value of a cell for `me`: own and opposing lines through it, weighted by how many pieces they already hold. */
function cellScore(board, v, cell, me) {
  const r0 = Math.floor(cell / v.cols), c0 = cell % v.cols;
  let total = 0;
  for (const [dr, dc] of DIRS) {
    for (const who of [me, 1 - me]) {
      let count = 0, open = 0;
      for (const s of [1, -1]) {
        let r = r0 + dr * s, c = c0 + dc * s;
        while (r >= 0 && r < v.rows && c >= 0 && c < v.cols && board[r * v.cols + c] === who) { count++; r += dr * s; c += dc * s; }
        if (r >= 0 && r < v.rows && c >= 0 && c < v.cols && board[r * v.cols + c] === null) open++;
      }
      if (count + 1 >= v.win) total += who === me ? 100000 : 50000;
      else if (open) total += (who === me ? 1.2 : 1) * Math.pow(10, count) * (open === 2 ? 2 : 1);
    }
  }
  const centre = Math.abs(r0 - (v.rows - 1) / 2) + Math.abs(c0 - (v.cols - 1) / 2);
  return total - centre * 0.01;
}

/** Negamax with alpha-beta. Scores are from the point of view of `me` (the player to move). */
function search(board, v, me, depth, alpha, beta, count) {
  const moves = [];
  if (v.gravity) { for (let c = 0; c < v.cols; c++) for (let r = v.rows - 1; r >= 0; r--) if (board[r * v.cols + c] === null) { moves.push(r * v.cols + c); break; } }
  else for (let k = 0; k < board.length; k++) if (board[k] === null) moves.push(k);
  if (!moves.length) return 0;
  moves.sort((a, b) => Math.abs((a % v.cols) - (v.cols - 1) / 2) - Math.abs((b % v.cols) - (v.cols - 1) / 2));
  let best = -Infinity;
  for (const k of moves) {
    board[k] = me;
    let score;
    if (lineThrough(board, v, k).length) score = 1000 + depth;
    else if (depth <= 1) score = 0;
    else score = -search(board, v, 1 - me, depth - 1, -beta, -alpha, count);
    board[k] = null;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function botAction(g, playerId) {
  const me = indexOf(g, playerId);
  if (me < 0 || g.phase === 'gameOver' || g.turn !== me) return null;
  const cells = legalCells(g);
  const act = (k) => (g.v.gravity ? { type: 'drop', col: k % g.v.cols } : { type: 'place', cell: k });
  const board = g.board.slice();
  // 1. win now, 2. block their win
  for (const who of [me, 1 - me]) for (const k of cells) { board[k] = who; const hit = lineThrough(board, g.v, k).length; board[k] = null; if (hit) return act(k); }
  // 3. look ahead (tic-tac-toe to the end, Four/Five in a Row five plies), ties broken by the pattern score
  const depth = g.v.id === 'tictactoe' ? 9 : 5;
  let best = -Infinity, pick = [];
  for (const k of cells) {
    board[k] = me;
    const s = -search(board, g.v, 1 - me, depth - 1, -Infinity, Infinity, 0) + cellScore(g.board, g.v, k, me) * 0.0001;
    board[k] = null;
    if (s > best + 1e-9) { best = s; pick = [k]; } else if (Math.abs(s - best) <= 1e-9) pick.push(k);
  }
  return act(pick[Math.floor(g.rng() * pick.length)]);
}

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const myTurn = g.phase !== 'gameOver' && me >= 0 && g.turn === me;
  return {
    game: g.v.id, me, n: 2, name: g.v.name,
    rows: g.v.rows, cols: g.v.cols, win: g.v.win, gravity: g.v.gravity,
    players: g.players.map((p) => ({ id: p.id, name: p.name })),
    board: g.board.slice(), turn: g.turn, first: g.first, moves: g.moves, phase: g.phase,
    winner: g.winner, draw: g.phase === 'gameOver' && g.winner === null, line: g.line.slice(), last: g.last,
    myTurn,
    // the cells a move can go to (for gravity games, the landing cell of each open column)
    legal: myTurn ? legalCells(g) : [],
    event: g.event, log: g.log.slice(-30),
  };
}

module.exports = { VARIANTS, variantFor, createGame, applyAction, awaiting, botAction, viewFor, dropCell, lineThrough, legalCells };
