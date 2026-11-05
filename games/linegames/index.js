'use strict';
/** Plugins for Tic-Tac-Toe and Four in a Row (which has a Five in a Row option): one engine, two games. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

const LINE = { key: 'line', type: 'select', label: 'Line length', default: '4', choices: [
  { value: '4', label: 'Four in a row', desc: 'Classic: a 7×6 grid, connect four.' },
  { value: '5', label: 'Five in a row', desc: 'A bigger 9×8 grid, connect five.' },
] };
const STARTER = { key: 'starter', type: 'select', label: 'Who starts', default: 'random', choices: [
  { value: 'random', label: 'Random', desc: 'The first move is decided by chance.' },
  { value: 'host', label: 'First seat', desc: 'The first seat always starts.' },
  { value: 'guest', label: 'Second seat', desc: 'The second seat always starts.' },
] };

function make(variantId, meta) {
  const v = engine.VARIANTS[variantId];
  return {
    id: v.id, name: v.name, ...meta, extraOptions: undefined,
    seats: { min: 2, max: 2, default: 2 },
    seatLabel: (i) => (v.gravity ? ['Red', 'Yellow'] : ['X', 'O'])[i],
    stats: { kind: 'none', bestLabel: null, bestOf: null },
    options: [...(meta.extraOptions || []), STARTER, TIME_LIMIT_OPTION],
    create(players, options, rng) {
      const g = engine.createGame(variantId, players, options, rng);
      return {
        view: (playerId) => engine.viewFor(g, playerId),
        scrub: (names, to) => scrubDeep([g, players], names, to),
        act: (playerId, action) => { try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; } },
        awaiting: () => engine.awaiting(g),
        botAction: (playerId) => engine.botAction(g, playerId),
        botDelayMs: () => 600 + g.rng() * 500,
        autoAction: () => null,
        isOver: () => g.phase === 'gameOver',
        // a win scores 1, a draw 0.5 for both, a loss 0
        results: () => g.players.map((_, i) => ({ score: g.winner === null ? 0.5 : g.winner === i ? 1 : 0, winner: g.winner === i })),
      };
    },
  };
}

module.exports = [
  make('tictactoe', {
    icon: '❎', accent: '#6c5ce7',
    tagline: 'Three in a row on a 3×3 grid. Quick, classic, and hard to win against a careful player.',
    rules: [
      'Two players take turns placing their mark on a 3×3 grid.',
      'The first player to get three of their marks in a line, across, down or diagonally, wins.',
      'If the grid fills up with no line, the game is a draw.',
    ],
  }),
  make('fourinarow', {
    icon: '🟡', accent: '#e17055', extraOptions: [LINE],
    tagline: 'Drop discs into the grid and connect four before your opponent does. Or go bigger and connect five.',
    rules: [
      'Two players take turns dropping a disc into one of the columns. The disc falls to the lowest free space.',
      'The first player to connect four of their discs in a line, across, down or diagonally, wins. With “Line length” set to five you play on a bigger 9×8 grid and need five in a row.',
      'If the grid fills up with no line, the game is a draw.',
    ],
  }),
];
