'use strict';
// The page's guest reminders: how often they show, how a dismissal holds, and that a non-guest never sees one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let passed = 0; let failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (err) { failed++; console.error('FAIL  ' + name + '\n' + err.stack); } }

function load(initial = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const listeners = [];
  const window = {};
  const ctx = { window, localStorage, document: { addEventListener: (t, f) => listeners.push([t, f]) }, console, Date };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'guest.js'), 'utf8'), ctx);
  return { g: window.TvGuest, store };
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
