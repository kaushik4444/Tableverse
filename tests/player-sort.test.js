'use strict';
// Admin player directory sort keys: every key the table headers use is allowed, orders are fixed SQL, and bad input falls back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SORTS, clampSort, clampDir, orderBy } = require('../db/playerStats');

const COLUMN_KEYS = ['player', 'games', 'wins', 'winrate', 'leftrate', 'minutes', 'seen'];
const PRESET_KEYS = ['seen', 'joined', 'games', 'wins', 'minutes', 'leaving'];

test('every column header key and preset key is a known sort', () => {
  for (const k of [...COLUMN_KEYS, ...PRESET_KEYS]) assert.ok(Object.hasOwn(SORTS, k), k);
});

test('unknown sort keys fall back to last seen', () => {
  assert.equal(clampSort('games'), 'games');
  assert.equal(clampSort('drop table'), 'seen');
  assert.equal(clampSort('__proto__'), 'seen');
});

test('direction: asc and desc are honoured, anything else uses the key default', () => {
  assert.equal(clampDir('asc', 'games'), 'ASC');
  assert.equal(clampDir('desc', 'player'), 'DESC');
  assert.equal(clampDir('sideways', 'games'), 'DESC');
  assert.equal(clampDir('', 'player'), 'ASC');
  assert.equal(clampDir(undefined, 'seen'), 'DESC');
});

test('ratios sort NULLs last and never divide by zero', () => {
  assert.match(orderBy('winrate', 'DESC'), /NULLIF\(s\.rated - s\.draws, 0\)\) DESC NULLS LAST/);
  assert.match(orderBy('leftrate', 'ASC'), /NULLIF\(s\.games, 0\)\) ASC NULLS LAST/);
});

test('ordering text is built only from the fixed map, never from the request', () => {
  for (const k of Object.keys(SORTS)) {
    for (const d of ['ASC', 'DESC']) {
      assert.doesNotMatch(orderBy(k, d), /[;'"]/, k + ' ' + d);
    }
  }
});
