'use strict';
// Regression tests for review findings on Penalty Rows (PR #219 review).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const penalty = require('../games/penaltyrows');

test('scrubbing a deleted player\'s name keeps the game phase (a player named "choose" must not stop the table)', () => {
  const players = [{ id: 'a', name: 'choose' }, { id: 'b', name: 'Bo' }];
  const g = penalty.create(players, {}, Math.random);
  assert.equal(g.view('a').phase, 'choose');
  g.scrub(['choose'], 'Deleted player');
  const v = g.view('a');
  assert.equal(v.phase, 'choose', 'phase is still the engine phase');
  assert.equal(v.players[0].name, 'Deleted player', 'the name is still scrubbed');
});

test('the Penalty Rows stylesheet is scoped to its own root class (.prt), not the shared .pr used by Property Rivals', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'penaltyrows.css'), 'utf8');
  assert.doesNotMatch(css, /\.pr(?![-\w])/, 'no bare .pr selector');
  assert.match(css, /\.prt \.pr-card/);
});

test('the Penalty Rows renderer marks its root with the .prt class', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'penaltyrows.js'), 'utf8');
  assert.match(src, /class="wz prt"/);
  assert.doesNotMatch(src, /class="wz pr"/);
});
