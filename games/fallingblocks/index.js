'use strict';
/** Falling Blocks: adapts the pure versus rules to the server's game interface. Everybody builds at once; bots are timed by Bot speed. One player alone is a solo game. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');

const COLOURS = ['Blue', 'Red', 'Green', 'Gold'];

module.exports = {
  id: 'fallingblocks',
  name: 'Falling Blocks',
  icon: '🧱',
  accent: '#e17055',
  tagline: 'Drop the same blocks into your own well. Clear rows, send garbage to rivals, and be the last one still building.',
  seats: { min: 1, max: 4, default: 2 },
  seatLabel: (i) => COLOURS[i],
  // rows cleared is shown as the score; the stat is the most rows cleared in a game you won
  // the most rows cleared alone (a solo game, seats === 1); a versus game is not a comparable number
  stats: { kind: 'none', bestLabel: 'Most rows cleared alone', bestOf: (row) => (row.seats === 1 && Number.isFinite(row.score) ? row.score : null) },
  options: [
    // no TIME_LIMIT_OPTION: everybody builds at once, so nobody waits for a turn. Bots are timed by Bot speed.
    { key: 'pace', type: 'select', label: 'Bot speed', default: 'slow', choices: [
      { value: 'slow', label: 'Slow', desc: 'Bots drop a piece about every four seconds.' },
      { value: 'normal', label: 'Normal', desc: 'Bots drop a piece about every three seconds.' },
      { value: 'quick', label: 'Quick', desc: 'Bots drop a piece about every two seconds.' },
    ] },
  ],
  rules: [
    'Two to four players, each with a 10 × 20 well. Everybody gets the same sequence of blocks, so it is down to play.',
    'Playing alone, there is no one to send garbage to. Your well is the whole game: it ends when a block cannot appear at the top, and your score is the rows you cleared.',
    'Choose where the block goes: pick a rotation and a column, then Drop. It falls as far as it can. Nobody waits for a turn.',
    'A full row clears. Clearing two, three or four rows at once sends one, two or four garbage rows to each of the others.',
    'A block that cannot appear at the top of your well tops you out, and you are out. The last player still building wins.',
    'Bots drop their blocks one at a time, at the speed set by Bot speed. Their wells are shown, like everybody\'s.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state. Phase is kept, so a name cannot change it.
      // only the names are rewritten: piece letters and board cells are game data, and a name like "I" must not change them
      scrub: (names, to) => scrubDeep([g.players, players], names, to),
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
