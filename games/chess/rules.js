'use strict';
/**
 * Chess rules: a pure module (no sockets, no timers). The board is an array of 64 cells, index = rank * 8 + file,
 * rank 0 is the first rank (White's back rank) and file 0 is the a-file. A cell holds a piece letter: uppercase for
 * White (P N B R Q K), lowercase for Black, or null. Colours are 'w' and 'b'.
 *
 * Everything a game needs is here: legal moves (castling, en passant, promotion, no move that leaves the king in check),
 * the end of a game (checkmate, stalemate, the 50-move rule, threefold repetition, dead positions) and move notation.
 * Move generation is checked against the standard perft counts in tests/chess-rules.test.js.
 */

const FILES = 'abcdefgh';
const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const PROMOTIONS = ['Q', 'R', 'B', 'N'];
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

const idx = (r, f) => r * 8 + f;
const rankOf = (i) => Math.floor(i / 8);
const fileOf = (i) => i % 8;
const inside = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
const colorOf = (p) => (p === null ? null : p === p.toUpperCase() ? 'w' : 'b');
const sqName = (i) => FILES[fileOf(i)] + (rankOf(i) + 1);
function parseSq(name) {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return null;
  return idx(Number(name[1]) - 1, FILES.indexOf(name[0]));
}

/** The starting position, or any position from a FEN string (used by the tests). */
function fromFEN(fen) {
  const [place, turn, castling, ep, half, full] = String(fen).trim().split(/\s+/);
  const board = new Array(64).fill(null);
  const rows = place.split('/');
  if (rows.length !== 8) throw new Error('bad FEN');
  rows.forEach((row, k) => {
    const r = 7 - k;
    let f = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) f += Number(ch);
      else { board[idx(r, f)] = ch; f++; }
    }
    if (f !== 8) throw new Error('bad FEN row');
  });
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castle: castling && castling !== '-' ? castling : '',
    ep: ep && ep !== '-' ? parseSq(ep) : null,
    half: Number(half || 0),
    full: Number(full || 1),
  };
}
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const initial = () => fromFEN(START_FEN);

function toFEN(s) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[idx(r, f)];
      if (p === null) empty++;
      else { if (empty) row += empty; empty = 0; row += p; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return [rows.join('/'), s.turn, s.castle || '-', s.ep === null ? '-' : sqName(s.ep), s.half, s.full].join(' ');
}

/** Is the cell (r, f) attacked by any piece of colour `by`? */
function attacked(board, r, f, by) {
  const at = (rr, ff) => (inside(rr, ff) ? board[idx(rr, ff)] : null);
  // a pawn of `by` stands one rank behind the target (from its own point of view), on a neighbouring file
  const pr = by === 'w' ? r - 1 : r + 1;
  if (at(pr, f - 1) === (by === 'w' ? 'P' : 'p') || at(pr, f + 1) === (by === 'w' ? 'P' : 'p')) return true;
  const N = by === 'w' ? 'N' : 'n', K = by === 'w' ? 'K' : 'k';
  for (const [dr, df] of KNIGHT_STEPS) if (at(r + dr, f + df) === N) return true;
  for (const [dr, df] of KING_STEPS) if (at(r + dr, f + df) === K) return true;
  const R = by === 'w' ? 'R' : 'r', B = by === 'w' ? 'B' : 'b', Q = by === 'w' ? 'Q' : 'q';
  for (const [dr, df] of ROOK_DIRS) {
    for (let k = 1; inside(r + dr * k, f + df * k); k++) {
      const p = board[idx(r + dr * k, f + df * k)];
      if (p !== null) { if (p === R || p === Q) return true; break; }
    }
  }
  for (const [dr, df] of BISHOP_DIRS) {
    for (let k = 1; inside(r + dr * k, f + df * k); k++) {
      const p = board[idx(r + dr * k, f + df * k)];
      if (p !== null) { if (p === B || p === Q) return true; break; }
    }
  }
  return false;
}

function kingCell(board, color) {
  const K = color === 'w' ? 'K' : 'k';
  return board.indexOf(K);
}
const inCheck = (s, color = s.turn) => {
  const k = kingCell(s.board, color);
  return k >= 0 && attacked(s.board, rankOf(k), fileOf(k), color === 'w' ? 'b' : 'w');
};

/** Every move the side to move can make, ignoring whether its own king is left in check. */
function pseudoMoves(s) {
  const moves = [];
  const { board, turn } = s;
  const enemy = turn === 'w' ? 'b' : 'w';
  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (p === null || colorOf(p) !== turn) continue;
    const r = rankOf(from), f = fileOf(from), type = p.toUpperCase();
    const push = (to, extra) => moves.push({ from, to, piece: type, captured: board[to] || null, ...extra });
    if (type === 'P') {
      const dir = turn === 'w' ? 1 : -1, startRank = turn === 'w' ? 1 : 6, lastRank = turn === 'w' ? 7 : 0;
      const promoting = (to, extra) => {
        if (rankOf(to) === lastRank) for (const t of PROMOTIONS) push(to, { ...extra, promo: t });
        else push(to, extra);
      };
      if (inside(r + dir, f) && board[idx(r + dir, f)] === null) {
        promoting(idx(r + dir, f), {});
        if (r === startRank && board[idx(r + 2 * dir, f)] === null) push(idx(r + 2 * dir, f), { double: true });
      }
      for (const df of [-1, 1]) {
        if (!inside(r + dir, f + df)) continue;
        const to = idx(r + dir, f + df);
        if (board[to] !== null && colorOf(board[to]) === enemy) promoting(to, {});
        else if (to === s.ep) push(to, { ep: true, captured: turn === 'w' ? 'p' : 'P' });
      }
    } else if (type === 'N') {
      for (const [dr, df] of KNIGHT_STEPS) {
        if (!inside(r + dr, f + df)) continue;
        const to = idx(r + dr, f + df);
        if (board[to] === null || colorOf(board[to]) === enemy) push(to, {});
      }
    } else if (type === 'K') {
      for (const [dr, df] of KING_STEPS) {
        if (!inside(r + dr, f + df)) continue;
        const to = idx(r + dr, f + df);
        if (board[to] === null || colorOf(board[to]) === enemy) push(to, {});
      }
      // castling: the king and rook are unmoved (castle rights), the cells between are empty, and the king is not in check
      // on its own cell or the cell it crosses
      const home = turn === 'w' ? 0 : 7;
      if (from === idx(home, 4) && !attacked(board, home, 4, enemy)) {
        const rights = s.castle;
        const K = turn === 'w' ? 'K' : 'k', Q = turn === 'w' ? 'Q' : 'q';
        if (rights.includes(K) && board[idx(home, 5)] === null && board[idx(home, 6)] === null && board[idx(home, 7)] === (turn === 'w' ? 'R' : 'r') &&
          !attacked(board, home, 5, enemy) && !attacked(board, home, 6, enemy)) {
          push(idx(home, 6), { castle: 'K' });
        }
        if (rights.includes(Q) && board[idx(home, 3)] === null && board[idx(home, 2)] === null && board[idx(home, 1)] === null && board[idx(home, 0)] === (turn === 'w' ? 'R' : 'r') &&
          !attacked(board, home, 3, enemy) && !attacked(board, home, 2, enemy)) {
          push(idx(home, 2), { castle: 'Q' });
        }
      }
    } else {
      const dirs = type === 'R' ? ROOK_DIRS : type === 'B' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, df] of dirs) {
        for (let k = 1; inside(r + dr * k, f + df * k); k++) {
          const to = idx(r + dr * k, f + df * k);
          if (board[to] === null) push(to, {});
          else { if (colorOf(board[to]) === enemy) push(to, {}); break; }
        }
      }
    }
  }
  return moves;
}

/** Apply a move (from pseudoMoves) and return the new position. Does not check legality. */
function apply(s, m) {
  const board = s.board.slice();
  const piece = board[m.from];
  const side = s.turn;
  const home = side === 'w' ? 0 : 7;
  if (m.ep) board[m.to - (side === 'w' ? 8 : -8)] = null;
  board[m.from] = null;
  board[m.to] = m.promo ? (side === 'w' ? m.promo : m.promo.toLowerCase()) : piece;
  if (m.castle) {
    const rookFrom = idx(home, m.castle === 'K' ? 7 : 0), rookTo = idx(home, m.castle === 'K' ? 5 : 3);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  // castle rights go when the king moves, or when a rook leaves or is taken on its home corner
  let castle = s.castle;
  const drop = (cells) => { for (const [sq, letters] of cells) if (m.from === sq || m.to === sq) castle = castle.split('').filter((c) => !letters.includes(c)).join(''); };
  drop([[idx(0, 4), 'KQ'], [idx(7, 4), 'kq'], [idx(0, 0), 'Q'], [idx(0, 7), 'K'], [idx(7, 0), 'q'], [idx(7, 7), 'k']]);
  const pawnMove = piece.toUpperCase() === 'P';
  const capture = m.captured !== null && m.captured !== undefined;
  return {
    board,
    turn: side === 'w' ? 'b' : 'w',
    castle,
    ep: m.double ? (m.from + m.to) / 2 : null,
    half: pawnMove || capture ? 0 : s.half + 1,
    full: side === 'b' ? s.full + 1 : s.full,
  };
}

/** Legal moves for the side to move. */
function legalMoves(s) {
  return pseudoMoves(s).filter((m) => !inCheck(apply(s, m), s.turn));
}

/** Position key for repetition: placement, side, castle rights and an en-passant square only when it can be used. */
function keyOf(s) {
  let ep = '-';
  if (s.ep !== null) {
    const canTake = pseudoMoves(s).some((m) => m.ep);
    if (canTake) ep = sqName(s.ep);
  }
  return `${s.board.map((p) => p || '.').join('')} ${s.turn} ${s.castle || '-'} ${ep}`;
}

function insufficient(s) {
  const pieces = [];
  s.board.forEach((p, i) => { if (p && p.toUpperCase() !== 'K') pieces.push({ t: p.toUpperCase(), i }); });
  if (pieces.length === 0) return true;
  if (pieces.every((p) => p.t === 'N' || p.t === 'B') && pieces.length === 1) return true;
  if (pieces.every((p) => p.t === 'B')) {
    const shade = (i) => (rankOf(i) + fileOf(i)) % 2;
    return pieces.every((p) => shade(p.i) === shade(pieces[0].i));
  }
  return false;
}

/**
 * The state of a game: 'playing', or 'over' with the reason and the winning colour (null for a draw).
 * `repeats` is how many times the current position has now occurred (the caller counts positions).
 */
function status(s, repeats = 1) {
  const moves = legalMoves(s);
  if (moves.length === 0) {
    if (inCheck(s)) return { over: true, reason: 'checkmate', winner: s.turn === 'w' ? 'b' : 'w' };
    return { over: true, reason: 'stalemate', winner: null };
  }
  if (insufficient(s)) return { over: true, reason: 'insufficient material', winner: null };
  if (s.half >= 100) return { over: true, reason: 'fifty-move rule', winner: null };
  if (repeats >= 3) return { over: true, reason: 'threefold repetition', winner: null };
  return { over: false, reason: null, winner: null };
}

/** Standard algebraic notation for a legal move in state s, with disambiguation, captures, promotion and check. */
function san(s, m, legal = legalMoves(s)) {
  if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
  let out;
  if (m.piece === 'P') {
    out = m.captured ? FILES[fileOf(m.from)] + 'x' + sqName(m.to) : sqName(m.to);
    if (m.promo) out += '=' + m.promo;
  } else {
    const same = legal.filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
    let dis = '';
    if (same.length) {
      const sameFile = same.some((x) => fileOf(x.from) === fileOf(m.from));
      const sameRank = same.some((x) => rankOf(x.from) === rankOf(m.from));
      if (!sameFile) dis = FILES[fileOf(m.from)];
      else if (!sameRank) dis = String(rankOf(m.from) + 1);
      else dis = sqName(m.from);
    }
    out = m.piece + dis + (m.captured ? 'x' : '') + sqName(m.to);
  }
  const after = apply(s, m);
  if (inCheck(after)) out += legalMoves(after).length === 0 ? '#' : '+';
  return out;
}

module.exports = {
  FILES, VALUE, START_FEN, PROMOTIONS,
  idx, rankOf, fileOf, sqName, parseSq, colorOf,
  fromFEN, toFEN, initial,
  inCheck, kingCell, attacked,
  pseudoMoves, legalMoves, apply, keyOf, insufficient, status, san,
};
