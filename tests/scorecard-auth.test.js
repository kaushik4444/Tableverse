'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function boot(sessionResponse) {
  const root = { innerHTML: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, querySelector() { return null; } };
  const toasts = { appendChild() {} };
  const document = {
    activeElement: null,
    getElementById(id) { return id === 'sc' ? root : toasts; },
    createElement() { return { className: '', textContent: '', remove() {} }; },
  };
  const local = new Map();
  const context = {
    document, URLSearchParams, console, Math, Date, JSON, String, Number, Array, Set, Object,
    location: { search: '?game=wizard' },
    localStorage: { getItem: (k) => local.get(k) || null, setItem: (k,v) => local.set(k,v), removeItem: (k) => local.delete(k) },
    navigator: {},
    fetch: async () => ({ ok: true, json: async () => sessionResponse }),
    setTimeout: () => 0,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/scorecard.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  return root.innerHTML;
}

(async () => {
  const guest = await boot({ ok: true, authenticated: false });
  assert.match(guest, /Log in to use the scorecard/);
  assert.doesNotMatch(guest, /Players \(3 to 6/);

  const unverified = await boot({ ok: true, authenticated: true, emailVerificationRequired: true, emailVerified: false });
  assert.match(unverified, /verify your account email/i);
  assert.doesNotMatch(unverified, /Players \(3 to 6/);

  const signedIn = await boot({ ok: true, authenticated: true, emailVerificationRequired: false, emailVerified: false });
  assert.match(signedIn, /Players \(3 to 6/);
  console.log('scorecard auth gate tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
