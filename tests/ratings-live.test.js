'use strict';
// The live ratings switch is off unless RATINGS_LIVE is exactly '1'. Pure: no database is touched.
const assert = require('node:assert/strict');
const { liveEnabled } = require('../db/ratings');

assert.equal(liveEnabled({}), false, 'off by default');
assert.equal(liveEnabled({ RATINGS_LIVE: '0' }), false);
assert.equal(liveEnabled({ RATINGS_LIVE: 'true' }), false, 'only exactly 1 turns it on');
assert.equal(liveEnabled({ RATINGS_LIVE: '1' }), true);

console.log('ratings live switch: all tests passed');
