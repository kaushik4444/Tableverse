'use strict';
/**
 * Carrom for two to four players. The physics is in physics.js; this file holds the rules and the table state.
 *
 * Sides and teams: each seat sits on one side of the board. Two players sit opposite each other; three or four take the
 * sides in turn order. Seats 0 and 2 play White and seats 1 and 3 play Black, so partners sit opposite each other and
 * share a colour. Turns go round in seat order.
 *
 * The simulation always runs in the bottom side's frame (the first seat's baseline at the bottom). A seat's shot is given
 * in its own frame and rotated into that frame. Action: { type: 'flick', x, angle, power } or { type: 'resign' }, where
 * x is the striker's position along the seat's own baseline (0.2 to 0.8), angle is in radians from straight ahead
 * (positive to the player's right, at most 75 degrees) and power is 0 to 1.
 *
 * Rules (simplified):
 *  - Your team pockets its own colour. Pocket all nine coins of your colour, with the queen held, to win for your team.
 *  - The queen is covered when your team pockets it in the same shot as one of its coins, or once it has all nine. A
 *    covered queen is held by the team; an uncovered one goes back to the centre.
 *  - Pocketing one of your own coins gives you another shot. Any other shot passes the turn.
 *  - Coins of the other colour that are pocketed go back to the centre.
 *  - Foul: the striker is pocketed. Every coin pocketed on that shot goes back, and one coin the team holds goes back too.
 *  - The striker is taken off the board after each shot and placed again from the baseline each turn.
 */
const P = require('./physics');
const pacing = require('../pacing');

const COINS_EACH = 9;
const MAX_SHOTS = 300; // a safety limit against a game that never finishes; it is a draw
const BASE_Y = 0.12;   // the baseline of each side, in the bottom side's frame
const STRIKER_X = [0.2, 0.8];
const COIN_SPACING = 2 * P.RADIUS.coin;

/** Rotate a point about the centre by k quarter turns, counter-clockwise (k = 1 moves the bottom side to the right). */
function rotPoint([x, y], k) {
  let p = [x, y];
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) p = [1 - p[1], p[0]];
  return p;
}
/** The same rotation applied to a direction (no centre). */
function rotVector([x, y], k) {
  let v = [x, y];
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) v = [-v[1], v[0]];
  return v;
}

/** The sides used by a table of n players, in seat order. */
function sidesFor(n) {
  if (n === 2) return [0, 2];
  if (n === 3) return [0, 1, 2];
  return [0, 1, 2, 3];
}
const colourOf = (seat) => (seat % 2 === 0 ? 'w' : 'b');
const forwardOf = () => 1;

/** The opening layout: a queen in the centre and nine coins of each colour in two hexagonal rings, alternating. */
/** The opening, as on a real board: the queen in the centre, then a ring of six and a ring of twelve, the colours alternating round each ring. */
function opening() {
  const cells = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
    if (Math.abs(a + b) > 2) continue;
    const x = 0.5 + COIN_SPACING * (a + b / 2), y = 0.5 + COIN_SPACING * (b * Math.sqrt(3) / 2);
    cells.push({ x, y, ring: Math.max(Math.abs(a), Math.abs(b), Math.abs(a + b)), angle: Math.atan2(y - 0.5, x - 0.5) });
  }
  const colourAt = new Map();
  for (const ring of [1, 2]) {
    cells.filter((c) => c.ring === ring).sort((p, q) => p.angle - q.angle).forEach((c, i) => colourAt.set(c, i % 2 === 0 ? 'w' : 'b'));
  }
  const coins = [];
  let n = 0;
  for (const c of cells) {
    if (c.ring === 0) { coins.push({ id: 'q', kind: 'queen', colour: null, x: c.x, y: c.y, r: P.RADIUS.queen }); continue; }
    n++;
    coins.push({ id: 'c' + n, kind: 'coin', colour: colourAt.get(c), x: c.x, y: c.y, r: P.RADIUS.coin });
  }
  return coins;
}

function createGame(players) {
  return {
    players: players.map((p, seat) => ({ id: p.id, name: p.name, seat, side: sidesFor(players.length)[seat], colour: colourOf(seat) })),
    sides: sidesFor(players.length),
    coins: opening(),           // coins and the queen on the board, in the bottom side's frame
    score: { w: 0, b: 0 },      // own-colour coins held by each team
    queenHeld: null,            // the colour of the team holding the queen
    turn: 0,
    phase: 'playing',
    winner: null,               // the colour that won
    finisher: null,             // the seat that pocketed the last coin
    draw: false,
    reason: null,
    shots: 0,
    nextId: COINS_EACH * 2 + 1, // the opening uses q, c1 to c18: returned discs start after them, so ids stay unique
    shot: null,                 // the last shot: { seq, seat, colour, foul, scored, keyframes, events, pocketed }
    seq: 0,
    log: [],
  };
}

const seatOf = (g, playerId) => g.players.findIndex((p) => p.id === playerId);

/** A free spot near the centre for a disc going back on the board: the first one that touches no other disc. */
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
  return { x: 0.5, y: 0.5 };
}

/** Plans a flick without changing the game. Returns { error } or { next, shot, winner, extra, nextTurn }. */
function plan(g, seat, a) {
  if (!a || typeof a !== 'object' || a.type !== 'flick') return { error: 'Invalid action' };
  const { x, angle, power } = a;
  if (![x, angle, power].every(Number.isFinite)) return { error: 'Invalid action' };
  if (x < STRIKER_X[0] || x > STRIKER_X[1]) return { error: 'Place the striker on your baseline' };
  if (Math.abs(angle) > P.ANGLE_LIMIT + 1e-9) return { error: 'Aim within 75 degrees of straight ahead' };
  if (power <= 0 || power > 1) return { error: 'Choose a power between 0 and 1' };

  const colour = colourOf(seat);
  const k = g.sides[seat];
  const [sx, sy] = rotPoint([x, BASE_Y], k);
  const r = P.RADIUS.striker;
  if (g.coins.some((c) => Math.hypot(c.x - sx, c.y - sy) < c.r + r)) return { error: 'The striker overlaps a piece' };
  const local = P.flickVelocity(angle, power, forwardOf());
  const [vx, vy] = rotVector([local.vx, local.vy], k);
  const striker = { id: 'striker', kind: 'striker', colour, x: sx, y: sy, vx, vy, r };
  const res = P.simulate([...g.coins.map((c) => ({ ...c, vx: 0, vy: 0 })), striker]);

  const foul = res.pocketed.some((p) => p.kind === 'striker');
  const own = res.pocketed.filter((p) => p.kind === 'coin' && p.colour === colour);
  const queenIn = res.pocketed.some((p) => p.kind === 'queen');
  const score = { ...g.score };
  let queenHeld = g.queenHeld;
  const back = []; // discs going back on the board: { kind, colour }
  if (foul) {
    for (const p of res.pocketed) if (p.kind !== 'striker') back.push({ kind: p.kind, colour: p.colour });
    if (score[colour] > 0) { score[colour] -= 1; back.push({ kind: 'coin', colour }); }
  } else {
    score[colour] += own.length;
    for (const p of res.pocketed) if (p.kind === 'coin' && p.colour !== colour) back.push({ kind: 'coin', colour: p.colour });
    if (queenIn) {
      const covered = own.length > 0 || g.score[colour] >= COINS_EACH;
      if (covered) queenHeld = colour;
      else back.push({ kind: 'queen', colour: null });
    }
  }

  // The new board: what stayed on it (the striker is taken off), then the discs going back.
  const coins = res.discs.filter((d) => d.kind !== 'striker').map(({ id, kind, colour: c, x: px, y: py, r: pr }) => ({ id, kind, colour: c, x: px, y: py, r: pr }));
  let nextId = g.nextId;
  for (const b of back) {
    const rr = P.RADIUS[b.kind === 'queen' ? 'queen' : 'coin'];
    const spot = freeSpot(coins, rr);
    coins.push({ id: (b.kind === 'queen' ? 'q' : 'c') + (nextId++), kind: b.kind, colour: b.colour, x: spot.x, y: spot.y, r: rr });
  }

  const winner = !foul && score[colour] >= COINS_EACH && queenHeld === colour ? colour : null;
  const extra = !foul && own.length > 0 && winner === null;
  const shot = {
    seat, colour, foul, scored: foul ? 0 : own.length, keyframes: res.keyframes, events: res.events,
    pocketed: res.pocketed.map((p) => ({ kind: p.kind, colour: p.colour })),
  };
  const nextTurn = extra ? seat : (seat + 1) % g.players.length;
  return { next: { coins, score, queenHeld, nextId }, shot, winner, extra, nextTurn };
}

function finish(g, { winner, seat, draw, reason }) {
  g.phase = 'gameOver';
  g.winner = winner;
  g.finisher = seat === undefined ? null : seat;
  g.draw = !!draw;
  g.reason = reason;
}

const teamName = (g, colour) => g.players.filter((p) => p.colour === colour).map((p) => p.name).join(' & ');

function applyAction(g, playerId, action) {
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  if (g.phase !== 'playing') return { ok: false, error: 'The game is over' };
  const seat = seatOf(g, playerId);
  if (seat < 0) return { ok: false, error: 'Not a player at this table' };
  if (action.type === 'resign') {
    // Any seated player may resign at any time; the other colour wins (a three-player table has two seats of one colour).
    finish(g, { winner: colourOf(seat) === 'w' ? 'b' : 'w', seat: null, reason: 'resignation' });
    g.log.push(`${g.players[seat].name} resigned`);
    return { ok: true };
  }
  if (seat !== g.turn) return { ok: false, error: 'Not your turn' };
  // a flick names the board it was aimed at: a duplicate sent before the new board arrived must not play on it
  if (action.seq !== g.seq) return { ok: false, error: 'The table changed before your shot: aim again' };
  const p = plan(g, seat, action);
  if (p.error) return { ok: false, error: p.error };

  g.coins = p.next.coins;
  g.score = p.next.score;
  g.queenHeld = p.next.queenHeld;
  g.nextId = p.next.nextId;
  g.shots += 1;
  g.shot = { ...p.shot, seq: ++g.seq };
  // the bot waits until this shot has been played out, plus a short pause to read it (people are never held)
  pacing.holdLatest(g, p.shot.keyframes[p.shot.keyframes.length - 1].t * 1000 + 400);
  const name = g.players[seat].name;
  g.log.push(p.shot.foul ? `${name}: foul, the striker was pocketed`
    : p.shot.scored ? `${name} pocketed ${p.shot.scored} ${p.shot.colour === 'w' ? 'white' : 'black'}`
    : `${name} missed`);
  if (p.winner !== null) { finish(g, { winner: p.winner, seat, reason: 'all nine coins' }); return { ok: true }; }
  if (g.shots >= MAX_SHOTS) { finish(g, { winner: null, draw: true, reason: 'move limit' }); return { ok: true }; }
  g.turn = p.nextTurn;
  return { ok: true };
}

function viewFor(g, playerId) {
  const me = seatOf(g, playerId);
  const myTurn = g.phase === 'playing' && me >= 0 && me === g.turn;
  return {
    game: 'carrom',
    name: 'Carrom',
    phase: g.phase,
    players: g.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, side: p.side, colour: p.colour })),
    me,
    mySide: me >= 0 ? g.sides[me] : 0,
    myTurn,
    turn: g.turn,
    colours: g.players.map((p) => p.colour),
    board: g.coins.map((c) => ({ id: c.id, kind: c.kind, colour: c.colour, x: c.x, y: c.y, r: c.r })),
    score: { ...g.score },
    queenHeld: g.queenHeld,
    shots: g.shots,
    seq: g.seq,
    shot: g.shot,
    log: g.log.slice(-8),
    winner: g.phase === 'gameOver' ? g.winner : null,
    winnerNames: g.phase === 'gameOver' && g.winner ? teamName(g, g.winner) : null,
    finisher: g.phase === 'gameOver' ? g.finisher : null,
    draw: g.phase === 'gameOver' && g.draw,
    reason: g.reason,
  };
}

/**
 * A simple bot: tries random flicks on a copy of the table and plays the one that pockets the most of its team's coins,
 * avoiding fouls and not pocketing the other colour. Deterministic for a given rng.
 */
function botAction(g, seat, rng) {
  const cands = [];
  for (let i = 0; i < 16; i++) {
    cands.push({ type: 'flick', x: STRIKER_X[0] + (STRIKER_X[1] - STRIKER_X[0]) * rng(), angle: (rng() * 2 - 1) * 0.9, power: 0.45 + 0.55 * rng(), seq: g.seq });
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
  // a fine grid across the baseline, both ends included: a narrow gap between coins (about 0.0005 wide) is found, and only clear spots go to the rules
  const [lo, hi] = STRIKER_X, steps = 4000;
  const clear = (x) => {
    const [sx, sy] = rotPoint([x, BASE_Y], g.sides[seat]);
    return !g.coins.some((c) => Math.hypot(c.x - sx, c.y - sy) < c.r + P.RADIUS.striker);
  };
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    if (!clear(x)) continue;
    const a = { type: 'flick', x, angle: 0, power: 0.6, seq: g.seq };
    if (!plan(g, seat, a).error) return a;
  }
  return { type: 'resign' };
}

module.exports = { COINS_EACH, BASE_Y, STRIKER_X, createGame, plan, applyAction, viewFor, botAction, seatOf, opening, freeSpot, rotPoint, rotVector, sidesFor, colourOf };
