'use strict';
// Round ready-up: the table waits for every connected person to press Ready; bots and people who are away never hold it up.
const assert = require('node:assert/strict');
const { startGate, gateOpen, markReady, readyState } = require('../lib/readyGate');

const human = (id) => ({ id, name: id, bot: false });
const bot = (id) => ({ id, name: id, bot: true });
const room = (members) => ({ members });
const all = () => true;

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

t('no gate: the table is never held', () => {
  assert.equal(gateOpen(room([human('a')]), all), true);
  assert.equal(readyState(room([human('a')]), all), null);
});

t('the gate waits for every connected person to press Ready', () => {
  const r = room([human('a'), human('b'), bot('c')]);
  startGate(r);
  assert.equal(gateOpen(r, all), false);
  markReady(r, 'a');
  assert.equal(gateOpen(r, all), false, 'b has not pressed yet');
  markReady(r, 'b');
  assert.equal(gateOpen(r, all), true);
});

t('bots are ready already; a person who is away does not hold the table', () => {
  const r = room([human('a'), human('b'), bot('c')]);
  startGate(r);
  const away = (m) => m.id !== 'b';
  assert.equal(gateOpen(r, away), false, 'a is connected and must press');
  markReady(r, 'a');
  assert.equal(gateOpen(r, away), true, 'b is away, so a bot stands in for them');
});

t('a person who is not seated cannot count as ready', () => {
  const r = room([human('a')]);
  startGate(r);
  assert.equal(markReady(r, 'someone-else'), false);
  assert.equal(markReady(r, 'a'), true);
});

t('the table shows who is ready and who is still awaited', () => {
  const r = room([human('a'), human('b')]);
  startGate(r);
  markReady(r, 'a');
  assert.deepEqual(readyState(r, all), { ready: ['a'], waiting: ['b'] });
});

console.log(`\n${passed} ready gate tests passed`);
