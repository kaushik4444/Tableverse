'use strict';
/** Hidden Miners plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'hiddenminers',
  name: 'Hidden Miners',
  icon: '⛏️',
  accent: '#c98a2b',
  tagline: 'Dig toward the gold together, but someone at the table is secretly working against you.',
  seats: { min: 3, max: 8, default: 5 },
  stats: { kind: 'solo', bestLabel: 'Highest score', bestOf: (row) => row.score },
  options: [
    {
      key: 'rounds',
      type: 'select',
      label: 'Rounds',
      default: '3',
      choices: [
        { value: '1', label: 'One round', desc: 'A single dig.' },
        { value: '3', label: 'Three rounds', desc: 'Roles are dealt again each round.' },
        { value: '5', label: 'Five rounds', desc: 'A long session.' },
      ],
    },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Everyone is secretly a Digger or a Saboteur (with 3 or 4 players one Saboteur, 5 or 6 two, 7 or 8 three). You only ever learn your own role. Diggers want to reach the gold; Saboteurs want the tunnel to fail.',
    'The tunnel starts on the left of a 9 by 5 grid. Three chambers wait on the right, and only one holds gold. A chamber opens when a tunnel from the start reaches it.',
    'On your turn play one card, or throw one away, then draw a card if the deck has any. Tunnel pieces must join a tunnel that runs from the start, and every side must match its neighbours (open to open, closed to closed). You may turn a piece upside down. Dead-end pieces connect but do not carry the tunnel on.',
    'Break a Lamp, Pick or Cart on another miner: they cannot add tunnel pieces until a matching Repair card mends it. Repair cards can help anyone, yourself included. Scout lets you secretly look at one chamber. Collapse removes one tunnel piece (never the start).',
    'If the gold chamber is reached the Diggers win the round: each Digger scores 3 and the miner who opened the gold scores 1 more. If the deck and every hand run out first, the Saboteurs win: each scores 3 (a lone Saboteur scores 4). All roles are shown when a round ends.',
    'After the chosen number of rounds the highest score wins; equal scores share the win.',
    'Hidden Miners is Tableverse\'s own game, made with our own cards, wording and artwork. It is not affiliated with, endorsed by or licensed by the publisher of any similar game.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      botDelayMs: () => 900 + g.rng() * 800,
      autoAction: () => (g.phase === 'roundEnd' ? { type: 'continue' } : null),
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
