'use strict';
/** Carrom: two players, one colour each. Physics and rules live in physics.js and engine.js. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'carrom',
  name: 'Carrom',
  icon: '◎',
  accent: '#a16207',
  tagline: 'Flick the striker and pocket your nine coins before your rival does.',
  seats: { min: 2, max: 2, default: 2 },
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  rules: [
    'Two players, one colour each. The first seat plays White from the bottom and the second plays Black from the top.',
    'On your turn, place the striker along your baseline, aim with the angle and set the power, then flick. Left and right are as you see the board.',
    'Pocket your own coins in the corners. Pocketing one of your coins gives you another shot. Coins of the other colour go back to the centre.',
    'Pocketing the queen covers it when you pocket one of your coins in the same shot, or once you hold all nine. A covered queen is yours. An uncovered queen goes back to the centre.',
    'Pocketing the striker is a foul: the coins of that shot go back and you lose one coin you hold.',
    'Pocket all nine of your coins with the queen held to win. You can resign at any time.',
  ],
  options: [TIME_LIMIT_OPTION],
  create(players, options, rng) {
    const g = engine.createGame(players);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => (g.phase === 'playing' ? [players[g.turn].id] : []),
      botAction: () => engine.botAction(g, g.turn, rng),
      botDelayMs: () => 900 + rng() * 500,
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
