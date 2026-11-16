'use strict';
/** Penalty Rows plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'penaltyrows',
  name: 'Penalty Rows',
  icon: '🔢',
  accent: '#c2652a',
  tagline: 'Everyone plays a card at once. Squeeze it into a row, and avoid being the one who has to take it.',
  seats: { min: 2, max: engine.MAX_PLAYERS, default: 4 },
  // lowest total wins; the stored score is the negative total, so the profile shows the fewest penalty points as a positive number
  stats: { kind: 'solo', bestLabel: 'Fewest penalty points', bestOf: (row) => row.score, formatBest: (value) => String(-value) },
  options: [
    {
      key: 'target',
      type: 'select',
      label: 'Game length',
      default: 'standard',
      choices: [
        { value: 'short', label: 'Short (35)', desc: 'The game ends when someone reaches 35 penalty points.' },
        { value: 'standard', label: 'Standard (66)', desc: 'The game ends when someone reaches 66 penalty points.' },
        { value: 'long', label: 'Long (100)', desc: 'The game ends when someone reaches 100 penalty points.' },
      ],
    },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Two to eight players share the numbers 1 to 104. Each number carries penalty points: 1, plus 1 if it is a multiple of 5, 1 more if it is a multiple of 10, and 4 more for 11, 22, 33 and so on. Penalty points are bad.',
    'Each round you get 10 cards, and four cards are turned up to start four rows. Every turn all players secretly pick one card from their hand. When everyone has picked, the cards are shown and played from the lowest number to the highest.',
    'A card goes onto the row whose last card is the highest number that is still lower than it. A row holds five cards: if your card would be the sixth, you take those five cards as penalty points and your card starts the row again.',
    'If your card is lower than the last card of every row, it fits nowhere. You take any one row of your choice as penalty points, and your card starts that row.',
    'After the 10 turns the penalty points you took are added to your total. A new round is dealt until someone reaches the target. The player with the lowest total wins; equal totals share the win.',
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
      forcedPlay: () => engine.forcedPlay(g),
      // lets the table show the played cards before the next turn is asked for
      stamp: () => ({ round: g.round, turn: g.turn, seq: g.seq }),
      botDelayMs: () => 700 + g.rng() * 900,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
