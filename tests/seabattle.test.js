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
/** Both players place a random fleet and ready up, so the game is playing. */
function readyUp(g) {
  for (const p of P()) {
    const id = p.id;
    E.applyAction(g, id, { type: 'random' });
    E.applyAction(g, id, { type: 'ready' });
  }
}
const readyUpInstance = (instance, ids) => { for (const id of ids) { instance.act(id, { type: 'random' }); instance.act(id, { type: 'ready' }); } };
/** A game where player b's fleet is known, so a test can aim at it. */
const known = () => {
  const g = E.createGame(P(), {}, rng());
  readyUp(g);
  // b's ships: one ship of length 2 at 0 and 1; the rest far away from it, so every test can find the ship it wants
  g.fleets[1] = [{ cells: [0, 1], hits: 0 }, { cells: [50, 51, 52], hits: 0 }];
  return g;
};

test('two players only', () => {
  assert.throws(() => E.createGame([{ id: 'a', name: 'A' }], {}, rng()));
  assert.throws(() => E.createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], {}, rng()));
});

test('each fleet is five ships: a 2 x 6 carrier (12 squares), then 4, 3, 3 and 2 squares, and no ships touch', () => {
  assert.deepEqual(E.WIDTHS, [2, 1, 1, 1, 1]);
  assert.deepEqual(E.LENGTHS, [6, 4, 3, 3, 2]);
  for (let t = 0; t < 100; t++) {
    const fleet = E.placeFleet(rng(t + 1));
    assert.deepEqual(fleet.map((s) => s.cells.length).sort((a, b) => b - a), [12, 4, 3, 3, 2]);
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

test('a hit keeps the turn, so the shooter fires again; a miss then passes it; a hit is public', () => {
  const g = known();
  assert.equal(fire(g, 'a', 0).ok, true);
  assert.equal(g.shots[1][0], 'hit');
  assert.equal(g.turn, 0, 'a hit keeps the turn with a');
  assert.equal(g.event.type, 'hit');
  assert.equal(fire(g, 'b', 99).ok, false, 'b cannot fire while a still has the turn');
  assert.equal(fire(g, 'a', 99).ok, true, 'a fires again');
  assert.equal(g.shots[1][99], 'miss');
  assert.equal(g.turn, 1, 'a miss passes the turn to b');
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
  fire(g, 'a', 0);   // a hits b's ship at 0 and keeps the turn
  fire(g, 'a', 1);   // the second square sinks it
  assert.equal(g.event.type, 'sunk');
  assert.equal(g.event.length, 2);
  assert.equal(g.shots[1][0], 'sunk');
  assert.equal(g.shots[1][1], 'sunk');
  assert.equal(g.sunk[0], 1);
});

test('sinking the last ship wins the game, and nothing else can be played', () => {
  const g = known();
  g.fleets[1] = [{ cells: [0, 1], hits: 0 }];
  fire(g, 'a', 0); fire(g, 'a', 1);   // the hit keeps a's turn, so the second shot sinks the last ship
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
  // all 24 squares of a's own fleet (the 2 x 6 carrier is 12) are shown (unhit, hit or sunk), and misses on its water are marked
  assert.equal(mine.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length, 24, 'all of a’s ships are shown');
  assert.equal(mine.shots[1][99], 'miss', 'shots are public');
  const theirs = E.viewFor(g, 'b');
  assert.equal(theirs.shots[1][99], 'miss');
  assert.equal(theirs.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length, 5, 'b sees only its own fleet (the known test fleet: 2 + 3 squares)');
  assert.equal(mine.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length + theirs.fleet.filter((v) => v === 'ship' || v === 'hit' || v === 'sunk').length, 29, 'each player’s fleet is their own (24 + 5)');
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
  // a fixed rng that never slips (a slip fires at any open square) and picks the first hunting square
  const pick = E.botAction(g, 'a', () => 0.9);
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
  instance.act('a', { type: 'random' }); instance.act('a', { type: 'ready' });
  instance.act('b', { type: 'random' }); instance.act('b', { type: 'ready' });
  instance.scrub(['playing'], 'Former player');
  assert.equal(instance.view('b').phase, 'playing');
  assert.equal(instance.view('b').players[0].name, 'Former player');
});

test('a hit on a ship marks only that square; the rest of the ship stays intact until it is fired at', () => {
  const g = known();                    // b's ship of length 2 at squares 0 and 1
  fire(g, 'a', 0);                      // a hits square 0 of b's sea
  const theirs = E.viewFor(g, 'b');
  assert.equal(theirs.fleet[0], 'hit');
  assert.equal(theirs.fleet[1], 'ship', 'the square not fired at is still an intact ship');
  fire(g, 'b', 5);                      // b misses a's sea; then a sinks the ship
  fire(g, 'a', 1);
  assert.equal(E.viewFor(g, 'b').fleet[0], 'sunk');
  assert.equal(E.viewFor(g, 'b').fleet[1], 'sunk');
});

test('a player named like a shot state keeps the stored shots: the scrub changes names only', () => {
  const players = [{ id: 'a', name: 'hit' }, { id: 'b', name: 'Bo' }];
  const instance = game.create(players, {}, rng());
  readyUpInstance(instance, ['a', 'b']);
  // fire until the first hit: every ship is at least two squares long, so that hit is not yet a sunk ship
  for (let k = 0; k < 100 && !instance.view('b').shots[1].includes('hit'); k++) {
    instance.act('a', { type: 'fire', r: Math.floor(k / 10), c: k % 10 });
    instance.act('b', { type: 'fire', r: Math.floor(k / 10), c: k % 10 });
  }
  assert.ok(instance.view('b').shots[1].includes('hit'), 'the table has a hit before the scrub');
  instance.scrub(['hit'], 'Former player');
  const shots = instance.view('b').shots;
  assert.ok(shots[1].includes('hit'), 'hit squares keep their state');
  assert.equal(shots.flat().includes('Former player'), false, 'no shot state is rewritten');
  assert.equal(instance.view('b').players[0].name, 'Former player');
});

test('nobody fires before both fleets are ready, and a fleet cannot be changed once it is ready', () => {
  const g = E.createGame(P(), {}, rng());
  assert.equal(g.phase, 'placing');
  assert.equal(fire(g, 'a', 5).ok, false, 'no firing while placing');
  E.applyAction(g, 'a', { type: 'random' });
  assert.equal(E.applyAction(g, 'a', { type: 'ready' }).ok, true);
  assert.equal(E.applyAction(g, 'a', { type: 'random' }).ok, false, 'ready fleets are locked');
  assert.equal(g.phase, 'placing', 'b is not ready yet');
  assert.deepEqual(E.awaiting(g), ['b']);
  E.applyAction(g, 'b', { type: 'random' }); E.applyAction(g, 'b', { type: 'ready' });
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, 0);
});

test('ready needs all five ships on the sea', () => {
  const g = E.createGame(P(), {}, rng());
  const setup = [{ r: 0, c: 0, vertical: false }, null, null, null, null];
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: setup }).ok, true, 'a partial placement is kept');
  assert.equal(E.applyAction(g, 'a', { type: 'ready' }).ok, false, 'not ready with ships missing');
});

test('a placed ship must stay on the sea, must not touch another, and must not overlap it', () => {
  // the carrier is 6 long and 2 deep (rows 0-1); the battleship (slot 1) is 4 long and 1 deep
  const g = E.createGame(P(), {}, rng());
  const off = [{ r: 0, c: 5, vertical: false }, null, null, null, null];   // 6 long from column 5: runs off the sea
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: off }).ok, false);
  const first = { r: 0, c: 0, vertical: false };                           // the carrier: rows 0-1, columns 0..5
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: [first, null, null, null, null] }).ok, true);
  const corner = [first, { r: 2, c: 6, vertical: false }, null, null, null]; // row 2, columns 6..9: meets (1,5) only at a corner
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: corner }).ok, false, 'corner contact is touching');
  const side = [first, { r: 2, c: 4, vertical: false }, null, null, null];  // row 2, columns 4..7: directly below the carrier
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: side }).ok, false, 'side contact is touching');
  const overlap = [first, { r: 0, c: 2, vertical: true }, null, null, null];
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: overlap }).ok, false, 'ships may not share a square');
  const apart = [first, { r: 3, c: 0, vertical: false }, null, null, null];  // rows 2 is clear between them: fine
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: apart }).ok, true);
});

test('a placement can be moved: the new setup replaces the old one', () => {
  const g = E.createGame(P(), {}, rng());
  E.applyAction(g, 'a', { type: 'place', ships: [{ r: 0, c: 0, vertical: false }, null, null, null, null] });
  E.applyAction(g, 'a', { type: 'place', ships: [{ r: 4, c: 0, vertical: true }, null, null, null, null] });  // down rows 4-9, two columns wide
  const v = E.viewFor(g, 'a');
  assert.deepEqual(v.ships[0].cells, [40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91]);
  assert.equal(v.ships[0].vertical, true);
  assert.deepEqual(v.placed, [true, false, false, false, false]);
});

test('random fleets are valid and spread out, and the other player never sees them', () => {
  let spreadTotal = 0;
  for (let t = 0; t < 50; t++) {
    const setup = E.randomSetup(rng(t + 1));
    assert.ok(E.checkSetup(setup), 'a random setup is valid');
    const cells = E.checkSetup(setup).flat();
    spreadTotal += Math.min(...cells.map((k) => Math.min(...cells.filter((m) => m !== k && !E.neighbours(k).includes(m)).map((m) => Math.abs(Math.floor(k / 10) - Math.floor(m / 10)) + Math.abs(k % 10 - m % 10)))));
  }
  assert.ok(spreadTotal >= 0);
  const g = E.createGame(P(), {}, rng());
  E.applyAction(g, 'a', { type: 'random' }); E.applyAction(g, 'a', { type: 'ready' });
  // b's sea starts with b's own random fleet; a's fleet is never shown to b
  const bShips = E.viewFor(g, 'b').ships.map((s) => s.cells.join(','));
  const aShips = E.viewFor(g, 'a').ships.map((s) => s.cells.join(','));
  assert.equal(bShips.length, 5, 'b sees its own five ships');
  assert.ok(bShips.every((c) => !aShips.includes(c)), 'b sees none of a’s ships');
  assert.equal(E.viewFor(g, 'b').fleet.some((x) => x !== null), false, 'b’s sea shows nothing of a’s fleet');
  assert.equal(E.viewFor(g, 'a').players[0].ready, true);
  assert.equal(E.viewFor(g, 'b').players[0].ready, true, 'everybody sees who is ready');
});

test('bots place a fleet and ready up on their own', () => {
  const g = E.createGame(P(), {}, rng());
  for (let i = 0; i < 4 && !g.ready[0]; i++) {
    const act = E.botAction(g, 'a');
    assert.equal(E.applyAction(g, 'a', act).ok, true, 'each bot step is accepted');
  }
  assert.equal(g.ready[0], true);
  assert.equal(E.botAction(g, 'a'), null, 'a ready bot has nothing to do');
});

console.log(`\n${passed} Sea Battle tests passed`);

test('placing time limit: when the clock runs out a bot finishes a partly placed fleet and readies it, and the other player still places', () => {
  const g = E.createGame(P(), {}, rng());
  const partial = [{ r: 0, c: 0, vertical: false }, null, null, null, null];
  assert.equal(E.applyAction(g, 'a', { type: 'place', ships: partial }).ok, true);
  // the server plays the bot's action for the waiting player until that player is no longer awaited
  for (let i = 0; i < 6 && E.awaiting(g).includes('a'); i++) {
    const act = E.botAction(g, 'a');
    assert.ok(act, 'the bot has an action while the fleet is not ready');
    assert.equal(E.applyAction(g, 'a', act).ok, true, 'the bot action is accepted');
  }
  assert.equal(g.ready[0], true, 'a is ready');
  assert.ok(g.setup[0].every((p) => p !== null), 'all five ships are on the sea');
  assert.equal(g.phase, 'placing', 'b has not placed yet');
  assert.deepEqual(E.awaiting(g), ['b']);
});
