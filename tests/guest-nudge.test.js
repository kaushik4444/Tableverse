'use strict';
// The page's guest reminders: how often they show, how a dismissal holds, and that a non-guest never sees one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }

function load(initial = {}, storageOverride) {
  const store = new Map(Object.entries(initial));
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const listeners = [];
  const window = {};
  const ctx = { window, localStorage: storageOverride || localStorage, document: { addEventListener: (t, f) => listeners.push([t, f]) }, console, Date };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'guest.js'), 'utf8'), ctx);
  return { g: window.TvGuest, store, listeners };
}
const H = 60 * 60 * 1000;

test('a guest sees a reminder on a page, and a non-guest never does', () => {
  const { g } = load();
  assert.notEqual(g.nudgeHTML('home', { guest: true }), '');
  assert.equal(g.nudgeHTML('home', { guest: false }), '');
});

test('reminders are shown no more than once per six hours on different pages', () => {
  const { g } = load();
  const t0 = 1e12;
  assert.notEqual(g.nudgeHTML('home', { guest: true, now: t0 }), '');
  assert.equal(g.nudgeHTML('profile', { guest: true, now: t0 + H }), '', 'a different page within six hours is held back');
  assert.notEqual(g.nudgeHTML('home', { guest: true, now: t0 + H }), '', 'the same page may show again');
  assert.notEqual(g.nudgeHTML('profile', { guest: true, now: t0 + 7 * H }), '', 'after six hours another page may show');
});

test('a dismissed reminder stays away for its own time, and the game-over one comes back sooner', () => {
  const { g } = load();
  const t0 = 2e12;
  g.nudgeHTML('home', { guest: true, now: t0 });
  g.dismiss('home', t0);
  assert.equal(g.nudgeHTML('home', { guest: true, now: t0 + 2 * 24 * H }), '', 'still hidden after two days');
  assert.notEqual(g.nudgeHTML('home', { guest: true, now: t0 + 4 * 24 * H }), '', 'back after three days');
  g.dismiss('gameover', t0);
  assert.equal(g.nudgeHTML('gameover', { guest: true, now: t0 + 10 * 60 * 1000 }), '', 'game-over hidden for a short time');
  assert.notEqual(g.nudgeHTML('gameover', { guest: true, now: t0 + 31 * 60 * 1000 }), '', 'and back after 30 minutes');
});

test('the game-over reminder is the stronger one and never blocks a game-over', () => {
  const { g } = load();
  const html = g.nudgeHTML('gameover', { guest: true, now: 3e12 });
  assert.match(html, /strong/);
  assert.match(html, /Keep your result/);
});

test('a broken or missing store does not stop reminders (it is a convenience only)', () => {
  const { g } = load({ ct_guest_nudge: '{not json' });
  assert.notEqual(g.nudgeHTML('home', { guest: true, now: 4e12 }), '');
});

test('the guest lifetime is shown in the reminder and the dialog, escaped', () => {
  const { g } = load();
  assert.match(g.nudgeHTML('home', { guest: true, hours: 48, now: 5e12 }), /about 48 hours/);
  assert.match(g.guestSheetHTML({ hours: 24 }), /about 24 hours/);
  assert.match(g.lockedLabel('<img onerror=x>'), /&lt;img onerror=x&gt;/);
});

test('cross-page cooldown ends at exactly six hours and game-over bypasses it', () => {
  const { g } = load();
  const now = 6e12;
  g.markShown('home', now);
  assert.equal(g.canShow('profile', now + 6 * H - 1), false);
  assert.equal(g.canShow('profile', now + 6 * H), true);
  assert.equal(g.canShow('gameover', now + 1), true);
});

test('every dismissal expires at its boundary and does not dismiss another context', () => {
  for (const [ctx, duration] of [['home', 72 * H], ['create', 72 * H], ['profile', 72 * H], ['friends', 72 * H], ['gameover', H / 2]]) {
    const { g } = load();
    const now = 7e12;
    g.dismiss(ctx, now);
    assert.equal(g.canShow(ctx, now + duration - 1), false, ctx);
    assert.equal(g.canShow(ctx, now + duration), true, ctx);
    assert.equal(g.canShow(ctx === 'home' ? 'profile' : 'home', now), true);
  }
});

test('rejected reminders do not consume the cross-page cooldown', () => {
  const { g, store } = load();
  assert.equal(g.nudgeHTML('unknown', { guest: true }), '');
  assert.equal(g.nudgeHTML('home'), '');
  assert.equal(store.size, 0);
});

test('cooldowns persist across page loads and preserve independent dismissals', () => {
  const { g, store } = load();
  const now = 8e12;
  g.markShown('home', now);
  g.dismiss('profile', now);
  g.dismiss('friends', now);
  const next = load(Object.fromEntries(store)).g;
  assert.equal(next.canShow('create', now + H), false);
  assert.equal(next.canShow('profile', now + 48 * H), false);
  assert.equal(next.canShow('friends', now + 48 * H), false);
});

test('unavailable browser storage never prevents rendering or dismissal', () => {
  const { g } = load({}, {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
  });
  assert.notEqual(g.nudgeHTML('home', { guest: true }), '');
  assert.doesNotThrow(() => g.dismiss('home'));
});

test('delegated clicks trigger upgrade and dismissal hooks and remove the reminder', () => {
  const { g, listeners } = load();
  const click = listeners.find(([type]) => type === 'click')[1];
  let upgrades = 0;
  let removed = 0;
  const dismissed = [];
  g.hooks.upgrade = () => { upgrades++; };
  g.hooks.dismissed = (ctx) => dismissed.push(ctx);
  click({ target: {} });
  click({ target: { closest: () => null } });
  click({ target: { closest: () => ({ dataset: { guestAct: 'upgrade' } }) } });
  assert.equal(upgrades, 1);
  click({ target: { closest: () => ({
    dataset: { guestAct: 'dismiss', guestCtx: 'home' },
    closest: () => ({ remove: () => { removed++; } }),
  }) } });
  assert.equal(removed, 1);
  assert.deepEqual(dismissed, ['home']);
  assert.equal(g.canShow('home'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
