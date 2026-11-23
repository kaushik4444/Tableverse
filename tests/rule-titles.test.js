'use strict';
const assert = require('node:assert/strict');
const games = require('../games');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; } }

test('every game has one how-to-play card title per rule paragraph', () => {
  for (const g of games.list()) {
    assert.equal(g.ruleTitles.length, (g.rules || []).length, `${g.id}: ${g.ruleTitles.length} titles for ${(g.rules || []).length} rules`);
    g.ruleTitles.forEach((t) => assert.ok(typeof t === 'string' && t.length > 0 && t.length <= 28, `${g.id}: a short title`));
  }
});

console.log(`\n${passed} rule title tests passed`);
