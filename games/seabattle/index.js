'use strict';
/** Sea Battle: adapts the two-player rules to the server's game interface. Turns are timed by the table's time limit. */
const engine = require('./engine');
const { scrubText, scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'seabattle',
  name: 'Sea Battle',
  icon: '🚢',
  accent: '#0284c7',
  tagline: 'Hide five ships in your sea and fire at the other player’s. The first to sink the whole fleet wins.',
  seats: { min: 2, max: 2, default: 2 },
  seatLabel: (i) => (i === 0 ? 'Blue' : 'Red'),
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  options: [
    TIME_LIMIT_OPTION,
    { key: 'pace', type: 'select', label: 'Bot speed', default: 'normal', choices: [
      { value: 'slow', label: 'Slow', desc: 'Bots fire about every three seconds.' },
      { value: 'normal', label: 'Normal', desc: 'Bots fire about every two seconds.' },
      { value: 'quick', label: 'Quick', desc: 'Bots fire about every one and a bit seconds.' },
    ] },
  ],
  rules: [
    'Two players. Each has a 10 × 10 sea with five ships: lengths 5, 4, 3, 3 and 2. The ships are placed at random and never touch.',
    'Take turns firing at one square of the other sea. A hit or a miss is shown to both players.',
    'A ship is sunk when every one of its squares is hit. Its squares are then shown to everybody.',
    'Each turn passes after a shot, whether it hits or misses.',
    'The first player to sink the whole enemy fleet wins. Nobody sees the other fleet.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state. Phase is kept, so a name cannot change it.
      // an account was deleted: only the name fields and log text change. Shot states are game content, not names.
      scrub: (names, to) => {
        for (const p of [...g.players, ...players]) if (typeof p.name === 'string') p.name = scrubText(p.name, names, to);
        scrubDeep([g.log], names, to);
      },
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      botDelayMs: (playerId) => engine.botDelayMs(g, playerId),
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
