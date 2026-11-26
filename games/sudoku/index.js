'use strict';
/** Sudoku plugin: adapts the pure race rules to the server's game interface. Bots fill their grids through the timer. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');

module.exports = {
  id: 'sudoku',
  name: 'Sudoku',
  icon: '🔢',
  accent: '#0284c7',
  tagline: 'Everybody gets the same puzzle. Fill your grid so every row, column and box holds 1 to 9. First complete grid wins.',
  seats: { min: 2, max: 8, default: 3 },
  // fastest complete grid, in seconds, among the games this player won (lower is better)
  stats: { kind: 'solo', bestLabel: 'Fastest grid', bestOf: (row) => (row.isWinner ? -row.score : null), formatBest: (v) => `${-v} s` },
  options: [
    // no TIME_LIMIT_OPTION: nobody takes turns, so there is no clock to run out. Bots are timed by Bot speed.
    { key: 'difficulty', type: 'select', label: 'Difficulty', default: 'medium', choices: [
      { value: 'easy', label: 'Easy', desc: 'Forty numbers are given.' },
      { value: 'medium', label: 'Medium', desc: 'Thirty-two numbers are given.' },
      { value: 'hard', label: 'Hard', desc: 'Twenty-six numbers are given.' },
    ] },
    { key: 'pace', type: 'select', label: 'Bot speed', default: 'normal', choices: [
      { value: 'slow', label: 'Slow', desc: 'Bots fill a square about every four seconds.' },
      { value: 'normal', label: 'Normal', desc: 'Bots fill a square about every two and a half seconds.' },
      { value: 'quick', label: 'Quick', desc: 'Bots fill a square about every one and a half seconds.' },
    ] },
  ],
  rules: [
    'Two to eight players, each with a 9×9 grid. Everybody starts with the same puzzle. Some squares are given; tap an empty square and choose a number from 1 to 9.',
    'Every row, every column and every 3×3 box must hold each number from 1 to 9 once. Numbers that are given cannot be changed.',
    'A wrong number is shown in red and counted as a mistake. Change it or erase it; it does not end anything.',
    'The first grid completed with every number right wins and ends the game. Nobody has to take turns, so there is no time limit.',
    'Bots fill their grids one square at a time. Bot speed sets how quick they are. Their grids are not shown; only how many squares each has right.',
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
      botAction: (playerId) => engine.botAction(g, playerId),
      botDelayMs: (playerId) => engine.botDelayMs(g, playerId),
      autoAction: () => null,
      autoDelayMs: () => 0,
      isOver: () => g.phase === 'gameOver',
      results: () => engine.results(g),
    };
  },
};
