'use strict';
// Run the real admin client with controlled requests and timers to exercise save/redraw races.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/admin.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function scenario(olderFails) {
  const requests = []; const timers = new Map(); let timerId = 0; let click;
  const select = { dataset: { gaccess: 'ludo' }, value: 'off' };
  const retry = {};
  const save = {};
  // The game-switch box is repainted after each change, so its fake exposes the same controls every time.
  const switches = {
    innerHTML: '',
    querySelector: (selector) => selector === '[data-gsave]' ? save : null,
    querySelectorAll: (selector) => selector === '[data-gaccess]' ? [select] : [],
  };
  const main = {
    innerHTML: '',
    querySelector: (selector) => selector === '[data-loading]' ? (main.innerHTML.includes('data-loading') ? {} : null)
      : selector === '[data-retry]' ? retry : selector === '#gameSwitches' ? switches : null,
    querySelectorAll: () => [],
    insertAdjacentHTML: (_, html) => { main.innerHTML += html; },
  };
  const tabs = { querySelectorAll: () => [], querySelector: () => null, addEventListener: (_, fn) => { click = fn; } };
  const context = {
    document: { getElementById: (id) => id === 'adMain' ? main : id === 'adTabs' ? tabs : {} },
    window: {},
    MutationObserver: class { observe() {} }, AbortController,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch: (path) => new Promise((resolve, reject) => requests.push({ path, resolve: (json) => resolve({ ok: true, status: 200, json: async () => json }), reject })),
  };
  vm.runInNewContext(source, context);
  const answer = async (path, json) => {
    const index = requests.findIndex((r) => r.path === path);
    assert.ok(index >= 0, `request for ${path}`);
    requests.splice(index, 1)[0].resolve(json); await flush();
  };
  const tab = async (name) => { click({ target: { closest: () => ({ dataset: { tab: name } }) } }); await flush(); };
  const games = { days: 30, games: [] };
  await answer('/api/admin/me', { isAdmin: true, isOwner: true });
  await answer('/api/admin/overview?days=30', {}); // settle the unrelated initial view
  await tab('games');
  await answer('/api/admin/games?days=30', games);
  await answer('/api/admin/game-flags', { modes: ['on', 'off'], games: [{ id: 'ludo', name: 'Ludo', access: 'on' }] });
  assert.equal(timers.size, 0, 'completed render cancels its watchdog');
  select.onchange(); await flush(); // a change only fills the draft; nothing is sent yet
  assert.equal(requests.length, 0, 'editing the draft sends no request');
  save.onclick(); await flush(); // Save sends the draft
  await answer('/api/auth/csrf', { csrfToken: 'synthetic' });
  await tab('health');
  await tab('games'); // re-enter while the save is pending
  const older = requests.splice(requests.findIndex((r) => r.path === '/api/admin/games?days=30'), 1)[0];
  await answer('/api/admin/game-flags', { ok: true }); // save starts a replacement GET
  assert.equal(timers.size, 1, 'replacement owns an active watchdog');
  if (olderFails) older.reject(new Error('old request failed'));
  else older.resolve(games);
  await flush();
  assert.equal(timers.size, 1, 'superseded settlement cannot clear the replacement timer');
  assert.match(main.innerHTML, /data-loading/);
  const slow = [...timers.values()][0];
  assert.equal(slow.ms, 12000);
  slow.fn();
  assert.match(main.innerHTML, /Try again/, 'hung replacement offers retry');
  retry.onclick(); await flush();
  // Resolve the superseded replacement, then the retry, and finish rendering.
  await answer('/api/admin/games?days=30', games);
  assert.equal(timers.size, 1, 'retry retains its watchdog');
  await answer('/api/admin/games?days=30', games);
  await answer('/api/admin/game-flags', { modes: [], games: [] });
  assert.equal(timers.size, 0, 'finished retry cancels watchdog');
  await tab('games');
  const abandoned = [...timers.values()][0];
  await tab('health');
  const healthMarkup = main.innerHTML;
  abandoned.fn();
  assert.equal(main.innerHTML, healthMarkup, 'leaving Games prevents its watchdog from rendering');
  assert.equal(timers.size, 1, 'only the new tab watchdog remains');
}

(async () => {
  await scenario(false);
  await scenario(true);
  console.log('ok: Games replacement watchdog survives stale success and failure; retry, completion and tab cancellation');
})().catch((e) => { console.error(e); process.exitCode = 1; });
