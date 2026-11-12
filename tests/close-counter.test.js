'use strict';
// The socket close counter behind the Health tab: counts only, normal closes apart from everything else.
const assert = require('node:assert/strict');
const { createCloseCounter } = require('../lib/closeCounter');

const c = createCloseCounter();
assert.deepEqual(c.stats(), { normal: 0, other: 0 }, 'starts at zero');
c.record(1000); c.record(1001);
c.record(1006); c.record(1011); c.record(undefined);
assert.deepEqual(c.stats(), { normal: 2, other: 3 }, 'normal closes and other closes are counted apart');
console.log('  ok  close counter splits normal and other closes');
console.log('close-counter: 1 passed');
