'use strict';
// A game that animates a walking token tells the server how long the walk takes, so bots wait for it.
const assert = require('node:assert/strict');
const pacing = require('../games/pacing');
const games = require('../games');

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } };

test('holds queue one after another and only run out with time', () => {
  const g = {};
  assert.equal(pacing.remaining(g), 0);
  pacing.hold(g, 1000); pacing.hold(g, 500);
  const r = pacing.remaining(g);
  assert.ok(r > 1400 && r <= 1500, `remaining ${r}`);
});

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: i ? 'p' + i : 'me', name: 'P' + i }));

test('Property Rivals: a longer walk holds the bots for longer', () => {
  const E = require('../games/propertyrivals/engine'); const A = require('../games/propertyrivals/actions');
  const play = (d1, d2) => {
    const g = E.createGame(people(3), {}, () => 0.5);
    assert.equal(pacing.remaining(g), 0);
    const q = [d1, d2].map((d) => (d - 0.5) / 6); g.rng = () => (q.length ? q.shift() : 0.5);
    assert.ok(A.applyAction(g, 'me', { type: 'roll' }).ok);
    return pacing.remaining(g);
  };
  const short = play(1, 2), long = play(5, 6);
  assert.ok(short >= 3 * 480, `short walk holds ${short}`);
  assert.ok(long > short + 7 * 480, `an 11-square walk holds much longer: ${long} vs ${short}`);
});

test('Snakes and Ladders: the hold covers the walk and a snake or ladder slide', () => {
  const g = games.get('snakesladders').create(people(2), {}, () => 0.5);
  g.act('me', { type: 'roll' }); // a 4
  assert.ok(g.holdMs() >= 4 * 480, `holds ${g.holdMs()}`);
});

test('Ludo: a move holds the bots for the walk', () => {
  const g = games.get('ludo').create(people(2), {}, () => 0.5);
  assert.equal(g.holdMs(), 0);
});

test('a scale shortens the reservation at the time it is made, so the bots wait exactly that long', () => {
  const g = {};
  pacing.setScale(g, 0.25);
  pacing.hold(g, 4000); // 1000 ms reserved
  pacing.hold(g, 4000); // queues another 1000 ms behind it
  const r = pacing.remaining(g);
  assert.ok(r > 1900 && r <= 2000, `two holds of 4000 at scale 0.25 give ~2000 ms: ${r}`);
});

console.log(`\n${passed} pacing tests passed`);
