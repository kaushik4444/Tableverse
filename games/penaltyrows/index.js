'use strict';
/** Penalty Rows plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');
const pacing = require('../pacing');

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
        { value: 'short', label: 'Short', desc: 'The game ends when someone reaches 35 penalty points (20 with simple scoring).' },
        { value: 'standard', label: 'Standard', desc: 'The game ends when someone reaches 66 penalty points (35 with simple scoring).' },
        { value: 'long', label: 'Long', desc: 'The game ends when someone reaches 100 penalty points (50 with simple scoring).' },
      ],
    },
    {
      key: 'scoring',
      type: 'select',
      label: 'Scoring',
      default: 'standard',
      choices: [
        { value: 'standard', label: 'Standard', desc: 'Each card is worth 1 to 6 penalty points, as in the rules.' },
        { value: 'simple', label: 'Simple', desc: 'Every card is worth 1 penalty point. The totals grow more slowly, so the game is shorter.' },
      ],
    },
    {
      key: 'rowSize',
      type: 'select',
      label: 'Cards per row',
      default: '5',
      choices: [
        { value: '4', label: 'Four', desc: 'A row is full at four cards. The fifth card to a full row takes the row.' },
        { value: '5', label: 'Five', desc: 'The classic game: a row is full at five cards, and the sixth takes it.' },
        { value: '6', label: 'Six', desc: 'A row is full at six cards. The seventh card to a full row takes it.' },
      ],
    },
    {
      key: 'hand',
      type: 'select',
      label: 'Cards each',
      default: '10',
      choices: [
        { value: '6', label: '6 cards', desc: 'Short rounds: six turns each.' },
        { value: '8', label: '8 cards', desc: 'Eight turns each.' },
        { value: '10', label: '10 cards', desc: 'The classic game: ten turns each.' },
      ],
    },
    {
      key: 'lowCard',
      type: 'select',
      label: 'Card below every row',
      default: 'choose',
      choices: [
        { value: 'choose', label: 'You choose', desc: 'The player whose card fits no row takes the row they pick.' },
        { value: 'cheapest', label: 'Cheapest row', desc: 'The row with the fewest penalty points is taken automatically.' },
      ],
    },
    {
      key: 'pace',
      type: 'select',
      label: 'Pace',
      default: 'relaxed',
      choices: [
        { value: 'relaxed', label: 'Relaxed', desc: 'Each card stays on the table long enough to read it.' },
        { value: 'normal', label: 'Normal', desc: 'A quicker table: cards stay on the table for less time.' },
        { value: 'quick', label: 'Quick', desc: 'The shortest pauses between the cards.' },
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
    'The table options change the rules: the number of cards each, the cards per row, the scoring (simple scoring is one point per card), the game length and what happens to a card below every row.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      scrub: (names, to) => { const phase = g.phase; scrubDeep([g, players], names, to); g.phase = phase; }, // phase is an internal enum, never a name
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      forcedPlay: () => engine.forcedPlay(g),
      // lets the table show the played cards before the next turn is asked for
      stamp: () => g.seq, // a number that changes once per finished turn (the server compares stamps with !==)
      botDelayMs: () => 700 + g.rng() * 900,
      holdMs: () => pacing.remaining(g), // the time the table needs to show the cards played (games/pacing.js)
      setPacingScale: (scale) => pacing.setScale(g, scale),
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
