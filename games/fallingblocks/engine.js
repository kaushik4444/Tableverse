'use strict';
/**
 * Falling Blocks (2 to 4 players), rules only: no sockets, no timers.
 *
 * Everybody builds in their own 10 x 20 well and gets the same piece sequence (seven-bag, from the game's random source).
 * Nobody takes turns: each player places their own piece whenever they like. A move is a drop: choose a rotation and a
 * column, and the piece falls as far as it can. A full row clears. Clearing two, three or four rows at once sends one, two
 * or four garbage rows to every other player still building. A garbage row is full except for one gap. A piece that cannot
 * appear at the top of the well tops the player out, and they are out. The game ends as soon as one player is still
 * building: that player wins. A game is never a draw, so the score (rows cleared) only matters for the results table.
 *
 * Cells are numbered r * W + c. A piece is a list of [row, column] cells with the top-left at (0, 0); `rot` 0..3 turns it a
 * quarter at a time. Bots choose their drop with the usual board scores (rows cleared, height, holes, bumpiness); their
 * turns are paced by the `pace` option, and the server asks awaiting() and botDelayMs() for them.
 */

const W = 10;
const H = 20;
const SPAWN_X = 3;
const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const GARBAGE = { 2: 1, 3: 2, 4: 4 };       // rows cleared at once -> garbage rows sent to each other player
// the time between a bot's drops: long enough to follow every well, so a person can read the table
const PACE_MS = { slow: 4000, normal: 3000, quick: 2000 };
const MAX_PLAYERS = 4;

const BASE = {
  I: [[0, 0], [0, 1], [0, 2], [0, 3]],
  O: [[0, 0], [0, 1], [1, 0], [1, 1]],
  T: [[0, 1], [1, 0], [1, 1], [1, 2]],
  S: [[0, 1], [0, 2], [1, 0], [1, 1]],
  Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
  J: [[0, 0], [1, 0], [1, 1], [1, 2]],
  L: [[0, 2], [1, 0], [1, 1], [1, 2]],
};

const sortCells = (cells) => cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
function normalize(cells) {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return sortCells(cells.map(([r, c]) => [r - minR, c - minC]));
}

/** ROTATIONS[kind][rot] is the cell list turned `rot` quarter turns clockwise. */
const ROTATIONS = Object.fromEntries(KINDS.map((kind) => {
  const turns = [normalize(BASE[kind])];
  for (let k = 1; k < 4; k++) turns.push(normalize(turns[k - 1].map(([r, c]) => [c, -r])));
  return [kind, turns];
}));

const emptyBoard = () => new Array(W * H).fill(null);

/** Whether the piece fits in the well with its top-left at (x, y). */
function fits(board, cells, x, y) {
  return cells.every(([r, c]) => {
    const rr = y + r, cc = x + c;
    return cc >= 0 && cc < W && rr >= 0 && rr < H && board[rr * W + cc] === null;
  });
}

/** The row a piece lands on when dropped in column x, or -1 if it does not fit at the top. */
function landingY(board, cells, x) {
  if (!fits(board, cells, x, 0)) return -1;
  let y = 0;
  while (fits(board, cells, x, y + 1)) y++;
  return y;
}

/** Removes full rows and adds empty ones at the top. Returns how many rows cleared. */
function clearRows(board) {
  const rows = [];
  for (let r = 0; r < H; r++) rows.push(board.slice(r * W, r * W + W));
  const kept = rows.filter((row) => !row.every(Boolean));
  const cleared = H - kept.length;
  const flat = [...Array.from({ length: cleared }, () => new Array(W).fill(null)), ...kept].flat();
  for (let k = 0; k < W * H; k++) board[k] = flat[k];
  return cleared;
}

/** The seven-bag: each bag holds every kind once, shuffled. Every player gets the same sequence. */
function pieceAt(g, n) {
  while (g.pieces.length <= n) {
    const bag = KINDS.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(g.rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    g.pieces.push(...bag);
  }
  return g.pieces[n];
}

const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };

function createGame(players, options = {}, rng = Math.random, now = Date.now) {
  if (players.length < 2 || players.length > MAX_PLAYERS) throw new Error('Falling Blocks is for 2 to 4 players');
  const pace = Object.hasOwn(PACE_MS, options.pace) ? options.pace : 'slow';
  const startedAt = now();
  const g = {
    game: 'fallingblocks',
    players: players.map((p) => ({ id: p.id, name: p.name })),
    options: { pace },
    rng, now,
    pieces: [],                                     // the shared sequence, grown as anybody needs the next piece
    boards: players.map(() => emptyBoard()),
    count: players.map(() => 0),                    // pieces each player has placed
    lines: players.map(() => 0),                    // rows cleared by each player
    out: players.map(() => false),
    skill: players.map(() => 0.85 + rng() * 0.3),   // some bots are a little quicker than others
    due: players.map(() => 0),                      // when each player's next move is due (bots use it)
    startedAt,
    phase: 'playing', // playing | gameOver
    winner: null,
    event: null, seq: 0, version: 0,
  };
  g.due = players.map((_, i) => startedAt + botGap(g, i));
  return g;
}

/** The time a bot takes over its next piece. */
function botGap(g, i) {
  return PACE_MS[g.options.pace] * g.skill[i] * (0.75 + g.rng() * 0.5);
}

const alive = (g) => g.players.map((_, i) => i).filter((i) => !g.out[i]);

/** Ends the game with the one player still building as the winner. */
function finish(g) {
  const still = alive(g);
  g.phase = 'gameOver';
  g.winner = still.length === 1 ? still[0] : null;
  emit(g, { type: 'over', winner: g.winner });
}

/** Tops a player out. The game ends when one player is left building. */
function topOut(g, i) {
  if (g.out[i]) return;
  g.out[i] = true;
  if (alive(g).length <= 1) finish(g);
  else emit(g, { type: 'out', by: i });
}

/** Pushes `rows` garbage rows into player i's well. A block pushed past the top tops the player out. */
function addGarbage(g, i, rows) {
  const board = g.boards[i];
  for (let k = 0; k < rows; k++) {
    if (board.slice(0, W).some(Boolean)) { topOut(g, i); return; }
    board.splice(0, W);
    const gap = Math.floor(g.rng() * W);
    for (let c = 0; c < W; c++) board.push(c === gap ? null : 'G');
  }
}

function applyAction(g, playerId, action) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (g.out[who]) return { ok: false, error: 'You are out of the game' };
  if (!action || typeof action !== 'object' || action.type !== 'drop') return { ok: false, error: 'Unknown action' };
  const { x, rot } = action;
  if (!Number.isInteger(x) || !Number.isInteger(rot) || rot < 0 || rot > 3) return { ok: false, error: 'Invalid drop' };

  const board = g.boards[who];
  const kind = pieceAt(g, g.count[who]);
  const cells = ROTATIONS[kind][rot];
  const y = landingY(board, cells, x);
  if (y < 0) return { ok: false, error: 'That piece does not fit there' };

  for (const [r, c] of cells) board[(y + r) * W + x + c] = kind;
  const cleared = clearRows(board);
  g.lines[who] += cleared;
  g.count[who]++;
  g.version++;
  const sent = GARBAGE[cleared] || 0;

  // the garbage goes first: a player who is hit can be topped out before anyone's next piece appears
  if (sent) g.players.forEach((_, j) => { if (j !== who && !g.out[j]) addGarbage(g, j, sent); });
  if (g.phase === 'gameOver') return { ok: true };

  // the next piece appears at the top; if it cannot, the player is out
  const next = ROTATIONS[pieceAt(g, g.count[who])][0];
  if (!fits(board, next, SPAWN_X, 0)) { topOut(g, who); return { ok: true }; }

  g.due[who] = g.now() + botGap(g, who);
  if (g.phase !== 'gameOver') emit(g, { type: 'lock', by: who, cleared, sent, x, rot });
  return { ok: true };
}

/** Everybody still building is asked for their next piece. */
const awaiting = (g) => (g.phase === 'gameOver' ? [] : alive(g).map((i) => g.players[i].id));

/** The time until a bot's next move. */
function botDelayMs(g, playerId) {
  const i = g.players.findIndex((p) => p.id === playerId);
  return i < 0 ? 0 : Math.max(0, g.due[i] - g.now());
}

/** The board after a drop, scored with the usual measures: rows cleared (good), height, holes and bumpiness (bad). */
function scoreAfter(board, cells, x, y) {
  const b = board.slice();
  for (const [r, c] of cells) b[(y + r) * W + x + c] = 'bot';
  const cleared = clearRows(b);
  const heights = [];
  let holes = 0;
  for (let c = 0; c < W; c++) {
    let top = -1;
    for (let r = 0; r < H; r++) if (b[r * W + c]) { top = r; break; }
    heights.push(top < 0 ? 0 : H - top);
    if (top >= 0) for (let r = top; r < H; r++) if (!b[r * W + c]) holes++;
  }
  const aggregate = heights.reduce((s, h) => s + h, 0);
  const bump = heights.slice(1).reduce((s, h, c) => s + Math.abs(h - heights[c]), 0);
  return cleared * 0.76 - aggregate * 0.51 - holes * 0.36 - bump * 0.18;
}

/** The best drop for the piece the bot is holding. Fits at the top are guaranteed, so there is always one. */
function botAction(g, playerId) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0 || g.phase === 'gameOver' || g.out[who]) return null;
  const board = g.boards[who];
  const kind = pieceAt(g, g.count[who]);
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    const cells = ROTATIONS[kind][rot];
    for (let x = 0; x < W; x++) {
      const y = landingY(board, cells, x);
      if (y < 0) continue;
      const score = scoreAfter(board, cells, x, y);
      if (!best || score > best.score) best = { score, x, rot };
    }
  }
  return best ? { type: 'drop', x: best.x, rot: best.rot } : null;
}

/** What a seat sees: every well (they are public, like the other boards), and the piece in hand for the viewer. */
function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const current = me >= 0 && !g.out[me] && g.phase === 'playing' ? pieceAt(g, g.count[me]) : null;
  return {
    me, phase: g.phase, options: { ...g.options }, W, H, spawnX: SPAWN_X, shapes: ROTATIONS,
    players: g.players.map((p, i) => ({ id: p.id, name: p.name, lines: g.lines[i], out: g.out[i], pieces: g.count[i] })),
    boards: g.boards.map((b) => b.slice()),
    current,
    next: me >= 0 ? [pieceAt(g, g.count[me] + 1), pieceAt(g, g.count[me] + 2)] : [],
    myTurn: current !== null,
    winner: g.winner,
    event: g.event ? { ...g.event } : null,
  };
}

/** Score is the rows cleared; the winner is the one still building when the others have all gone out. */
function results(g) {
  return g.players.map((_, i) => ({ score: g.lines[i], winner: g.winner === i, draw: false }));
}

module.exports = {
  W, H, SPAWN_X, KINDS, GARBAGE, PACE_MS, ROTATIONS,
  createGame, applyAction, awaiting, botAction, botDelayMs, viewFor, results,
  fits, landingY, clearRows,
};
