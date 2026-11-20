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
  tagline: 'Flick the striker, pocket your coins and the queen. Play alone or in teams of two.',
  seats: { min: 2, max: 4, default: 2 },
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  rules: [
    'Two to four players. With four, partners sit opposite each other and play the same colour: White for the first and third seats, Black for the second and fourth.',
    'On your turn, set the striker along your baseline with the Striker slider. Then drag on the board: drag back from the striker and let go to flick. The further you drag, the harder the flick. The arrow shows where it will go.',
    'Pocket your team\u2019s coins in the corners. Pocketing one of your own coins gives you another shot. Coins of the other colour go back to the centre.',
    'The queen is covered when your team pockets it in the same shot as one of its coins, or once it has all nine. A covered queen is held by the team. An uncovered queen goes back to the centre.',
    'Pocketing the striker is a foul: the coins of that shot go back, and one coin your team holds goes back too.',
    'The first team to pocket all nine of its coins, with the queen held, wins. You can resign at any time.',
  ],

  options: [TIME_LIMIT_OPTION],
  create(players, options, rng) {
    const g = engine.createGame(players);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // only the names and the log text hold player names: the phase, colours and rules fields must keep their values
      scrub: (names, to) => scrubDeep([g.players, players, g.log], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => (g.phase === 'playing' ? [players[g.turn].id] : []),
      botAction: () => engine.botAction(g, g.turn, rng),
      botDelayMs: () => 900 + rng() * 500,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      // the engine's winner is a colour ('w' or 'b'), so each seat compares its own colour
      results: () => g.players.map((p) => ({
        score: g.draw ? 0.5 : g.winner === p.colour ? 1 : 0,
        winner: !g.draw && g.winner === p.colour,
        draw: g.draw,
      })),
    };
  },
};
