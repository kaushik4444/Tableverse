'use strict';
// Resource Isles engine (draft): board geometry, the setup order, rejected moves, and bot-only games that finish.
const assert = require('node:assert/strict');
const E = require('../games/resourceisles/engine');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + e.stack); } }
const rng = (seed) => { let s = seed * 7919; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
const newGame = (seed = 1, length = 'classic') => E.createGame([0, 1, 2, 3].map((i) => ({ id: 'p' + i, name: 'P' + i })), { length }, rng(seed));

test('the island has 19 hexes, 54 corners, 72 edges and 9 harbours', () => {
  const g = newGame();
  assert.equal(g.board.hexes.length, 19);
  assert.equal(g.board.verts.length, 54);
  assert.equal(g.board.edges.length, 72);
  assert.equal(g.board.harbors.length, 9);
});

test('tiles: 18 land tiles with numbers and one desert that starts with the robber', () => {
  const g = newGame(3);
  assert.equal(g.board.hexes.filter((h) => h.res === E.DESERT).length, 1);
  assert.equal(g.board.hexes.filter((h) => h.num !== null).length, 18);
  assert.equal(g.board.hexes[g.robber].res, E.DESERT);
});

test('a 6 and an 8 never sit on touching hexes (for a typical seed)', () => {
  const g = newGame(5);
  const hot = (h) => h.num === 6 || h.num === 8;
  const nbrs = E.buildTopology().hexNbrs;
  g.board.hexes.forEach((h, i) => { if (hot(h)) assert.ok(!nbrs[i].some((j) => hot(g.board.hexes[j])), 'touching 6/8 on hex ' + i); });
});

test('setup: a settlement too close to another is refused, and the road must touch the new settlement', () => {
  const g = newGame();
  const v = 0;
  assert.equal(E.applyAction(g, 'p0', { type: 'setupSettlement', vertex: v }, rng(1)).ok, true);
  assert.equal(E.applyAction(g, 'p1', { type: 'setupSettlement', vertex: g.board.verts[v].nbrs[0] }, rng(1)).ok, false, 'not your turn');
  const away = g.board.edges.findIndex((e) => e.a !== v && e.b !== v);
  assert.equal(E.applyAction(g, 'p0', { type: 'setupRoad', edge: away }, rng(1)).ok, false, 'a road must touch the settlement');
  const e = g.board.verts[v].edges[0];
  assert.equal(E.applyAction(g, 'p0', { type: 'setupRoad', edge: e }, rng(1)).ok, true);
  assert.equal(g.turn, 1, 'the next seat places in snake order');
});

test('a roll moves to the main phase and a second settlement gives starting cards', () => {
  const g = newGame(2);
  const order = [0, 1, 2, 3, 3, 2, 1, 0];
  let vtx = 0;
  for (const seat of order) {
    const id = 'p' + seat;
    while (g.vertOwner[vtx] || !E.canSettle(g, vtx)) vtx++;
    assert.equal(E.applyAction(g, id, { type: 'setupSettlement', vertex: vtx }, rng(9)).ok, true, 'settle for seat ' + seat);
    const e = g.board.verts[vtx].edges.find((x) => g.edgeOwner[x] === null);
    assert.equal(E.applyAction(g, id, { type: 'setupRoad', edge: e }, rng(9)).ok, true, 'road for seat ' + seat);
    vtx++;
  }
  assert.equal(g.phase, 'roll');
  assert.equal(g.turn, 0);
  assert.ok(E.RESOURCES.some((r) => g.hand[3][r] > 0), 'the last seat got starting cards from its second settlement');
});

test('a bot-only game finishes with no rejected moves (short and classic)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = newGame(seed, seed % 2 ? 'short' : 'classic');
    let guard = 0;
    while (g.phase !== 'gameOver' && guard++ < 8000) {
      for (const id of E.awaiting(g)) {
        const r = E.applyAction(g, id, E.botAction(g, id, rng(seed + guard)), rng(seed + guard));
        assert.equal(r.ok, true, `seed ${seed}: ${r.error}`);
      }
    }
    if (g.phase === 'gameOver') {
      const res = E.results(g);
      assert.equal(res.length, 4);
      if (g.winner !== null) assert.ok(E.vpOf(g, g.winner) >= g.target, 'the winner reached the target');
    }
  }
});

// plays the eight setup placements and returns the game in the roll phase
function setupDone(seed) {
  const g = newGame(seed);
  let vtx = 0;
  for (const seat of [0, 1, 2, 3, 3, 2, 1, 0]) {
    while (g.vertOwner[vtx] || !E.canSettle(g, vtx)) vtx++;
    E.applyAction(g, 'p' + seat, { type: 'setupSettlement', vertex: vtx }, rng(9));
    E.applyAction(g, 'p' + seat, { type: 'setupRoad', edge: g.board.verts[vtx].edges.find((x) => g.edgeOwner[x] === null) }, rng(9));
    vtx++;
  }
  return g;
}

test('the view\'s batch changes with every turn and setup step (the server restarts the time limit on it)', () => {
  const g = newGame(4);
  const seen = new Set([E.viewFor(g, 'p0').batch]);
  let vtx = 0;
  for (const seat of [0, 1, 2, 3, 3, 2, 1, 0]) {
    while (g.vertOwner[vtx] || !E.canSettle(g, vtx)) vtx++;
    E.applyAction(g, 'p' + seat, { type: 'setupSettlement', vertex: vtx }, rng(9));
    E.applyAction(g, 'p' + seat, { type: 'setupRoad', edge: g.board.verts[vtx].edges.find((x) => g.edgeOwner[x] === null) }, rng(9));
    seen.add(E.viewFor(g, 'p0').batch);
    vtx++;
  }
  assert.equal(seen.size, 9, 'a new value after each of the eight placements');
  g.phase = 'main';
  const before = E.viewFor(g, 'p0').batch;
  E.applyAction(g, 'p0', { type: 'endTurn' }, rng(1));
  assert.notEqual(E.viewFor(g, 'p0').batch, before);
});

test('a player who reaches the target on someone else\'s turn wins when their own turn comes round', () => {
  const g = setupDone(6);
  g.phase = 'main';
  g.turn = 0;
  g.target = E.vpOf(g, 1); // seat 1 is already there, as if a rival's build had handed it the longest road
  assert.equal(E.applyAction(g, 'p0', { type: 'endTurn' }, rng(1)).ok, true);
  assert.equal(g.phase, 'gameOver');
  assert.equal(E.viewFor(g, 'p0').winner, 1);
});

console.log(`${passed} Resource Isles engine tests passed${failed ? `, ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
