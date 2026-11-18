'use strict';
/** Stage Rummy plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'stagerummy',
  name: 'Stage Rummy',
  icon: '🪜',
  accent: '#2f8f83',
  tagline: 'Climb the stages: lay down sets, runs or one colour, then be first to empty your hand.',
  seats: { min: 2, max: engine.MAX_PLAYERS, default: 4 },
  // the stored score is stages first, then fewer points; the profile shows the stage reached
  stats: { kind: 'solo', bestLabel: 'Best stage reached', bestOf: (row) => row.score, formatBest: (value) => String(Math.max(1, Math.ceil(value / 100000))) },
  options: [
    {
      key: 'length',
      type: 'select',
      label: 'Game length',
      default: 'full',
      choices: [
        { value: 'short', label: 'Short (5 stages)', desc: 'Play the first five stages.' },
        { value: 'full', label: 'Full (10 stages)', desc: 'Play all ten stages.' },
      ],
    },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Two to six players. The cards are the numbers 1 to 12 in four colours (two of each), wild cards and skip cards. Everyone starts on stage 1 and gets 10 cards.',
    'Each stage has a goal to lay down: for example a set of 3 (same number) and a run of 3 (consecutive numbers), or six cards of one colour. A wild card can stand in for any number or colour, but every group needs at least one real number card. Skip cards cannot be used in groups.',
    'On your turn: draw one card from the stock or the top of the discard pile (a skip card cannot be picked up). Then, if you can, lay down your stage goal. Once you have laid down you may add cards to any laid group (extend a set, add to either end of a run, or add a matching colour). Finish by discarding one card.',
    'Discarding a skip card makes the next player lose their turn. The round ends when a player gets rid of all their cards. Everyone else counts the cards left in their hand: 1 to 9 are 5 points, 10 to 12 are 10, skip is 15 and wild is 25.',
    'Players who laid down their stage move up a stage. The game ends when a round finishes and someone has completed the last stage. Among the players who completed it, the lowest points win.',
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
      forcedPlay: () => null,
      stamp: () => g.round + ':' + g.turn, // changes when the turn passes (the server compares stamps with !==)
      botDelayMs: () => 900 + g.rng() * 900,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
