'use strict';
/** Chess: two players, full rules (castling, en passant, promotion, draws). See rules.js and engine.js. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'chess',
  name: 'Chess',
  icon: '♞',
  accent: '#8b5e3c',
  tagline: 'The classic game of two armies. Checkmate the king to win.',
  seats: { min: 2, max: 2, default: 2 },
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  rules: [
    'Two players, White and Black. White moves first. Tap one of your pieces to see where it can go, then tap the square to move it.',
    'Every piece moves as in standard chess. You may castle, take en passant, and promote a pawn that reaches the last rank (you choose the piece).',
    'You may never leave your own king in check. Checkmate wins the game. Stalemate, insufficient material, 50 moves without a capture or pawn move, and threefold repetition are draws.',
    'You can resign at any time.',
  ],
  options: [engine.COLOUR_OPTION, TIME_LIMIT_OPTION],
  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // only the player records hold names: the phase, colours, board and move notation must keep their values
      scrub: (names, to) => scrubDeep([g.players, players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => (g.phase === 'playing' ? [players[engine.turnSeat(g)].id] : []),
      botAction: () => engine.botAction(g),
      botDelayMs: () => 700 + g.rng() * 500,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => g.players.map((_, i) => ({
        score: g.draw ? 0.5 : g.winner === i ? 1 : 0,
        winner: g.winner === i,
        draw: g.draw,
      })),
    };
  },
};
