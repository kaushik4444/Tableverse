'use strict';
/** Memory Match: 2 to 4 players turn over two cards a turn to find pairs. The most pairs wins. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

const SIZE = { key: 'size', type: 'select', label: 'Cards', default: '4x4', choices: [
  { value: '4x4', label: '4 × 4 (16 cards)', desc: 'A quick game: eight pairs.' },
  { value: '4x6', label: '4 × 6 (24 cards)', desc: 'Twelve pairs to find.' },
  { value: '6x6', label: '6 × 6 (36 cards)', desc: 'Eighteen pairs: a long, careful game.' },
] };
const COLOURS = ['Blue', 'Red', 'Green', 'Gold'];

module.exports = {
  id: 'memorymatch', name: 'Memory Match', icon: '🃏', accent: '#e84393',
  tagline: 'Turn two cards over and find the pairs. Remember where they are, and keep going while you match.',
  rules: [
    'Every card is face down. On your turn, turn over two cards.',
    'If they match, you keep the pair and play again. If not, they turn back over and the turn passes.',
    'Every card turned over stays known to the table, so remember where the pairs are.',
    'When all pairs are found, the player with the most pairs wins. A tie for the most is a draw.',
  ],
  seats: { min: 2, max: 4, default: 2 },
  seatLabel: (i) => COLOURS[i],
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  options: [SIZE, TIME_LIMIT_OPTION],
  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      scrub: (names, to) => scrubDeep([g, players], names, to),
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
