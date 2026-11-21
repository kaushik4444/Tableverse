'use strict';
/** Stage 10 plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubText } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

/** "set of 3", "run of 5" or "6 cards of one colour": how one group of a stage is described. */
const groupText = (r) => (r.kind === 'colour' ? `${r.size} cards of one colour` : `${r.kind} of ${r.size}`);
const stageLine = (goal, i) => `${i + 1} ${engine.STAGE_NAMES[i]}: ${goal.map(groupText).join(' and ')}`;

module.exports = {
  id: 'stagerummy',
  name: 'Stage 10',
  icon: '🪜',
  accent: '#2f8f83',
  tagline: 'Lay down the goal of your stage, stage by stage. First to finish the last stage wins.',
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
        { value: 'short', label: 'Quick: stages 1 to 5', desc: 'A shorter game. The first five stages, from Trio and run to Colour rush.' },
        { value: 'full', label: 'Full: stages 1 to 10', desc: 'The whole game, all ten stages, ending with Grand finale.' },
      ],
    },
    {
      key: 'wildCards',
      type: 'boolean',
      label: 'Wild cards',
      desc: 'A wild card can stand in for any number or colour. Turn this off for a harder game with only numbers and skip cards.',
      default: true,
    },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Goal: be the first to finish the last stage. Each round you try to lay down the goal of your current stage, a set of groups on the table in front of you. Players who lay down move up to the next stage.',
    'Groups: a set is cards with the same number, in any colours (three 7s). A run is consecutive numbers, in any colours (4, 5, 6). A colour group is any cards of one colour. A wild card can stand in for any number or colour, but every group needs at least one real number card.',
    'Your turn has three steps: draw one card from the stock or take the top of the discard pile (a skip card cannot be taken). Lay down your stage if your cards allow it. End the turn by discarding one card. Once you have laid down, you can add cards to any group on the table, including on the turn you lay down.',
    'Skip cards: when a skip card is discarded, the next player loses their turn.',
    'Going out: a round ends when a player has no cards left. Everyone else counts the cards still in their hand: 1 to 9 are 5 points, 10 to 12 are 10, skip cards are 15 and wild cards are 25.',
    'The stages: ' + engine.STAGES.slice(0, 10).map(stageLine).join('. ') + '.',
    'Winning: the game ends when a round finishes and someone has completed the last stage. The player who completed the most stages wins; if players completed the same number, the one with the fewest points wins.',
    'Stage 10 is Tableverse\'s own game, made with our own cards, wording and artwork. It is not affiliated with, endorsed by or licensed by the publisher of any similar game.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // only each seat's name changes: groups (kind), phase and matchId are game state and keep their values; log events hold seat numbers, not names
      scrub: (names, to) => { for (const p of [...g.players, ...players]) if (typeof p.name === 'string') p.name = scrubText(p.name, names, to); },
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      forcedPlay: () => null,
      stamp: () => g.round + ':' + g.turn, // changes when the turn passes (the server compares stamps with !==)
      botDelayMs: () => 1100 + g.rng() * 800, // bots pause long enough for people to follow each move
      autoAction: () => (g.phase === 'roundEnd' ? { type: 'continue' } : null),
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
