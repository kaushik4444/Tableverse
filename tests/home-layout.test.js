'use strict';
// Run with: node tests/home-layout.test.js
// Exercise the real renderer without starting sockets or the application server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const start = source.indexOf('  function renderHome() {');
const end = source.indexOf('  function optionHTML(', start);
assert.ok(start >= 0 && end > start, 'the home renderer can be isolated');
const renderer = source.slice(start, end);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (err) { console.error('FAIL  ' + name + '\n' + err.stack); process.exitCode = 1; }
}

function home({ old = null, tables = true, guest = false, games = [] } = {}) {
  let list = old;
  let html = '';
  let calls = 0;
  const writes = [];
  const app = {
    querySelector(selector) { assert.equal(selector, '.public-tables'); return list; },
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      // A redraw replaces the node; new nodes have no inherited scroll position.
      list = tables ? {
        x: 0, y: 0,
        get scrollLeft() { return this.x; },
        set scrollLeft(value) { writes.push(['x', value]); this.x = value; },
        get scrollTop() { return this.y; },
        set scrollTop(value) { writes.push(['y', value]); this.y = value; },
      } : null;
    },
  };
  const context = {
    $app: app, S: { games, guest, named: false }, window: {},
    paintApp: (html) => { app.innerHTML = html; }, // the app's memo (skip an unchanged redraw) is covered by tests/ui/polish-ui.js
    esc: (value) => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    gameMark: (g) => String(g.icon || '🎴').replaceAll('<', '&lt;'), // the real mark helper is covered by tests/game-marks.test.js
    gameOpenFor: () => true, guestLockedFor: () => false, range: () => '2–4',
    loadWelcome: () => {}, welcomeHTML: () => '', // the welcome card has its own UI test (tests/ui/welcome-back-ui.js)
    guestNudge: () => '', topbarHTML: () => '', rejoinBannerHTML: () => '', bannersHTML: () => '', friendsStripHTML: () => '',
    publicTablesHTML: () => { calls++; return tables ? '<section class="public-tables-panel"><div class="public-tables"></div></section>' : ''; },
    comingSoonHTML: () => '<details class="soon-fold"></details>',
    recentTablesHTML: () => '<section class="recent-tables"></section>',
    loadingBlock: (label) => `<p role="status">${label}</p>`,
  };
  vm.createContext(context);
  vm.runInContext(renderer, context);
  return { app, context, writes, render: () => context.renderHome(), get list() { return list; }, get calls() { return calls; } };
}

for (const guest of [false, true]) {
  test(`open tables precede games once, with secondary sections below (guest=${guest})`, () => {
    const h = home({ guest }); h.render();
    const html = h.app.innerHTML;
    assert.equal(h.calls, 1);
    const split = html.indexOf('class="home-split"');
    const tables = html.indexOf('class="public-tables-panel"');
    const games = html.indexOf('id="games"');
    const soon = html.indexOf('class="soon-fold"');
    const recent = html.indexOf('class="recent-tables"');
    assert.ok(split >= 0 && split < tables && tables < games && games < soon && soon < recent);
    assert.equal((html.match(/class="public-tables-panel"/g) || []).length, 1);
    assert.match(html.slice(games, soon), /<\/section>\s*<\/div>/, 'games end inside the shared layout');
  });
}
test('no open tables still renders games and the loading state', () => {
  const h = home({ tables: false }); h.render();
  assert.doesNotMatch(h.app.innerHTML, /public-tables-panel/);
  assert.match(h.app.innerHTML, /id="games"/);
  assert.match(h.app.innerHTML, /Loading games…/);
  assert.equal(h.list, null);
});
test('game cards still render inside the shared layout', () => {
  const h = home({ games: [{ id: 'ludo', name: 'Ludo', seats: { min: 2, max: 4 }, tagline: 'Race home' }] });
  h.render();
  assert.match(h.app.innerHTML, /class="game-grid"[\s\S]*<h3>Ludo/);
  assert.match(h.app.innerHTML, /data-act="create" data-game="ludo"/);
  assert.doesNotMatch(h.app.innerHTML, /Loading games…/);
});
for (const [x, y] of [[145, 0], [0, 390], [0, 0], [31.5, 67.25]]) {
  test(`redraw restores both scroll axes (${x}, ${y}) on the replacement node`, () => {
    const old = { scrollLeft: x, scrollTop: y };
    const h = home({ old }); h.render();
    assert.notEqual(h.list, old);
    assert.deepEqual(h.writes, [['x', x], ['y', y]]);
    assert.equal(h.list.scrollLeft, x);
    assert.equal(h.list.scrollTop, y);
  });
}
test('successive redraws use the latest user scroll position', () => {
  const h = home({ old: { scrollLeft: 100, scrollTop: 200 } }); h.render();
  h.list.scrollLeft = 245; h.list.scrollTop = 350;
  h.render();
  assert.equal(h.list.scrollLeft, 245);
  assert.equal(h.list.scrollTop, 350);
});
test('a newly appearing list starts at its default position', () => {
  const h = home(); h.render();
  assert.deepEqual(h.writes, []);
  assert.equal(h.list.scrollLeft, 0);
  assert.equal(h.list.scrollTop, 0);
});
test('removing the last open table does not attempt to restore a missing list', () => {
  const h = home({ old: { scrollLeft: 200, scrollTop: 400 }, tables: false });
  assert.doesNotThrow(() => h.render());
  assert.equal(h.list, null);
  assert.deepEqual(h.writes, []);
});

// These are stylesheet contract checks, not a substitute for browser geometry tests.
// Scope declarations to their selector and breakpoint so a rule elsewhere cannot satisfy them.
const desktopStart = css.indexOf('@media (min-width: 1000px)');
assert.ok(desktopStart >= 0, 'desktop layout starts at 1000px');
const mobileCSS = css.slice(0, desktopStart);
const desktopCSS = css.slice(desktopStart);
function rule(text, selector) {
  const bodies = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].trim() === selector).map((m) => m[2]);
  assert.ok(bodies.length, `missing rule: ${selector}`);
  return bodies.join(';');
}
function declarations(text, selector, expected) {
  const body = rule(text, selector);
  for (const [property, value] of Object.entries(expected)) {
    const values = [...body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)]
      .filter((m) => m[1] === property).map((m) => m[2].trim());
    assert.equal(values.at(-1), value, `${selector}: ${property}`);
  }
}
test('phone list uses two rows, horizontal scrolling and a partial next card', () => {
  declarations(mobileCSS, '.public-tables-panel .public-tables', {
    'grid-auto-flow': 'column', 'grid-template-rows': 'repeat(2, auto)',
    'grid-auto-columns': 'min(280px, 82%)', 'overflow-x': 'auto', 'scroll-snap-type': 'x mandatory',
  });
  declarations(mobileCSS, '.public-tables-panel .public-table', { 'scroll-snap-align': 'start', 'flex-wrap': 'wrap' });
});
test('desktop reserves a sidebar only when the open-tables panel exists', () => {
  declarations(desktopCSS, '.home-split', { 'grid-template-columns': 'minmax(0, 1fr)' });
  declarations(desktopCSS, '.home-split:has(> .public-tables-panel)', { 'grid-template-columns': 'minmax(0, 1fr) 320px' });
  declarations(desktopCSS, '.home-split:has(> .public-tables-panel) > #games', { 'grid-column': '1', 'grid-row': '1' });
  declarations(desktopCSS, '.home-split > .public-tables-panel', { 'grid-column': '2', 'grid-row': '1', position: 'sticky', top: '12px' });
});
test('desktop replaces the horizontal two-row list with a bounded vertical list', () => {
  declarations(desktopCSS, '.public-tables-panel .public-tables', {
    'grid-auto-flow': 'row', 'grid-template-rows': 'none', 'grid-auto-columns': 'auto',
    'overflow-x': 'hidden', 'overflow-y': 'auto', 'max-height': '72vh', 'scroll-snap-type': 'none',
  });
});
test('narrow table cards can wrap their action without shrinking its label', () => {
  declarations(mobileCSS, '.public-tables-panel', { 'min-width': '0' });
  declarations(mobileCSS, '.public-tables-panel .public-table .public-table-info', { flex: '1 1 200px' });
  declarations(mobileCSS, '.public-tables-panel .public-table .btn', { 'flex-shrink': '0', 'white-space': 'nowrap', 'margin-left': 'auto' });
});
console.log(`\n${passed} home layout checks passed`);
