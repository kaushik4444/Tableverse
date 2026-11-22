'use strict';
/**
 * Hidden Miners: the rules only (no sockets, no timers). An original hidden-role tunnel game for 3-8 players.
 *
 * Everyone is secretly a Digger or a Saboteur. Players take turns building tunnels from the start on a 9 x 5 grid, trying
 * to reach one of three goal chambers: only one holds gold. Diggers want the gold; Saboteurs want the tunnel to fail.
 * On your turn play one card (a tunnel piece, break or repair a tool, scout a chamber, or collapse a piece) or throw one away,
 * then draw. If the deck and every hand run out before the gold is reached the Saboteurs win the round.
 */
const W = 9;
const H = 5;
const START = { x: 0, y: 2 };
const GOALS = [{ x: 8, y: 0 }, { x: 8, y: 2 }, { x: 8, y: 4 }];
const TOOLS = ['lamp', 'pick', 'cart'];
const TOOL_NAMES = { lamp: 'Lamp', pick: 'Pick', cart: 'Cart' };
const N = 1; const E = 2; const S = 4; const WE = 8;
const DIRS = [{ bit: N, opp: S, dx: 0, dy: -1 }, { bit: E, opp: WE, dx: 1, dy: 0 }, { bit: S, opp: N, dx: 0, dy: 1 }, { bit: WE, opp: E, dx: -1, dy: 0 }];
const SABOTEURS = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3 };
const HAND = { 3: 6, 4: 6, 5: 5, 6: 5, 7: 4, 8: 4 };
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const ROUNDS = ['1', '3', '5'];

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind) => { g.log.push({ by: by === null ? 'Table' : g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };
const flipMask = (m) => ((m << 2) | (m >> 2)) & 15;
const key = (x, y) => `${x},${y}`;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

function buildDeck() {
  const d = [];
  const add = (n, make) => { for (let i = 0; i < n; i++) d.push({ id: '', ...make }); };
  for (const m of [5, 10]) add(5, { k: 'tile', mask: m, cut: false });
  for (const m of [3, 6, 9, 12]) add(2, { k: 'tile', mask: m, cut: false });
  for (const m of [7, 11, 13, 14]) add(2, { k: 'tile', mask: m, cut: false });
  add(4, { k: 'tile', mask: 15, cut: false });
  for (const m of [1, 2, 4, 8, 5, 10, 15, 3, 12]) add(1, { k: 'tile', mask: m, cut: true });
  for (const t of TOOLS) { add(3, { k: 'break', tool: t }); add(2, { k: 'repair', tools: [t] }); }
  add(1, { k: 'repair', tools: ['lamp', 'pick'] }); add(1, { k: 'repair', tools: ['pick', 'cart'] }); add(1, { k: 'repair', tools: ['cart', 'lamp'] });
  add(6, { k: 'scout' });
  add(3, { k: 'collapse' });
  d.forEach((c, i) => { c.id = `${c.k[0]}${i}`; });
  return d;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const pub = (c) => (c.k === 'tile' ? { id: c.id, k: c.k, mask: c.mask, cut: c.cut } : c.k === 'break' ? { id: c.id, k: c.k, tool: c.tool } : c.k === 'repair' ? { id: c.id, k: c.k, tools: c.tools.slice() } : { id: c.id, k: c.k });
const label = (c) => (c.k === 'tile' ? (c.cut ? 'Dead-end tunnel' : 'Tunnel') : c.k === 'break' ? `Break ${TOOL_NAMES[c.tool]}` : c.k === 'repair' ? `Repair ${c.tools.map((t) => TOOL_NAMES[t]).join(' or ')}` : c.k === 'scout' ? 'Scout' : 'Collapse');

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('Hidden Miners is for 3 to 8 players');
  const rounds = options && ROUNDS.includes(options.rounds) ? options.rounds : '3';
  const g = {
    game: 'hiddenminers',
    n,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    rng,
    options: { rounds },
    scores: players.map(() => 0),
    round: 0,
    deck: [],
    discards: 0,
    hands: [],
    roles: [],
    broken: [],
    board: new Map(),
    goals: [],
    scouts: [],
    turn: 0,
    phase: 'playing', // playing | gameOver
    event: null,
    roundResult: null,
    winners: [],
    log: [],
    seq: 0,
    version: 0,
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round++;
  g.deck = shuffle(buildDeck(), g.rng);
  g.discards = 0;
  g.board = new Map([[key(START.x, START.y), { id: 'start', mask: 15, cut: false, x: START.x, y: START.y }]]);
  const gold = Math.floor(g.rng() * GOALS.length);
  g.goals = GOALS.map((p, i) => ({ ...p, gold: i === gold, revealed: false }));
  const sab = SABOTEURS[g.n];
  const roles = shuffle([...Array(g.n)].map((_, i) => (i < sab ? 'saboteur' : 'digger')), g.rng);
  g.roles = roles;
  g.broken = g.players.map(() => []);
  g.scouts = g.players.map(() => []);
  g.hands = g.players.map(() => []);
  for (let k = 0; k < HAND[g.n]; k++) for (let i = 0; i < g.n; i++) g.hands[i].push(g.deck.pop());
  g.turn = (g.round - 1) % g.n;
  say(g, null, `Round ${g.round}: roles are secret. ${sab} Saboteur${sab > 1 ? 's' : ''} among ${g.n} miners`, 'round');
}

const cellAt = (g, x, y) => {
  const t = g.board.get(key(x, y));
  if (t) return t;
  const goal = g.goals.findIndex((q) => q.x === x && q.y === y);
  return goal >= 0 ? { id: `goal${goal}`, mask: 15, cut: true, goal } : null;
};

/** Cells reached from the start: dead ends and chambers are reached but do not pass the tunnel on. */
function reach(g) {
  const seen = new Set([key(START.x, START.y)]);
  const queue = [g.board.get(key(START.x, START.y))];
  while (queue.length) {
    const c = queue.shift();
    if (c.cut && c.id !== 'start') continue;
    for (const d of DIRS) {
      if (!(c.mask & d.bit)) continue;
      const x = c.x + d.dx; const y = c.y + d.dy;
      if (!inside(x, y) || seen.has(key(x, y))) continue;
      const nb = cellAt(g, x, y);
      if (!nb || !(nb.mask & d.opp)) continue;
      seen.add(key(x, y));
      if (nb.goal === undefined) queue.push(nb);
    }
  }
  return seen;
}

/** A piece fits when its sides match every neighbour (open to open, closed to closed) and it joins a tunnel running from the start. */
function canPlace(g, mask, x, y, seen = reach(g)) {
  if (!inside(x, y) || cellAt(g, x, y)) return false;
  let joined = false;
  for (const d of DIRS) {
    const nb = cellAt(g, x + d.dx, y + d.dy);
    if (!nb) continue;
    if (Boolean(mask & d.bit) !== Boolean(nb.mask & d.opp)) return false;
    const live = nb.goal === undefined && !(nb.cut && nb.id !== 'start') && seen.has(key(x + d.dx, y + d.dy));
    if ((mask & d.bit) && live) joined = true;
  }
  return joined;
}

function spotsFor(g, card) {
  const seen = reach(g);
  const out = [];
  const masks = card.mask === flipMask(card.mask) ? [[card.mask, 0]] : [[card.mask, 0], [flipMask(card.mask), 1]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (const [m, f] of masks) if (canPlace(g, m, x, y, seen)) out.push([x, y, f]);
  }
  return out;
}

const canBuild = (g, who) => g.broken[who].length === 0;
const repairTargets = (g, who, card) => {
  const out = [];
  g.broken.forEach((b, seat) => { for (const t of card.tools) if (b.includes(t)) out.push({ seat, tool: t }); });
  return out;
};
const breakTargets = (g, who, card) => g.players.map((_, i) => i).filter((i) => i !== who && !g.broken[i].includes(card.tool));
const collapseCells = (g) => [...g.board.values()].filter((t) => t.id !== 'start').map((t) => [t.x, t.y]);

function endRound(g, side, finder, reveal) {
  const gains = g.players.map(() => 0);
  const sabCount = g.roles.filter((r) => r === 'saboteur').length;
  g.roles.forEach((r, i) => {
    if (side === 'diggers' && r === 'digger') gains[i] = 3;
    if (side === 'saboteurs' && r === 'saboteur') gains[i] = sabCount === 1 ? 4 : 3;
  });
  if (side === 'diggers' && finder !== undefined) gains[finder] += 1; // whoever opens the gold earns 1 more, even a Saboteur who gave the Diggers the win
  gains.forEach((v, i) => { g.scores[i] += v; });
  g.roundResult = { round: g.round, side, finder: finder === undefined ? null : finder, roles: g.roles.slice(), gains, gold: g.goals.findIndex((q) => q.gold) };
  say(g, null, side === 'diggers' ? `The Diggers found the gold in round ${g.round}` : `The Saboteurs won round ${g.round}`, 'end');
  if (g.round >= Number(g.options.rounds)) {
    g.phase = 'gameOver';
    const best = Math.max(...g.scores);
    g.winners = g.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    emit(g, { type: 'over', side, winners: g.winners.slice(), round: g.round, ...(reveal || {}) });
    return;
  }
  emit(g, { type: 'roundEnd', side, round: g.round, ...(reveal || {}) });
  g.phase = 'roundEnd'; // the next round is dealt once everybody has pressed Ready (the continue action)
}

/** After a card is spent: draw back up, then give the turn to the next miner who still holds cards (or end the round). */
function finishTurn(g, who) {
  if (g.deck.length) g.hands[who].push(g.deck.pop());
  for (let k = 1; k <= g.n; k++) {
    const next = (who + k) % g.n;
    if (g.hands[next].length) { g.turn = next; return; }
  }
  endRound(g, 'saboteurs');
}

const take = (g, who, id) => {
  const card = typeof id === 'string' ? g.hands[who].find((c) => c.id === id) : null;
  if (card) g.hands[who] = g.hands[who].filter((c) => c.id !== card.id);
  return card;
};

/**
 * action: { type: 'tile', card, x, y, flip? } | { type: 'break', card, target } | { type: 'repair', card, target, tool }
 *       | { type: 'scout', card, goal } | { type: 'collapse', card, x, y } | { type: 'discard', card }
 */
function applyAction(g, playerId, action) {
  if (g.phase === 'roundEnd') {
    if (action && action.type === 'continue') { startRound(g); g.phase = 'playing'; g.version++; return { ok: true }; }
    return { ok: false, error: 'The next round starts when everybody is ready' };
  }
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  const who = indexOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (who !== g.turn) return { ok: false, error: 'Not your turn' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  const card = g.hands[who].find((c) => c.id === action.card);
  if (!card) return { ok: false, error: 'You do not have that card' };
  const type = action.type;
  const int = (v) => Number.isInteger(v);
  if (type === 'discard') {
    take(g, who, card.id); g.discards++;
    emit(g, { type: 'discard', by: who });
    say(g, who, 'threw a card away', 'discard');
  } else if (type === 'tile') {
    if (card.k !== 'tile') return { ok: false, error: 'That is not a tunnel piece' };
    if (!canBuild(g, who)) return { ok: false, error: 'A broken tool stops you digging. Get it repaired first' };
    if (!int(action.x) || !int(action.y)) return { ok: false, error: 'Pick a place' };
    const mask = action.flip ? flipMask(card.mask) : card.mask;
    if (!canPlace(g, mask, action.x, action.y)) return { ok: false, error: 'The piece does not fit there' };
    take(g, who, card.id);
    g.board.set(key(action.x, action.y), { id: card.id, mask, cut: card.cut, x: action.x, y: action.y });
    emit(g, { type: 'tile', by: who, x: action.x, y: action.y, mask, cut: card.cut, revealed: [], goldIndex: -1 });
    say(g, who, `dug ${card.cut ? 'a dead end' : 'a tunnel'}`, 'tile');
    const seen = reach(g);
    let found = false;
    g.goals.forEach((q, i) => {
      if (!q.revealed && seen.has(key(q.x, q.y))) {
        q.revealed = true; g.event.revealed.push(i);
        if (q.gold) g.event.goldIndex = i;
        say(g, null, q.gold ? 'The gold chamber is open!' : 'That chamber holds only rock', 'reveal');
        if (q.gold) found = true;
      }
    });
    // the round-ending event keeps what this move opened, so every client can still show the gold being found
    if (found) { endRound(g, 'diggers', who, { by: who, revealed: g.event.revealed.slice(), goldIndex: g.event.goldIndex }); return { ok: true }; }
  } else if (type === 'break') {
    if (card.k !== 'break') return { ok: false, error: 'That is not a break card' };
    if (!int(action.target) || !breakTargets(g, who, card).includes(action.target)) return { ok: false, error: 'You cannot break that' };
    take(g, who, card.id); g.discards++;
    g.broken[action.target].push(card.tool);
    emit(g, { type: 'break', by: who, target: action.target, tool: card.tool });
    say(g, who, `broke ${g.players[action.target].name}'s ${TOOL_NAMES[card.tool]}`, 'break');
  } else if (type === 'repair') {
    if (card.k !== 'repair') return { ok: false, error: 'That is not a repair card' };
    if (!int(action.target) || !card.tools.includes(action.tool) || !repairTargets(g, who, card).some((t) => t.seat === action.target && t.tool === action.tool)) return { ok: false, error: 'There is nothing to repair' };
    take(g, who, card.id); g.discards++;
    g.broken[action.target] = g.broken[action.target].filter((t) => t !== action.tool);
    emit(g, { type: 'repair', by: who, target: action.target, tool: action.tool });
    say(g, who, `repaired ${g.players[action.target].name}'s ${TOOL_NAMES[action.tool]}`, 'repair');
  } else if (type === 'scout') {
    if (card.k !== 'scout') return { ok: false, error: 'That is not a scout card' };
    if (!int(action.goal) || action.goal < 0 || action.goal >= g.goals.length) return { ok: false, error: 'Pick a chamber' };
    take(g, who, card.id); g.discards++;
    g.scouts[who].push({ goal: action.goal, gold: g.goals[action.goal].gold });
    emit(g, { type: 'scout', by: who, goal: action.goal });
    say(g, who, 'scouted a chamber', 'scout');
  } else if (type === 'collapse') {
    if (card.k !== 'collapse') return { ok: false, error: 'That is not a collapse card' };
    const t = int(action.x) && int(action.y) ? g.board.get(key(action.x, action.y)) : null;
    if (!t || t.id === 'start') return { ok: false, error: 'There is no piece to collapse there' };
    take(g, who, card.id); g.discards++;
    g.board.delete(key(action.x, action.y));
    emit(g, { type: 'collapse', by: who, x: action.x, y: action.y });
    say(g, who, 'collapsed a tunnel piece', 'collapse');
  } else return { ok: false, error: 'Unknown action' };
  g.version++;
  finishTurn(g, who);
  return { ok: true };
}

const awaiting = (g) => (g.phase === 'gameOver' || g.phase === 'roundEnd' ? [] : [g.players[g.turn].id]);

/** Every legal move for a seat, as actions. */
function legalMoves(g, who) {
  const out = [];
  const seen = reach(g);
  for (const c of g.hands[who]) {
    out.push({ type: 'discard', card: c.id });
    if (c.k === 'tile' && canBuild(g, who)) {
      for (const [x, y, f] of spotsFor(g, c)) out.push({ type: 'tile', card: c.id, x, y, flip: Boolean(f) });
    } else if (c.k === 'break') for (const target of breakTargets(g, who, c)) out.push({ type: 'break', card: c.id, target });
    else if (c.k === 'repair') for (const t of repairTargets(g, who, c)) out.push({ type: 'repair', card: c.id, target: t.seat, tool: t.tool });
    else if (c.k === 'scout') g.goals.forEach((_, goal) => out.push({ type: 'scout', card: c.id, goal }));
    else if (c.k === 'collapse') for (const [x, y] of collapseCells(g)) out.push({ type: 'collapse', card: c.id, x, y });
  }
  void seen;
  return out;
}

/** Bots use only their own role, hand, scouting and the public table. Diggers build toward the gold and mend tools; Saboteurs break and block quietly. */
function botAction(g, playerId) {
  const who = indexOf(g, playerId);
  if (g.phase !== 'playing' || who !== g.turn) return null;
  const moves = legalMoves(g, who);
  const saboteur = g.roles[who] === 'saboteur';
  const goldKnown = g.scouts[who].find((s) => s.gold);
  const rockKnown = new Set(g.scouts[who].filter((s) => !s.gold).map((s) => s.goal));
  const targets = g.goals.map((q, i) => ({ q, i })).filter(({ q, i }) => !q.revealed && !rockKnown.has(i) && (!goldKnown || goldKnown.goal === i));
  const dist = (x, y) => Math.min(...(targets.length ? targets : g.goals.map((q) => ({ q }))).map(({ q }) => Math.abs(q.x - x) + Math.abs(q.y - y)));
  const handOf = (id) => g.hands[who].find((c) => c.id === id);
  const score = (m) => {
    const c = handOf(m.card);
    let s = g.rng() * 3;
    if (m.type === 'tile') {
      const mask = m.flip ? flipMask(c.mask) : c.mask;
      const d = dist(m.x, m.y);
      s += saboteur ? (c.cut ? 28 : 6) + d * 0.8 - (mask & E ? 2 : 0) : (c.cut ? -30 : 30 - d * 3 + (mask & E ? 4 : 0));
    } else if (m.type === 'repair') {
      const own = m.target === who;
      s += saboteur ? (own ? 40 : -20) : (own ? 45 : 22);
    } else if (m.type === 'break') {
      s += saboteur ? 38 : -50;
    } else if (m.type === 'scout') {
      s += saboteur ? -5 : (g.scouts[who].length ? -10 : 26);
    } else if (m.type === 'collapse') {
      const t = g.board.get(key(m.x, m.y));
      s += saboteur ? (t && !t.cut ? 24 + t.x : 4) : (t && t.cut ? 20 : -40);
    } else {
      const bad = saboteur ? (c.k === 'repair' ? 4 : -8) : (c.k === 'break' || (c.k === 'tile' && c.cut) ? 8 : c.k === 'collapse' ? 5 : -15);
      s += bad;
    }
    return s;
  };
  return moves.map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s)[0].m;
}

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const over = g.phase === 'gameOver';
  const myTurn = !over && me >= 0 && me === g.turn;
  const mine = me >= 0 ? g.hands[me] : [];
  const spots = {};
  const targets = {};
  const hand = mine.map((c) => {
    let ok = true;
    if (myTurn) {
      if (c.k === 'tile') { const s = canBuild(g, me) ? spotsFor(g, c) : []; spots[c.id] = s; ok = s.length > 0; }
      else if (c.k === 'break') { targets[c.id] = breakTargets(g, me, c); ok = targets[c.id].length > 0; }
      else if (c.k === 'repair') { targets[c.id] = repairTargets(g, me, c); ok = targets[c.id].length > 0; }
      else if (c.k === 'collapse') { targets[c.id] = collapseCells(g); ok = targets[c.id].length > 0; }
    }
    return { ...pub(c), ok: myTurn && ok };
  });
  const roundResult = g.roundResult ? { ...g.roundResult } : null;
  return {
    game: 'hiddenminers',
    me,
    n: g.n,
    W,
    H,
    options: { ...g.options },
    phase: g.phase,
    round: g.round,
    rounds: Number(g.options.rounds),
    turn: g.turn,
    myTurn,
    role: me >= 0 ? g.roles[me] : null,
    deck: g.deck.length,
    players: g.players.map((p, i) => ({ id: p.id, name: p.name, cards: g.hands[i].length, broken: g.broken[i].slice(), score: g.scores[i] })),
    board: [...g.board.values()].map((t) => ({ x: t.x, y: t.y, mask: t.mask, cut: t.cut, start: t.id === 'start' })),
    // once a round is over every chamber is shown, so the table can see where the gold was
    goals: g.goals.map((q) => ({ x: q.x, y: q.y, revealed: q.revealed || g.phase !== 'playing', gold: q.revealed || g.phase !== 'playing' ? q.gold : null })),
    scouts: me >= 0 ? g.scouts[me].map((s) => ({ ...s })) : [],
    hand,
    spots,
    targets,
    event: g.event ? { ...g.event, revealed: g.event.revealed ? g.event.revealed.slice() : undefined } : null,
    roundResult,
    winners: over ? g.winners.slice() : [],
  };
}

/** Higher total wins; everyone at the top shares the win. */
function results(g) {
  return g.players.map((_, i) => ({ score: g.scores[i], winner: g.phase === 'gameOver' && g.winners.includes(i) }));
}

module.exports = { W, H, START, GOALS, TOOLS, TOOL_NAMES, SABOTEURS, HAND, MIN_PLAYERS, MAX_PLAYERS, ROUNDS, flipMask, label, buildDeck, canPlace, legalMoves, createGame, applyAction, awaiting, botAction, viewFor, results };
