'use strict';
/**
 * Snakes and Ladders: the rules only (no sockets, no timers).
 * 2-4 players race along a 10x10 board numbered 1-100 (every second row runs the other way, so the path snakes up the
 * board). Everyone starts off the board on square 0. On your turn roll one die and move that many squares. A ladder
 * foot lifts you up to its top; a snake head drops you down to its tail. First to reach square 100 wins.
 *
 * Options: `exactFinish` (default on) needs the exact number to land on 100, otherwise you stay put. `sixAgain`
 * (default on) gives another roll after a six; a third six in a row ends your turn with no move, as in Ludo.
 * The board is this game's own layout, fixed for every game so players can learn it.
 */
const pacing = require('../pacing');
// Milliseconds the clients take to walk a token one square, to slide it along a ladder or snake, and the pause after (public/games/snakesladders.js)
const WALK = { step: 480, jump: 1400, settle: 1400 };
const SIZE = 100;
const LADDERS = { 4: 25, 9: 31, 20: 41, 28: 55, 40: 62, 51: 72, 63: 81, 71: 91 };
const SNAKES = { 17: 7, 27: 5, 47: 26, 56: 37, 64: 42, 87: 49, 93: 73, 95: 75, 98: 78 };
const JUMPS = { ...LADDERS, ...SNAKES };
const COLORS = ['red', 'blue', 'green', 'yellow'];

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind) => { g.log.push({ by: g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };
const bump = (g) => { g.version++; };

function createGame(players, options = {}, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > 4) throw new Error('Snakes and Ladders is for 2 to 4 players');
  return {
    game: 'snakesladders',
    n,
    players: players.map((p, i) => ({ id: p.id, name: p.name, color: COLORS[i] })),
    rng,
    options: { exactFinish: !options || options.exactFinish !== false, sixAgain: !options || options.sixAgain !== false },
    pos: players.map(() => 0),
    turn: 0,
    sixes: 0, // consecutive sixes by the player whose turn it is
    phase: 'playing', // playing | gameOver
    lastRoll: null, // { by, dice, seq } stays visible after the turn has passed
    winner: null,
    event: null,
    log: [],
    seq: 0,
    version: 0,
  };
}

function endTurn(g) {
  g.turn = (g.turn + 1) % g.n;
  g.sixes = 0;
  emit(g, { type: 'turn', by: g.turn });
}

function applyAction(g, playerId, action) {
  const who = indexOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (!action || typeof action !== 'object' || action.type !== 'roll') return { ok: false, error: 'Unknown action' };
  if (g.turn !== who) return { ok: false, error: 'Not your turn to roll' };

  const dice = Math.floor(g.rng() * 6) + 1;
  const from = g.pos[who];
  g.lastRoll = { by: who, dice, seq: g.seq + 1, from };
  if (dice === 6 && g.options.sixAgain && g.sixes === 2) {
    say(g, who, 'rolled three sixes in a row: turn over', 'miss');
    Object.assign(g.lastRoll, { landed: from, to: from, via: null, stuck: true, forfeited: true });
    emit(g, { type: 'rolled', by: who, dice, from, to: from, via: null, forfeited: true });
    endTurn(g);
    bump(g);
    return { ok: true };
  }
  g.sixes = dice === 6 ? g.sixes + 1 : 0;

  let landed = from + dice;
  if (landed > SIZE) landed = g.options.exactFinish ? from : SIZE;
  const stuck = landed === from;
  let to = landed;
  let via = null;
  if (!stuck && JUMPS[landed]) { to = JUMPS[landed]; via = LADDERS[landed] ? 'ladder' : 'snake'; }
  Object.assign(g.lastRoll, { landed, to, via, stuck });
  g.pos[who] = to;

  if (stuck) say(g, who, `rolled a ${dice}: needs exactly ${SIZE - from} to finish`, 'miss');
  else if (via === 'ladder') say(g, who, `rolled a ${dice}, climbed a ladder from ${landed} to ${to}`, 'ladder');
  else if (via === 'snake') say(g, who, `rolled a ${dice}, slid down a snake from ${landed} to ${to}`, 'snake');
  else say(g, who, `rolled a ${dice} and moved to ${to}`, 'roll');
  pacing.hold(g, 450 + (landed - from) * WALK.step + (to !== landed ? WALK.jump : 0) + WALK.settle); // the walk every client animates
  emit(g, { type: 'rolled', by: who, dice, from, landed, to, via, stuck });

  if (to === SIZE) {
    g.phase = 'gameOver';
    g.winner = who;
    say(g, who, 'reached 100 and won', 'win');
    emit(g, { type: 'won', by: who, dice, from, landed, to, via });
  } else if (dice === 6 && g.options.sixAgain) {
    // the same player rolls again
  } else {
    endTurn(g);
  }
  bump(g);
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);
const botAction = (g, playerId) => (g.phase !== 'gameOver' && indexOf(g, playerId) === g.turn ? { type: 'roll' } : null);

/** 1 for the winner, then by how far each got (ties keep seat order). */
function placings(g) {
  return g.players.map((_, i) => i).sort((a, b) => (b === g.winner) - (a === g.winner) || g.pos[b] - g.pos[a] || a - b);
}

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const over = g.phase === 'gameOver';
  return {
    game: 'snakesladders',
    me,
    n: g.n,
    size: SIZE,
    ladders: LADDERS,
    snakes: SNAKES,
    options: { ...g.options },
    players: g.players.map((p, i) => ({ id: p.id, name: p.name, color: p.color, pos: g.pos[i] })),
    turn: g.turn,
    phase: g.phase,
    lastRoll: g.lastRoll,
    myTurn: !over && me >= 0 && g.turn === me,
    canRoll: !over && me >= 0 && g.turn === me,
    winner: g.winner,
    placings: over ? placings(g) : null,
    event: g.event,
    log: g.log.slice(-30),
  };
}

module.exports = { SIZE, LADDERS, SNAKES, JUMPS, COLORS, createGame, applyAction, awaiting, botAction, viewFor, placings };
