'use strict';
/**
 * Sea Battle (two players), rules only: no sockets, no timers.
 *
 * Each player has a 10 x 10 sea with a fleet of five ships (lengths 5, 4, 3, 3 and 2). The fleets are placed at random when
 * the game starts and nobody sees the other fleet. Players take turns firing at one square of the other sea. A hit or a
 * miss is public; a ship that is hit on every square is sunk, and its squares are shown to everyone. The first player to
 * sink every enemy ship wins. Ships never touch, including at corners.
 *
 * Cells are numbered r * 10 + c. Shots are stored per target sea: 'miss', 'hit' or 'sunk' (a sunk ship's squares are 'sunk').
 * A view shows both seas' shots, and only the viewer's own fleet.
 */

const N = 10;
const LENGTHS = [5, 4, 3, 3, 2];
const CELLS = N * N;
const PACE_MS = { slow: 3000, normal: 2000, quick: 1200 };

const neighbours = (k) => {
  const r = Math.floor(k / N), c = k % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if ((dr || dc) && rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
  }
  return out;
};

/** Places the five ships at random without touching. A rare dead end starts the fleet again. */
function placeFleet(rng) {
  for (;;) {
    const taken = new Set();
    const ships = [];
    let ok = true;
    for (const len of LENGTHS) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const horizontal = rng() < 0.5;
        const r = Math.floor(rng() * (horizontal ? N : N - len + 1));
        const c = Math.floor(rng() * (horizontal ? N - len + 1 : N));
        const cells = Array.from({ length: len }, (_, i) => (horizontal ? r * N + c + i : (r + i) * N + c));
        const touching = cells.some((k) => taken.has(k) || neighbours(k).some((n) => taken.has(n)));
        if (touching) continue;
        cells.forEach((k) => taken.add(k));
        ships.push({ cells, hits: 0 });
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
}

const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };

function createGame(players, options = {}, rng = Math.random, now = Date.now) {
  if (players.length !== 2) throw new Error('Sea Battle is for two players');
  const pace = PACE_MS[options.pace] ? options.pace : 'normal';
  return {
    game: 'seabattle',
    players: players.map((p) => ({ id: p.id, name: p.name })),
    options: { pace },
    fleets: [placeFleet(rng), placeFleet(rng)],   // fleets[i] is player i's ships; only the owner's view shows them
    shots: [Array(CELLS).fill(null), Array(CELLS).fill(null)], // shots[i]: the sea of player i, as fired at
    sunk: [0, 0],                                 // ships each player has sunk
    turn: 0,
    phase: 'playing', // playing | gameOver
    winner: null,
    event: null, log: [], seq: 0, version: 0,
    rng, now,
    due: [0, 0],
    startedAt: now(),
  };
}

const fail = (error) => ({ ok: false, error });

function applyAction(g, playerId, action) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0) return fail('You are not a player in this game');
  if (g.phase === 'gameOver') return fail('The game is over');
  if (g.turn !== who) return fail('Not your turn');
  if (!action || typeof action !== 'object' || action.type !== 'fire') return fail('Unknown action');
  const { r, c } = action;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) return fail('No such square');
  const target = 1 - who;
  const k = r * N + c;
  if (g.shots[target][k]) return fail('That square has already been fired at');

  const ship = g.fleets[target].find((s) => s.cells.includes(k));
  if (!ship) {
    g.shots[target][k] = 'miss';
    g.turn = target;
    g.version++;
    emit(g, { type: 'miss', by: who, k });
    return { ok: true };
  }
  ship.hits++;
  g.version++;
  if (ship.hits === ship.cells.length) {
    ship.cells.forEach((cell) => { g.shots[target][cell] = 'sunk'; });
    g.sunk[who]++;
    if (g.fleets[target].every((s) => s.hits === s.cells.length)) {
      g.phase = 'gameOver';
      g.winner = who;
      emit(g, { type: 'over', by: who, k, length: ship.cells.length, winner: who });
      return { ok: true };
    }
    emit(g, { type: 'sunk', by: who, k, length: ship.cells.length, cells: ship.cells.slice() });
  } else {
    g.shots[target][k] = 'hit';
    emit(g, { type: 'hit', by: who, k });
  }
  // a hit or a sinking still passes the turn, as a miss does: each player fires once per turn
  g.turn = target;
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);

// ------------------------------------------------------------------------------------------------ bots (public information only)

/** Hunt and target: squares next to a hit that is not yet sunk come first; otherwise a random square of a chequerboard. */
function botAction(g, playerId, rng = g.rng) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0 || g.phase === 'gameOver' || g.turn !== who) return null;
  const sea = g.shots[1 - who];
  const open = [];
  for (let k = 0; k < CELLS; k++) if (!sea[k]) open.push(k);
  if (!open.length) return null;
  const hunting = [];
  for (let k = 0; k < CELLS; k++) if (sea[k] === 'hit') for (const n of neighbours(k)) if (!sea[n]) hunting.push(n);
  const pool = hunting.length ? hunting : open.filter((k) => ((Math.floor(k / N) + (k % N)) % 2) === 0);
  const choices = pool.length ? pool : open;
  const k = choices[Math.floor(rng() * choices.length)];
  return { type: 'fire', r: Math.floor(k / N), c: k % N };
}

/** The delay before a bot fires (bots are timed by Bot speed). */
function botDelayMs(g) {
  return Math.round(PACE_MS[g.options.pace] * (0.75 + g.rng() * 0.5));
}

/** What a player sees: both seas' shots (public), and only their own fleet. */
function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const fleet = me >= 0 ? Array(CELLS).fill(null) : null;
  if (me >= 0) {
    g.fleets[me].forEach((s) => s.cells.forEach((k) => { fleet[k] = s.hits === s.cells.length ? 'sunk' : s.hits ? 'hit' : 'ship'; }));
    // the shots the enemy has fired at my sea: a miss on water shows as a miss
    g.shots[me].forEach((state, k) => { if (state === 'miss' && !fleet[k]) fleet[k] = 'miss'; });
  }
  return {
    me, phase: g.phase, options: { ...g.options }, N,
    players: g.players.map((p, i) => ({
      id: p.id, name: p.name, sunk: g.sunk[i], left: g.fleets[i].filter((s) => s.hits < s.cells.length).length,
    })),
    shots: g.shots.map((sea) => sea.slice()),   // shots[i]: fired at player i's sea
    fleet,                                       // my sea, with my ships and the shots I have taken
    turn: g.turn,
    myTurn: me >= 0 && me === g.turn && g.phase === 'playing',
    winner: g.winner,
    event: g.event ? { ...g.event } : null,
  };
}

/** Score is the number of ships sunk; the winner sank the whole fleet. */
function results(g) {
  return g.players.map((_, i) => ({ score: g.sunk[i], winner: g.winner === i, draw: false }));
}

module.exports = { N, LENGTHS, PACE_MS, createGame, applyAction, awaiting, botAction, botDelayMs, viewFor, results, placeFleet, neighbours };
