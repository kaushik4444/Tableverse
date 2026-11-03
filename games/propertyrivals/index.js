'use strict';
/** Property Rivals plugin: adapts the engine and actions to the server's game interface. */
const E = require('./engine');
const A = require('./actions');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'propertyrivals',
  name: 'Property Rivals',
  icon: '🏠',
  accent: '#2f9e6e',
  tagline: 'Buy cities, collect rent, build and trade your way to the biggest fortune on a world tour.',
  seats: { min: 2, max: 6, default: 4 },
  stats: { kind: 'solo', bestLabel: 'Highest net worth', bestOf: (row) => row.score },
  options: [
    {
      key: 'rounds', type: 'select', label: 'Game length', default: 'off',
      choices: [
        { value: 'off', label: 'Until one player is left', desc: 'The classic game: it can take a long time.' },
        { value: '30', label: 'Short: 30 rounds', desc: 'After 30 rounds the richest player wins (cash, properties and buildings).' },
        { value: '60', label: 'Medium: 60 rounds', desc: 'After 60 rounds the richest player wins.' },
      ],
    },
    {
      key: 'startCash', type: 'select', label: 'Starting cash', default: '1500',
      choices: [
        { value: '1000', label: '1,000 coins', desc: 'Tighter: money runs out sooner.' },
        { value: '1500', label: '1,500 coins', desc: 'The usual start.' },
        { value: '2000', label: '2,000 coins', desc: 'A relaxed start.' },
      ],
    },
    { key: 'auction', type: 'boolean', label: 'Auction unbought properties', desc: 'If the player who lands on a free property does not buy it, everybody can bid for it.', default: true },
    { key: 'jackpot', type: 'boolean', label: 'Rest Stop jackpot', desc: 'Taxes and fines go into a pot that the next player to land on the Rest Stop collects.', default: false },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Two to six players travel round a 40-square world tour. Everybody starts with the same coins (1,500 by default) and collects 200 every time they pass Start. The last player with money wins, or in a shorter game the richest player after the chosen number of rounds.',
    'Roll two dice and move. Landing on a free city, port or utility lets you buy it; if you do not, it is auctioned to everyone (when that option is on). Landing on someone else’s property means paying rent. Doubles let you roll again, but three doubles in a row send you to the lockup.',
    'Own every city of a colour and the rent on its bare cities doubles, and you may build: houses cost the amount on the colour (even building, up to four houses and then a hotel). Ports pay more the more ports their owner has. Utilities pay a multiple of your dice.',
    'Surprise and Community Fund squares draw a card. Taxes go to the bank. The lockup holds you until you pay 50, use a get-out card or roll doubles (a third failed try pays the fine).',
    'On your turn you can mortgage properties for half their price (no rent while mortgaged; unmortgaging costs the mortgage plus 10%), sell buildings back for half, and trade properties and coins with another player.',
    'If you owe more than you hold, raise cash by selling buildings and mortgaging. If that is not enough you go bankrupt: your properties go to the player you owe (or back to the bank).',
  ],

  create(players, options, rng) {
    const g = E.createGame(players, options, rng);
    return {
      view: (playerId) => A.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state, including the log
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => {
        try { return A.applyAction(g, playerId, action); } catch (e) { return { ok: false, error: 'Invalid action' }; }
      },
      awaiting: () => A.awaiting(g),
      botAction: (playerId) => A.botAction(g, playerId),
      forcedPlay: () => A.forcedPlay(g),
      botDelayMs: () => 700 + g.rng() * 500,
      autoAction: () => null,
      isOver: () => g.phase === 'gameOver',
      // the score is each player's net worth at the end; the winner is the last player standing (or the richest in a timed game)
      results: () => g.players.map((p, i) => ({ score: p.bankrupt ? 0 : E.netWorth(g, i), winner: g.winner === i })),
    };
  },
};
