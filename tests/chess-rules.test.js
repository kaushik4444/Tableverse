'use strict';
// Chess rules: perft move counts (standard reference positions), FEN, castling, en passant, promotion, draws, notation.
require('./helpers/env');
const assert = require('node:assert/strict');
const R = require('../games/chess/rules');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';

function perft(s, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of R.legalMoves(s)) n += perft(R.apply(s, m), depth - 1);
  return n;
}
const find = (s, from, to, promo) => R.legalMoves(s).find((m) => m.from === R.parseSq(from) && m.to === R.parseSq(to) && (m.promo || null) === (promo || null));

test('perft: start position depths 1-3 (20, 400, 8902)', () => {
  const s = R.initial();
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
});

test('perft: Kiwipete depths 1-3 (castling, en passant, promotions in the tree)', () => {
  const s = R.fromFEN(KIWIPETE);
  assert.equal(perft(s, 1), 48);
  assert.equal(perft(s, 2), 2039);
  assert.equal(perft(s, 3), 97862);
});

test('perft: position 3 depths 1-3 (en passant and pins)', () => {
  const s = R.fromFEN(POS3);
  assert.equal(perft(s, 1), 14);
  assert.equal(perft(s, 2), 191);
  assert.equal(perft(s, 3), 2812);
});

test('FEN round-trips the start position and Kiwipete', () => {
  assert.equal(R.toFEN(R.fromFEN(R.START_FEN)), R.START_FEN);
  assert.equal(R.toFEN(R.fromFEN(KIWIPETE)), KIWIPETE);
});

test('FEN rejects a malformed board', () => {
  assert.throws(() => R.fromFEN('8/8/8 w - - 0 1'));
});

test('square names convert both ways', () => {
  assert.equal(R.sqName(R.parseSq('e4')), 'e4');
  assert.equal(R.parseSq('i9'), null);
  assert.equal(R.parseSq('a0'), null);
});

test('castling: king-side and queen-side moves are generated and flagged', () => {
  const s = R.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const ks = find(s, 'e1', 'g1');
  const qs = find(s, 'e1', 'c1');
  assert.ok(ks && ks.castle === 'K');
  assert.ok(qs && qs.castle === 'Q');
  const after = R.apply(s, ks);
  assert.equal(after.board[R.parseSq('f1')], 'R');
  assert.equal(after.board[R.parseSq('h1')], null);
});

test('castling is not allowed through an attacked square or out of check', () => {
  // Black rook on f8 attacks f1, so the king may not pass through f1.
  const through = R.fromFEN('5r2/8/8/8/8/8/8/R3K2R w K - 0 1');
  assert.equal(find(through, 'e1', 'g1'), undefined);
  // White king in check from a rook on e8: no castling at all.
  const check = R.fromFEN('4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  assert.equal(find(check, 'e1', 'g1'), undefined);
});

test('en passant captures the pawn that just advanced two squares', () => {
  const s = R.fromFEN('k7/8/8/3pP3/8/8/8/K7 w - d6 0 1');
  const ep = find(s, 'e5', 'd6');
  assert.ok(ep, 'en passant move exists');
  const after = R.apply(s, ep);
  assert.equal(after.board[R.parseSq('d5')], null, 'captured pawn removed');
  assert.equal(after.board[R.parseSq('d6')], 'P');
});

test('promotion offers Q, R, B and N and applies the choice', () => {
  const s = R.fromFEN('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
  const promos = R.legalMoves(s).filter((m) => m.from === R.parseSq('e7') && m.to === R.parseSq('e8')).map((m) => m.promo).sort();
  assert.deepEqual(promos, ['B', 'N', 'Q', 'R']);
  const after = R.apply(s, find(s, 'e7', 'e8', 'N'));
  assert.equal(after.board[R.parseSq('e8')], 'N');
});

test('checkmate: fool’s mate is recognised and is a win for Black', () => {
  let s = R.initial();
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) s = R.apply(s, find(s, f, t));
  const st = R.status(s, 1);
  assert.deepEqual(st, { over: true, reason: 'checkmate', winner: 'b' });
});

test('stalemate is a draw, not a loss', () => {
  const s = R.fromFEN('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
  assert.equal(R.inCheck(s), false);
  assert.deepEqual(R.status(s, 1), { over: true, reason: 'stalemate', winner: null });
});

test('insufficient material: lone kings and a single minor piece', () => {
  assert.equal(R.insufficient(R.fromFEN('k7/8/8/8/8/8/8/K7 w - - 0 1')), true);
  assert.equal(R.insufficient(R.fromFEN('k7/8/8/8/8/8/8/KN6 w - - 0 1')), true);
  assert.equal(R.insufficient(R.fromFEN('k7/8/8/8/8/8/8/KB6 w - - 0 1')), true);
  assert.equal(R.insufficient(R.fromFEN('k7/8/8/8/8/8/8/KR6 w - - 0 1')), false);
});

test('fifty-move rule ends the game as a draw', () => {
  const s = R.fromFEN('k7/8/8/8/8/8/8/K6R w - - 100 80');
  assert.deepEqual(R.status(s, 1), { over: true, reason: 'fifty-move rule', winner: null });
});

test('threefold repetition is a draw when the caller reports three occurrences', () => {
  const s = R.initial();
  assert.equal(R.status(s, 2).over, false);
  assert.deepEqual(R.status(s, 3), { over: true, reason: 'threefold repetition', winner: null });
});

test('notation: pawn push, knight move, capture, check, castling and mate suffixes', () => {
  const s = R.initial();
  const e4 = find(s, 'e2', 'e4');
  assert.equal(R.san(s, e4), 'e4');
  const nf3 = find(s, 'g1', 'f3');
  assert.equal(R.san(s, nf3), 'Nf3');
  const cap = R.fromFEN('k7/8/8/3p4/4P3/8/8/K7 w - - 0 1');
  assert.equal(R.san(cap, find(cap, 'e4', 'd5')), 'exd5');
  const mate = R.fromFEN('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  assert.equal(R.san(mate, find(mate, 'a1', 'a8')), 'Ra8#');
  const castle = R.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(R.san(castle, find(castle, 'e1', 'g1')), 'O-O');
});

test('repetition key: an en-passant square is kept only when a legal en-passant capture exists', () => {
  // e5xd6 would expose the White king to the e8 rook, so it is illegal and d6 must not change the key
  const pinned = R.fromFEN('k3r1n1/8/8/3pP3/8/8/8/4K1N1 w - d6 0 1');
  const noEp = R.fromFEN('k3r1n1/8/8/3pP3/8/8/8/4K1N1 w - - 0 1');
  assert.equal(R.legalMoves(pinned).filter((m) => m.ep).length, 0);
  assert.equal(R.keyOf(pinned), R.keyOf(noEp));
  // with the king off the rook's file the capture is legal, so the square is part of the key
  const free = R.fromFEN('k7/8/8/3pP3/8/8/8/K7 w - d6 0 1');
  const freeNoEp = R.fromFEN('k7/8/8/3pP3/8/8/8/K7 w - - 0 1');
  assert.equal(R.legalMoves(free).filter((m) => m.ep).length, 1);
  assert.notEqual(R.keyOf(free), R.keyOf(freeNoEp));
});

test('castling notation carries the check suffix', () => {
  const checking = R.fromFEN('5k2/8/8/8/8/8/8/4K2R w K - 0 1');
  const castle = R.legalMoves(checking).find((m) => m.castle === 'K');
  assert.equal(R.inCheck(R.apply(checking, castle), 'b'), true);
  assert.equal(R.san(checking, castle), 'O-O+', 'the rook on f1 gives check');
  // a non-checking castle keeps the plain notation
  const quiet = R.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(R.san(quiet, R.legalMoves(quiet).find((m) => m.castle === 'K')), 'O-O');
  assert.equal(R.san(quiet, R.legalMoves(quiet).find((m) => m.castle === 'Q')), 'O-O-O');
});

console.log(`\n${passed} chess rules tests passed`);
