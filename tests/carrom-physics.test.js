'use strict';
// Carrom physics: flicks, friction, cushions, pockets, collisions, settling and determinism. The physics is pure, so no server is needed.
require('./helpers/env');
const assert = require('node:assert/strict');
const P = require('../games/carrom/physics');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; } }
const disc = (id, x, y, vx = 0, vy = 0, kind = 'coin', colour = 'w') => ({ id, kind, colour, x, y, vx, vy, r: kind === 'striker' ? P.RADIUS.striker : P.RADIUS.coin });
const at = (res, id) => res.discs.find((d) => d.id === id);

test('flick: straight ahead, full power, and forward for the far player', () => {
  const v = P.flickVelocity(0, 1);
  assert.equal(v.vx, 0);
  assert.equal(v.vy, P.MAX_SPEED);
  assert.equal(P.flickVelocity(0, 1, -1).vy, -P.MAX_SPEED);
});

test('flick: the far player\u2019s right is the board\u2019s left', () => {
  assert.ok(P.flickVelocity(Math.PI / 6, 1, -1).vx < 0);
});

test('flick: power is clamped to 0..1 and angle sets the sideways part', () => {
  assert.equal(P.flickVelocity(0, 5).vy, P.MAX_SPEED);
  assert.equal(P.flickVelocity(0, -1).vy, 0);
  const v = P.flickVelocity(Math.PI / 6, 1);
  assert.ok(Math.abs(v.vx - P.MAX_SPEED * 0.5) < 1e-9);
});

test('the distance a flick slides is linear in power', () => {
  // Starts at y = 0.8 and slides up the board, so even a full flick stays clear of the cushions.
  const slide = (power) => {
    const d = [{ id: 's', kind: 'striker', colour: 'w', x: 0.5, y: 0.8, vx: 0, vy: 0, r: P.RADIUS.striker }];
    const v = P.flickVelocity(0, power, -1);
    d[0].vx = v.vx; d[0].vy = v.vy;
    const r = P.simulate(d);
    return 0.8 - r.keyframes.at(-1).d[0][2];
  };
  const quarter = slide(0.1), half = slide(0.2), full = slide(0.4);
  assert.ok(Math.abs(half / quarter - 2) < 0.05, `double power ${half} should slide twice ${quarter}`);
  assert.ok(Math.abs(full / quarter - 4) < 0.1, `four times power ${full} should slide four times ${quarter}`);
});

test('friction: a free disc stops after about v^2 / (2a) units, within 5%', () => {
  const r = P.simulate([disc('c', 0.5, 0.3, 0, 0.5)]);
  const travelled = at(r, 'c').y - 0.3;
  const expected = 0.25 / (2 * 1.5);
  assert.ok(r.settled, 'the shot settles');
  // The fixed time step makes the distance a little under the continuous value; 5% is well inside a playable tolerance.
  assert.ok(Math.abs(travelled - expected) / expected < 0.05, `travelled ${travelled}, expected ${expected}`);
});

test('cushion: a disc that reaches an edge bounces back with less speed', () => {
  const d = [disc('c', 0.5, 0.9, 0, 1.0)];
  for (let i = 0; i < 400; i++) P.step(d);
  const c = d[0];
  assert.ok(c.y <= 1 - c.r + 1e-9, 'stays inside the board');
});

test('pocket: a disc that reaches a pocket is taken, not bounced back out by the cushion', () => {
  // A coin just inside the corner at (0,0), moving down past the edge: the cushion must not turn it back into the board.
  const discs = [{ x: P.POCKET_R - 0.008, y: 0.026, vx: 0.24, vy: -1.2, r: P.RADIUS.coin, id: 1 }];
  const pocketed = P.step(discs);
  assert.equal(pocketed.length, 1, 'pocketed in this step');
  assert.equal(discs.length, 0, 'it leaves the board');
});

test('pocket: a disc aimed at a corner is pocketed and leaves the board', () => {
  // Aim straight at the bottom-left pocket (0,0) from above it.
  const r = P.simulate([disc('c', 0.2, 0.2, -1.2, -1.2)]);
  assert.equal(r.discs.length, 0);
  assert.deepEqual(r.pocketed.map((p) => p.id), ['c']);
});

test('pocket: the striker is reported as pocketed with its kind, so the engine can call a foul', () => {
  const r = P.simulate([disc('s', 0.2, 0.2, -1.0, -1.0, 'striker', 'w')]);
  assert.equal(r.pocketed.length, 1);
  assert.equal(r.pocketed[0].kind, 'striker');
});

test('collision: a moving striker hits a stationary coin, which moves on and the striker slows', () => {
  const r = P.simulate([disc('s', 0.5, 0.2, 0, 1.5, 'striker'), disc('c', 0.5, 0.45, 0, 0)]);
  const s = at(r, 's'), c = at(r, 'c');
  assert.ok(c.y > 0.45 + 0.05, 'the coin moved forward');
  assert.ok(s.y < c.y, 'the striker stays behind the coin');
});

test('collision: equal discs exchange the velocity along the line of centres', () => {
  const r = P.simulate([disc('a', 0.3, 0.5, 1.0, 0), disc('b', 0.3 + 0.044, 0.5, 0, 0)]);
  assert.ok(at(r, 'b').x > 0.344, 'the target gained the motion');
  assert.ok(at(r, 'a').x < 0.3 + 0.2, 'the shooter slowed sharply');
});

test('discs never overlap after a shot settles', () => {
  const discs = [disc('s', 0.5, 0.2, 0.1, 2.0, 'striker')];
  for (let i = 0; i < 12; i++) discs.push(disc('c' + i, 0.4 + (i % 4) * 0.05, 0.45 + Math.floor(i / 4) * 0.05));
  const r = P.simulate(discs);
  for (let i = 0; i < r.discs.length; i++) for (let j = i + 1; j < r.discs.length; j++) {
    const a = r.discs[i], b = r.discs[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-6, 'no overlap');
  }
});

test('settling: keyframes start at time 0, are in time order and end at rest', () => {
  const r = P.simulate([disc('s', 0.5, 0.2, 0, 2.0, 'striker'), disc('c', 0.5, 0.5)]);
  assert.equal(r.keyframes[0].t, 0);
  for (let i = 1; i < r.keyframes.length; i++) assert.ok(r.keyframes[i].t >= r.keyframes[i - 1].t);
  assert.ok(r.settled);
  assert.ok(r.keyframes.at(-1).t <= P.MAX_TIME + 1e-9);
});

test('determinism: the same input gives the same keyframes, and the input is not changed', () => {
  const input = [disc('s', 0.5, 0.2, 0.2, 2.1, 'striker'), disc('c', 0.52, 0.5), disc('d', 0.47, 0.55)];
  const before = JSON.stringify(input);
  const a = P.simulate(input), b = P.simulate(input);
  assert.equal(JSON.stringify(a.keyframes), JSON.stringify(b.keyframes));
  assert.equal(JSON.stringify(input), before, 'the caller’s discs are copied, not moved');
});


test('a striker hit sends a coin across a real distance, not a few millimetres', () => {
  // Head-on hit from the middle of the board, at half power: the coin should travel well over a fifth of the board.
  const v = P.flickVelocity(0, 0.5, -1);
  const r = P.simulate([
    { id: 'c', kind: 'coin', colour: 'b', x: 0.5, y: 0.6, vx: 0, vy: 0, r: P.RADIUS.coin },
    { id: 's', kind: 'striker', colour: 'w', x: 0.5, y: 0.85, vx: v.vx, vy: v.vy, r: P.RADIUS.striker },
  ]);
  const coin = r.keyframes.at(-1).d.find((d) => d[0] === 'c');
  assert.ok(0.6 - coin[2] > 0.2, `the coin should travel more than 0.2, it travelled ${(0.6 - coin[2]).toFixed(3)}`);
});

test('the striker is heavier than a coin: it carries on after a head-on hit, and the coin leaves faster than the striker was going', () => {
  const discs = [
    { id: 's', kind: 'striker', x: 0.5, y: 0.3, vx: 0, vy: 0.8, r: P.RADIUS.striker },
    { id: 1, kind: 'coin', x: 0.5, y: 0.3 + P.RADIUS.striker + P.RADIUS.coin + 0.001, vx: 0, vy: 0, r: P.RADIUS.coin },
  ];
  for (let i = 0; i < 4; i++) P.step(discs);
  const s = discs[0], c = discs[1];
  assert.ok(s.vy > 0.2, 'the striker keeps moving forward');
  assert.ok(c.vy > 0.8, 'the coin is thrown faster than the striker was going');
});

test('a coin driven into the cushion by the striker makes a cushion sound, not only the hit', () => {
  const r = P.simulate([
    { id: 1, kind: 'coin', colour: 'w', x: 0.022, y: 0.5, vx: 0, vy: 0, r: P.RADIUS.coin },
    { id: 's', kind: 'striker', colour: 'w', x: 0.075, y: 0.5, vx: -1.2, vy: 0, r: P.RADIUS.striker },
  ]);
  assert.ok(r.events.some(([, kind]) => kind === P.CUSHION_HIT), 'a cushion impact is reported');
});

console.log(`\n${passed} carrom physics tests passed`);
