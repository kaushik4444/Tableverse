'use strict';
const engine = require('./engine');
const { scrubDeep } = require('../scrub');
const { TIME_LIMIT_OPTION } = require('../common');

module.exports = {
  id: 'twentynine',
  name: '29',
  icon: '🂫',
  accent: '#d64545',
  tagline: 'The classic South Asian trick-taking game for two teams of two. Bid, hide your trump, and take the points.',
  seats: { min: 4, max: 4, default: 4 },
  // 'team': a win means your TEAM won. No "best score": a winning team always ends on about the same game points,
  // so a maximum would say nothing.
  stats: { kind: 'team', bestLabel: null, bestOf: null },
  seatLabel: (i) => (i % 2 === 0 ? 'Team A' : 'Team B'),
  options: [
    {
      key: 'shuffleSeats',
      type: 'boolean',
      label: 'Shuffle seats',
      desc: 'Shuffle the seating when the game starts, which also changes the teams. Off: players sit in the order they joined, and partners sit opposite.',
      default: true,
    },
    {
      key: 'target',
      type: 'select',
      label: 'Play until',
      default: '6',
      choices: [
        { value: '3', label: '3 game points', desc: 'A short match.' },
        { value: '6', label: '6 game points', desc: 'The usual match.' },
        { value: '9', label: '9 game points', desc: 'A long evening.' },
      ],
    },
    {
      key: 'allTwentyNine',
      type: 'boolean',
      label: 'All 29 doubles the win',
      desc: 'If the bidding team takes all 29 points in a hand and makes its bid, it scores +2 game points instead of +1.',
      default: true,
    },
    {
      key: 'halfFailDouble',
      type: 'boolean',
      label: 'Double loss below half',
      desc: 'If the bidding team misses its bid with less than half the points (14 or fewer), it scores −2 instead of −1.',
      default: true,
    },
    {
      key: 'marriageBid',
      type: 'boolean',
      label: 'Marriage changes the bid',
      desc: 'Instead of +4 hand points, a King–Queen marriage changes the bid. If the bidding team declares it, the bid drops by 4 (never below 15). If the other team declares it, the bid rises by 4.',
      default: true,
    },
    {
      key: 'doubleChallenge',
      type: 'boolean',
      label: 'Double and redouble',
      desc: 'After trump is chosen, the other team may double the bid, which doubles the hand’s game points. The bidding team may then redouble, which makes them four times. Either side can accept instead.',
      default: true,
    },
    TIME_LIMIT_OPTION,
  ],
  rules: [
    'Four players, two teams: you and the player sitting opposite are partners. 32 cards (7 to Ace). Card order, high to low: J, 9, A, 10, K, Q, 8, 7.',
    'Card points: Jack 3, Nine 2, Ace 1, Ten 1. That is 28 points, plus 1 for winning the last trick makes 29.',
    'Everyone gets 4 cards. Starting left of the dealer, two players bid head-to-head, raising from 15 to 28 or passing. When one passes, the next player clockwise takes the vacant bidding seat. Passing is permanent. The auction continues until only one bidder remains; that highest bidder wins. If everyone else passes without a bid, the dealer must open at 15. A bid of 28 ends the auction immediately.',
    'The highest bidder secretly picks the trump suit (one they hold). Four more cards are then dealt to each player, and the bidder leads the first trick.',
    'Play 8 tricks and follow the lead suit if you can. If you cannot follow, you may ask to see the trump: it is then shown to everyone and you must play a trump card if you have one. Until it is shown, trump cards played as discards do not count as trump.',
    'Trump marriage (K–Q): after trump has been revealed and your team has won at least one trick, declare the King and Queen of trump while it is your turn to add 4 points to your team’s hand total (or, with the Marriage changes the bid setting, change the bid by 4). It can be declared once per hand.',
    'The bidding team needs at least as many points as it bid. Make it and the team scores +1 game point, miss it and it scores −1. The first team to reach the target wins (or the other team wins if one team falls to minus the target). Game settings can change these: All 29 doubles the win, Double loss below half, Marriage changes the bid, and Double and redouble, which lets the other team double a bid before play (×2), and the bidding team redouble (×4).',
  ],

  create(players, options, rng) {
    const g = engine.createGame(players, options, rng);
    return {
      view: (playerId) => engine.viewFor(g, playerId),
      // an account was deleted: its name is rewritten everywhere in the state, including the log
      scrub: (names, to) => scrubDeep([g, players], names, to),
      act: (playerId, action) => engine.applyAction(g, playerId, action),
      awaiting: () => engine.awaiting(g),
      botAction: (playerId) => engine.botAction(g, playerId),
      forcedPlay: () => engine.forcedPlay(g),
      stamp: () => g.lastTrick, // changes whenever a trick is completed
      autoAction: () => (g.phase === 'handEnd' ? { type: 'continue' } : null),
      isOver: () => g.phase === 'gameOver',
      // teams are the even and the odd seats (seat % 2); every member of the winning team wins
      results: () => players.map((_, i) => ({ score: g.teamScore[i % 2], winner: g.winnerTeam === i % 2 })),
    };
  },
};
