'use strict';
/** Go Fish plugin: adapts the pure engine to the server's game interface. */
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'gofish',
  name: 'Go Fish',
  icon: '🐟',
  accent: '#1fa2b8',
  tagline: 'Ask for a card, collect four of a kind and make the most books. Simple, quick and friendly.',
  seats: { min: 2, max: 6, default: 4 },
  stats: { kind: 'solo', bestLabel: 'Most books', bestOf: (row) => row.score },
  options: [
    { key: 'wishAgain', type: 'boolean', label: 'Fish your wish', desc: 'If you draw the very card you asked for, you go again.', default: true },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Two to six players use a standard 52-card deck. With two players each gets 7 cards, otherwise 5. The rest is the stock.',
    'On your turn ask one other player for a rank you already hold (“Do you have any 7s?”). If they have any, they must give you all of them and you ask again.',
    'If they have none, they say “Go Fish”: you draw the top card of the stock. With “Fish your wish” on, drawing the rank you asked for lets you go again. Otherwise your turn ends.',
    'Four cards of one rank make a book, which you lay down at once. If you have no cards on your turn, you draw one from the stock.',
    'The game ends when all 13 books are down. The player with the most books wins; equal books share the win.',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state, including the log
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => {
        try { return engine.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      forcedPlay: () => engine.forcedPlay(g),
      botDelayMs: () => 800 + g.rng() * 600,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      // most books wins; ties share the win
      results: () => {
        const best = Math.max(...g.books.map((b) => b.length));
        return g.players.map((_, i) => ({ score: g.books[i].length, winner: g.books[i].length === best }));
      },
    };
  },
};
