'use strict';
/** Bingo plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');

module.exports = {
  id: 'bingo',
  name: 'Bingo',
  icon: '🎱',
  accent: '#be185d',
  tagline: 'Numbers are called one at a time. Mark your card and shout Bingo first.',
  seats: { min: 2, max: 8, default: 4 },
  stats: { kind: 'none', bestLabel: null, bestOf: null },
  options: [
    { key: 'pattern', type: 'select', label: 'Winning pattern', default: 'line', choices: [
      { value: 'line', label: 'Any line', desc: 'A full row, column or diagonal.' },
      { value: 'full', label: 'Full card', desc: 'Every square on your card.' },
    ] },
    { key: 'speed', type: 'select', label: 'Pace', default: 'normal', choices: [
      { value: 'slow', label: 'Slow', desc: 'About five seconds between numbers.' },
      { value: 'normal', label: 'Normal', desc: 'About three and a half seconds between numbers.' },
      { value: 'quick', label: 'Quick', desc: 'About two seconds between numbers.' },
    ] },
    { key: 'autoMark', type: 'boolean', label: 'Mark for me', desc: 'Called numbers on your card are marked for you. You still shout Bingo.', default: false },
  ],
  rules: [
    'Two to eight players. Each card has 25 squares in five columns: B 1–15, I 16–30, N 31–45, G 46–60 and O 61–75. The middle square is free.',
    'Numbers are called one at a time in a random order. Tap a called number on your card to mark it. You can only mark a number after it has been called.',
    'Shout Bingo with the button as soon as your card has a full line across, down or diagonally. With the Full card pattern you need every square.',
    'The first valid Bingo wins and ends the game. A Bingo that is not complete is refused, so check your card first.',
    'Bots mark their cards and call Bingo as soon as they can. With Mark for me on, your called numbers are marked for you, but you still have to call Bingo yourself.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: () => null, // bots act through the timer call below
      autoAction: () => engine.autoAction(g),
      autoDelayMs: () => engine.autoDelayMs(g),
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
