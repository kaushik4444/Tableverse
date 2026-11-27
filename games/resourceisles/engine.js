'use strict';
/**
 * Resource Isles, for four players: settle an archipelago of hexes, gather resources from the numbers rolled, build roads,
 * settlements and cities, and be first to reach the target number of points.
 *
 * Pure: no sockets, no timers. All randomness comes from the rng passed in, so a game can be replayed from its seed.
 *
 * Draft scope (also listed in the rules text): no development cards, no player-to-player trading and no bank supply limit.
 */

const SEATS = 4;
const RESOURCES = ['timber', 'clay', 'wool', 'grain', 'stone'];
const DESERT = 'desert';
const TILE_BAG = [
  'timber', 'timber', 'timber', 'timber',
  'wool', 'wool', 'wool', 'wool',
  'grain', 'grain', 'grain', 'grain',
  'clay', 'clay', 'clay',
  'stone', 'stone', 'stone',
  DESERT,
];
const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
// dots under a number: how often it comes up (a 6 or 8 is the most useful)
const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const HARBOR_TYPES = ['any', 'any', 'any', 'any', ...RESOURCES];
const HARBOR_COUNT = HARBOR_TYPES.length;
// who places in which order: each seat places a settlement and a road, then the order turns round
const SETUP_ORDER = [0, 1, 2, 3, 3, 2, 1, 0];
const PIECES = { settlement: 5, city: 4, road: 15 };
const COST = {
  road: { timber: 1, clay: 1 },
  settlement: { timber: 1, clay: 1, wool: 1, grain: 1 },
  city: { grain: 2, stone: 3 },
};
const LONGEST_MIN = 5;
const LONGEST_BONUS = 2;
const TARGET = { classic: 10, short: 8 };
const SQ3 = Math.sqrt(3);

const fail = (error) => ({ ok: false, error });
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const emptyHand = () => Object.fromEntries(RESOURCES.map((r) => [r, 0]));
const total = (hand) => RESOURCES.reduce((n, r) => n + hand[r], 0);

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The fixed geometry of the archipelago: 19 pointy-top hexes (3, 4, 5, 4, 3 across), 54 corners and 72 edges. Corners and
 * edges are merged by position, so two hexes that share a corner share one vertex id.
 */
function buildTopology() {
  const hexes = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2) hexes.push({ x: SQ3 * (q + r / 2), y: 1.5 * r, verts: [] });
    }
  }
  const verts = [];
  const vertByKey = new Map();
  hexes.forEach((h, hi) => {
    for (let k = 0; k < 6; k++) {
      const a = ((60 * k + 30) * Math.PI) / 180;
      const x = h.x + Math.cos(a);
      const y = h.y + Math.sin(a);
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
      let id = vertByKey.get(key);
      if (id === undefined) {
        id = verts.length;
        vertByKey.set(key, id);
        verts.push({ x, y, hexes: [], nbrs: [], edges: [] });
      }
      verts[id].hexes.push(hi);
      h.verts.push(id);
    }
  });
  const edges = [];
  const edgeByKey = new Map();
  hexes.forEach((h, hi) => {
    for (let k = 0; k < 6; k++) {
      const a = h.verts[k];
      const b = h.verts[(k + 1) % 6];
      const lo = Math.min(a, b);
      const hi2 = Math.max(a, b);
      const key = `${lo}-${hi2}`;
      let id = edgeByKey.get(key);
      if (id === undefined) {
        id = edges.length;
        edgeByKey.set(key, id);
        edges.push({ a: lo, b: hi2, hexes: [] });
        verts[lo].nbrs.push(hi2);
        verts[hi2].nbrs.push(lo);
        verts[lo].edges.push(id);
        verts[hi2].edges.push(id);
      }
      edges[id].hexes.push(hi);
    }
  });
  const hexNbrs = hexes.map(() => []);
  for (const e of edges) {
    if (e.hexes.length === 2) {
      hexNbrs[e.hexes[0]].push(e.hexes[1]);
      hexNbrs[e.hexes[1]].push(e.hexes[0]);
    }
  }
  return { hexes, verts, edges, hexNbrs };
}

/** Resources and number tokens. A 6 and an 8 never sit on touching hexes (retried a few times, then accepted). */
function layoutTiles(rng, hexNbrs) {
  let out = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const res = shuffle(TILE_BAG, rng);
    const tokens = shuffle(NUMBER_TOKENS, rng);
    const num = res.map(() => null);
    let k = 0;
    res.forEach((r, i) => { if (r !== DESERT) num[i] = tokens[k++]; });
    out = { res, num };
    const hot = (n) => n === 6 || n === 8;
    const clash = hexNbrs.some((ns, i) => hot(num[i]) && ns.some((j) => hot(num[j])));
    if (!clash) break;
  }
  return out;
}

function buildBoard(rng) {
  const { hexes, verts, edges, hexNbrs } = buildTopology();
  const tiles = layoutTiles(rng, hexNbrs);
  hexes.forEach((h, i) => { h.res = tiles.res[i]; h.num = tiles.num[i]; });
  // harbours sit on the coast, spread evenly round the island, starting at a random point
  const coast = edges
    .filter((e) => e.hexes.length === 1)
    .map((e) => ({ e, ang: Math.atan2((verts[e.a].y + verts[e.b].y) / 2, (verts[e.a].x + verts[e.b].x) / 2) }))
    .sort((p, q) => p.ang - q.ang);
  const step = coast.length / HARBOR_COUNT;
  const offset = Math.floor(rng() * step);
  const types = shuffle(HARBOR_TYPES, rng);
  const harbors = types.map((type, i) => {
    const e = coast[(offset + Math.floor(i * step)) % coast.length].e;
    return { edge: edges.indexOf(e), type, verts: [e.a, e.b] };
  });
  return { hexes, verts, edges, harbors };
}

function createGame(players, options, rng) {
  const board = buildBoard(rng);
  const g = {
    players: players.slice(0, SEATS).map((p) => ({ id: p.id, name: p.name })),
    target: TARGET[options && options.length] || TARGET.classic,
    board,
    vertOwner: board.verts.map(() => null), // { seat, city } per corner
    edgeOwner: board.edges.map(() => null), // seat per edge
    hand: Array.from({ length: SEATS }, emptyHand),
    robber: board.hexes.findIndex((h) => h.res === DESERT),
    phase: 'setup', // setup | roll | discard | robber | main | gameOver
    turn: SETUP_ORDER[0],
    step: 0,
    setupVertex: null,
    dice: null,
    owed: Array(SEATS).fill(0),
    longest: null,
    winner: null,
    log: [],
    event: { seq: 0, type: 'start', seat: null },
  };
  return g;
}

function emit(g, type, seat, extra = {}) {
  g.event = { seq: g.event.seq + 1, type, seat, ...extra };
}

function note(g, seat, kind, n = 0) {
  g.log.push({ seat, kind, n });
  if (g.log.length > 60) g.log.splice(0, g.log.length - 60);
}

const seatOf = (g, playerId) => g.players.findIndex((p) => p.id === playerId);

function countOf(g, seat) {
  let settlements = 0; let cities = 0; let roads = 0;
  for (const o of g.vertOwner) if (o && o.seat === seat) { if (o.city) cities++; else settlements++; }
  for (const s of g.edgeOwner) if (s === seat) roads++;
  return { settlements, cities, roads };
}

const vpOf = (g, seat) => { const c = countOf(g, seat); return c.settlements + 2 * c.cities + (g.longest === seat ? LONGEST_BONUS : 0); };

/** Players who must discard, or whose turn it is to rob, for the current state. */
function awaitingSeats(g) {
  if (g.phase === 'gameOver') return [];
  if (g.phase === 'discard') return g.owed.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  return [g.turn];
}

function awaiting(g) {
  return awaitingSeats(g).map((s) => g.players[s].id);
}

/** Free corner with no neighbour taken: the distance rule. */
const canSettle = (g, v) => !g.vertOwner[v] && g.board.verts[v].nbrs.every((n) => !g.vertOwner[n]);

/** A road touches a corner the seat already holds, or one of its own roads, and the corner is not blocked by someone else. */
function roadTouches(g, seat, e, v) {
  const o = g.vertOwner[v];
  if (o && o.seat === seat) return true;
  if (o && o.seat !== seat) return false;
  return g.board.verts[v].edges.some((x) => x !== e && g.edgeOwner[x] === seat);
}

const roadLegal = (g, seat, e) => {
  if (g.edgeOwner[e] !== null) return false;
  const { a, b } = g.board.edges[e];
  return roadTouches(g, seat, e, a) || roadTouches(g, seat, e, b);
};

const settleLegal = (g, seat, v) => canSettle(g, v) && g.board.verts[v].edges.some((e) => g.edgeOwner[e] === seat);

/** Longest unbroken run of the seat's roads. Another player's settlement or city breaks a run at its corner. */
function longestRoad(g, seat) {
  const adj = new Map();
  const ends = [];
  g.edgeOwner.forEach((s, e) => {
    if (s !== seat) return;
    const { a, b } = g.board.edges[e];
    ends[e] = [a, b];
    for (const v of [a, b]) { if (!adj.has(v)) adj.set(v, []); adj.get(v).push(e); }
  });
  const used = new Set();
  let best = 0;
  const blocked = (v) => g.vertOwner[v] && g.vertOwner[v].seat !== seat;
  const walk = (v, len) => {
    best = Math.max(best, len);
    if (len > 0 && blocked(v)) return;
    for (const e of adj.get(v) || []) {
      if (used.has(e)) continue;
      used.add(e);
      const [a, b] = ends[e];
      walk(v === a ? b : a, len + 1);
      used.delete(e);
    }
  };
  for (const v of adj.keys()) walk(v, 0);
  return best;
}

/** Who holds the longest road: the holder keeps it on a tie, and a newcomer needs a strict lead of at least five. */
function refreshLongest(g) {
  const lens = Array.from({ length: SEATS }, (_, i) => longestRoad(g, i));
  const max = Math.max(...lens);
  const top = lens.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
  const holder = g.longest;
  if (holder !== null && lens[holder] >= LONGEST_MIN && lens[holder] === max) return;
  g.longest = max >= LONGEST_MIN && top.length === 1 ? top[0] : null;
}

function bankRate(g, seat, res) {
  let rate = 4;
  for (const h of g.board.harbors) {
    const mine = h.verts.some((v) => g.vertOwner[v] && g.vertOwner[v].seat === seat);
    if (!mine) continue;
    if (h.type === 'any') rate = Math.min(rate, 3);
    else if (h.type === res) rate = Math.min(rate, 2);
  }
  return rate;
}

/** Players (other than the mover) with a building on the hex and at least one card to steal. */
function victimsOf(g, seat, hex) {
  const out = new Set();
  for (const v of g.board.hexes[hex].verts) {
    const o = g.vertOwner[v];
    if (o && o.seat !== seat && total(g.hand[o.seat]) > 0) out.add(o.seat);
  }
  return [...out].sort((a, b) => a - b);
}

function produce(g, roll) {
  g.board.hexes.forEach((h, i) => {
    if (h.num !== roll || i === g.robber) return;
    for (const v of h.verts) {
      const o = g.vertOwner[v];
      if (o) g.hand[o.seat][h.res] += o.city ? 2 : 1;
    }
  });
}

function pay(g, seat, cost) {
  for (const r of RESOURCES) g.hand[seat][r] -= cost[r] || 0;
}

const canAfford = (g, seat, cost) => RESOURCES.every((r) => g.hand[seat][r] >= (cost[r] || 0));

function checkWin(g, seat) {
  if (vpOf(g, seat) >= g.target) {
    g.phase = 'gameOver';
    g.winner = seat;
    emit(g, 'over', seat);
  }
}

function nextSetup(g) {
  g.step++;
  if (g.step >= SETUP_ORDER.length) {
    g.phase = 'roll';
    g.turn = 0;
  } else {
    g.turn = SETUP_ORDER[g.step];
  }
}

function applySetup(g, seat, action) {
  if (action.type === 'setupSettlement' && g.setupVertex === null) {
    const v = action.vertex;
    if (!isInt(v, 0, g.board.verts.length - 1)) return fail('Pick a corner');
    if (!canSettle(g, v)) return fail('Too close to another settlement');
    g.vertOwner[v] = { seat, city: false };
    g.setupVertex = v;
    // the second settlement brings one card from each land it touches
    if (g.step >= SEATS) {
      for (const h of g.board.verts[v].hexes.map((i) => g.board.hexes[i])) {
        if (h.res !== DESERT) g.hand[seat][h.res]++;
      }
    }
    note(g, seat, 'settle');
    emit(g, 'build', seat, { piece: 'settlement', at: v });
    return { ok: true };
  }
  if (action.type === 'setupRoad' && g.setupVertex !== null) {
    const e = action.edge;
    if (!isInt(e, 0, g.board.edges.length - 1)) return fail('Pick an edge');
    const { a, b } = g.board.edges[e];
    if (g.edgeOwner[e] !== null) return fail('That edge already has a road');
    if (a !== g.setupVertex && b !== g.setupVertex) return fail('The road must touch your new settlement');
    g.edgeOwner[e] = seat;
    g.setupVertex = null;
    note(g, seat, 'road');
    emit(g, 'build', seat, { piece: 'road', at: e });
    nextSetup(g);
    return { ok: true };
  }
  return fail(g.setupVertex === null ? 'Place a settlement first' : 'Place a road next to your settlement');
}

function applyDiscard(g, seat, action) {
  if (action.type !== 'discard' || g.owed[seat] === 0) return fail('Nothing to discard');
  const cards = action.cards || {};
  let sum = 0;
  for (const r of RESOURCES) {
    const n = cards[r] === undefined ? 0 : cards[r];
    if (!isInt(n, 0, g.hand[seat][r])) return fail('You do not have those cards');
    sum += n;
  }
  if (sum !== g.owed[seat]) return fail(`Discard exactly ${g.owed[seat]} cards`);
  for (const r of RESOURCES) g.hand[seat][r] -= cards[r] || 0;
  g.owed[seat] = 0;
  note(g, seat, 'discard', sum);
  if (g.owed.every((n) => n === 0)) g.phase = 'robber';
  return { ok: true };
}

function applyRobber(g, seat, action, rng) {
  if (action.type !== 'robber') return fail('Move the robber');
  const hex = action.hex;
  if (!isInt(hex, 0, g.board.hexes.length - 1) || hex === g.robber) return fail('Move the robber to a different land');
  const victims = victimsOf(g, seat, hex);
  let victim = null;
  if (victims.length === 1) victim = victims[0];
  else if (victims.length > 1) {
    if (!victims.includes(action.victim)) return fail('Choose who to steal from');
    victim = action.victim;
  }
  g.robber = hex;
  if (victim !== null) {
    const pick = Math.floor(rng() * total(g.hand[victim]));
    let acc = 0;
    const res = RESOURCES.find((r) => (acc += g.hand[victim][r]) > pick);
    g.hand[victim][res]--;
    g.hand[seat][res]++;
    note(g, seat, 'steal');
    emit(g, 'robber', seat, { victim, hex });
  } else {
    emit(g, 'robber', seat, { victim: null, hex });
  }
  note(g, seat, 'robber');
  g.phase = 'main';
  return { ok: true };
}

function applyMain(g, seat, action) {
  switch (action.type) {
    case 'buildRoad': {
      const e = action.edge;
      if (!isInt(e, 0, g.board.edges.length - 1)) return fail('Pick an edge');
      if (countOf(g, seat).roads >= PIECES.road) return fail('No roads left');
      if (!canAfford(g, seat, COST.road)) return fail('Not enough cards for a road');
      if (!roadLegal(g, seat, e)) return fail('A road must join your own roads or settlements');
      pay(g, seat, COST.road);
      g.edgeOwner[e] = seat;
      note(g, seat, 'road');
      emit(g, 'build', seat, { piece: 'road', at: e });
      refreshLongest(g);
      return checkedWin(g, seat);
    }
    case 'buildSettlement': {
      const v = action.vertex;
      if (!isInt(v, 0, g.board.verts.length - 1)) return fail('Pick a corner');
      if (countOf(g, seat).settlements >= PIECES.settlement) return fail('No settlements left');
      if (!canAfford(g, seat, COST.settlement)) return fail('Not enough cards for a settlement');
      if (!settleLegal(g, seat, v)) return fail('A settlement needs a road of yours and two free corners apart');
      pay(g, seat, COST.settlement);
      g.vertOwner[v] = { seat, city: false };
      note(g, seat, 'settle');
      emit(g, 'build', seat, { piece: 'settlement', at: v });
      refreshLongest(g);
      return checkedWin(g, seat);
    }
    case 'buildCity': {
      const v = action.vertex;
      if (!isInt(v, 0, g.board.verts.length - 1)) return fail('Pick a corner');
      const o = g.vertOwner[v];
      if (!o || o.seat !== seat || o.city) return fail('Upgrade one of your settlements');
      if (countOf(g, seat).cities >= PIECES.city) return fail('No cities left');
      if (!canAfford(g, seat, COST.city)) return fail('Not enough cards for a city');
      pay(g, seat, COST.city);
      o.city = true;
      note(g, seat, 'city');
      emit(g, 'build', seat, { piece: 'city', at: v });
      return checkedWin(g, seat);
    }
    case 'trade': {
      const { give, get } = action;
      if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) return fail('Pick two different cards');
      const rate = bankRate(g, seat, give);
      if (g.hand[seat][give] < rate) return fail(`The bank takes ${rate} ${give} for one`);
      g.hand[seat][give] -= rate;
      g.hand[seat][get]++;
      note(g, seat, 'trade');
      emit(g, 'trade', seat, { give, get });
      return { ok: true };
    }
    case 'endTurn':
      note(g, seat, 'end');
      // nobody can place a piece any more, so no points can change: the most points wins (a tie has no winner)
      if (noBuildLeft(g)) {
        const vp = g.players.map((_, i) => vpOf(g, i));
        const top = Math.max(...vp);
        const leaders = vp.map((n, i) => (n === top ? i : -1)).filter((i) => i >= 0);
        g.phase = 'gameOver';
        g.winner = leaders.length === 1 ? leaders[0] : null;
        emit(g, 'over', g.winner);
        return { ok: true };
      }
      g.phase = 'roll';
      g.turn = (g.turn + 1) % SEATS;
      return { ok: true };
    default:
      return fail('Not a move you can make now');
  }
}

/** True when no seat has a legal settlement, city or road left (the piece limits are part of the check). */
function noBuildLeft(g) {
  return Array.from({ length: SEATS }, (_, s) => legalFor(g, s)).every((l) => !l.settle.length && !l.city.length && !l.road.length);
}

function checkedWin(g, seat) {
  checkWin(g, seat);
  return { ok: true };
}

/**
 * Apply one player's action. Returns { ok: true } or { ok: false, error }. The rng is used for the dice and for a steal.
 */
function applyAction(g, playerId, action, rng) {
  if (g.phase === 'gameOver') return fail('The game is over');
  const seat = seatOf(g, playerId);
  if (seat < 0) return fail('You are not playing');
  if (!action || typeof action !== 'object') return fail('Invalid action');
  if (!awaitingSeats(g).includes(seat)) return fail('Not your move');
  switch (g.phase) {
    case 'setup':
      return applySetup(g, seat, action);
    case 'discard':
      return applyDiscard(g, seat, action);
    case 'robber':
      return applyRobber(g, seat, action, rng);
    case 'roll': {
      if (action.type !== 'roll') return fail('Roll the dice first');
      const d = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
      const sum = d[0] + d[1];
      g.dice = d;
      note(g, seat, 'roll', sum);
      emit(g, 'roll', seat, { dice: d, sum });
      if (sum === 7) {
        g.owed = g.hand.map((h) => (total(h) > 7 ? Math.floor(total(h) / 2) : 0));
        g.phase = g.owed.some((n) => n > 0) ? 'discard' : 'robber';
      } else {
        produce(g, sum);
        g.phase = 'main';
      }
      return { ok: true };
    }
    case 'main':
      if (seat !== g.turn) return fail('Not your turn');
      return applyMain(g, seat, action);
    default:
      return fail('Not a move you can make now');
  }
}

/** The moves the seat can make right now, for the table to highlight. */
function legalFor(g, seat) {
  const out = { settle: [], city: [], road: [], robber: [] };
  if (g.phase === 'setup') {
    if (g.setupVertex === null) out.settle = g.board.verts.map((_, v) => v).filter((v) => canSettle(g, v));
    else out.road = g.board.verts[g.setupVertex].edges.filter((e) => g.edgeOwner[e] === null);
  } else if (g.phase === 'robber') {
    out.robber = g.board.hexes.map((_, hex) => hex).filter((hex) => hex !== g.robber).map((hex) => ({ hex, victims: victimsOf(g, seat, hex) }));
  } else if (g.phase === 'main') {
    // a piece the seat has used up is not offered (the limits are part of the legal moves)
    const c = countOf(g, seat);
    if (c.settlements < PIECES.settlement) out.settle = g.board.verts.map((_, v) => v).filter((v) => settleLegal(g, seat, v));
    if (c.cities < PIECES.city) out.city = g.vertOwner.map((o, v) => (o && o.seat === seat && !o.city ? v : -1)).filter((v) => v >= 0);
    if (c.roads < PIECES.road) out.road = g.board.edges.map((_, e) => e).filter((e) => roadLegal(g, seat, e));
  }
  return out;
}

function viewFor(g, playerId) {
  const me = seatOf(g, playerId);
  const myTurn = me >= 0 && awaitingSeats(g).includes(me);
  return {
    phase: g.phase,
    turn: g.turn,
    me,
    myTurn,
    target: g.target,
    players: g.players.map((p, i) => {
      const c = countOf(g, i);
      return { id: p.id, name: p.name, vp: vpOf(g, i), settlements: c.settlements, cities: c.cities, roads: c.roads, cards: total(g.hand[i]), longest: g.longest === i, owed: g.owed[i] };
    }),
    board: {
      hexes: g.board.hexes.map((h) => ({ x: h.x, y: h.y, res: h.res, num: h.num, verts: h.verts })),
      verts: g.board.verts.map((v) => ({ x: v.x, y: v.y })),
      edges: g.board.edges.map((e) => [e.a, e.b]),
      harbors: g.board.harbors.map((h) => ({ type: h.type, edge: h.edge, verts: h.verts })),
    },
    buildings: g.vertOwner.map((o) => (o ? { seat: o.seat, city: o.city } : null)),
    roads: g.edgeOwner.slice(),
    robber: g.robber,
    dice: g.dice,
    hand: me >= 0 ? { ...g.hand[me] } : null,
    rates: me >= 0 ? Object.fromEntries(RESOURCES.map((r) => [r, bankRate(g, me, r)])) : null,
    owed: me >= 0 ? g.owed[me] : 0,
    legal: myTurn || (g.phase === 'setup' && me >= 0 && awaitingSeats(g).includes(me)) ? legalFor(g, me) : null,
    setupVertex: g.setupVertex,
    log: g.log.slice(-14),
    event: g.event,
    winner: g.winner,
  };
}

/** Points that the table computes for each seat (public, so the result is the same for everyone). */
function results(g) {
  return g.players.map((_, i) => ({ score: vpOf(g, i), winner: g.winner === i }));
}

/** The move a bot would make now. Always a legal move for the phase: the turn can always end. */
function botAction(g, playerId, rng) {
  const seat = seatOf(g, playerId);
  const pips = (v) => g.board.verts[v].hexes.reduce((n, i) => n + (PIPS[g.board.hexes[i].num] || 0), 0);
  const best = (list, score) => list.reduce((b, x) => (b === null || score(x) > score(b) ? x : b), null);
  switch (g.phase) {
    case 'setup': {
      if (g.setupVertex === null) {
        const spots = g.board.verts.map((_, v) => v).filter((v) => canSettle(g, v));
        return { type: 'setupSettlement', vertex: best(spots, pips) };
      }
      const edges = g.board.verts[g.setupVertex].edges.filter((e) => g.edgeOwner[e] === null);
      return { type: 'setupRoad', edge: edges[Math.floor(rng() * edges.length)] };
    }
    case 'roll':
      return { type: 'roll' };
    case 'discard': {
      const cards = emptyHand();
      const h = { ...g.hand[seat] };
      for (let i = 0; i < g.owed[seat]; i++) {
        const r = RESOURCES.reduce((b, x) => (h[x] > 0 && (b === null || h[x] > h[b]) ? x : b), null);
        cards[r]++;
        h[r]--;
      }
      return { type: 'discard', cards };
    }
    case 'robber': {
      const hexes = g.board.hexes.map((_, i) => i).filter((i) => i !== g.robber);
      const hex = best(hexes, (i) => (PIPS[g.board.hexes[i].num] || 0) - 3 * g.board.hexes[i].verts.filter((v) => g.vertOwner[v] && g.vertOwner[v].seat === seat).length);
      return { type: 'robber', hex, victim: victimsOf(g, seat, hex)[0] };
    }
    case 'main': {
      const legal = legalFor(g, seat);
      if (legal.city.length && canAfford(g, seat, COST.city)) return { type: 'buildCity', vertex: best(legal.city, pips) };
      if (legal.settle.length && canAfford(g, seat, COST.settlement)) return { type: 'buildSettlement', vertex: best(legal.settle, pips) };
      if (legal.road.length && canAfford(g, seat, COST.road) && countOf(g, seat).roads < PIECES.road) {
        return { type: 'buildRoad', edge: legal.road[Math.floor(rng() * legal.road.length)] };
      }
      // stuck for a card: trade a surplus card with the bank for one the next build needs
      const need = RESOURCES.find((r) => g.hand[seat][r] === 0 && (COST.road[r] || COST.settlement[r]));
      if (need && legal.road.length) {
        const give = RESOURCES.filter((r) => r !== need && g.hand[seat][r] >= bankRate(g, seat, r))
          .sort((a, b) => g.hand[seat][b] - g.hand[seat][a])[0];
        if (give) return { type: 'trade', give, get: need };
      }
      return { type: 'endTurn' };
    }
    default:
      return { type: 'endTurn' };
  }
}

module.exports = {
  SEATS, RESOURCES, DESERT, TARGET, PIECES, COST, PIPS,
  createGame, applyAction, awaiting, botAction, viewFor, results,
  buildTopology, longestRoad, bankRate, vpOf, countOf, victimsOf, canSettle, roadLegal, settleLegal, legalFor, awaitingSeats,
};
