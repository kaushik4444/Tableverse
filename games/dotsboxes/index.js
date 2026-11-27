'use strict';
/** Dots and Boxes: 2 to 4 players draw lines on a dot grid and claim the boxes they close. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

const SIZE = { key: 'size', type: 'select', label: 'Board', default: '4', choices: [
  { value: '3', label: '3 × 3 boxes', desc: 'A small board, quick to finish.' },
  { value: '4', label: '4 × 4 boxes', desc: 'The classic board.' },
  { value: '5', label: '5 × 5 boxes', desc: 'A bigger board with more boxes to fight over.' },
  { value: '6', label: '6 × 6 boxes', desc: 'The biggest board: a long game with many boxes to fight over.' },
] };
const COLOURS = ['Blue', 'Red', 'Green', 'Gold'];

module.exports = {
  id: 'dotsboxes', name: 'Dots and Boxes', icon: '🔲', accent: '#0984e3',
  tagline: 'Draw lines between the dots and close boxes to claim them. Close a box and you move again.',
  rules: [
    'Players take turns drawing one line between two neighbouring dots.',
    'When your line closes a box (its fourth side), write your mark in it and take another turn.',
    'Otherwise the turn passes to the next player. Every box you claim counts for you.',
    'When every line is drawn, the player with the most boxes wins. A tie for the most is a draw.',
  ],
  seats: { min: 2, max: 4, default: 2 },
  seatLabel: (i) => COLOURS[i],
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  options: [SIZE, TIME_LIMIT_OPTION],
  create(players, options, rng) {
    const g = engine.createGame(players, options);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // the phase is an internal value, never a name: keep it through the scrub
      scrub: (names, to) => { const phase = g.phase; scrubDeep([g, players], names, to); g.phase = phase; },
      act: (playerId, action) => { try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; } },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId, rng),
      botDelayMs: () => 900 + rng() * 500,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
