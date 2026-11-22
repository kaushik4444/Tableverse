'use strict';
const assert = require('node:assert/strict');
const e = require('../games/hiddenminers/engine');
const plugin = require('../games/hiddenminers');
const registry = require('../games');

let seedBase = 1;
const mkrng = (s) => { let x = s; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; };
const people = (n) => [...Array(n)].map((_, i) => ({ id: `p${i}`, name: `P${i}` }));
const fresh = (n = 4, options = {}, seed = seedBase++) => e.createGame(people(n), options, mkrng(seed));
const tile = (id, mask, cut = false) => ({ id, k: 'tile', mask, cut });
let count = 0;
const test = (name, fn) => { fn(); count++; };

test('deck: 39 tunnel pieces, tool cards, scouts and collapses with unique ids', () => {
  const d = e.buildDeck();
  assert.equal(new Set(d.map((c) => c.id)).size, d.length);
  assert.equal(d.filter((c) => c.k === 'tile').length, 39);
  assert.equal(d.filter((c) => c.k === 'break').length, 9);
  assert.equal(d.filter((c) => c.k === 'repair').length, 9);
  assert.equal(d.filter((c) => c.k === 'scout').length, 6);
  assert.equal(d.filter((c) => c.k === 'collapse').length, 3);
});

test('deal: hand sizes, saboteur counts and the three hidden chambers', () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const g = fresh(n);
    assert.ok(g.hands.every((h) => h.length === e.HAND[n]));
    assert.equal(g.roles.filter((r) => r === 'saboteur').length, e.SABOTEURS[n]);
    assert.equal(g.goals.filter((q) => q.gold).length, 1);
    assert.ok(g.goals.every((q) => !q.revealed));
  }
  assert.throws(() => fresh(2));
  assert.throws(() => fresh(9));
});

test('placement: must join the start, match neighbours and cannot overlap', () => {
  const g = fresh(4);
  assert.ok(e.canPlace(g, 10, 1, 2), 'east-west piece next to the start');
  assert.ok(!e.canPlace(g, 5, 1, 2), 'a north-south piece has no west opening to meet the start');
  assert.ok(!e.canPlace(g, 15, 0, 2), 'cannot cover the start');
  assert.ok(!e.canPlace(g, 15, 4, 2), 'must be joined to a tunnel');
  assert.ok(!e.canPlace(g, 15, 9, 2), 'inside the grid only');
});

test('a tile card is placed, can be turned upside down, and fills the board', () => {
  const g = fresh(4);
  const who = g.turn;
  g.hands[who] = [tile('t1', 3), tile('t2', 10)];
  const r = e.applyAction(g, `p${who}`, { type: 'tile', card: 't1', x: 1, y: 2, flip: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(g.board.get('1,2').mask, 12, 'turned piece: south-west');
  assert.equal(e.applyAction(g, `p${g.turn}`, { type: 'tile', card: 'nope', x: 1, y: 1 }).ok, false);
});

test('turn order and card ownership are enforced', () => {
  const g = fresh(4);
  const other = `p${(g.turn + 1) % 4}`;
  assert.equal(e.applyAction(g, other, { type: 'discard', card: g.hands[(g.turn + 1) % 4][0].id }).error, 'Not your turn');
  assert.equal(e.applyAction(g, `p${g.turn}`, { type: 'discard', card: g.hands[(g.turn + 1) % 4][0].id }).error, 'You do not have that card');
  assert.equal(e.applyAction(g, 'ghost', { type: 'discard', card: 'x' }).ok, false);
  assert.equal(e.applyAction(g, `p${g.turn}`, null).ok, false);
});

test('break and repair: a broken tool stops digging until mended; no double break; cannot break yourself', () => {
  const g = fresh(4);
  const a = g.turn; const b = (a + 1) % 4;
  g.hands[a] = [{ id: 'b1', k: 'break', tool: 'pick' }, { id: 'b2', k: 'break', tool: 'pick' }, { id: 'rr', k: 'repair', tools: ['pick', 'cart'] }];
  g.hands[b] = [tile('t1', 10), { id: 'r1', k: 'repair', tools: ['pick'] }];
  assert.equal(e.applyAction(g, `p${a}`, { type: 'break', card: 'b1', target: a }).ok, false);
  assert.equal(e.applyAction(g, `p${a}`, { type: 'break', card: 'b1', target: b }).ok, true);
  assert.deepEqual(g.broken[b], ['pick']);
  g.turn = a;
  assert.equal(e.applyAction(g, `p${a}`, { type: 'break', card: 'b2', target: b }).ok, false, 'already broken');
  g.turn = b;
  const blocked = e.applyAction(g, `p${b}`, { type: 'tile', card: 't1', x: 1, y: 2 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /broken tool/);
  assert.equal(e.applyAction(g, `p${b}`, { type: 'repair', card: 'r1', target: b, tool: 'cart' }).ok, false, 'wrong tool');
  assert.equal(e.applyAction(g, `p${b}`, { type: 'repair', card: 'r1', target: b, tool: 'pick' }).ok, true);
  assert.deepEqual(g.broken[b], []);
});

test('scout: only the scout learns the chamber; everyone sees that a scout happened', () => {
  const g = fresh(4);
  const a = g.turn;
  g.hands[a] = [{ id: 's1', k: 'scout' }];
  const gold = g.goals.findIndex((q) => q.gold);
  assert.equal(e.applyAction(g, `p${a}`, { type: 'scout', card: 's1', goal: gold }).ok, true);
  assert.deepEqual(e.viewFor(g, `p${a}`).scouts, [{ goal: gold, gold: true }]);
  const others = e.viewFor(g, `p${(a + 1) % 4}`);
  assert.deepEqual(others.scouts, []);
  assert.ok(!JSON.stringify(others).includes('"gold":true'), 'no one else sees where the gold is');
});

test('collapse removes a piece but never the start', () => {
  const g = fresh(4);
  const a = g.turn;
  g.hands[a] = [{ id: 'c1', k: 'collapse' }, { id: 'c2', k: 'collapse' }];
  g.board.set('1,2', { id: 't', mask: 10, cut: false, x: 1, y: 2 });
  assert.equal(e.applyAction(g, `p${a}`, { type: 'collapse', card: 'c1', x: 0, y: 2 }).ok, false);
  assert.equal(e.applyAction(g, `p${a}`, { type: 'collapse', card: 'c1', x: 1, y: 2 }).ok, true);
  assert.ok(!g.board.has('1,2'));
});

test('dead-end pieces join the tunnel but do not carry it on', () => {
  const g = fresh(4);
  g.board.set('1,2', { id: 'd', mask: 10, cut: true, x: 1, y: 2 });
  assert.ok(!e.canPlace(g, 10, 2, 2), 'cannot continue past a dead end');
});

test('reaching a chamber opens it; the gold ends the round for the Diggers with the finder bonus', () => {
  const g = fresh(4, { rounds: '1' });
  g.goals.forEach((q, i) => { q.gold = i === 1; });
  for (let x = 1; x <= 7; x++) g.board.set(`${x},2`, { id: `t${x}`, mask: 10, cut: false, x, y: 2 });
  const who = g.turn;
  g.hands[who] = [tile('last', 10)];
  g.roles = ['digger', 'digger', 'saboteur', 'digger'];
  // 7,2 is already placed; a piece at 7,1 cannot join from the side. Remove 7,2 and place it as the last piece.
  g.board.delete('7,2');
  assert.equal(e.applyAction(g, `p${who}`, { type: 'tile', card: 'last', x: 7, y: 2 }).ok, true);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.roundResult.side, 'diggers');
  assert.equal(g.roundResult.finder, who);
  assert.equal(g.goals[1].revealed, true);
  g.roles.forEach((r, i) => assert.equal(g.roundResult.gains[i], r === 'digger' ? 3 + (i === who ? 1 : 0) : 0));
  assert.ok(g.winners.length >= 1);
  assert.equal(g.event.type, 'over');
  assert.equal(g.event.goldIndex, 1, 'the closing event still says which chamber held the gold');
  assert.deepEqual(e.viewFor(g, 'p0').event.revealed, [1]);
});

test('a Saboteur who opens the gold earns only the finder point; the Diggers still score', () => {
  const g = fresh(4, { rounds: '1' });
  g.goals.forEach((q, i) => { q.gold = i === 1; });
  for (let x = 1; x <= 6; x++) g.board.set(`${x},2`, { id: `t${x}`, mask: 10, cut: false, x, y: 2 });
  const who = g.turn;
  g.roles = ['digger', 'digger', 'digger', 'digger'];
  g.roles[who] = 'saboteur';
  g.hands[who] = [tile('last', 10)];
  assert.equal(e.applyAction(g, `p${who}`, { type: 'tile', card: 'last', x: 7, y: 2 }).ok, true);
  g.roles.forEach((r, i) => assert.equal(g.roundResult.gains[i], i === who ? 1 : 3));
});

test('a rock chamber opens without ending the round', () => {
  const g = fresh(4);
  g.goals.forEach((q, i) => { q.gold = i === 0; });
  for (let x = 1; x <= 6; x++) g.board.set(`${x},2`, { id: `t${x}`, mask: 10, cut: false, x, y: 2 });
  const who = g.turn;
  g.hands[who] = [tile('last', 10), tile('x', 10)];
  assert.equal(e.applyAction(g, `p${who}`, { type: 'tile', card: 'last', x: 7, y: 2 }).ok, true);
  assert.equal(g.goals[1].revealed, true);
  assert.equal(g.goals[1].gold, false);
  assert.equal(g.phase, 'playing');
  assert.equal(e.viewFor(g, 'p0').goals[1].gold, false);
  assert.equal(e.viewFor(g, 'p0').goals[0].gold, null, 'hidden chambers stay hidden');
});

test('when the deck and every hand run out the Saboteurs win the round', () => {
  const g = fresh(3, { rounds: '1' });
  g.deck = [];
  g.roles = ['digger', 'saboteur', 'digger'];
  g.hands = [[{ id: 'a', k: 'scout' }], [], []];
  g.turn = 0;
  assert.equal(e.applyAction(g, 'p0', { type: 'discard', card: 'a' }).ok, true);
  assert.equal(g.roundResult.side, 'saboteurs');
  assert.equal(g.roundResult.gains[1], 4, 'a lone Saboteur scores 4');
  assert.deepEqual(g.winners, [1]);
});

test('multi-round match: roles are dealt again and the board resets', () => {
  const g = fresh(3, { rounds: '3' });
  g.deck = [];
  g.hands = [[{ id: 'a', k: 'scout' }], [], []];
  g.turn = 0;
  e.applyAction(g, 'p0', { type: 'discard', card: 'a' });
  assert.equal(g.phase, 'roundEnd', 'the next round waits for Ready');
  assert.deepEqual(e.awaiting(g), []);
  assert.equal(e.applyAction(g, 'p0', { type: 'discard', card: 'x' }).ok, false, 'nothing is played while waiting');
  assert.ok(e.viewFor(g, 'p0').goals.every((q) => q.revealed && q.gold !== null), 'every chamber is shown at the end of a round');
  assert.equal(e.applyAction(g, null, { type: 'continue' }).ok, true);
  assert.equal(g.phase, 'playing');
  assert.equal(g.round, 2);
  assert.equal(g.board.size, 1);
  assert.equal(g.event.type, 'roundEnd');
  assert.ok(g.hands.every((h) => h.length === e.HAND[3]));
  assert.equal(e.viewFor(g, 'p0').roundResult.round, 1);
});

test('hidden information: roles, other hands and the gold stay private until the round ends', () => {
  const g = fresh(5);
  const v = e.viewFor(g, 'p0');
  assert.ok(['digger', 'saboteur'].includes(v.role));
  const text = JSON.stringify(v);
  for (let i = 1; i < 5; i++) for (const c of g.hands[i]) assert.ok(!text.includes(`"${c.id}"`) || v.hand.some((h) => h.id === c.id), 'no other hand leaks');
  assert.ok(!('roles' in v) && v.roundResult === null);
  assert.equal(v.players[1].cards, g.hands[1].length);
  const s = e.viewFor(g, 'spectator');
  assert.equal(s.me, -1);
  assert.equal(s.role, null);
  assert.equal(s.hand.length, 0);
});

test('view: legal placements and targets are listed only on your turn', () => {
  const g = fresh(4);
  const me = g.turn;
  g.hands[me] = [tile('t', 10), { id: 'b', k: 'break', tool: 'lamp' }, { id: 'c', k: 'collapse' }];
  const v = e.viewFor(g, `p${me}`);
  assert.deepEqual(v.spots.t, [[1, 2, 0]]);
  assert.equal(v.targets.b.length, 3);
  assert.deepEqual(v.targets.c, []);
  assert.equal(v.hand.find((c) => c.id === 'c').ok, false);
  const other = e.viewFor(g, `p${(me + 1) % 4}`);
  assert.deepEqual(other.spots, {});
  assert.ok(other.hand.every((c) => !c.ok));
});

test('bots: 120 complete bot games (3-8 players) end with only legal moves', () => {
  for (let s = 0; s < 120; s++) {
    const n = 3 + (s % 6);
    const g = fresh(n, { rounds: s % 2 ? '3' : '1' }, 1000 + s);
    let turns = 0;
    while (g.phase !== 'gameOver') {
      if (g.phase === 'roundEnd') { assert.equal(e.applyAction(g, null, { type: 'continue' }).ok, true); continue; }
      const id = g.players[g.turn].id;
      const a = e.botAction(g, id);
      assert.ok(a, 'a bot always has a move');
      const r = e.applyAction(g, id, a);
      assert.equal(r.ok, true, `${JSON.stringify(a)} ${r.error}`);
      assert.ok(++turns < 3000, 'game terminates');
    }
    assert.ok(g.winners.length >= 1);
    assert.equal(e.results(g).filter((x) => x.winner).length, g.winners.length);
  }
});

test('plugin: interface, registry and rules', () => {
  const p = registry.get('hiddenminers');
  assert.equal(p.id, 'hiddenminers');
  assert.deepEqual([p.seats.min, p.seats.max], [3, 8]);
  assert.match(p.rules.at(-1), /not affiliated with, endorsed by or licensed by/);
  const inst = p.create(people(4), {}, mkrng(5));
  assert.equal(inst.awaiting().length, 1);
  assert.equal(inst.act('p0', { type: 'tile' }).ok, false);
  assert.equal(inst.isOver(), false);
  assert.equal(inst.view('p0').game, 'hiddenminers');
  assert.equal(typeof inst.botDelayMs(), 'number');
  const name = inst.view('p0').players[0].name;
  inst.scrub([name], 'Former player');
  assert.equal(inst.view('p0').players[0].name, 'Former player');
});

console.log(`${count} hidden miners tests passed`);
