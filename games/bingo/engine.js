'use strict';
/**
 * Bingo: the rules only (no sockets, no timers).
 * 2-8 players, each with a 5x5 card. Columns hold B 1-15, I 16-30, N 31-45, G 46-60 and O 61-75, and the middle
 * square is free. Numbers are called one at a time from a shuffled 1-75. You can mark a number only after it has
 * been called (unless "Mark for me" is on). The first valid Bingo wins: a full line (across, down or diagonal), or
 * with the "Full card" pattern every square. Bots mark their cards and call Bingo themselves as soon as they can.
 */
const FREE = 12; // index of the middle square (row 3, column 3)
const ALL = Array.from({ length: 25 }, (_, k) => k);
const LINES = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)), // across
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)), // down
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20], // diagonals
];
const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const SPEEDS = { slow: 5000, normal: 3500, quick: 2200 }; // ms between calls
const letterOf = (n) => LETTERS[Math.floor((n - 1) / 15)];

function shuffled(rng, from, to) {
  const d = [];
  for (let v = from; v <= to; v++) d.push(v);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** One card: cells[k] is the number on square k (row-major), or 0 for the free middle square. */
function makeCard(rng) {
  const cells = new Array(25).fill(0);
  for (let c = 0; c < 5; c++) {
    const pool = shuffled(rng, 15 * c + 1, 15 * c + 15);
    for (let r = 0; r < 5; r++) cells[r * 5 + c] = pool[r];
  }
  cells[FREE] = 0;
  return cells;
}

/** Cards are unique at the table, so no two players can be looking at the same card. */
function dealCards(n, rng) {
  const cards = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    let cells = makeCard(rng);
    for (let tries = 0; tries < 50 && seen.has(cells.join(',')); tries++) cells = makeCard(rng);
    seen.add(cells.join(','));
    cards.push(cells);
  }
  return cards;
}

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > 8) throw new Error('Bingo is for 2 to 8 players');
  const o = options || {};
  const g = {
    game: 'bingo',
    n,
    players: players.map((p) => ({ id: p.id, name: p.name, bot: p.bot === true })),
    rng,
    options: {
      pattern: o.pattern === 'full' ? 'full' : 'line',
      speed: Object.hasOwn(SPEEDS, o.speed) ? o.speed : 'normal',
      autoMark: o.autoMark === true,
    },
    cards: dealCards(n, rng),
    marks: players.map(() => new Set()), // called numbers each player has marked
    deck: shuffled(rng, 1, 75),
    called: [], // in call order
    phase: 'playing', // playing | gameOver
    winners: [],
    event: null, // the latest event: { type: 'call', n, seq } or { type: 'over', winners, by, calls, seq }
    seq: 0, // event counter (the feed and the sounds use it to skip what they already showed)
    version: 0,
  };
  return g;
}

const isMarked = (g, i, k) => g.cards[i][k] === 0 || g.marks[i].has(g.cards[i][k]);

function hasBingo(g, i) {
  const full = g.options.pattern === 'full';
  if (full) return ALL.every((k) => isMarked(g, i, k));
  return LINES.some((line) => line.every((k) => isMarked(g, i, k)));
}

function finish(g, winners, by = null) {
  g.phase = 'gameOver';
  g.winners = winners;
  g.seq++;
  g.event = { type: 'over', winners: winners.slice(), by, calls: g.called.length, seq: g.seq };
}

/** Call the next number. Bots mark it and call Bingo the moment they can. */
function callNext(g) {
  if (g.phase !== 'playing') return { ok: false, error: 'The game is over' };
  const n = g.deck.pop();
  g.called.push(n);
  g.seq++;
  g.event = { type: 'call', n, seq: g.seq };
  g.players.forEach((p, i) => {
    if ((p.bot || g.options.autoMark) && g.cards[i].includes(n)) g.marks[i].add(n);
  });
  const bots = g.players.map((_, i) => i).filter((i) => g.players[i].bot && hasBingo(g, i));
  if (bots.length) finish(g, bots, bots[0]);
  else if (!g.deck.length) finish(g, []); // every number is out and nobody called Bingo
  return { ok: true };
}

/**
 * action: { type: 'mark', n } | { type: 'claim' }. The server calls with playerId null and { type: 'call' } on its timer.
 */
function applyAction(g, playerId, action) {
  if (playerId === null) {
    if (action && action.type === 'call') return callNext(g);
    return { ok: false, error: 'Invalid action' };
  }
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0) return { ok: false, error: 'You are not playing this game' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  if (action.type === 'mark') {
    if (g.options.autoMark) return { ok: false, error: 'Numbers mark themselves at this table' };
    const n = action.n;
    if (!Number.isInteger(n) || n < 1 || n > 75) return { ok: false, error: 'Pick a number' };
    if (!g.called.includes(n)) return { ok: false, error: 'That number has not been called yet' };
    if (!g.cards[who].includes(n)) return { ok: false, error: 'That number is not on your card' };
    if (g.marks[who].has(n)) return { ok: false, error: 'You have already marked that number' };
    g.marks[who].add(n);
    g.version++;
    return { ok: true };
  }
  if (action.type === 'claim') {
    if (!hasBingo(g, who)) return { ok: false, error: 'That is not a Bingo yet' };
    finish(g, [who], who);
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action' };
}

/** Players do not take turns, so nothing is awaited. The server's timer calls the next number (autoAction). */
const awaiting = () => [];
const autoAction = (g) => (g.phase === 'playing' ? { type: 'call' } : null);
const autoDelayMs = (g) => SPEEDS[g.options.speed];

/** Positions only: `full` = squares in a completed line, `near` = the open square of each line with four marked. */
function lineState(squares) {
  const full = new Set();
  const near = new Set();
  for (const line of LINES) {
    const open = line.filter((k) => !squares[k]);
    if (open.length === 0) line.forEach((k) => full.add(k));
    else if (open.length === 1) near.add(open[0]);
  }
  return { full: [...full].sort((a, b) => a - b), near: [...near].filter((k) => !full.has(k)).sort((a, b) => a - b) };
}

function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const over = g.phase === 'gameOver';
  return {
    game: 'bingo',
    me,
    n: g.n,
    phase: g.phase,
    options: { ...g.options },
    myTurn: false, // nobody takes turns
    // every player's progress is public: which squares are marked (a 5x5 matrix of booleans, free square included), never the numbers
    players: g.players.map((p, i) => {
      const squares = g.cards[i].map((_, k) => isMarked(g, i, k));
      return { id: p.id, name: p.name, bot: p.bot, marked: g.marks[i].size, squares, ...lineState(squares) };
    }),
    // your own card only: other people's numbers are not shown
    card: me >= 0 ? g.cards[me].map((n, k) => ({ n, free: k === FREE, marked: isMarked(g, me, k) })) : [],
    called: g.called.slice(),
    lastCall: g.called.length ? g.called[g.called.length - 1] : null,
    lastLetter: g.called.length ? letterOf(g.called[g.called.length - 1]) : null,
    toGo: g.deck.length,
    canClaim: !over && me >= 0 && hasBingo(g, me),
    winners: over ? g.winners.slice() : [],
    event: g.event ? { ...g.event } : null,
  };
}

/** Score for the stats: the numbers that were called when a player won (fewer is better), 0 for everyone else. */
function results(g) {
  return g.players.map((_, i) => ({ score: g.winners.includes(i) ? g.called.length : 0, winner: g.winners.includes(i) }));
}

module.exports = {
  LETTERS, FREE, LINES, SPEEDS, letterOf, makeCard, dealCards, createGame, applyAction, awaiting, autoAction, autoDelayMs, hasBingo, viewFor, results,
};
