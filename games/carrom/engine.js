'use strict';
/**
 * Carrom for two players (one colour each). The physics is in physics.js; this file holds the rules and the table state.
 *
 * Seats: the first seat plays White from the bottom baseline, the second plays Black from the top. Each player flicks the
 * striker from their own baseline (x is measured from their own left, so the board turns for the far player).
 * Action: { type: 'flick', x, angle, power } or { type: 'resign' }.
 *
 * Rules (first version, deliberately simple):
 *  - Pocket all nine of your own coins to win. The queen is covered when you pocket it in the same shot as one of your
 *    coins, or once you have all nine; a covered queen is held by you. An uncovered queen goes back to the centre.
 *  - Pocketing one of your own coins gives you another shot. Any other shot passes the turn.
 *  - Coins of the other colour that you pocket go back to the centre.
 *  - Foul: the striker is pocketed. Every coin pocketed on that shot goes back, and one coin you already hold goes back too.
 *  - The striker is taken off the board after each shot, so it is placed again from the baseline each turn.
 */
const P = require('./physics');

const COINS_EACH = 9;
const MAX_SHOTS = 300; // a safety limit against a game that never finishes; it is a draw
const BASE_Y = [0.12, 0.88];
const STRIKER_X = [0.2, 0.8];
const COIN_SPACING = 2 * P.RADIUS.coin;
const COLOURS = ['w', 'b'];

const forward = (seat) => (seat === 0 ? 1 : -1);
const colourOf = (seat) => COLOURS[seat];
const boardX = (seat, x) => (seat === 0 ? x : 1 - x);

/** The opening layout: a queen in the centre and nine coins of each colour in two hexagonal rings, alternating. */
function opening() {
  const coins = [];
  let n = 0;
  const pts = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
    if (Math.abs(a + b) > 2) continue;
    pts.push([a, b]);
  }
  for (const [a, b] of pts) {
    const x = 0.5 + COIN_SPACING * (a + b / 2), y = 0.5 + COIN_SPACING * (b * Math.sqrt(3) / 2);
    if (a === 0 && b === 0) { coins.push({ id: 'q', kind: 'queen', colour: null, x, y, r: P.RADIUS.queen }); continue; }
    const colour = COLOURS[n++ % 2];
    coins.push({ id: 'c' + n, kind: 'coin', colour, x, y, r: P.RADIUS.coin });
  }
  return coins;
}

function createGame(players) {
  return {
    players: players.map((p) => ({ id: p.id, name: p.name })),
    coins: opening(),          // coins and the queen on the board
    score: [0, 0],             // own coins held by each seat
    queenHeld: null,           // seat holding the queen
    turn: 0,
    phase: 'playing',
    winner: null,
    draw: false,
    reason: null,
    shots: 0,
    nextId: 1,
    shot: null,                // the last shot: { seq, seat, keyframes, pocketed, foul, scored }
    seq: 0,
    log: [],
  };
}

const seatOf = (g, playerId) => g.players.findIndex((p) => p.id === playerId);

/** A free spot near the centre for a disc going back on the board: the first one not touching another disc. */
function freeSpot(coins, r) {
  for (let ring = 0; ring <= 12; ring++) {
    const steps = ring === 0 ? 1 : ring * 6;
    for (let k = 0; k < steps; k++) {
      const rad = ring * COIN_SPACING * 0.75;
      const ang = (2 * Math.PI * k) / steps;
      const x = 0.5 + rad * Math.cos(ang), y = 0.5 + rad * Math.sin(ang);
      if (x < r || x > 1 - r || y < r || y > 1 - r) continue;
      if (coins.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + 0.002)) return { x, y };
    }
  }
  return { x: 0.5, y: 0.5 }; // the board is full: a very unlikely case, the disc is placed at the centre
}

/**
 * Plans a flick without changing the game. Returns { error } or { next, shot, winner, extra }. The caller commits `next`.
 */
function plan(g, seat, a) {
  if (!a || typeof a !== 'object' || a.type !== 'flick') return { error: 'Invalid action' };
  const { x, angle, power } = a;
  if (![x, angle, power].every(Number.isFinite)) return { error: 'Invalid action' };
  if (x < STRIKER_X[0] || x > STRIKER_X[1]) return { error: 'Place the striker on your baseline' };
  if (Math.abs(angle) > P.ANGLE_LIMIT + 1e-9) return { error: 'Aim within 75 degrees of straight ahead' };
  if (power <= 0 || power > 1) return { error: 'Choose a power between 0 and 1' };

  const colour = colourOf(seat);
  const sx = boardX(seat, x), sy = BASE_Y[seat];
  const r = P.RADIUS.striker;
  if (g.coins.some((c) => Math.hypot(c.x - sx, c.y - sy) < c.r + r)) return { error: 'The striker overlaps a piece' };
  const v = P.flickVelocity(angle, power, forward(seat));
  const striker = { id: 'striker', kind: 'striker', colour, x: sx, y: sy, vx: v.vx, vy: v.vy, r };
  const res = P.simulate([...g.coins.map((c) => ({ ...c, vx: 0, vy: 0 })), striker]);

  const foul = res.pocketed.some((p) => p.kind === 'striker');
  const own = res.pocketed.filter((p) => p.kind === 'coin' && p.colour === colour);
  const queenIn = res.pocketed.some((p) => p.kind === 'queen');
  const score = [...g.score];
  let queenHeld = g.queenHeld;
  const back = []; // discs going back on the board: { kind, colour }
  if (foul) {
    for (const p of res.pocketed) if (p.kind !== 'striker') back.push({ kind: p.kind, colour: p.colour });
    if (score[seat] > 0) { score[seat] -= 1; back.push({ kind: 'coin', colour }); }
  } else {
    score[seat] += own.length;
    for (const p of res.pocketed) if (p.kind === 'coin' && p.colour !== colour) back.push({ kind: 'coin', colour: p.colour });
    if (queenIn) {
      const covered = own.length > 0 || g.score[seat] >= COINS_EACH;
      if (covered) queenHeld = seat;
      else back.push({ kind: 'queen', colour: null });
    }
  }

  // The new board: what stayed on it (the striker is taken off), then the discs going back.
  const coins = res.discs.filter((d) => d.kind !== 'striker').map(({ id, kind, colour: c, x: px, y: py, r: pr }) => ({ id, kind, colour: c, x: px, y: py, r: pr }));
  let nextId = g.nextId;
  for (const b of back) {
    const spot = freeSpot(coins, P.RADIUS[b.kind === 'queen' ? 'queen' : 'coin']);
    coins.push({ id: (b.kind === 'queen' ? 'q' : 'c') + (nextId++), kind: b.kind, colour: b.colour, x: spot.x, y: spot.y, r: P.RADIUS[b.kind === 'queen' ? 'queen' : 'coin'] });
  }

  const winner = !foul && score[seat] >= COINS_EACH && queenHeld === seat ? seat : null;
  const extra = !foul && own.length > 0 && winner === null;
  const shot = {
    seat, foul, scored: foul ? 0 : own.length, keyframes: res.keyframes,
    pocketed: res.pocketed.map((p) => ({ kind: p.kind, colour: p.colour })),
  };
  return { next: { coins, score, queenHeld, nextId }, shot, winner, extra };
}

function finish(g, winner, reason) {
  g.phase = 'gameOver';
  g.winner = winner;
  g.draw = winner === null;
  g.reason = reason;
}

function applyAction(g, playerId, action) {
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  if (g.phase !== 'playing') return { ok: false, error: 'The game is over' };
  const seat = seatOf(g, playerId);
  if (seat < 0 || seat !== g.turn) return { ok: false, error: 'Not your turn' };
  if (action.type === 'resign') {
    finish(g, 1 - seat, 'resignation');
    g.log.push(`${g.players[seat].name} resigned`);
    return { ok: true };
  }
  const p = plan(g, seat, action);
  if (p.error) return { ok: false, error: p.error };

  g.coins = p.next.coins;
  g.score = p.next.score;
  g.queenHeld = p.next.queenHeld;
  g.nextId = p.next.nextId;
  g.shots += 1;
  g.shot = { ...p.shot, seq: ++g.seq };
  const name = g.players[seat].name;
  g.log.push(p.shot.foul ? `${name}: foul, the striker was pocketed` : p.shot.scored ? `${name} pocketed ${p.shot.scored}` : `${name} missed`);
  if (p.winner !== null) return finishAndReturn(g, p.winner, 'all nine coins');
  if (g.shots >= MAX_SHOTS) return finishAndReturn(g, null, 'move limit');
  if (!p.extra) g.turn = 1 - seat;
  return { ok: true };
}

function finishAndReturn(g, winner, reason) { finish(g, winner, reason); return { ok: true }; }

function viewFor(g, playerId) {
  const me = seatOf(g, playerId);
  const myTurn = g.phase === 'playing' && me >= 0 && me === g.turn;
  return {
    game: 'carrom',
    name: 'Carrom',
    phase: g.phase,
    players: g.players,
    me,
    myTurn,
    turn: g.turn,
    colours: COLOURS,
    board: g.coins.map((c) => ({ id: c.id, kind: c.kind, colour: c.colour, x: c.x, y: c.y, r: c.r })),
    score: g.score.slice(),
    queenHeld: g.queenHeld,
    shot: g.shot,
    log: g.log.slice(-8),
    winner: g.phase === 'gameOver' ? g.winner : null,
    draw: g.phase === 'gameOver' && g.draw,
    reason: g.reason,
  };
}

/**
 * A simple bot: tries a set of random flicks on a copy of the table and plays the one that pockets the most of its own coins,
 * avoiding fouls and not pocketing the other colour. Deterministic for a given rng.
 */
function botAction(g, seat, rng) {
  const cands = [];
  for (let i = 0; i < 16; i++) {
    cands.push({ type: 'flick', x: STRIKER_X[0] + (STRIKER_X[1] - STRIKER_X[0]) * rng(), angle: (rng() * 2 - 1) * 0.9, power: 0.45 + 0.55 * rng() });
  }
  let best = null, bestScore = -Infinity;
  for (const a of cands) {
    const p = plan(g, seat, a);
    if (p.error) continue;
    const other = p.shot.pocketed.filter((x) => x.kind === 'coin' && x.colour !== colourOf(seat)).length;
    const score = p.shot.scored * 10 - (p.shot.foul ? 12 : 0) - other * 4 + (p.winner !== null ? 50 : 0) + rng() * 0.1;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  if (best) return best;
  // Nothing valid among the random shots: try the centre of the baseline with a gentle flick.
  for (let x = STRIKER_X[0]; x <= STRIKER_X[1]; x += 0.02) {
    const a = { type: 'flick', x, angle: 0, power: 0.6 };
    if (!plan(g, seat, a).error) return a;
  }
  return { type: 'resign' };
}

module.exports = { COINS_EACH, createGame, plan, applyAction, viewFor, botAction, seatOf, opening, freeSpot, COLOURS, BASE_Y, STRIKER_X };
