'use strict';
// Sea Battle: fleets, firing, turns, sinking, the winner, bots, and what a player can see. Pure, no sockets.
const assert = require('node:assert/strict');
const E = require('../games/seabattle/engine');
const game = require('../games/seabattle');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }
const P = () => [{ id: 'a', name: 'Aarav' }, { id: 'b', name: 'Bo' }];
const rng = (seed = 4) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const fire = (g, pid, k) => E.applyAction(g, pid, { type: 'fire', r: Math.floor(k / 10), c: k % 10 });
/** A game where player b's fleet is known, so a test can aim at it. */
const known = () => {
  const g = E.createGame(P(), {}, rng());
  // b's ships: one ship of length 2 at 0 and 1; the rest far away from it, so every test can find the ship it wants
  g.fleets[1] = [{ cells: [0, 1], hits: 0 }, { cells: [50, 51, 52], hits: 0 }];
  return g;
};

test('two players only', () => {
  assert.throws(() => E.createGame([{ id: 'a', name: 'A' }], {}, rng()));
  assert.throws(() => E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], {}, rng()));
});

test('each fleet has five ships of lengths 5, 4, 3, 3 and 2, and no ships touch', () => {
  for (let t = 0; t < 100; t++) {
    const fleet = E.placeFleet(rng(t + 1));
    assert.deepEqual(fleet.map((s) => s.cells.length).sort((a, b) => b - a), [5, 4, 3, 3, 2]);
    const all = fleet.flatMap((s) => s.cells);
    assert.equal(new Set(all).size, all.length, 'no overlaps');
    for (const s of fleet) for (const k of s.cells) for (const n of E.neighbours(k)) {
      if (!s.cells.includes(n)) assert.ok(!all.includes(n), 'ships never touch');
    }
  }
});

test('a miss passes the turn; the square cannot be fired at again', () => {
  const g = known();
  assert.equal(fire(g, 'a', 90).ok, true);
  assert.equal(g.shots[1][90], 'miss');
  assert.equal(g.turn, 1);
  assert.equal(fire(g, 'b', 90).ok, true, 'b fires at a');
  assert.equal(fire(g, 'a', 90).ok, false, 'the same square again');
});

test('a hit passes the turn too, and is public', () => {
  const g = known();
  assert.equal(fire(g, 'a', 0).ok, true);
  assert.equal(g.shots[1][0], 'hit');
  assert.equal(g.turn, 1, 'each player fires once per turn');
  assert.equal(g.event.type, 'hit');
});

test('invalid moves are refused: not your turn, a square off the sea, an unknown action, a player not in the game', () => {
  const g = known();
  assert.equal(fire(g, 'b', 5).ok, false, 'not b’s turn');
  assert.equal(E.applyAction(g, 'a', { type: 'fire', r: 10, c: 0 }).ok, false);
  assert.equal(E.applyAction(g, 'a', { type: 'fire', r: 1.5, c: 0 }).ok, false);
  assert.equal(E.applyAction(g, 'a', { type: 'bomb', r: 0, c: 0 }).ok, false);
  assert.equal(E.applyAction(g, 'nobody', { type: 'fire', r: 0, c: 0 }).ok, false);
});

test('sinking a ship shows it to everybody and counts for the shooter', () => {
  const g = known();
  fire(g, 'a', 0); fire(g, 'b', 99);   // a hits b's ship at 0; b misses
  fire(g, 'a', 1);
  assert.equal(g.event.type, 'sunk');
  assert.equal(g.event.length, 2);
  assert.equal(g.shots[1][0], 'sunk');
  assert.equal(g.shots[1][1], 'sunk');
  assert.equal(g.sunk[0], 1);
});

test('sinking the last ship wins the game, and nothing else can be played', () => {
  const g = known();
  g.fleets[1] = [{ cells: [0, 1], hits: 0 }];
  fire(g, 'a', 0); fire(g, 'b', 99); fire(g, 'a', 1);
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0);
  assert.deepEqual(E.awaiting(g), []);
  assert.equal(fire(g, 'b', 5).ok, false);
  assert.deepEqual(E.results(g).map((r) => r.winner), [true, false]);
});

test('a player sees their own ships, not the other fleet; both seas show the shots', () => {
  const g = known();
  fire(g, 'a', 99);                    // a misses b's sea
  fire(g, 'b', 0);                     // b hits a ship in a's sea (a's fleet is random: find one)
  const mine = E.viewFor(g, 'a');
  // all 17 squares of a's own fleet are shown (unhit, hit or sunk), and misses on its water are marked
  assert.equal(mine.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length, 17, 'all of a’s ships are shown');
  assert.equal(mine.shots[1][99], 'miss', 'shots are public');
  const theirs = E.viewFor(g, 'b');
  assert.equal(theirs.shots[1][99], 'miss');
  assert.equal(theirs.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length, 5, 'b sees only its own fleet (the known test fleet: 2 + 3 squares)');
  assert.equal(mine.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length + theirs.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length, 22, 'each player’s fleet is their own');
});

test('a watcher sees the shots, but no fleet', () => {
  const g = known();
  const watching = E.viewFor(g, 'nobody');
  assert.equal(watching.me, -1);
  assert.equal(watching.fleet, null);
  assert.equal(watching.myTurn, false);
});

test('a bot hunts next to a hit that is not yet sunk', () => {
  const g = known();
  g.shots[1][44] = 'hit';   // a hit in b’s sea, not sunk, with open squares around it
  g.turn = 0;
  const pick = E.botAction(g, 'a', () => 0.0);
  const k = pick.r * 10 + pick.c;
  assert.ok(E.neighbours(44).includes(k), `the bot fired at ${k}, next to 44`);
});

test('the bot only plays on its own turn, and never fires twice at a square', () => {
  const g = known();
  assert.equal(E.botAction(g, 'b'), null, 'not b’s turn');
  for (let i = 0; i < 100 && g.phase === 'playing'; i++) {
    const pid = E.awaiting(g)[0];
    const act = E.botAction(g, pid);
    assert.equal(E.applyAction(g, pid, act).ok, true, 'each move is new');
  }
  assert.equal(g.shots[0].concat(g.shots[1]).filter(Boolean).length > 0, true);
});

test('the scrub keeps the phase, so a name cannot change the state of the game', () => {
  const players = [{ id: 'a', name: 'playing' }, { id: 'b', name: 'Bo' }];
  const instance = game.create(players, {}, rng());
  instance.scrub(['playing'], 'Former player');
  assert.equal(instance.view('b').phase, 'playing');
  assert.equal(instance.view('b').players[0].name, 'Former player');
});

console.log(`\n${passed} Sea Battle tests passed`);
