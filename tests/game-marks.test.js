'use strict';
// The shared game marks: a known game gets its SVG mark; an unknown id, including an inherited name such as "constructor",
// gets the escaped emoji fallback and never "undefined" in the markup.
const assert = require('node:assert/strict');
global.window = {};
require('../public/game-marks.js');
const { html } = window.GameMarks;

const known = window.GameMarks.ids()[0];
assert.match(html(known, '🎴'), /^<svg class="gmark"/, 'a registered game gets its mark');
assert.equal(html('constructor', '🎲'), '🎲', 'an inherited property name falls back to the emoji');
assert.equal(html('no-such-game', '🎲'), '🎲', 'an unknown game falls back to the emoji');
assert.equal(html('constructor', '🎲').includes('undefined'), false);
assert.equal(html('no-such-game', undefined), '🎴', 'no icon at all uses the default');
console.log('game marks: 4 checks passed');
