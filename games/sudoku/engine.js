'use strict';
/**
 * Sudoku rules (pure). Everybody gets the same puzzle and fills in their own grid. A wrong number shows red at once and costs
 * one of three lives; the third mistake takes you out (in a race you watch the others; alone the game is over). Each player
 * can undo their last move, three times in the game. The first grid completed with every number right wins. Other people's
 * grids are never sent: a view shows only each player's count of right squares. Bots never make mistakes and fill squares at
 * a pace set by the options; the server asks awaiting() and botDelayMs() for their turns.
 */
const { makePuzzle } = require('./puzzle');

/** A bot's time for each square it fills (before its own speed and a little randomness). */
const PACE_MS = { slow: 4000, normal: 2600, quick: 1600 };
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const LIVES = 3;   // wrong numbers before a player is out
const UNDOS = 3;   // undos per player in a game; each one takes back that player's last move only

const fail = (error) => ({ ok: false, error });

/** Squares this player has filled with the right number (clues are not counted). */
function rightOf(g, i) {
  let n = 0;
  for (let k = 0; k < 81; k++) if (!g.puzzle[k] && g.boards[i][k] === g.solution[k]) n++;
  return n;
}

function emptyCount(g) {
  return g.puzzle.reduce((n, v) => n + (v ? 0 : 1), 0);
}

/** The time a bot waits before its next square. */
function botGap(g, i) {
  return PACE_MS[g.options.pace] * g.skill[i] * (0.75 + g.rng() * 0.5);
}

/** Ends the game with nobody winning: the last player is out (alone) or everyone is out. */
function lose(g) {
  g.phase = 'gameOver';
  g.winner = -1;
  g.event = { type: 'over', winner: -1, lost: true, seq: ++g.seq };
}

function createGame(players, options, rng, now = Date.now) {
  if (players.length < 1 || players.length > 8) throw new Error('Sudoku needs 1 to 8 players');
  const difficulty = DIFFICULTIES.includes(options.difficulty) ? options.difficulty : 'medium';
  const pace = PACE_MS[options.pace] ? options.pace : 'normal';
  const { puzzle, solution } = makePuzzle(rng, difficulty);
  const startedAt = now();
  const g = {
    players: players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot })),
    options: { difficulty, pace },
    puzzle, solution, now, rng,
    solo: players.length === 1,
    boards: players.map(() => new Array(81).fill(0)),
    mistakes: players.map(() => 0),
    out: players.map(() => false),
    undos: players.map(() => UNDOS),
    last: players.map(() => null), // { k, prev }: the square and its number before the last move
    skill: players.map(() => 0.85 + rng() * 0.3), // some bots are a little faster than others
    due: players.map(() => 0), // when each bot next fills a square
    startedAt, phase: 'playing', winner: -1, event: null, seq: 0,
  };
  g.players.forEach((p, i) => { if (p.bot) g.due[i] = startedAt + botGap(g, i); });
  return g;
}

function applyAction(g, playerId, action) {
  if (g.phase !== 'playing') return fail('The game is over.');
  const i = g.players.findIndex((p) => p.id === playerId);
  if (i < 0) return fail('You are not playing.');
  if (!action || typeof action !== 'object') return fail('Invalid action');
  if (g.out[i]) return fail('You are out of lives.');
  if (action.type === 'undo') {
    if (g.undos[i] <= 0) return fail('No undos left.');
    if (!g.last[i]) return fail('Only your last move can be undone.');
    g.boards[i][g.last[i].k] = g.last[i].prev;
    g.undos[i]--;
    g.last[i] = null;
    return { ok: true };
  }
  const r = Number.isInteger(action.r) ? action.r : -1;
  const c = Number.isInteger(action.c) ? action.c : -1;
  if (r < 0 || r > 8 || c < 0 || c > 8) return fail('That square is not on the grid.');
  const k = r * 9 + c;
  if (g.puzzle[k]) return fail('That number is part of the puzzle.');
  const board = g.boards[i];
  if (board[k] === g.solution[k]) return fail('That square is already filled in.');
  const prev = board[k];
  if (action.type === 'erase') {
    board[k] = 0;
  } else if (action.type === 'place') {
    if (!Number.isInteger(action.v) || action.v < 1 || action.v > 9) return fail('Choose a number from 1 to 9.');
    board[k] = action.v;
    if (action.v !== g.solution[k]) {
      g.mistakes[i]++;
      if (g.mistakes[i] >= LIVES) g.out[i] = true;
    }
  } else {
    return fail('Invalid action');
  }
  g.last[i] = { k, prev };
  if (g.players[i].bot) g.due[i] = g.now() + botGap(g, i);
  if (g.out[i]) {
    if (g.solo || g.out.every(Boolean)) lose(g);
  } else if (rightOf(g, i) === emptyCount(g)) {
    g.phase = 'gameOver';
    g.winner = i;
    const seconds = Math.max(1, Math.round((g.now() - g.startedAt) / 1000));
    g.event = { type: 'over', winner: i, seconds, seq: ++g.seq };
  }
  return { ok: true };
}

/** Everybody still filling in and not out, while the game runs. The server only sets a timer for bots (and for a seat whose
 * person has left), so a connected person is never played for; they fill squares when they like. */
function awaiting(g) {
  if (g.phase !== 'playing') return [];
  const empties = emptyCount(g);
  return g.players.filter((_, i) => !g.out[i] && rightOf(g, i) < empties).map((p) => p.id);
}

function botDelayMs(g, playerId) {
  const i = g.players.findIndex((p) => p.id === playerId);
  return i < 0 ? 0 : Math.max(0, g.due[i] - g.now());
}

/** The next square a bot fills in, with the right number. Null when there is nothing left to fill. */
function botAction(g, playerId) {
  const i = g.players.findIndex((p) => p.id === playerId);
  if (i < 0 || g.phase !== 'playing') return null;
  const k = g.boards[i].findIndex((v, idx) => !g.puzzle[idx] && v !== g.solution[idx]);
  if (k < 0) return null;
  return { type: 'place', r: Math.floor(k / 9), c: k % 9, v: g.solution[k] };
}

/** What one player may see. Their own board, lives and undos in full; everybody else's only as a count of right squares and lives. */
function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const empties = emptyCount(g);
  const wrong = [];
  if (me >= 0) {
    for (let k = 0; k < 81; k++) if (!g.puzzle[k] && g.boards[me][k] && g.boards[me][k] !== g.solution[k]) wrong.push(k);
  }
  const canUndo = me >= 0 && g.phase === 'playing' && !g.out[me] && g.undos[me] > 0 && !!g.last[me];
  return {
    me,
    phase: g.phase,
    options: { ...g.options },
    solo: g.solo,
    puzzle: g.puzzle.slice(),
    empties,
    board: me >= 0 ? g.boards[me].slice() : null,
    wrong,
    mistakes: me >= 0 ? g.mistakes[me] : 0,
    lives: me >= 0 ? Math.max(0, LIVES - g.mistakes[me]) : null,
    undos: me >= 0 ? g.undos[me] : 0,
    canUndo,
    out: me >= 0 ? g.out[me] : false,
    maxLives: LIVES,
    players: g.players.map((p, i) => ({
      id: p.id, name: p.name, bot: p.bot, right: rightOf(g, i), total: empties, done: g.winner === i,
      out: g.out[i], lives: Math.max(0, LIVES - g.mistakes[i]),
    })),
    winner: g.winner,
    // the answer is shown only when the game is over, so nobody can read it from a running game
    solution: g.phase === 'gameOver' ? g.solution.slice() : null,
    event: g.event ? { ...g.event } : null,
  };
}

function results(g) {
  return g.players.map((_, i) => ({ score: g.winner === i && g.event ? g.event.seconds : 0, winner: g.winner === i }));
}

module.exports = { PACE_MS, DIFFICULTIES, LIVES, UNDOS, createGame, applyAction, awaiting, botDelayMs, botAction, viewFor, results, rightOf };
