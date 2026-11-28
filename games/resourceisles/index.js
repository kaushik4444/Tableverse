'use strict';
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

const LENGTH = { key: 'length', type: 'select', label: 'Points to win', default: 'classic', choices: [
  { value: 'classic', label: '10 points', desc: 'The full game. Build up to ten points first.' },
  { value: 'short', label: '8 points', desc: 'A shorter island: eight points win.' },
] };

module.exports = {
  id: 'resourceisles',
  name: 'Resource Isles',
  icon: '🌾',
  accent: '#e9b949',
  tagline: 'Settle an archipelago, gather what the dice bring, build roads and cities, and be first to the points.',
  rules: [
    'Four players, each with a colour. Settle the island in turn: two settlements and two roads each. The second settlement brings a card from each land it touches.',
    'On your turn roll two dice. Every land showing the number gives a card to each settlement and city on it (a city gives two). A roll of 7 moves the robber.',
    'A 7: anyone holding more than seven cards discards half. Then move the robber to another land and take a card from a player with a building there.',
    'Build with cards: a road costs timber and clay, a settlement timber, clay, wool and grain, a city two grain and three stone. A road must join your own roads or settlements, and settlements must be two corners apart.',
    'Trade with the bank: four cards for one, or three for one (or two for one of a kind) with a harbour your settlement touches.',
    'Points: each settlement is one, each city two, and the longest road of five or more is two. Be first to the points target on your turn. If nobody can place another piece, the most points wins.',
    'This is a draft: development cards and player-to-player trading are not in this version.',
  ],
  seats: { min: 4, max: 4, default: 4 },
  seatLabel: (i) => ['Blue', 'Red', 'Orange', 'Black'][i],
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  options: [LENGTH, TIME_LIMIT_OPTION],
  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // only the seat names are text the scrub may rewrite: the board, phase and log hold numbers and fixed words
      scrub: (names, to) => scrubDeep([g.players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action, rng); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId, rng),
      // quick for the many small steps (setup, discards, trades, builds), slower for the dice and the robber so they can be followed
      botDelayMs: () => ({ setup: 800, roll: 1100, discard: 700, robber: 1000 }[g.phase] || 700) + rng() * 400,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
