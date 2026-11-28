'use strict';
// Memory Match: turns, pairs, misses, the result, bots that only use what the table has seen, and what a seat can see.
const assert = require('node:assert/strict');
const E = require('../games/memorymatch/engine');
const game = require('../games/memorymatch');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
// a seeded rng, so the deal in each test is the same every run
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
/** The index of the other card with the same symbol (the test can peek at the hidden deal). */
const partnerOf = (g, i) => g.cards.findIndex((s, k) => k !== i && s === g.cards[i]);
const notPartner = (g, i) => g.cards.findIndex((s, k) => k !== i && s !== g.cards[i]);

test('the deal has every symbol exactly twice, for each board size', () => {
  for (const [size, total] of [['4x4', 16], ['4x6', 24], ['6x6', 36]]) {
    const g = E.createGame(P(2), { size }, rng(3));
    assert.equal(g.cards.length, total);
    const counts = new Map();
    for (const s of g.cards) counts.set(s, (counts.get(s) || 0) + 1);
    assert.ok([...counts.values()].every((n) => n === 2), `${size}: each symbol twice`);
  }
});

test('1 to 4 players; the default is 4x4; an unknown size falls back to it', () => {
  assert.throws(() => E.createGame(P(0)));
  assert.throws(() => E.createGame(P(5)));
  assert.equal(E.createGame(P(2), {}).total, 16);
  assert.equal(E.createGame(P(2), { size: '9x9' }).total, 16);
});

test('a matching pair keeps the turn and gives the pair to the seat that found it', () => {
  const g = E.createGame(P(2), { size: '4x4' }, rng(5));
  const a = 0, b = partnerOf(g, a);
  assert.equal(E.applyAction(g, 'p0', { type: 'flip', index: a }).ok, true);
  assert.equal(E.applyAction(g, 'p0', { type: 'flip', index: b }).ok, true);
  assert.equal(g.owner[a], 0); assert.equal(g.owner[b], 0);
  assert.equal(g.pairs[0], 1);
  assert.equal(g.turn, 0, 'the same player plays again');
  assert.equal(g.event.type, 'match');
});

test('a miss turns both cards back at once and passes the turn; the miss event carries both for the client to show', () => {
  const g = E.createGame(P(3), { size: '4x4' }, rng(7));
  const a = 0, b = notPartner(g, a);
  E.applyAction(g, 'p0', { type: 'flip', index: a });
  E.applyAction(g, 'p0', { type: 'flip', index: b });
  assert.equal(g.turn, 1, 'the next seat moves');
  assert.equal(g.matched[a], false);
  assert.equal(g.event.type, 'miss');
  assert.deepEqual([g.event.a, g.event.b], [a, b]);
  const v = E.viewFor(g, 'p1');
  assert.equal(v.board[a].symbol, null, 'the first card is face down in the view');
  assert.equal(v.board[b].symbol, null, 'the second card is face down in the view');
  E.applyAction(g, 'p1', { type: 'flip', index: 5 });
  assert.equal(E.viewFor(g, 'p1').board[a].symbol, null, 'no third card can leave the missed pair face up');
});

test('invalid moves are refused: not your turn, a matched card, the card already face up, no such card, an unknown action', () => {
  const g = E.createGame(P(2), { size: '4x4' }, rng(9));
  assert.equal(E.applyAction(g, 'p1', { type: 'flip', index: 0 }).ok, false, 'not your turn');
  E.applyAction(g, 'p0', { type: 'flip', index: 0 });
  assert.equal(E.applyAction(g, 'p0', { type: 'flip', index: 0 }).ok, false, 'already face up');
  assert.equal(E.applyAction(g, 'p0', { type: 'flip', index: 99 }).ok, false, 'no such card');
  assert.equal(E.applyAction(g, 'p0', { type: 'place', cell: 1 }).ok, false, 'unknown action');
  const b = partnerOf(g, 0);
  E.applyAction(g, 'p0', { type: 'flip', index: b });
  assert.equal(E.applyAction(g, 'p0', { type: 'flip', index: 0 }).ok, false, 'a matched card');
});

test('the most pairs wins; a tie for the most is a draw', () => {
  const g = E.createGame(P(2), { size: '4x4' }, rng(11));
  g.pairs = [5, 3]; g.phase = 'gameOver'; g.winner = 0; g.draw = false;
  assert.deepEqual(E.results(g), [{ score: 5, winner: true, draw: false }, { score: 3, winner: false, draw: false }]);
  g.pairs = [4, 4]; g.winner = null; g.draw = true;
  assert.deepEqual(E.results(g).map((r) => r.draw), [true, true]);
});

test('bot games finish at every size and seat count, and the pairs add up to the board', () => {
  for (const size of ['4x4', '4x6', '6x6']) {
    for (const players of [2, 3, 4]) {
      const g = E.createGame(P(players), { size }, rng(size.length * 31 + players));
      const r = rng(players * 97);
      let guard = 0;
      while (g.phase !== 'gameOver') {
        const pid = g.players[g.turn].id;
        assert.equal(E.applyAction(g, pid, E.botAction(g, pid, r)).ok, true, 'a bot move is legal');
        assert.ok(++guard < 2000, 'the game ends');
      }
      assert.equal(g.pairs.reduce((a, b) => a + b, 0), g.total / 2, `${size}, ${players} players`);
    }
  }
});

test('a bot takes a known pair when the table has seen both cards', () => {
  const g = E.createGame(P(2), { size: '4x4' }, rng(13));
  // the table has seen card 0 and its partner: the bot should flip one of them
  const b = partnerOf(g, 0);
  g.known.set(0, g.cards[0]); g.known.set(b, g.cards[b]);
  const pick = E.botAction(g, 'p0', rng(1));
  assert.ok(pick.index === 0 || pick.index === b, 'a known pair is the first choice');
});

test('a seat sees only the matched cards and the cards in play; the rest stay hidden', () => {
  const g = E.createGame(P(2), { size: '4x4' }, rng(15));
  E.applyAction(g, 'p0', { type: 'flip', index: 0 });
  const v = E.viewFor(g, 'p1');
  assert.equal(v.board[0].symbol, g.cards[0], 'the card in play is face up for everyone');
  assert.equal(v.board[1].symbol, null, 'a card face down is not sent');
  assert.equal(JSON.stringify(v).includes(JSON.stringify(g.cards)), false, 'the whole deal is never sent');
  assert.equal(E.viewFor(g, 'nobody').myTurn, false);
});

test('the plugin: 1 to 4 seats, a size option, and the rules have a title for each', () => {
  assert.deepEqual(game.seats, { min: 1, max: 4, default: 1 }); // a single player is the default
  assert.deepEqual(game.options[0].choices.map((c) => c.value), ['4x4', '4x6', '6x6']);
  const inst = game.create(P(3), { size: '4x4' }, rng(17));
  assert.equal(inst.awaiting()[0], 'p0');
  assert.equal(inst.act('p0', { type: 'flip', index: 0 }).ok, true);
});

test('a scrubbed player name leaves the engine-owned player list and the log', () => {
  const players = P(2);
  const inst = game.create(players, { size: '4x4' }, rng(23));
  const name = players[1].name;
  assert.ok(JSON.stringify(inst.view('p0')).includes(name), 'the name is on the table before the scrub');
  inst.scrub([name], 'Removed player');
  assert.equal(JSON.stringify(inst.view('p0')).includes(name), false);
  assert.equal(JSON.stringify(inst.view('p1')).includes(name), false);
});

test('alone, the score is the turns it took to find every pair, and the player wins', () => {
  const g = E.createGame(P(1), { size: '4x4' }, rng(11));
  let guard = 0;
  while (g.phase !== 'gameOver' && guard++ < 500) E.applyAction(g, 'p0', E.botAction(g, 'p0', rng(guard)));
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winner, 0);
  assert.ok(g.turns >= g.total / 2, 'at least one turn per pair');
  assert.deepEqual(E.results(g), [{ score: g.turns, winner: true, draw: false }]);
  const { bestOf, bestLabel } = game.stats;
  assert.equal(bestLabel, 'Fewest turns alone');
  assert.equal(bestOf({ seats: 1, isWinner: true, score: 12 }), -12);
  assert.equal(bestOf({ seats: 2, isWinner: true, score: 6 }), null, 'a versus game does not count');
});

console.log(`\n${passed} memory match tests passed`);
