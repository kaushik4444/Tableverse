'use strict';
// Run the browser module in isolation, without leaking window into other tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const games = require('../games').list();
const publicFile = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const window = {};
vm.runInNewContext(publicFile('game-marks.js'), { window }, { filename: 'game-marks.js' });
const { html, ids } = window.GameMarks;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok ' + name);
}

test('every registered game has a distinct, decorative SVG mark', () => {
  assert.deepEqual(Array.from(ids()).sort(), games.map((g) => g.id).sort());
  const marks = games.map((g) => html(g.id, g.icon));
  assert.equal(new Set(marks).size, games.length, 'no two games share a mark');
  for (const [i, mark] of marks.entries()) {
    assert.match(mark, /^<svg\b[^>]*class="gmark"[^>]*>.+<\/svg>$/, games[i].id);
    assert.match(mark, /viewBox="0 0 48 48"/);
    assert.match(mark, /aria-hidden="true"/);
    assert.match(mark, /focusable="false"/);
    assert.doesNotMatch(mark, /undefined|NaN|<script|\bon\w+=/);
    assert.equal(mark, html(games[i].id, '<img src=x onerror=alert(1)>'), 'known ids ignore fallback markup');
  }
  assert.notEqual(html('tictactoe'), html('fourinarow'), 'the shared engine has separate game marks');
});

test('unknown and inherited names use the supplied fallback', () => {
  for (const id of ['no-such-game', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '', null, undefined]) {
    assert.equal(html(id, '🎲'), '🎲', String(id));
  }
  assert.equal(html('LUDO', '🎲'), '🎲', 'ids are case sensitive');
});

test('fallback text escapes all HTML metacharacters without damaging emoji', () => {
  assert.equal(html('unknown', `🎲 &<>"'`), '🎲 &amp;&lt;&gt;&quot;&#39;');
  assert.equal(html('__proto__', '<img src="x" onerror=\'alert(1)\'>'),
    '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;');
  assert.equal(html('unknown', '🃏'), '🃏');
});

test('missing and empty icons use the default card mark', () => {
  for (const fallback of [undefined, null, '']) assert.equal(html('unknown', fallback), '🎴');
  assert.equal(html('unknown'), '🎴');
});

test('mutating the returned id list cannot change the registry or its marks', () => {
  const before = Array.from(ids());
  const mark = html(before[0]);
  const copy = ids();
  copy.splice(0, copy.length, 'invented');
  assert.deepEqual(Array.from(ids()), before);
  assert.equal(html(before[0]), mark);
  assert.equal(html('invented', '🎲'), '🎲');
});

test('both entry pages load marks before the consuming deferred script', () => {
  for (const [page, consumer] of [['index.html', 'app.js'], ['admin.html', 'admin.js']]) {
    const scripts = [...publicFile(page).matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)];
    const mark = scripts.findIndex((m) => m[2] === '/game-marks.js');
    const app = scripts.findIndex((m) => m[2] === '/' + consumer);
    assert.ok(mark >= 0 && app > mark, page);
    for (const i of [mark, app]) {
      assert.match(scripts[i][1] + scripts[i][3], /\bdefer\b/);
      assert.doesNotMatch(scripts[i][1] + scripts[i][3], /\basync\b/);
    }
  }
});

// Isolate the real, pure rendering declarations from the app's IIFE. This avoids
// starting sockets, timers or authentication, and never duplicates their bodies.
const app = publicFile('app.js');
function declaration(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `rendering declaration exists: ${start}`);
  return app.slice(from, to);
}
const renderContext = {
  window, S: { games: [] },
  // These collaborators are unrelated to marks; the production renderers still
  // perform metadata lookup, fallback selection and HTML interpolation.
  emptyState: () => '<p>empty</p>',
  publicTableAction: () => ({ cls: '', disabled: false, label: 'Join' }),
};
vm.createContext(renderContext);
vm.runInContext([
  declaration('  const esc =', '\n  const store ='),
  declaration('  const gameMeta =', '\n  /**'),
  declaration('  const statsGame =', '\n  /** The statistics block of a profile'),
  declaration('  function progressHTML(', '\n  /** One game'),
  declaration('  function gameDetailHTML(', '\n  function statsHTML('),
  declaration('  function rejoinBannerHTML(', '\n  function tableByCode('),
  declaration('  function publicTablesHTML(', '\n  function joinTable('),
  declaration('  function statsHTML(', '\n  function openActivityLog('),
  declaration('  function historyHTML(', '\n  /** Accounts'),
  declaration('  const RESULT_LABEL =', '\n'),
  'globalThis.render = { gameMark, statsGame, statsHTML, historyHTML, progressHTML, gameDetailHTML, rejoinBannerHTML, publicTablesHTML };',
].join('\n'), renderContext);
const render = renderContext.render;

test('app helper uses marks and safely falls back if the script is unavailable', () => {
  assert.equal(render.gameMark({ id: 'ludo', icon: '🎲' }), html('ludo'));
  assert.equal(render.gameMark({ id: 'unknown', icon: '<x>' }), '&lt;x&gt;');
  delete window.GameMarks;
  try {
    assert.equal(render.gameMark({ id: 'ludo', icon: '<x>' }), '&lt;x&gt;');
    assert.equal(render.gameMark({ id: 'ludo' }), '🎴');
  } finally { window.GameMarks = { html, ids }; }
});

test('history retains known marks even when a game is absent from the menu', () => {
  const history = { total: 1, pages: 1, items: [{ gameId: 'ludo', humans: 2, seats: 2, result: 'won', finishedAt: '2026-01-01' }] };
  assert.equal(render.statsGame('ludo').id, 'ludo');
  assert.ok(render.historyHTML(history).includes(html('ludo')));
  history.items[0].gameId = '<unknown>';
  const result = render.historyHTML(history);
  assert.ok(result.includes('🎴'));
  assert.ok(result.includes('&lt;unknown&gt;'));
  assert.doesNotMatch(result, /<unknown>/);
});

test('favourite, per-game and recent results all retain marks without menu metadata', () => {
  const progress = { level: 1, games: { ludo: { points: 20 } } };
  for (const interactive of [true, false]) {
    // the level card lists no games any more (Game XP is not shown)
    assert.doesNotMatch(render.progressHTML(progress, interactive), /XP/);
    const result = render.statsHTML({
      played: 1, wins: 1, losses: 0, winRate: 100, favouriteGame: 'ludo',
      streak: { current: 1, best: 1 }, progress,
      perGame: [{ gameId: 'ludo', wins: 1, losses: 0, winRate: 100, best: null }],
      recent: [{ gameId: 'ludo', won: true, finishedAt: '2026-01-01' }],
    }, interactive);
    assert.equal(result.split(html('ludo')).length - 1, 3, 'favourite, by-game row and recent chip');
    assert.doesNotMatch(result, /undefined/);
  }
});

test('game detail headers retain a mark before any matches have been played', () => {
  const result = render.gameDetailHTML({ game: 'ludo', data: { stats: { perGame: [] } } });
  assert.ok(result.includes(html('ludo')));
  assert.ok(result.includes('data-act="closeGameStats"'));
});

test('open tables and rejoin banners show marks and keep unknown-game fallbacks safe', () => {
  const state = renderContext.S;
  state.games = [{ id: 'ludo', name: 'Ludo', icon: '🎲' }];
  state.sessionListOpen = true;
  for (const id of ['ludo', '<unknown>']) {
    state.publicTables = [{ gameId: id, code: 'ABCDEF', host: 'Host', members: 1, seats: 4 }];
    state.rejoin = [{ gameId: id, code: 'ABCDEF' }];
    for (const result of [render.publicTablesHTML(), render.rejoinBannerHTML()]) {
      assert.ok(result.includes(id === 'ludo' ? html('ludo') : '🎴'));
      assert.doesNotMatch(result, /<unknown>|undefined/);
    }
  }
  state.games = [];
});

test('open tables and rejoin banners keep a known mark when the game is missing from the menu', () => {
  const state = renderContext.S;
  state.games = [];
  state.sessionListOpen = true;
  state.publicTables = [{ gameId: 'ludo', code: 'ABCDEF', host: 'Host', members: 1, seats: 4 }];
  state.rejoin = [{ gameId: 'ludo', code: 'ABCDEF' }];
  for (const result of [render.publicTablesHTML(), render.rejoinBannerHTML()]) {
    assert.ok(result.includes(html('ludo')), 'known id keeps its mark without menu metadata');
    assert.doesNotMatch(result, /undefined/);
  }
});

// Exercise the admin renderer with synthetic API data and a minimal output sink.
async function adminMarks() {
  const admin = publicFile('admin.js');
  const start = admin.indexOf('  async function gameSwitches(');
  const end = admin.indexOf('  // ---------------------------------------------------------------- chat reports', start);
  assert.ok(start >= 0 && end > start, 'admin game-switch renderer exists');
  // the draft state and its helpers sit above gameSwitches; the renderer needs them too
  const draftState = admin.slice(admin.indexOf('  let gameDraft'), admin.indexOf('  let generation'));
  const draftCode = admin.slice(admin.indexOf('  // ---- owner draft for the game switches'), start);
  assert.ok(draftState.length > 0 && draftCode.length > 0, 'admin game draft exists');
  for (const available of [true, false]) {
    let output = '';
    const context = {
      window: available ? window : {},
      state: { gen: 1 }, gameFlagPending: new Map(), gameTrialPending: new Map(), gameFlagError: null, orderBusy: false,
      api: async () => ({ modes: ['on'], games: [
        { id: 'ludo', name: 'Ludo', icon: '🎲', access: 'on' },
        { id: 'unknown', name: '<Unknown>', icon: '<img src=x>', access: 'on' },
      ] }),
      main: {
        insertAdjacentHTML: (_position, markup) => { output += markup; },
        querySelectorAll: () => [],
        // the rows are painted into #gameSwitches after the heading is appended
        querySelector: (selector) => (selector === '#gameSwitches' ? { set innerHTML(v) { output += v; }, get innerHTML() { return ''; }, querySelectorAll: () => [], querySelector: () => null } : null),
      },
    };
    vm.createContext(context);
    vm.runInContext(
      admin.slice(admin.indexOf('  const esc ='), admin.indexOf('  const countryName =')) +
      draftState + draftCode + admin.slice(start, end) + '\nglobalThis.run = gameSwitches;', context);
    await context.run();
    assert.ok(output.includes(available ? html('ludo') : '🎲'));
    assert.ok(output.includes('&lt;img src=x&gt;'));
    assert.ok(output.includes('&lt;Unknown&gt;'));
    assert.doesNotMatch(output, /<img|<Unknown>|undefined/);
    passed++;
    console.log('  ok admin game list with marks ' + (available ? 'available' : 'unavailable'));
  }
}
adminMarks().then(() => {
  console.log(`game marks: ${passed} tests passed`);
}).catch((err) => { console.error(err); process.exitCode = 1; });
