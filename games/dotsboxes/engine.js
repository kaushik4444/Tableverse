'use strict';
const { slips, pickOne } = require('../botSkill');
/**
 * Dots and Boxes (2 to 4 players), rules only: no sockets, no timers.
 *
 * The board is a grid of n x n boxes, with (n+1) x (n+1) dots. A turn draws one line between two neighbouring dots. A
 * player who completes a box (its fourth side) writes their seat in it and moves again; otherwise the turn passes to the
 * next seat. When every line is drawn, the player with the most boxes wins; a tie for the most is a draw.
 *
 * Lines are numbered 0..L-1. Horizontal line (r, c) joins dots (r,c)-(r,c+1) and touches boxes (r-1,c) and (r,c).
 * Vertical line (r, c) joins dots (r,c)-(r+1,c) and touches boxes (r,c-1) and (r,c). Boxes are numbered r*n + c.
 * Option `size`: '3', '4' (default), '5' or '6' boxes per side.
 */

const SIZES = ['3', '4', '5', '6'];

/** The line table for an n x n board: the lines, and the boxes each line touches. */
function boardFor(n) {
  const lines = [];
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) {
    const boxes = [];
    if (r > 0) boxes.push((r - 1) * n + c);
    if (r < n) boxes.push(r * n + c);
    lines.push({ kind: 'h', r, c, boxes });
  }
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) {
    const boxes = [];
    if (c > 0) boxes.push(r * n + c - 1);
    if (c < n) boxes.push(r * n + c);
    lines.push({ kind: 'v', r, c, boxes });
  }
  return lines;
}

const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind = 'info') => { g.log.push({ by: g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };

function createGame(players, options = {}) {
  if (players.length < 2 || players.length > 4) throw new Error('Dots and Boxes is for 2 to 4 players');
  const size = SIZES.includes(String(options.size)) ? String(options.size) : '4';
  const n = Number(size);
  const lines = boardFor(n);
  return {
    game: 'dotsboxes', n, lines, options: { size },
    players: players.map((p) => ({ id: p.id, name: p.name })),
    drawn: Array(lines.length).fill(false), lineBy: Array(lines.length).fill(null),
    sides: Array(n * n).fill(0), owner: Array(n * n).fill(null), boxes: Array(players.length).fill(0),
    turn: 0, drawnCount: 0,
    phase: 'playing', // playing | gameOver
    winner: null, draw: false,
    last: null, lastBoxes: [], event: null, log: [], seq: 0, version: 0,
  };
}

function applyAction(g, playerId, action) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (g.turn !== who) return { ok: false, error: 'Not your turn' };
  if (!action || typeof action !== 'object' || action.type !== 'line') return { ok: false, error: 'Unknown action' };
  const i = action.index;
  if (!Number.isInteger(i) || i < 0 || i >= g.lines.length) return { ok: false, error: 'No such line' };
  if (g.drawn[i]) return { ok: false, error: 'That line is already drawn' };

  g.drawn[i] = true; g.lineBy[i] = who; g.drawnCount++; g.last = i;
  const completed = [];
  for (const b of g.lines[i].boxes) {
    g.sides[b]++;
    if (g.sides[b] === 4) { g.owner[b] = who; g.boxes[who]++; completed.push(b); }
  }
  g.lastBoxes = completed;
  g.version++;

  if (g.drawnCount === g.lines.length) {
    g.phase = 'gameOver';
    const top = Math.max(...g.boxes);
    const leaders = g.boxes.map((b, s) => (b === top ? s : -1)).filter((s) => s >= 0);
    g.winner = leaders.length === 1 ? leaders[0] : null;
    g.draw = leaders.length > 1;
    emit(g, { type: 'over', by: who, line: i, boxes: completed, winner: g.winner, draw: g.draw });
    say(g, who, g.draw ? 'drew the last line: a draw' : `drew the last line and ${g.winner === who ? 'won' : 'ended'} the game`, g.draw ? 'draw' : 'win');
    return { ok: true };
  }
  if (completed.length) {
    // a completed box keeps the turn; the event tells the table which boxes were taken
    emit(g, { type: 'box', by: who, line: i, boxes: completed });
    say(g, who, `completed ${completed.length === 1 ? 'a box' : `${completed.length} boxes`}`, 'win');
  } else {
    g.turn = (who + 1) % g.players.length;
    emit(g, { type: 'line', by: who, line: i, boxes: [] });
  }
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);

/** Results for the ranking and the skill ladder: score is the number of boxes; the top scorer wins, a tie is a draw. */
function results(g) {
  const top = Math.max(...g.boxes);
  return g.players.map((_, s) => ({
    score: g.boxes[s],
    winner: g.winner === s,
    draw: g.draw && g.boxes[s] === top,
  }));
}

// ------------------------------------------------------------------------------------------------ bots (public information only)

/** The sides a line would give a box: a box that would be left with three sides is the one to avoid. */
function threeSidedAfter(g, i) {
  return g.lines[i].boxes.filter((b) => g.sides[b] === 2).length;
}

/** Take a completed box if there is one; otherwise draw a line that does not leave a box with three sides; otherwise the line that gives away fewest boxes. */
function botAction(g, playerId, rng = Math.random) {
  const open = [];
  for (let i = 0; i < g.lines.length; i++) if (!g.drawn[i]) open.push(i);
  // a slip: the bot draws any open line, so it can miss a box it could have taken
  if (slips(rng)) return { type: 'line', index: pickOne(rng, open) };
  const completing = open.filter((i) => g.lines[i].boxes.some((b) => g.sides[b] === 3));
  if (completing.length) return { type: 'line', index: completing[0] };
  const safe = open.filter((i) => threeSidedAfter(g, i) === 0);
  const pool = safe.length ? safe : open;
  const best = Math.min(...pool.map((i) => threeSidedAfter(g, i)));
  const choices = pool.filter((i) => threeSidedAfter(g, i) === best);
  return { type: 'line', index: choices[Math.floor(rng() * choices.length)] };
}

/** What a player sees: the whole board is public, so every seat sees the same state. */
function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  return {
    me, phase: g.phase, n: g.n, options: { ...g.options },
    players: g.players.map((p, s) => ({ id: p.id, name: p.name, boxes: g.boxes[s] })),
    turn: g.turn, myTurn: me >= 0 && me === g.turn && g.phase === 'playing',
    lines: g.lines.map((l) => ({ kind: l.kind, r: l.r, c: l.c })),
    drawn: g.drawn.slice(), lineBy: g.lineBy.slice(), owner: g.owner.slice(), sides: g.sides.slice(),
    last: g.last, lastBoxes: g.lastBoxes.slice(),
    winner: g.winner, draw: g.draw,
    remaining: g.lines.length - g.drawnCount,
    event: g.event ? { ...g.event } : null,
    log: g.log.slice(-30),
  };
}

module.exports = { SIZES, createGame, applyAction, awaiting, botAction, viewFor, results, boardFor };
