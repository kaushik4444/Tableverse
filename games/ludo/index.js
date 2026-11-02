'use strict';
const engine = require('./engine');
const { scrubDeep } = require('../scrub');

module.exports = {
  id: 'ludo',
  name: 'Ludo',
  icon: '🎲',
  accent: '#f59e0b',
  tagline: 'Race your four tokens home. Roll a six to get out, send opponents back to start, and finish by exact count.',
  seats: { min: 2, max: 4, default: 4 },
  stats: { kind: 'none', bestLabel: 'Best finish', bestOf: (row) => row.score - row.seats - 1, formatBest: (value) => String(-value) },
  seatLabel: (i) => ['Red', 'Yellow', 'Green', 'Blue'][i],
  options: [
    {
      key: 'timeLimit',
      type: 'select',
      label: 'Turn time limit',
      default: '60',
      noRules: true,
      choices: [
        { value: 'off', label: 'No limit', desc: 'Players can take as long as they like.' },
        { value: '20', label: '20 seconds', desc: 'Fast game. A bot plays for you when time runs out.' },
        { value: '30', label: '30 seconds', desc: 'A bot plays for you when time runs out.' },
        { value: '60', label: '60 seconds', desc: 'A bot plays for you when time runs out.' },
        { value: '120', label: '2 minutes', desc: 'Relaxed. A bot plays for you when time runs out.' },
      ],
    },
  ],
  rules: [
    '2-4 players, four tokens each. Everyone starts with all tokens in their yard.',
    'Roll a six to bring a token out onto your starting square. A six also earns another roll.',
    'Move your tokens clockwise around the board by the number rolled. You must finish your home column by exact count.',
    'Land on an opponent\'s token on a non-safe square and send it back to its yard. Safe squares (the four starts and four marked spots) protect from capture.',
    'Three sixes in a row end your turn. First player to get all four tokens home wins.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state, including the log
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => engine.applyAction(g, playerId, action),
      awaiting: () => engine.awaitingList(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      // first to finish all four tokens wins; score is placement (first = n, ... last = 1)
      results: () => {
        const place = (i) => g.finishedOrder.indexOf(i);
        return g.players.map((_, i) => ({ score: g.n - place(i), winner: g.winner === i, best: place(i) + 1 }));
      },
    };
  },
};
