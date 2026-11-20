'use strict';
const pacing = require('../pacing');
const { randomUUID } = require('crypto');
/**
 * Stage 10: the rules only (no sockets, no timers).
 *
 * 2-6 players. A 108-card deck: the numbers 1-12 in four colours (two of each), 8 wild cards and 4 skip cards. Ten stages
 * (a goal to lay down: sets, runs or one colour). Each round everyone gets 10 cards and tries to lay down the goal of their own
 * current stage. A turn is: draw (stock or the top discard), then optionally lay down your stage (once per round), then
 * optionally hit (add cards to any laid group), then discard one card. The first to get rid of all their cards ends the round;
 * everyone else adds up the points still in their hand. Players who laid down move to the next stage. The game ends when a
 * round finishes with someone having completed the last stage; among those, the lowest points win.
 *
 * This is our own implementation of a well-known kind of rummy. Rules are not protected, but names, artwork and rule wording
 * of published games are, so the stage list, the card set names and all wording here are our own (see docs/GAME_NAMES.md).
 */
const HAND = 10;
const MAX_PLAYERS = 6;
const COLOURS = ['R', 'B', 'G', 'Y'];
const MAXV = 12;
/** The goals, in order. set = same number, run = consecutive numbers, colour = same colour (any numbers). */
const STAGES = [
  [{ kind: 'set', size: 3 }, { kind: 'run', size: 3 }],
  [{ kind: 'set', size: 3 }, { kind: 'set', size: 3 }],
  [{ kind: 'run', size: 5 }],
  [{ kind: 'set', size: 4 }, { kind: 'run', size: 3 }],
  [{ kind: 'colour', size: 6 }],
  [{ kind: 'set', size: 3 }, { kind: 'run', size: 5 }],
  [{ kind: 'run', size: 7 }],
  [{ kind: 'set', size: 4 }, { kind: 'set', size: 4 }],
  [{ kind: 'colour', size: 8 }],
  [{ kind: 'set', size: 5 }, { kind: 'run', size: 4 }],
];
const LENGTHS = { short: 5, full: 10 };
/** A short name for each stage, shown on the table so players know which goal they are on. */
const STAGE_NAMES = [
  'Trio and run', 'Twin trios', 'Long run', 'Quad and run', 'Colour rush',
  'Trio and long run', 'Run of seven', 'Twin quads', 'Colour storm', 'Grand finale',
];

/** Cards: ids 0-95 numbers (id = colour*24 + copy*12 + value-1), 96-103 wild, 104-107 skip. */
function makeCard(id) {
  if (id < 96) return { id, k: 'n', c: COLOURS[Math.floor(id / 24)], v: (id % 12) + 1 };
  if (id < 104) return { id, k: 'w', c: null, v: 0 };
  return { id, k: 's', c: null, v: 0 };
}
const points = (c) => (c.k === 'w' ? 25 : c.k === 's' ? 15 : c.v >= 10 ? 10 : 5);
const sumPoints = (cards) => cards.reduce((s, c) => s + points(c), 0);

function shuffled(rng, wildCards = true) {
  const d = Array.from({ length: 108 }, (_, i) => makeCard(i)).filter((c) => wildCards || c.k !== 'w');
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** Checks `cards` against one goal part and returns the group, or null. Pure. */
function classify(cards, req) {
  if (!Array.isArray(cards) || cards.length !== req.size || cards.some((c) => c.k === 's')) return null;
  const nat = cards.filter((c) => c.k === 'n');
  const wild = cards.filter((c) => c.k === 'w');
  if (!nat.length) return null;
  if (req.kind === 'set') {
    if (nat.some((c) => c.v !== nat[0].v)) return null;
    return { kind: 'set', num: nat[0].v, cards: cards.map((c) => ({ ...c })) };
  }
  if (req.kind === 'colour') {
    if (nat.some((c) => c.c !== nat[0].c)) return null;
    return { kind: 'colour', colour: nat[0].c, cards: cards.map((c) => ({ ...c })) };
  }
  // run: naturals have distinct values that fit a window of the run's length inside 1..12; wilds fill the gaps, then extend upwards
  const vals = nat.map((c) => c.v).sort((a, b) => a - b);
  if (new Set(vals).size !== vals.length) return null;
  if (vals[vals.length - 1] - vals[0] + 1 > req.size) return null;
  const lo = Math.max(1, Math.min(vals[0], MAXV + 1 - req.size));
  if (lo + req.size - 1 < vals[vals.length - 1]) return null;
  const byV = new Map(nat.map((c) => [c.v, c]));
  const w = wild.slice();
  const out = [];
  for (let v = lo; v < lo + req.size; v++) out.push(byV.has(v) ? { ...byV.get(v) } : { ...w.pop(), as: v });
  return { kind: 'run', lo, hi: lo + req.size - 1, cards: out };
}

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > MAX_PLAYERS) throw new Error(`Stage 10 is for 2 to ${MAX_PLAYERS} players`);
  const length = options && Object.hasOwn(LENGTHS, options.length) ? options.length : 'full';
  const wildCards = !(options && options.wildCards === false); // on unless the host turns them off
  const g = {
    game: 'stagerummy', n, rng,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    options: { length, wildCards }, stageCount: LENGTHS[length],
    round: 0, dealer: n - 1, turn: 0,
    phase: 'draw', // draw | play | gameOver
    stock: [], discard: [], hands: [],
    stage: players.map(() => 1), scores: players.map(() => 0),
    laid: players.map(() => null), skipped: players.map(() => false),
    event: null, log: [], lastRound: null, winners: [], seq: 0,
    matchId: randomUUID(), // identifies this match: a rematch at the same table is a new one, even if its sequence catches up
  };
  startRound(g);
  return g;
}

function startRound(g) {
  g.round += 1;
  g.stock = shuffled(g.rng, g.options.wildCards);
  g.hands = g.players.map(() => []);
  for (let k = 0; k < HAND; k++) for (let i = 0; i < g.n; i++) g.hands[i].push(g.stock.pop());
  g.hands.forEach(sortHand);
  g.discard = [];
  // the first discard is never a skip card: those go back under the stock
  let first = g.stock.pop();
  while (first.k === 's') { g.stock.unshift(first); first = g.stock.pop(); }
  g.discard.push(first);
  g.laid = g.players.map(() => null);
  g.skipped = g.players.map(() => false);
  g.dealer = (g.dealer + 1) % g.n;
  g.turn = (g.dealer + 1) % g.n;
  g.phase = 'draw';
}
const sortHand = (h) => h.sort((a, b) => (a.k === b.k ? (a.c === b.c ? a.v - b.v : COLOURS.indexOf(a.c) - COLOURS.indexOf(b.c)) : a.k < b.k ? -1 : 1));

function awaiting(g) { return g.phase === 'gameOver' ? [] : [g.players[g.turn].id]; }

function applyAction(g, playerId, action) {
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  const i = indexOf(g, playerId);
  if (i < 0) return { ok: false, error: 'You are not at this table' };
  if (i !== g.turn) return { ok: false, error: 'It is not your turn' };
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return { ok: false, error: 'Invalid action' };
  switch (action.type) {
    case 'draw': return draw(g, i, action);
    case 'lay': return lay(g, i, action);
    case 'hit': return hit(g, i, action);
    case 'discard': return discard(g, i, action);
    default: return { ok: false, error: 'Unknown action' };
  }
}

const COLOUR_NAME = { R: 'Red', B: 'Blue', G: 'Green', Y: 'Yellow' };
/** A card in words for the public feed: "Blue 7", "Skip card" or "Wild card". Only for a card that is already public. */
function cardLabel(c) { return c.k === 'w' ? 'Wild card' : c.k === 's' ? 'Skip card' : `${COLOUR_NAME[c.c]} ${c.v}`; }
/** How long a bot waits after these events, so people can read the feed and the spotlight. Humans are never held. */
const HOLD_MS = { lay: 1200, skip: 1600, roundEnd: 1800 };

/** Records an event: the latest one (for the spotlight) and the recent ones (for the feed, so none is lost). */
function event(g, e) {
  g.seq += 1;
  const ev = { ...e, seq: g.seq };
  g.event = ev;
  g.log.push(ev);
  if (g.log.length > 40) g.log.shift();
  if (HOLD_MS[e.type]) pacing.hold(g, HOLD_MS[e.type]);
}

function draw(g, i, action) {
  if (g.phase !== 'draw') return { ok: false, error: 'You have already drawn' };
  let card;
  if (action.from === 'discard') {
    const top = g.discard[g.discard.length - 1];
    if (!top) return { ok: false, error: 'The discard pile is empty' };
    if (top.k === 's') return { ok: false, error: 'A skip card cannot be picked up' };
    card = g.discard.pop();
  } else if (action.from === 'stock') {
    if (!g.stock.length) { // reshuffle everything under the top discard
      const top = g.discard.pop();
      g.stock = g.discard; g.discard = top ? [top] : [];
      for (let k = g.stock.length - 1; k > 0; k--) { const j = Math.floor(g.rng() * (k + 1)); [g.stock[k], g.stock[j]] = [g.stock[j], g.stock[k]]; }
      if (!g.stock.length) return { ok: false, error: 'No cards left to draw' };
    }
    card = g.stock.pop();
  } else return { ok: false, error: 'Draw from the stock or the discard pile' };
  g.hands[i].push(card); sortHand(g.hands[i]);
  g.phase = 'play';
  event(g, { type: 'draw', by: i, from: action.from, card: action.from === 'discard' ? card.id : null, label: action.from === 'discard' ? cardLabel(card) : null });
  return { ok: true };
}

function lay(g, i, action) {
  if (g.phase !== 'play') return { ok: false, error: 'Draw first' };
  if (g.laid[i]) return { ok: false, error: 'You have already laid down this round' };
  const req = STAGES[g.stage[i] - 1];
  if (!Array.isArray(action.groups) || action.groups.length !== req.length) return { ok: false, error: `Your stage needs ${req.length} group${req.length === 1 ? '' : 's'}` };
  const used = new Set();
  const groups = [];
  for (let k = 0; k < req.length; k++) {
    const ids = action.groups[k];
    if (!Array.isArray(ids) || ids.length !== req[k].size || !ids.every(Number.isInteger)) return { ok: false, error: 'Wrong number of cards in a group' };
    const cards = [];
    for (const id of ids) {
      const c = g.hands[i].find((x) => x.id === id);
      if (!c || used.has(id)) return { ok: false, error: 'Those cards are not all in your hand' };
      used.add(id); cards.push(c);
    }
    const grp = classify(cards, req[k]);
    if (!grp) return { ok: false, error: `That is not a valid ${req[k].kind} of ${req[k].size}` };
    groups.push(grp);
  }
  g.hands[i] = g.hands[i].filter((c) => !used.has(c.id));
  g.laid[i] = groups;
  event(g, { type: 'lay', by: i, stage: g.stage[i] });
  if (!g.hands[i].length) endRound(g, i); // laying every card goes out
  return { ok: true };
}

function hit(g, i, action) {
  if (g.phase !== 'play') return { ok: false, error: 'Draw first' };
  if (!g.laid[i]) return { ok: false, error: 'Lay down your stage before adding to groups' };
  const c = Number.isInteger(action.card) ? g.hands[i].find((x) => x.id === action.card) : null;
  if (!c) return { ok: false, error: 'That card is not in your hand' };
  if (c.k === 's') return { ok: false, error: 'A skip card cannot be added to a group' };
  const owner = action.owner;
  // Only real indexes of this player's laid groups: a name such as "__proto__" must never reach an array's inherited properties.
  const groups = Number.isInteger(owner) && owner >= 0 && owner < g.n && g.laid[owner] ? g.laid[owner] : null;
  const gi = Number.isInteger(action.group) && action.group >= 0 && groups && action.group < groups.length ? action.group : -1;
  const grp = gi >= 0 ? groups[gi] : null;
  if (!grp) return { ok: false, error: 'No such group' };
  if (grp.kind === 'set') {
    if (c.k === 'n' && c.v !== grp.num) return { ok: false, error: 'That card does not match the set' };
    grp.cards.push({ ...c });
  } else if (grp.kind === 'colour') {
    if (c.k === 'n' && c.c !== grp.colour) return { ok: false, error: 'That card is not the group colour' };
    grp.cards.push({ ...c });
  } else {
    let end = action.end === 'low' || action.end === 'high' ? action.end : null;
    if (c.k === 'n') {
      if (c.v === grp.hi + 1) end = 'high'; else if (c.v === grp.lo - 1) end = 'low'; else return { ok: false, error: 'That card does not extend the run' };
    } else if (!end) end = grp.hi < MAXV ? 'high' : 'low';
    if (end === 'high' && grp.hi >= MAXV) return { ok: false, error: 'The run cannot go higher than 12' };
    if (end === 'low' && grp.lo <= 1) return { ok: false, error: 'The run cannot go lower than 1' };
    if (end === 'high') { grp.hi += 1; grp.cards.push(c.k === 'w' ? { ...c, as: grp.hi } : { ...c }); }
    else { grp.lo -= 1; grp.cards.unshift(c.k === 'w' ? { ...c, as: grp.lo } : { ...c }); }
  }
  g.hands[i] = g.hands[i].filter((x) => x.id !== c.id);
  event(g, { type: 'hit', by: i, owner, group: action.group, card: c.id, label: cardLabel(c) });
  if (!g.hands[i].length) endRound(g, i);
  return { ok: true };
}

function discard(g, i, action) {
  if (g.phase !== 'play') return { ok: false, error: 'Draw first' };
  const c = Number.isInteger(action.card) ? g.hands[i].find((x) => x.id === action.card) : null;
  if (!c) return { ok: false, error: 'That card is not in your hand' };
  g.hands[i] = g.hands[i].filter((x) => x.id !== c.id);
  g.discard.push(c);
  event(g, { type: 'discard', by: i, card: c.id, label: cardLabel(c) });
  if (!g.hands[i].length) { endRound(g, i); return { ok: true }; }
  advance(g, i, c.k === 's');
  return { ok: true };
}

/** Next player; a skip card makes the next player lose their turn (with two players the discarder goes again). */
function advance(g, from, skip) {
  let next = (from + 1) % g.n;
  if (skip) { g.skipped[next] = true; }
  if (g.skipped[next]) { g.skipped[next] = false; event(g, { type: 'skip', by: from, who: next }); next = (next + 1) % g.n; }
  g.turn = next;
  g.phase = 'draw';
}

function endRound(g, outBy) {
  const left = g.hands.map(sumPoints);
  const completed = g.players.map((_, i) => !!g.laid[i]);
  g.scores = g.scores.map((s, i) => s + left[i]);
  const done = g.players.map((_, i) => completed[i] && g.stage[i] === g.stageCount);
  g.lastRound = { round: g.round, outBy, points: left, laid: completed, stages: g.stage.slice() };
  g.stage = g.stage.map((s, i) => (completed[i] ? s + 1 : s));
  event(g, { type: 'roundEnd', by: outBy });
  if (done.some(Boolean)) {
    const low = Math.min(...g.scores.filter((_, i) => done[i]));
    g.winners = g.scores.map((s, i) => (done[i] && s === low ? i : -1)).filter((i) => i >= 0);
    g.phase = 'gameOver';
    return;
  }
  startRound(g);
}

/* ---------- Bot ---------- */

/** Every way to build one goal part from `pool` (arrays of card ids), fewest wild cards first. */
function candidates(pool, req) {
  const nat = pool.filter((c) => c.k === 'n');
  const wild = pool.filter((c) => c.k === 'w');
  const out = [];
  const fill = (chosen, need) => (need <= wild.length ? chosen.concat(wild.slice(0, need)) : null);
  const matching = [];
  if (req.kind === 'set') {
    for (let v = 1; v <= MAXV; v++) {
      const same = nat.filter((c) => c.v === v);
      matching.push(same);
      if (!same.length) continue;
      const take = same.slice(0, req.size);
      const g = fill(take, req.size - take.length);
      if (g) out.push(g);
    }
  } else if (req.kind === 'colour') {
    for (const col of COLOURS) {
      const same = nat.filter((c) => c.c === col);
      matching.push(same);
      if (!same.length) continue;
      const take = same.slice(0, req.size);
      const g = fill(take, req.size - take.length);
      if (g) out.push(g);
    }
  } else {
    for (let lo = 1; lo + req.size - 1 <= MAXV; lo++) {
      const chosen = [];
      for (let v = lo; v < lo + req.size; v++) { const c = nat.find((x) => x.v === v); if (c) chosen.push(c); }
      if (!chosen.length) continue;
      const g = fill(chosen, req.size - chosen.length);
      if (g) out.push(g);
    }
  }
  // Keep the original maximum-natural candidates first. Then try every smaller
  // natural subset that wilds can complete, reserving other cards for later parts.
  for (const same of matching) {
    for (let count = Math.min(same.length, req.size) - 1; count >= Math.max(1, req.size - wild.length); count--) {
      const choose = (start, chosen) => {
        if (chosen.length === count) { out.push(fill(chosen, req.size - count)); return; }
        for (let j = start; j <= same.length - (count - chosen.length); j++) choose(j + 1, chosen.concat(same[j]));
      };
      choose(0, []);
    }
  }
  return out;
}

/** Finds groups (as id lists) that lay down `stageReq` from `hand`, or null. Depth-first over the goal parts. */
function solve(hand, stageReq, part = 0) {
  if (part === stageReq.length) return [];
  for (const cand of candidates(hand, stageReq[part])) {
    const ids = new Set(cand.map((c) => c.id));
    const rest = solve(hand.filter((c) => !ids.has(c.id)), stageReq, part + 1);
    if (rest) return [cand.map((c) => c.id), ...rest];
  }
  return null;
}

/** Natural-card groups that could grow into one goal part, with how many cards each still lacks. */
function partOptions(nat, req) {
  const out = [];
  if (req.kind === 'set') {
    for (let v = 1; v <= MAXV; v++) { const same = nat.filter((c) => c.v === v).slice(0, req.size); if (same.length) out.push({ ids: same.map((c) => c.id), lack: req.size - same.length }); }
  } else if (req.kind === 'colour') {
    for (const col of COLOURS) { const same = nat.filter((c) => c.c === col).slice(0, req.size); if (same.length) out.push({ ids: same.map((c) => c.id), lack: req.size - same.length }); }
  } else {
    for (let lo = 1; lo + req.size - 1 <= MAXV; lo++) {
      const have = []; for (let v = lo; v < lo + req.size; v++) { const c = nat.find((x) => x.v === v); if (c) have.push(c); }
      if (have.length) out.push({ ids: have.map((c) => c.id), lack: req.size - have.length });
    }
  }
  return out;
}

/** How many more cards the hand needs before the stage can be laid (0 = can lay now). Wild cards fill gaps. */
function distance(hand, stageReq) {
  const nat = hand.filter((c) => c.k === 'n');
  const wilds = hand.filter((c) => c.k === 'w').length;
  let best = Infinity;
  const go = (part, pool, lack) => {
    if (part === stageReq.length) { best = Math.min(best, Math.max(0, lack - wilds)); return; }
    for (const o of partOptions(pool, stageReq[part])) {
      const used = new Set(o.ids);
      go(part + 1, pool.filter((c) => !used.has(c.id)), lack + o.lack);
    }
  };
  go(0, nat, 0);
  return best;
}

/** The card to throw away: the one whose removal leaves the hand closest to laying down (then the most points). */
function worstCard(hand, stageReq, rng) {
  let pick = hand[0]; let pickKey = Infinity;
  for (const c of hand) {
    const key = distance(hand.filter((x) => x.id !== c.id), stageReq) * 1000 - points(c) - (rng ? rng() : 0);
    if (key < pickKey) { pickKey = key; pick = c; }
  }
  return pick;
}

function botAction(g, playerId) {
  const i = indexOf(g, playerId);
  if (i < 0 || i !== g.turn || g.phase === 'gameOver') return null;
  const hand = g.hands[i];
  const req = STAGES[g.stage[i] - 1];
  if (g.phase === 'draw') {
    const top = g.discard[g.discard.length - 1];
    if (top && top.k !== 's' && !g.laid[i]) {
      const after = hand.concat(top);
      const drop = worstCard(after, req);
      if (drop.id !== top.id && distance(after.filter((c) => c.id !== drop.id), req) < distance(hand, req)) return { type: 'draw', from: 'discard' };
    } else if (top && top.k === 'w') return { type: 'draw', from: 'discard' };
    return { type: 'draw', from: 'stock' };
  }
  if (!g.laid[i]) {
    const groups = solve(hand, req);
    if (groups) return { type: 'lay', groups };
    return { type: 'discard', card: worstCard(hand, req, g.rng).id };
  }
  for (const c of hand) {
    if (c.k === 's') continue;
    for (let o = 0; o < g.n; o++) {
      if (!g.laid[o]) continue;
      for (let k = 0; k < g.laid[o].length; k++) {
        const grp = g.laid[o][k];
        const fits = grp.kind === 'set' ? c.k === 'w' || c.v === grp.num
          : grp.kind === 'colour' ? c.k === 'w' || c.c === grp.colour
            : c.k === 'w' ? grp.hi < MAXV || grp.lo > 1 : c.v === grp.hi + 1 || c.v === grp.lo - 1;
        if (fits) return { type: 'hit', card: c.id, owner: o, group: k };
      }
    }
  }
  // already laid down: shed the most points
  return { type: 'discard', card: hand.reduce((w, c) => (points(c) > points(w) ? c : w), hand[0]).id };
}

/* ---------- View ---------- */

const pub = (c) => ({ id: c.id, k: c.k, c: c.c, v: c.v, ...(c.as ? { as: c.as } : {}) });

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const over = g.phase === 'gameOver';
  return {
    game: 'stagerummy',
    phase: g.phase, round: g.round, turn: g.turn, me,
    myTurn: !over && me >= 0 && me === g.turn,
    stageCount: g.stageCount,
    goals: STAGES.slice(0, g.stageCount),
    stageNames: STAGE_NAMES.slice(0, g.stageCount),
    wildCards: g.options.wildCards,
    players: g.players.map((p, i) => ({
      id: p.id, name: p.name, cards: g.hands[i].length, stage: g.stage[i], score: g.scores[i],
      laid: g.laid[i] ? g.laid[i].map((grp) => ({ kind: grp.kind, num: grp.num, colour: grp.colour, lo: grp.lo, hi: grp.hi, cards: grp.cards.map(pub) })) : null,
    })),
    hand: me >= 0 ? g.hands[me].map(pub) : [],
    discardTop: g.discard.length ? pub(g.discard[g.discard.length - 1]) : null,
    discardCount: g.discard.length, stockCount: g.stock.length,
    event: g.event ? { ...g.event } : null,
    log: g.log.slice(-20).map((e) => ({ ...e })),
    matchId: g.matchId,
    lastRound: g.lastRound ? { ...g.lastRound, points: g.lastRound.points.slice(), laid: g.lastRound.laid.slice(), stages: g.lastRound.stages.slice() } : null,
    winners: g.winners.slice(),
  };
}

/** Higher is better: stages completed first, then fewer points. */
function results(g) {
  const best = g.winners;
  return g.players.map((_, i) => ({ score: (g.stage[i] - 1) * 100000 - g.scores[i], winner: g.phase === 'gameOver' && best.includes(i) }));
}

module.exports = { HAND, MAX_PLAYERS, STAGES, STAGE_NAMES, LENGTHS, makeCard, points, classify, solve, createGame, applyAction, awaiting, botAction, viewFor, results };
