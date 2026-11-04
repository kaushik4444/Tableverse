'use strict';
/**
 * Go Fish: the rules only (no sockets, no timers).
 * 2-6 players, a standard 52-card deck. Two players get 7 cards each, three to six get 5.
 * On your turn you ask ONE other player for a rank you hold. If they have any, they hand over all of them and you ask
 * again. If not, "Go fish": you draw the top card of the stock. Draw the rank you asked for and (with "Fish your wish")
 * you go again, otherwise the turn passes. Four of a rank is a book and is laid down at once. A player with no cards on
 * their turn draws one from the stock. The game ends when all 13 books are down; most books wins (ties share).
 */
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BOOKS = RANKS.length;
const rankWord = (r) => ({ A: 'Aces', J: 'Jacks', Q: 'Queens', K: 'Kings' }[r] || r + 's');

const indexOf = (g, id) => g.players.findIndex((p) => p.id === id);
const sortHand = (h) => h.sort((a, b) => a.ord - b.ord || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
const emit = (g, e) => { g.event = { seq: ++g.seq, ...e }; };
const say = (g, by, text, kind) => { g.log.push({ by: g.players[by].name, card: text, kind }); if (g.log.length > 60) g.log.shift(); };

function shuffled(rng) {
  const d = [];
  for (const s of SUITS) RANKS.forEach((r, ord) => d.push({ id: s + r, suit: s, rank: r, ord }));
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function createGame(players, options, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > 6) throw new Error('Go Fish is for 2 to 6 players');
  const g = {
    game: 'gofish',
    n,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    rng,
    options: { wishAgain: !options || options.wishAgain !== false },
    stock: shuffled(rng),
    hands: players.map(() => []),
    books: players.map(() => []), // ranks each player has laid down
    holds: players.map(() => new Set()), // ranks a player is publicly known to hold (they asked for it and nobody has taken it): bots use it
    turn: 0,
    phase: 'playing', // playing | gameOver
    event: null,
    lastDraw: null, // { seq, by, card }: what the last player to fish drew; only that player's view shows it
    log: [],
    seq: 0,
    version: 0,
  };
  const deal = n === 2 ? 7 : 5;
  for (let k = 0; k < deal; k++) for (let i = 0; i < n; i++) g.hands[i].push(g.stock.pop());
  g.hands.forEach((h, i) => { sortHand(h); layBooks(g, i); });
  startTurn(g);
  return g;
}

/** Lay down every complete book in a hand. Returns the ranks laid. */
function layBooks(g, i) {
  const laid = [];
  for (const rank of RANKS) {
    if (g.hands[i].filter((c) => c.rank === rank).length === 4) {
      g.hands[i] = g.hands[i].filter((c) => c.rank !== rank);
      g.books[i].push(rank);
      g.holds.forEach((s) => s.delete(rank));
      laid.push(rank);
      say(g, i, `laid down a book of ${rankWord(rank)}`, 'book');
    }
  }
  return laid;
}

const bookTotal = (g) => g.books.reduce((s, b) => s + b.length, 0);
const targetsOf = (g, i) => g.players.map((_, k) => k).filter((k) => k !== i && g.hands[k].length > 0);

/** Players with no cards draw one when their turn comes; nobody who cannot play at all is waited for. */
function startTurn(g) {
  for (let guard = 0; guard <= g.n; guard++) {
    if (bookTotal(g) >= BOOKS) break;
    const i = g.turn;
    if (g.hands[i].length === 0 && g.stock.length) {
      const card = g.stock.pop();
      g.hands[i].push(card);
      g.lastDraw = { seq: g.seq + 1, by: i, card };
      say(g, i, 'had no cards and drew one', 'draw');
      emit(g, { type: 'empty', by: i });
      layBooks(g, i);
    }
    if (g.hands[i].length > 0 && (targetsOf(g, i).length > 0 || g.stock.length > 0)) return;
    g.turn = (g.turn + 1) % g.n; // nothing this player can do: on to the next
  }
  finish(g);
}

function finish(g) {
  g.phase = 'gameOver';
  const best = Math.max(...g.books.map((b) => b.length));
  emit(g, { type: 'over', winners: g.books.map((b, i) => (b.length === best ? i : -1)).filter((i) => i >= 0) });
}

const nextPlayer = (g) => { g.turn = (g.turn + 1) % g.n; startTurn(g); };

function ask(g, who, targetId, rank) {
  const t = indexOf(g, targetId);
  if (t < 0 || t === who) return { ok: false, error: 'Pick another player to ask' };
  if (g.hands[t].length === 0) return { ok: false, error: `${g.players[t].name} has no cards` };
  if (typeof rank !== 'string' || !RANKS.includes(rank)) return { ok: false, error: 'Pick a rank' };
  if (!g.hands[who].some((c) => c.rank === rank)) return { ok: false, error: 'You can only ask for a rank you hold' };
  g.holds[who].add(rank);
  const got = g.hands[t].filter((c) => c.rank === rank);
  let again = false;
  if (got.length) {
    g.hands[t] = g.hands[t].filter((c) => c.rank !== rank);
    g.hands[who].push(...got);
    sortHand(g.hands[who]);
    g.holds[t].delete(rank);
    emit(g, { type: 'take', by: who, target: t, rank, count: got.length });
    say(g, who, `asked ${g.players[t].name} for ${rankWord(rank)} and got ${got.length}`, 'take');
    again = true;
  } else if (g.stock.length) {
    const card = g.stock.pop();
    g.hands[who].push(card);
    sortHand(g.hands[who]);
    const wish = card.rank === rank;
    g.lastDraw = { seq: g.seq + 1, by: who, card };
    emit(g, { type: 'fish', by: who, target: t, rank, wish });
    say(g, who, `asked ${g.players[t].name} for ${rankWord(rank)}: Go Fish${wish ? ' (drew the very card!)' : ''}`, 'fish');
    again = wish && g.options.wishAgain;
  } else {
    emit(g, { type: 'fish', by: who, target: t, rank, wish: false, empty: true });
    say(g, who, `asked ${g.players[t].name} for ${rankWord(rank)}: Go Fish (the stock is empty)`, 'fish');
  }
  const laid = layBooks(g, who);
  if (laid.length && g.event) g.event.books = laid; // the ask that completed a book says so
  if (bookTotal(g) >= BOOKS) { finish(g); return { ok: true }; }
  if (again) startTurn(g); else nextPlayer(g);
  return { ok: true };
}

/** Nobody else has cards: draw from the stock instead of asking, then the turn passes. */
function draw(g, who) {
  if (targetsOf(g, who).length || !g.stock.length) return { ok: false, error: 'You have someone to ask' };
  const card = g.stock.pop();
  g.hands[who].push(card);
  sortHand(g.hands[who]);
  g.lastDraw = { seq: g.seq + 1, by: who, card };
  emit(g, { type: 'draw', by: who });
  say(g, who, 'drew a card (nobody had cards to ask)', 'draw');
  layBooks(g, who);
  if (bookTotal(g) >= BOOKS) { finish(g); return { ok: true }; }
  nextPlayer(g);
  return { ok: true };
}

/** action: { type: 'ask', target: playerId, rank } | { type: 'draw' } */
function applyAction(g, playerId, action) {
  if (g.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  const who = indexOf(g, playerId);
  if (who < 0) return { ok: false, error: 'You are not a player in this game' };
  if (who !== g.turn) return { ok: false, error: 'Not your turn' };
  if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };
  g.version++;
  if (action.type === 'ask') return ask(g, who, action.target, action.rank);
  if (action.type === 'draw') return draw(g, who);
  return { ok: false, error: 'Unknown action' };
}

const awaiting = (g) => (g.phase === 'gameOver' ? [] : [g.players[g.turn].id]);

/** The server plays this itself after a short pause: the only thing left to do is draw. */
function forcedPlay(g) {
  if (g.phase !== 'playing') return null;
  if (!targetsOf(g, g.turn).length && g.stock.length) return { playerId: g.players[g.turn].id, action: { type: 'draw' } };
  return null;
}

/** Bots use only what the table has seen: they prefer to ask someone known to hold a rank, otherwise a rank they hold most of. */
function botAction(g, playerId) {
  const who = indexOf(g, playerId);
  if (g.phase !== 'playing' || who !== g.turn) return null;
  const targets = targetsOf(g, who);
  if (!targets.length) return { type: 'draw' };
  const count = (r) => g.hands[who].filter((c) => c.rank === r).length;
  const mine = [...new Set(g.hands[who].map((c) => c.rank))];
  let best = null;
  for (const r of mine) for (const t of targets) {
    const score = (g.holds[t].has(r) ? 10 : 0) + count(r) * 2 + g.rng();
    if (!best || score > best.score) best = { score, t, r };
  }
  return { type: 'ask', target: g.players[best.t].id, rank: best.r };
}

function viewFor(g, playerId) {
  const me = indexOf(g, playerId);
  const over = g.phase === 'gameOver';
  const myTurn = !over && me >= 0 && me === g.turn;
  const targets = myTurn ? targetsOf(g, me) : [];
  const draw = g.lastDraw && g.lastDraw.by === me ? g.lastDraw : null;
  return {
    game: 'gofish',
    me,
    n: g.n,
    options: { ...g.options },
    phase: g.phase,
    turn: g.turn,
    myTurn,
    stock: g.stock.length,
    hand: me >= 0 ? g.hands[me].map((c) => ({ ...c })) : [],
    askRanks: myTurn ? [...new Set(g.hands[me].map((c) => c.rank))] : [],
    targets: targets.map((k) => g.players[k].id),
    canDraw: myTurn && targets.length === 0 && g.stock.length > 0,
    players: g.players.map((p, i) => ({ id: p.id, name: p.name, cards: g.hands[i].length, books: g.books[i].slice(), bookCount: g.books[i].length })),
    event: g.event ? { ...g.event } : null,
    myDraw: draw ? { seq: draw.seq, card: { ...draw.card } } : null,
    winners: over && g.event && g.event.type === 'over' ? g.event.winners.slice() : [],
  };
}

module.exports = { SUITS, RANKS, BOOKS, rankWord, createGame, applyAction, awaiting, forcedPlay, botAction, viewFor, targetsOf };
