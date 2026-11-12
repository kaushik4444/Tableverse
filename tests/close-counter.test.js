'use strict';
// The socket close counter behind the Health tab: counts only, normal closes apart from everything else.
const assert = require('node:assert/strict');
const { createCloseCounter } = require('../lib/closeCounter');

const c = createCloseCounter();
assert.deepEqual(c.stats(), { normal: 0, replaced: 0, lost: 0 }, 'starts at zero');
c.record(1000); c.record(1001); c.record(1005);
c.record(4000); c.record(4002);
c.record(1006); c.record(1011); c.record(1013); c.record(undefined);
assert.deepEqual(c.stats(), { normal: 3, replaced: 2, lost: 4 }, 'normal closes, app replacements and losses are counted apart');
console.log('  ok  close counter splits normal, replaced and lost');
console.log('close-counter: 1 passed');
