'use strict';
const { slips } = require('../botSkill');
/**
 * Sea Battle (two players), rules only: no sockets, no timers.
 *
 * Each player has a 10 x 10 sea and a fleet of five ships (lengths 5, 4, 3, 3 and 2). In the placing phase every player puts
 * their ships on their own sea, by hand or with Random, and marks themselves ready. When both are ready, the first player
 * fires. Players take turns firing at one square of the other sea. A hit or a sinking keeps the turn, so the shooter fires again;
 * a miss passes it. A hit or a miss is public; a ship that is hit on every
 * square is sunk, and its squares are shown to everyone. The first player to sink every enemy ship wins. Ships never touch,
 * including at corners, and nobody sees the other fleet.
 *
 * Cells are numbered r * 10 + c. Shots are stored per target sea: 'miss', 'hit' or 'sunk' (a sunk ship's squares are 'sunk').
 * A setup is one entry per ship, in LENGTHS order: null (not placed yet) or { r, c, vertical }.
 */

const N = 10;
const LENGTHS = [5, 4, 3, 3, 2];
const CELLS = N * N;
// the time between a bot's shots: long enough to read the last shot before the next one
const PACE_MS = { slow: 4000, normal: 3000, quick: 2000 };

const neighbours = (k) => {
  const r = Math.floor(k / N), c = k % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if ((dr || dc) && rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
  }
  return out;
};

const shipCells = (len, p) => Array.from({ length: len }, (_, i) => (p.vertical ? (p.r + i) * N + p.c : p.r * N + p.c + i));
const inside = (len, p) => Number.isInteger(p.r) && Number.isInteger(p.c) && p.r >= 0 && p.c >= 0 && p.r < N && p.c < N
  && (p.vertical ? p.r + len <= N : p.c + len <= N);

/** Checks a whole setup (one entry per ship; null entries are not placed yet). Returns the placed ships' cells, or null. */
function checkSetup(setup) {
  if (!Array.isArray(setup) || setup.length !== LENGTHS.length) return null;
  const taken = new Set();
  const cellsOf = [];
  for (let i = 0; i < LENGTHS.length; i++) {
    const p = setup[i];
    if (p === null || p === undefined) { cellsOf.push(null); continue; }
    if (typeof p !== 'object' || typeof p.vertical !== 'boolean' || !inside(LENGTHS[i], p)) return null;
    const cells = shipCells(LENGTHS[i], p);
    if (cells.some((k) => taken.has(k) || neighbours(k).some((n) => taken.has(n)))) return null;
    cells.forEach((k) => taken.add(k));
    cellsOf.push(cells);
  }
  return cellsOf;
}

/** Candidate placements for one ship that do not touch the ships already placed. */
function candidatesFor(len, taken) {
  const out = [];
  for (const vertical of [false, true]) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const p = { r, c, vertical };
      if (!inside(len, p)) continue;
      const cells = shipCells(len, p);
      if (cells.some((k) => taken.has(k) || neighbours(k).some((n) => taken.has(n)))) continue;
      out.push({ p, cells });
    }
  }
  return out;
}

/**
 * A realistic random fleet: ships are spread over the whole sea rather than bunched up. Each ship is put where it is as far
 * from the others as a sample of the open squares allows, with a random pick among the best. A rare dead end starts again.
 */
function randomSetup(rng) {
  for (;;) {
    const taken = new Set();
    const centres = [];
    const setup = [];
    let ok = true;
    for (const len of LENGTHS) {
      const options = candidatesFor(len, taken);
      if (!options.length) { ok = false; break; }
      const sample = [];
      for (let i = 0; i < 40 && i < options.length * 3; i++) sample.push(options[Math.floor(rng() * options.length)]);
      const spread = (o) => {
        const cr = o.cells.reduce((s, k) => s + Math.floor(k / N), 0) / o.cells.length;
        const cc = o.cells.reduce((s, k) => s + (k % N), 0) / o.cells.length;
        return centres.length ? Math.min(...centres.map(([r, c]) => Math.abs(r - cr) + Math.abs(c - cc))) : 99;
      };
      let best = -1; let pool = [];
      for (const o of sample) {
        const s = spread(o);
        if (s > best) { best = s; pool = [o]; } else if (s === best) pool.push(o);
      }
      const pick = pool[Math.floor(rng() * pool.length)];
      pick.cells.forEach((k) => taken.add(k));
      centres.push([pick.cells.reduce((s, k) => s + Math.floor(k / N), 0) / pick.cells.length, pick.cells.reduce((s, k) => s + (k % N), 0) / pick.cells.length]);
      setup.push(pick.p);
    }
    if (ok) return setup;
  }
}

/** Places the five ships at random, spread out. Kept for tests and bots. */
function placeFleet(rng) {
  return buildFleet(randomSetup(rng));
}

function buildFleet(setup) {
  const cellsOf = checkSetup(setup);
  return cellsOf.map((cells) => ({ cells, hits: 0 }));
}

const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };

function createGame(players, options = {}, rng = Math.random, now = Date.now) {
  if (players.length !== 2) throw new Error('Sea Battle is for two players');
  const pace = PACE_MS[options.pace] ? options.pace : 'slow';
  return {
    game: 'seabattle',
    players: players.map((p) => ({ id: p.id, name: p.name })),
    options: { pace },
    phase: 'placing', // placing | playing | gameOver
    setup: [randomSetup(rng), randomSetup(rng)], // each player's ships until both are ready: the fleets start placed at random, and can be moved or re-rolled
    ready: [false, false],
    fleets: [null, null],                         // built when a player is ready; only the owner's view shows them
    shots: [Array(CELLS).fill(null), Array(CELLS).fill(null)], // shots[i]: the sea of player i, as fired at
    sunk: [0, 0],                                 // ships each player has sunk
    turn: 0,
    winner: null,
    event: null, log: [], seq: 0, version: 0,
    rng, now,
    due: [0, 0],
    startedAt: now(),
  };
}

const fail = (error) => ({ ok: false, error });

function placingAction(g, who, action) {
  if (!action || typeof action !== 'object') return fail('Unknown action');
  if (action.type === 'ready') {
    if (g.ready[who]) return fail('Your fleet is already ready');
    if (g.setup[who].some((p) => p === null)) return fail('Place all five ships first');
    g.ready[who] = true;
    g.fleets[who] = buildFleet(g.setup[who]);
    g.version++;
    if (g.ready[0] && g.ready[1]) { g.phase = 'playing'; g.turn = 0; emit(g, { type: 'start' }); }
    return { ok: true };
  }
  if (g.ready[who]) return fail('Your fleet is ready');
  if (action.type === 'random') { g.setup[who] = randomSetup(g.rng); g.version++; return { ok: true }; }
  if (action.type === 'place') {
    if (!Array.isArray(action.ships)) return fail('Unknown action');
    const candidate = action.ships.map((p) => (p === null || p === undefined ? null : p));
    if (!checkSetup(candidate)) return fail('Ships must stay on the sea and must not touch');
    g.setup[who] = candidate;
    g.version++;
    return { ok: true };
  }
  return fail('Place your fleet first');
}

function applyAction(g, playerId, action) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0) return fail('You are not a player in this game');
  if (g.phase === 'gameOver') return fail('The game is over');
  if (g.phase === 'placing') return placingAction(g, who, action);
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
  // a hit or a sinking keeps the turn: the shooter fires again until a shot misses
  return { ok: true };
}

const awaiting = (g) => {
  if (g.phase === 'gameOver') return [];
  if (g.phase === 'placing') return g.players.filter((_, i) => !g.ready[i]).map((p) => p.id);
  return [g.players[g.turn].id];
};

// ------------------------------------------------------------------------------------------------ bots (public information only)

/** Bots place a random fleet, then ready up; in play they hunt next to unsunk hits, otherwise a chequerboard square. */
function botAction(g, playerId, rng = g.rng) {
  const who = g.players.findIndex((p) => p.id === playerId);
  if (who < 0 || g.phase === 'gameOver') return null;
  if (g.phase === 'placing') {
    if (g.ready[who]) return null;
    return g.setup[who].some((p) => p === null) ? { type: 'random' } : { type: 'ready' };
  }
  if (g.turn !== who) return null;
  const sea = g.shots[1 - who];
  const open = [];
  for (let k = 0; k < CELLS; k++) if (!sea[k]) open.push(k);
  if (!open.length) return null;
  const hunting = [];
  for (let k = 0; k < CELLS; k++) if (sea[k] === 'hit') for (const n of neighbours(k)) if (!sea[n]) hunting.push(n);
  const pool = hunting.length ? hunting : open.filter((k) => ((Math.floor(k / N) + (k % N)) % 2) === 0);
  // a slip: the bot fires at any open square, not just where it is hunting
  const choices = slips(rng) || !pool.length ? open : pool;
  const k = choices[Math.floor(rng() * choices.length)];
  return { type: 'fire', r: Math.floor(k / N), c: k % N };
}

/** The delay before a bot acts (bots are timed by Bot speed). */
function botDelayMs(g) {
  return Math.round(PACE_MS[g.options.pace] * (0.75 + g.rng() * 0.5));
}

/** What a player sees: both seas' shots (public), and only their own ships. */
function viewFor(g, playerId) {
  const me = g.players.findIndex((p) => p.id === playerId);
  const fleet = me >= 0 ? Array(CELLS).fill(null) : null;
  let ships = null;
  let placed = null;
  if (me >= 0) {
    if (g.fleets[me]) {
      // each square shows its own state: a ship's intact squares stay 'ship' until they are fired at
      g.fleets[me].forEach((s) => {
        const sunk = s.hits === s.cells.length;
        s.cells.forEach((k) => { fleet[k] = sunk ? 'sunk' : g.shots[me][k] === 'hit' ? 'hit' : 'ship'; });
      });
      ships = g.fleets[me].map((s) => ({ cells: s.cells.slice(), sunk: s.hits === s.cells.length, hit: s.cells.filter((k) => g.shots[me][k] === 'hit') }));
    } else {
      // still placing: your own setup, drawn the same way, with nothing fired yet
      ships = g.setup[me].map((p, i) => (p ? { cells: shipCells(LENGTHS[i], p), sunk: false, hit: [] } : null)).filter(Boolean);
      placed = g.setup[me].map((p) => p !== null);
    }
    // the shots the enemy has fired at my sea: a miss on water shows as a miss
    g.shots[me].forEach((state, k) => { if (state === 'miss' && !fleet[k]) fleet[k] = 'miss'; });
  }
  return {
    me, phase: g.phase, options: { ...g.options }, N, lengths: LENGTHS.slice(),
    players: g.players.map((p, i) => ({
      id: p.id, name: p.name, sunk: g.sunk[i], left: g.fleets[i] ? g.fleets[i].filter((s) => s.hits < s.cells.length).length : LENGTHS.length,
      ready: g.ready[i],
    })),
    shots: g.shots.map((sea) => sea.slice()),   // shots[i]: fired at player i's sea
    fleet,                                       // my sea, with my ships and the shots I have taken
    ships,                                       // my ships as cell lists (null while placing: see placed)
    placed,                                      // while placing: which of my five ships are on the sea
    setup: me >= 0 && g.phase === 'placing' ? g.setup[me].map((p) => (p ? { r: p.r, c: p.c, vertical: p.vertical } : null)) : null,
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

module.exports = { N, LENGTHS, PACE_MS, createGame, applyAction, awaiting, botAction, botDelayMs, viewFor, results, placeFleet, randomSetup, checkSetup, neighbours };
