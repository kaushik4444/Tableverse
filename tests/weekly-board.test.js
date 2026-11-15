'use strict';
require('./helpers/env');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../db/pool');
const matches = require('../db/matches');
const { start } = require('../server');

const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function client() {
  const saves = [], boards = [], errors = [], reloads = [];
  const prof = { game: 'ludo', data: { profile: { leaderboardOptIn: false } } };
  const context = {
    S: { profile: prof }, sessionGen: 1, encodeURIComponent, render() {},
    toast: (e) => errors.push(e),
    loadProfile: async () => { reloads.push(context.S.profile); },
    postJson: () => { const d = deferred(); saves.push(d); return d.promise; },
    getJson: (url) => { const d = deferred(); boards.push({ ...d, url }); return d.promise; },
  };
  const helper = source.slice(source.indexOf('  function loadProfileBoard('), source.indexOf('  // ------------------------------------------------------------ events'));
  const handler = source.slice(source.indexOf('    boardOptIn: async () =>'), source.indexOf('    closeGameStats:'));
  vm.createContext(context);
  vm.runInContext(helper + '\nvar actions = {\n' + handler + '\n};', context);
  return { context, prof, saves, boards, errors, reloads };
}
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
  const srv = await start({ port: 0, matchLog: { log() {}, warn() {}, error() {} } });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const response = await fetch(base + '/api/leaderboard?game=ludo');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).board, []);
    assert.equal((await fetch(base + '/api/leaderboard?game=INVALID')).status, 400);
    assert.equal((await fetch(base + '/api/leaderboard?game=ludo', { method: 'POST' })).status, 405);
  } finally { await srv.close(); }

  const c = client();
  c.context.loadProfileBoard(c.prof);
  const first = c.context.actions.boardOptIn();
  await c.context.actions.boardOptIn();
  assert.equal(c.saves.length, 1, 'duplicate activation is ignored');
  c.saves[0].resolve({ optIn: true });
  await first;
  assert.equal(c.prof.data.profile.leaderboardOptIn, true);
  assert.equal(c.prof.board, null, 'old board invalidated');
  assert.equal(c.boards.length, 2, 'successful save refetches');
  c.boards[1].resolve({ board: ['updated'] });
  await flush();
  c.boards[0].resolve({ board: ['old'] });
  await flush();
  assert.equal(c.prof.board.board[0], 'updated', 'older request cannot overwrite refresh');
  const retry = c.context.actions.boardOptIn();
  c.saves[1].reject(new Error('save failed'));
  await retry;
  assert.equal(c.prof.boardOptInPending, false);
  assert.equal(c.errors[0], 'save failed');
  const again = c.context.actions.boardOptIn();
  c.saves[2].resolve({ optIn: false });
  await again;
  assert.equal(c.prof.data.profile.leaderboardOptIn, false);

  for (const stale of [
    (x) => { x.context.sessionGen++; },
    (x) => { x.context.S.profile = {}; },
    (x) => { x.prof.game = 'wizard'; },
    (x) => { x.context.loadProfileBoard(x.prof); },
  ]) {
    const x = client();
    x.context.loadProfileBoard(x.prof);
    stale(x);
    x.boards[0].resolve({ board: ['stale'] });
    await flush();
    assert.equal(x.prof.board, null, 'stale board discarded');
  }
  const staleFailure = client();
  staleFailure.context.loadProfileBoard(staleFailure.prof);
  staleFailure.context.loadProfileBoard(staleFailure.prof);
  staleFailure.boards[1].resolve({ board: ['current'] });
  await flush();
  staleFailure.boards[0].reject(new Error('old request failed'));
  await flush();
  assert.equal(staleFailure.prof.board.board[0], 'current', 'stale failure cannot replace newer board');

  const x = client();
  const saving = x.context.actions.boardOptIn();
  x.context.sessionGen++;
  x.saves[0].resolve({ optIn: true });
  await saving;
  assert.equal(x.prof.data.profile.leaderboardOptIn, false);
  assert.equal(x.boards.length, 0, 'stale save cannot launch board request');

  assert.equal(x.reloads.length, 0, 'another session cannot trigger a profile refresh');

  for (const replacement of [
    { data: { profile: { leaderboardOptIn: false } } },
    { loading: true, data: null },
    null,
  ]) {
    const reloaded = client();
    reloaded.context.S.page = 'profile';
    const pending = reloaded.context.actions.boardOptIn();
    reloaded.context.S.profile = replacement;
    reloaded.saves[0].resolve({ optIn: true });
    await pending;
    assert.equal(reloaded.reloads.length, 1, 'same-session profile replacement refreshes after save');
    assert.equal(reloaded.reloads[0], replacement);
    assert.equal(reloaded.prof.boardOptInPending, false);
    assert.equal(reloaded.boards.length, 0, 'replaced profile cannot launch a board request');
  }
  assert.equal(c.reloads.length, 0, 'unchanged profile updates directly');

  // Left the profile screen while the save was in flight: no reload, so the screen the viewer is on is not replaced.
  const elsewhere = client();
  elsewhere.context.S.page = 'home';
  const away = elsewhere.context.actions.boardOptIn();
  elsewhere.context.S.profile = { loading: true, data: null };
  elsewhere.saves[0].resolve({ optIn: true });
  await away;
  assert.equal(elsewhere.reloads.length, 0, 'a profile replaced after the viewer left the screen is not reloaded');

  const original = { hasDatabase: db.hasDatabase, query: db.query };
  let calls = 0;
  db.hasDatabase = () => true;
  db.query = async (sql, params) => {
    calls++;
    assert.deepEqual(params, ['ludo', 7]);
    return { rows: [
      { match_id: 'm', game_id: 'ludo', seat: 0, player_id: 'a', place: 2, eligible_id: 'a', username: 'alice', display_name: 'Alice' },
      { match_id: 'm', game_id: 'ludo', seat: 1, player_id: 'b', place: 1 },
    ] };
  };
  try {
    const board = await matches.weeklyBoard('ludo');
    assert.equal(calls, 1, 'identities and all seats loaded in one statement');
    assert.equal(board.length, 1);
    assert.equal(board[0].username, 'alice');
    assert.ok(board[0].points < 0, 'noneligible opponent still determines placement XP');
  } finally { Object.assign(db, original); }
  console.log('weekly board routing, pending saves, refresh races, and single-query mapping passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
