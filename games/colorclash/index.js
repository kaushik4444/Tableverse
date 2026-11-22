'use strict';
/** Color Clash plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubText } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'colorclash',
  name: 'Color Clash',
  icon: '🎨',
  accent: '#e0533f',
  tagline: 'Match colours and numbers, play action cards wisely and be first to empty your hand.',
  seats: { min: 2, max: 8, default: 4 },
  stats: { kind: 'solo', bestLabel: 'Highest score', bestOf: (row) => row.score },
  options: [
    {
      key: 'target',
      type: 'select',
      label: 'Game length',
      default: '200',
      choices: [
        { value: 'round', label: 'One round', desc: 'The first player to empty their hand wins.' },
        { value: '100', label: 'First to 100', desc: 'A short match over a few rounds.' },
        { value: '200', label: 'First to 200', desc: 'The usual match.' },
        { value: '300', label: 'First to 300', desc: 'A long match.' },
      ],
    },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'The deck has four colours (Ruby, Sun, Leaf and Sea) with the numbers 1 to 9, plus action cards and Wilds. Everyone starts with 7 cards. The top card of the discard pile starts the round.',
    'On your turn play one card that matches the top card by colour, by number or by action. Wild cards can always be played. If you cannot or do not want to play, draw one card: if it fits you may play it straight away, otherwise you keep it and the turn passes.',
    'Stop skips the next player. Flip turns the direction of play round (with two players it works like Stop). Take 2 makes the next player draw two cards and miss their turn. A Wild lets you choose the colour, and Wild Take 4 also makes the next player draw four and miss their turn.',
    'When you are down to one card, everyone at the table sees it.',
    'The first player to play their last card ends the round and scores the points left in the other hands: a number counts its value, Stop, Flip and Take 2 count 20, and Wilds count 50. A new round starts with a new deal.',
    'The match ends when a player reaches the target score you chose (or after one round). The highest score wins; equal scores share the win.',
    'Color Clash is Tableverse\'s own game, made with our own cards, wording and artwork. It is not affiliated with, endorsed by or licensed by the publisher of any similar game.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: only the name fields and the log's text change. Cards, colours, ids, the options and the phase
      // keep their values, so a player called 'wild' or 'round' cannot rewrite a card kind or a rule
      scrub: (names, to) => {
        for (const p of [...g.players, ...players]) if (typeof p.name === 'string') p.name = scrubText(p.name, names, to);
        for (const entry of g.log) {
          entry.by = scrubText(entry.by, names, to);
          if (typeof entry.card === 'string') entry.card = scrubText(entry.card, names, to);
        }
      },
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      botDelayMs: () => 1600 + g.rng() * 900,
      autoAction: () => (g.phase === 'roundEnd' ? { type: 'continue' } : null),
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
