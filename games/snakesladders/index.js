'use strict';
/** Snakes and Ladders plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'snakesladders',
  name: 'Snakes and Ladders',
  icon: '🐍',
  accent: '#2f9e6b',
  tagline: 'Roll, climb the ladders and dodge the snakes. First to square 100 wins.',
  seats: { min: 2, max: 4, default: 4 },
  seatLabel: (i) => ['Red', 'Blue', 'Green', 'Yellow'][i],
  stats: { kind: 'none', bestLabel: 'Best finish', bestOf: (row) => row.score - row.seats - 1, formatBest: (value) => String(-value) },
  options: [
    { key: 'exactFinish', type: 'boolean', label: 'Exact roll to finish', desc: 'You need the exact number to land on 100. Turn it off and any roll that reaches 100 wins.', default: true },
    { key: 'sixAgain', type: 'boolean', label: 'Roll again on a six', desc: 'A six gives you another roll. Three sixes in a row end your turn.', default: true },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Two to four players start off the board. Take turns to roll one die and move that many squares along the numbered path, which winds up the board from 1 to 100.',
    'If you land on the foot of a ladder, climb to its top. If you land on a snake’s head, slide down to its tail. Ladders and snakes only work when you land exactly on their start.',
    'With “Roll again on a six” on, a six gives you another roll, but a third six in a row ends your turn without a move.',
    'With “Exact roll to finish” on, you must land on 100 exactly. If your roll is too big you stay where you are.',
    'The first player to reach square 100 wins. The others are placed by how far they got.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state, including the log
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      botDelayMs: () => 900 + g.rng() * 500,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      // score is the placing (first = n, ... last = 1)
      results: () => {
        const order = engine.placings(g);
        return g.players.map((_, i) => ({ score: g.n - order.indexOf(i), winner: g.winner === i, best: order.indexOf(i) + 1 }));
      },
    };
  },
};
