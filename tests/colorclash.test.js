'use strict';
// Color Clash engine: the deck, matching, action cards, drawing, scoring, match flow, hidden information and bot games.
const assert = require('node:assert/strict');
const E = require('../games/colorclash/engine');
const plugin = require('../games/colorclash');

let passed = 0;
const test = (name, fn) => { fn(); passed++; };
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const card = (id, c, k, v = null) => ({ id, c, k, v });
const num = (c, v, copy = 'a') => card(`${c}${v}${copy}`, c, 'n', v);
const act = (c, k, copy = 'a') => card(`${c}${k}${copy}`, c, k);
const wild = (i = 1) => card(`W${i}`, 'W', 'wild');
const take4 = (i = 1) => card(`T${i}`, 'W', 'take4');

/** A game with chosen hands and top card, so a rule can be tested on its own. */
function setup(n, hands, topCard, opts = {}) {
  const g = E.createGame(people(n), { target: opts.target || '200' }, seeded(opts.seed || 7));
  g.hands = hands.map((h) => h.slice());
  for (let i = hands.length; i < n; i++) g.hands[i] = [num('B', 9, 'x'), num('B', 8, 'x'), num('B', 7, 'x')];
  g.discard = [topCard];
  g.colour = topCard.c;
  g.turn = opts.turn || 0;
  g.dir = 1;
  g.drawn = null;
  g.stock = opts.stock || [num('G', 1, 'z1'), num('G', 2, 'z2'), num('G', 3, 'z3'), num('G', 4, 'z4'), num('G', 5, 'z5'), num('G', 6, 'z6'), num('G', 7, 'z7')];
  return g;
}
const ok = (g, who, action) => { const r = E.applyAction(g, `p${who}`, action); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const bad = (g, who, action, re) => { const r = E.applyAction(g, `p${who}`, action); assert.equal(r.ok, false); if (re) assert.match(r.error, re); };

test('the deck has 104 cards: four colours of 1-9 twice plus Stop, Flip, Take 2 twice, and eight Wilds; ids are unique', () => {
  const d = E.buildDeck();
  assert.equal(d.length, 104);
  assert.equal(new Set(d.map((c) => c.id)).size, 104);
  for (const col of E.COLOURS) {
    assert.equal(d.filter((c) => c.c === col && c.k === 'n').length, 18);
    for (const k of ['stop', 'flip', 'take2']) assert.equal(d.filter((c) => c.c === col && c.k === k).length, 2);
  }
  assert.equal(d.filter((c) => c.k === 'wild').length, 4);
  assert.equal(d.filter((c) => c.k === 'take4').length, 4);
});

test('everyone is dealt 7 cards, the first card is a number card, and the whole deck is accounted for', () => {
  for (const n of [2, 3, 5, 8]) {
    const g = E.createGame(people(n), {}, seeded(n));
    assert.ok(g.hands.every((h) => h.length === 7));
    assert.equal(g.discard[0].k, 'n');
    assert.equal(g.colour, g.discard[0].c);
    assert.equal(g.stock.length + g.discard.length + g.hands.reduce((s, h) => s + h.length, 0), 104);
  }
  assert.throws(() => E.createGame(people(1), {}), /2 to 8/);
  assert.throws(() => E.createGame(people(9), {}), /2 to 8/);
});

test('a card matches by colour, by number or by action; Wilds always match', () => {
  const g = setup(3, [[]], num('R', 5));
  assert.equal(E.playable(g, num('R', 9)), true, 'same colour');
  assert.equal(E.playable(g, num('B', 5)), true, 'same number');
  assert.equal(E.playable(g, num('B', 6)), false);
  assert.equal(E.playable(g, act('B', 'stop')), false);
  assert.equal(E.playable(g, act('R', 'stop')), true, 'same colour action');
  assert.equal(E.playable(g, wild()), true);
  assert.equal(E.playable(g, take4()), true);
  const s = setup(3, [[]], act('R', 'stop'));
  assert.equal(E.playable(s, act('B', 'stop')), true, 'same action, other colour');
  assert.equal(E.playable(s, num('B', 3)), false);
  const w = setup(3, [[]], wild()); w.colour = 'G';
  assert.equal(E.playable(w, num('G', 4)), true, 'matches the colour chosen for the Wild');
  assert.equal(E.playable(w, num('R', 4)), false);
});

test('playing a card moves the turn on, sets the colour and tells the table', () => {
  const g = setup(3, [[num('R', 9), num('B', 2)], [num('R', 1)], [num('R', 2)]], num('R', 5));
  ok(g, 0, { type: 'play', card: 'R9a' });
  assert.equal(g.turn, 1);
  assert.equal(g.discard.at(-1).id, 'R9a');
  assert.equal(g.event.type, 'play');
  assert.equal(g.event.left, 1);
  assert.equal(g.event.last, true, 'one card left is announced');
});

test('Stop skips the next player', () => {
  const g = setup(4, [[act('R', 'stop'), num('B', 1)], [num('R', 1)], [num('R', 2)], [num('R', 3)]], num('R', 5));
  ok(g, 0, { type: 'play', card: 'Rstopa' });
  assert.equal(g.turn, 2);
  assert.equal(g.event.skipped, 1);
});

test('Flip reverses the direction; with two players it works like Stop', () => {
  const g = setup(4, [[act('R', 'flip'), num('B', 1)], [num('R', 1)], [num('R', 2)], [num('R', 3)]], num('R', 5));
  ok(g, 0, { type: 'play', card: 'Rflipa' });
  assert.equal(g.dir, -1);
  assert.equal(g.turn, 3, 'play now goes the other way');
  const two = setup(2, [[act('R', 'flip'), num('B', 1)], [num('R', 1)]], num('R', 5));
  ok(two, 0, { type: 'play', card: 'Rflipa' });
  assert.equal(two.turn, 0, 'the same player goes again');
});

test('Take 2 makes the next player draw two and miss their turn', () => {
  const g = setup(3, [[act('R', 'take2'), num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5));
  ok(g, 0, { type: 'play', card: 'Rtake2a' });
  assert.equal(g.hands[1].length, 3);
  assert.equal(g.turn, 2);
  assert.deepEqual(g.event.penalised, { target: 1, count: 2 });
});

test('Wild needs a colour, sets it, and Wild Take 4 also penalises the next player', () => {
  const g = setup(3, [[wild(), take4(), num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5));
  bad(g, 0, { type: 'play', card: 'W1' }, /colour/i);
  bad(g, 0, { type: 'play', card: 'W1', colour: 'X' }, /colour/i);
  ok(g, 0, { type: 'play', card: 'W1', colour: 'B' });
  assert.equal(g.colour, 'B');
  assert.equal(g.turn, 1);
  const h = setup(3, [[take4(), num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5));
  ok(h, 0, { type: 'play', card: 'T1', colour: 'G' });
  assert.equal(h.hands[1].length, 5);
  assert.equal(h.colour, 'G');
  assert.equal(h.turn, 2);
});

test('an unplayable card, a card you do not hold and a move out of turn are refused', () => {
  const g = setup(3, [[num('B', 1), num('R', 2)], [num('R', 1)], [num('R', 2)]], num('R', 5));
  bad(g, 0, { type: 'play', card: 'B1a' }, /match/);
  bad(g, 0, { type: 'play', card: 'nope' }, /do not have/);
  bad(g, 1, { type: 'play', card: 'R1a' }, /Not your turn/);
  bad(g, 0, { type: 'play' }, /do not have/);
  bad(g, 0, { type: 'jump' }, /Unknown/);
  assert.equal(E.applyAction(g, 'stranger', { type: 'draw' }).ok, false);
  assert.equal(E.applyAction(g, 'p0', null).ok, false);
});

test('drawing: a card that does not fit passes the turn; one that fits may be played or kept (and only that card)', () => {
  const a = setup(3, [[num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5), { stock: [num('B', 2, 'z')] });
  ok(a, 0, { type: 'draw' });
  assert.equal(a.hands[0].length, 2);
  assert.equal(a.turn, 1, 'it did not fit: the turn passes');
  const b = setup(3, [[num('B', 1), num('R', 3)], [num('R', 1)], [num('R', 2)]], num('R', 5), { stock: [num('R', 8, 'z')] });
  ok(b, 0, { type: 'draw' });
  assert.equal(b.turn, 0);
  assert.equal(b.drawn, 'R8z');
  bad(b, 0, { type: 'draw' }, /already drawn/);
  bad(b, 0, { type: 'play', card: 'R3a' }, /play that one or keep/);
  ok(b, 0, { type: 'pass' });
  assert.equal(b.turn, 1);
  assert.equal(b.hands[0].length, 3, 'the drawn card was kept');
  const c = setup(3, [[num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5), { stock: [num('R', 8, 'z')] });
  ok(c, 0, { type: 'draw' });
  ok(c, 0, { type: 'play', card: 'R8z' });
  assert.equal(c.turn, 1);
  bad(c, 1, { type: 'pass' }, /Draw a card first/);
});

test('when the stock runs out the discards (all but the top card) are shuffled into a new one', () => {
  const g = setup(3, [[num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5), { stock: [] });
  g.discard = [num('Y', 1, 'o1'), num('Y', 2, 'o2'), num('Y', 3, 'o3'), num('R', 5)];
  ok(g, 0, { type: 'draw' });
  assert.equal(g.hands[0].length, 2);
  assert.equal(g.discard.length, 1);
  assert.equal(g.discard[0].id, 'R5a');
  assert.equal(g.stock.length, 2);
  // with nothing left at all, a draw just passes the turn
  const h = setup(2, [[num('B', 1)], [num('R', 1)]], num('R', 5), { stock: [] });
  ok(h, 0, { type: 'draw' });
  assert.equal(h.turn, 1);
});

test('the first player out ends the round and scores the points left in the other hands', () => {
  const g = setup(3, [[num('R', 9)], [num('B', 4), act('G', 'stop'), wild()], [num('Y', 7)]], num('R', 5), { target: '200' });
  ok(g, 0, { type: 'play', card: 'R9a' });
  assert.equal(g.scores[0], 4 + 20 + 50 + 7);
  assert.equal(g.roundResult.winner, 0);
  assert.equal(g.roundResult.total, 81);
  assert.equal(g.phase, 'roundEnd', 'the table waits for everybody to be ready');
  assert.equal(E.applyAction(g, null, { type: 'continue' }).ok, true);
  assert.equal(g.round, 2, 'the next round has been dealt');
  assert.ok(g.hands.every((h) => h.length === 7));
  assert.equal(g.turn, 1, 'the first turn moves round the table');
  assert.equal(g.phase, 'playing');
  assert.equal(g.event.type, 'roundEnd');
});

test('the match ends at the target score and the highest total wins; one-round matches end at once', () => {
  const g = setup(2, [[num('R', 9)], [wild(), take4()]], num('R', 5), { target: '100' });
  g.scores = [30, 60];
  ok(g, 0, { type: 'play', card: 'R9a' });
  assert.equal(g.scores[0], 130);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, [0]);
  assert.deepEqual(E.awaiting(g), []);
  assert.equal(E.results(g)[0].winner, true);
  assert.equal(E.results(g)[1].winner, false);
  assert.equal(E.applyAction(g, 'p1', { type: 'draw' }).ok, false);
  const one = setup(2, [[num('R', 9)], [num('B', 3)]], num('R', 5), { target: 'round' });
  ok(one, 0, { type: 'play', card: 'R9a' });
  assert.equal(one.phase, 'gameOver');
  const tie = setup(2, [[num('R', 9)], [num('B', 3)]], num('R', 5), { target: '100' });
  tie.scores = [90, 100];
  ok(tie, 0, { type: 'play', card: 'R9a' });
  assert.equal(tie.scores[0], 93);
  assert.deepEqual(tie.winners, [1], 'the higher total wins, not the player who went out');
  const share = setup(2, [[num('R', 9)], [num('B', 9)]], num('R', 5), { target: '100' });
  share.scores = [100, 109];
  ok(share, 0, { type: 'play', card: 'R9a' });
  assert.deepEqual(share.winners, [0, 1], 'equal totals share the win');
});

test('a player sees their own hand only; others show a card count; a spectator sees no hand', () => {
  const g = E.createGame(people(3), {}, seeded(3));
  const v0 = E.viewFor(g, 'p0');
  assert.equal(v0.hand.length, 7);
  assert.deepEqual(v0.players.map((p) => p.cards), [7, 7, 7]);
  assert.ok(!JSON.stringify(v0).includes(g.hands[1][0].id + '"'), "another player's cards are not in the view");
  const spectator = E.viewFor(g, 'nobody');
  assert.equal(spectator.me, -1);
  assert.deepEqual(spectator.hand, []);
  assert.equal(spectator.myTurn, false);
  assert.equal(v0.stock + v0.discards + 21, 104);
  assert.ok(!('stockCards' in v0) && !('discardCards' in v0));
});

test('a drawn card is shown only to the player who drew it; playable cards are flagged only on your turn', () => {
  const g = setup(3, [[num('B', 1), num('R', 3)], [num('R', 1)], [num('R', 2)]], num('R', 5), { stock: [num('R', 8, 'z')] });
  ok(g, 0, { type: 'draw' });
  assert.equal(E.viewFor(g, 'p0').myDraw.card.id, 'R8z');
  assert.equal(E.viewFor(g, 'p1').myDraw, null);
  assert.equal(E.viewFor(g, 'p0').drawn, 'R8z');
  assert.deepEqual(E.viewFor(g, 'p0').hand.filter((c) => c.ok).map((c) => c.id), ['R8z'], 'only the drawn card may be played');
  assert.ok(E.viewFor(g, 'p1').hand.every((c) => !c.ok), 'not your turn: nothing is flagged');
});

test('bots always make a legal move and never leave the game stuck', () => {
  const g = setup(3, [[num('B', 1), num('G', 4), wild()], [num('R', 1)], [num('R', 2)]], num('R', 5));
  const a = E.botAction(g, 'p0');
  assert.equal(a.type, 'play');
  assert.equal(E.applyAction(g, 'p0', a).ok, true);
  assert.equal(E.botAction(g, 'p0'), null, 'not its turn');
  const none = setup(3, [[num('B', 1)], [num('R', 1)], [num('R', 2)]], num('R', 5));
  assert.deepEqual(E.botAction(none, 'p0'), { type: 'draw' });
});

test('full games played by bots finish, keep all 104 cards, and every move is accepted (2 to 8 players)', () => {
  for (const n of [2, 3, 4, 6, 8]) {
    for (let seed = 1; seed <= 12; seed++) {
      const g = E.createGame(people(n), { target: seed % 3 === 0 ? 'round' : '100' }, seeded(seed * 31 + n));
      let moves = 0;
      while (g.phase !== 'gameOver') {
        if (g.phase === 'roundEnd') { assert.equal(E.applyAction(g, null, { type: 'continue' }).ok, true); continue; }
        const id = E.awaiting(g)[0];
        const a = E.botAction(g, id);
        const r = E.applyAction(g, id, a);
        assert.equal(r.ok, true, `${n}p seed ${seed}: ${JSON.stringify(a)} -> ${r.error}`);
        assert.equal(g.stock.length + g.discard.length + g.hands.reduce((s, h) => s + h.length, 0), 104, 'no card is lost or copied');
        assert.ok(++moves < 4000, `${n}p seed ${seed}: the game does not end`);
      }
      assert.ok(g.winners.length >= 1);
      assert.equal(E.results(g).filter((r) => r.winner).length, g.winners.length);
    }
  }
});

test('the plugin matches the server interface: seats, options, rules, results, scrub and the disclaimer', () => {
  assert.equal(plugin.id, 'colorclash');
  assert.deepEqual(plugin.seats, { min: 2, max: 8, default: 4 });
  assert.ok(plugin.options.some((o) => o.key === 'target'));
  assert.match(plugin.rules.join('\n'), /not affiliated with, endorsed by or licensed by the publisher/);
  const game = plugin.create(people(3), { target: 'round' }, seeded(5));
  assert.deepEqual(game.awaiting(), ['p0']);
  assert.equal(game.isOver(), false);
  assert.equal(game.act('p1', { type: 'draw' }).ok, false);
  assert.equal(game.act('p0', 'junk').ok, false);
  assert.equal(game.view('p0').game, 'colorclash');
  game.scrub(['P1'], 'Former player');
  assert.ok(!JSON.stringify(game.view('p0')).includes('"P1"'));
  while (!game.isOver()) { const id = game.awaiting()[0]; assert.equal(game.act(id, game.botAction(id)).ok, true); }
  assert.equal(game.results().filter((r) => r.winner).length >= 1, true);
});

test('scrubbing a deleted player keeps the rule options (a player named like an option)', () => {
  const named = [{ id: 'p0', name: 'round' }, { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const game = plugin.create(named, { target: 'round' }, seeded(5));
  game.scrub(['round'], 'Former player');
  let steps = 0;
  while (!game.isOver() && steps++ < 2000) { const id = game.awaiting()[0]; assert.equal(game.act(id, game.botAction(id)).ok, true); }
  assert.equal(game.isOver(), true, 'the one-round game still ends after the scrub');
});

test('scrubbing a player named like a card kind leaves the cards alone', () => {
  const named = [{ id: 'p0', name: 'wild' }, { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
  const game = plugin.create(named, {}, () => 0.5);
  const wildCards = () => ['p0', 'p1', 'p2'].reduce((n, id) => n + (JSON.stringify(game.view(id)).match(/"k":"wild"/g) || []).length, 0);
  const before = wildCards();
  assert.ok(before > 0, 'the deal includes a Wild card, so the check means something');
  game.scrub(['wild'], 'Former player');
  assert.equal(wildCards(), before, 'the Wild cards keep their kind');
  assert.equal(JSON.stringify(game.view('p1')).includes('"k":"Former player"'), false, 'no card kind was rewritten');
});

console.log(`${passed} color clash tests passed`);
