'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');

function renderer() {
  // Like the other app.js unit tests, isolate the private client code from browser startup.
  const helper = source.match(/^  let shownOverlayTitles\b[^]*?^  function markSettledOverlays\([^]*?^  }/m);
  assert.ok(helper, 'overlay helper is present');
  const markSettledOverlays = vm.runInNewContext(helper[0] + '\nmarkSettledOverlays');

  // Each render replaces the overlay nodes, even when their titles stay the same.
  return (...overlays) => {
    const nodes = overlays.map(({ heading, body, visible = true }) => {
      const classes = new Set();
      return {
        classList: classes,
        textContent: body,
        querySelector: (selector) => selector === 'h2' && heading !== undefined ? { textContent: heading } : null,
        getClientRects: () => visible ? [{}] : [],
      };
    });
    markSettledOverlays({ querySelectorAll: (selector) => selector === '.overlay' ? nodes : [] });
    return nodes.map((node) => node.classList.has('settled'));
  };
}

test('only overlays with a previously visible heading settle, regardless of order or changed Ready copy', () => {
  const render = renderer();
  assert.deepEqual(render(
    { heading: '  Round 1  ', body: 'Round 1 · Ready?' },
    { heading: 'Scoreboard' },
  ), [false, false]);
  assert.deepEqual(render(
    { heading: 'Scoreboard' },
    { heading: 'Round 1', body: 'Round 1 · You are ready' },
    { heading: 'Round 2' },
  ), [true, true, false]);
});

test('a hidden overlay is never settled and animates the first time it becomes visible again', () => {
  const render = renderer();
  const scores = { heading: 'Scoreboard' };
  const hidden = { ...scores, visible: false };
  assert.deepEqual(render(hidden), [false]);
  assert.deepEqual(render(scores), [false]);
  assert.deepEqual(render(scores), [true]);
  assert.deepEqual(render(hidden), [false]);
  assert.deepEqual(render(scores), [false]);
});

test('an intervening render without overlays clears the previous titles', () => {
  const render = renderer();
  const scores = { heading: 'Scoreboard' };
  assert.deepEqual(render(scores), [false]);
  assert.deepEqual(render(scores), [true]);
  assert.deepEqual(render(), []);
  assert.deepEqual(render(scores), [false]);
});

test('overlays without a heading use their own text to distinguish consecutive sheets', () => {
  const render = renderer();
  assert.deepEqual(render({ body: ' Waiting for players ' }), [false]);
  assert.deepEqual(render({ body: 'Waiting for players' }), [true]);
  assert.deepEqual(render({ body: 'Game over' }), [false]);
});
