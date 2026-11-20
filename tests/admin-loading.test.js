'use strict';
// Exercise the complete admin client with deferred fetches and a deterministic clock.
// No browser, server, or real 12-second waits are needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function scenario({ abortController = true } = {}) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const requests = [];
  const retry = {};
  const main = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === '[data-loading]') return this.innerHTML.includes('data-loading') ? {} : null;
      if (selector === '[data-retry]') return this.innerHTML.includes('data-retry') ? retry : null;
      return null;
    },
    querySelectorAll: () => [],
  };
  const buttons = ['overview', 'users', 'players', 'feedback'].map((tab) => ({
    dataset: { tab }, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
  }));
  const listeners = {};
  const tabs = {
    querySelectorAll: () => buttons, querySelector: () => null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const elements = { adMain: main, adTabs: tabs, adWho: {}, fPrev: {}, fNext: {} };
  const context = {
    document: { getElementById: (id) => elements[id] },
    MutationObserver: class { observe() {} },
    AbortController: abortController ? AbortController : undefined,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch(url, options) {
      if (url === '/api/admin/me') return Promise.resolve({ ok: true, json: async () => ({ isAdmin: true, isOwner: false }) });
      return new Promise((resolve, reject) => {
        // Deliberately ignore abort: also verify the client's stale-answer guard.
        requests.push({ url, options, reject, reply: (body) => resolve({ ok: true, json: async () => body }) });
      });
    },
  };
  vm.runInNewContext(script, context, { filename: 'admin.js' });
  await flush();
  return {
    main, retry, requests, timers, buttons,
    tab(tab) { listeners.click({ target: { closest: () => buttons.find((b) => b.dataset.tab === tab) } }); },
    tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
    },
  };
}
const emptyFeedback = { items: [], total: 0, pageSize: 20 };
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n' + e.stack); process.exitCode = 1; }
}
(async () => {
  await test('a pending tab offers an accessible retry at exactly 12 seconds', async () => {
    const s = await scenario();
    assert.match(s.main.innerHTML, /data-loading/);
    s.tick(11999);
    assert.doesNotMatch(s.main.innerHTML, /data-retry/);
    s.tick(1);
    assert.match(s.main.innerHTML, /role="status"/);
    assert.match(s.main.innerHTML, /This is taking longer than usual/);
    assert.match(s.main.innerHTML, /<button type="button"[^>]*data-retry>Try again/);
    assert.equal(s.requests.length, 1, 'no automatic retry');
  });
  await test('retry restarts the same tab, aborts its request and resets the deadline', async () => {
    const s = await scenario();
    s.tab('feedback');
    const first = s.requests.at(-1);
    s.tick(12000);
    s.retry.onclick();
    assert.equal(first.options.signal.aborted, true);
    assert.equal(s.requests.at(-1).url, first.url);
    assert.match(s.main.innerHTML, /data-loading/);
    s.tick(11999);
    assert.doesNotMatch(s.main.innerHTML, /data-retry/);
    s.requests.at(-1).reply(emptyFeedback);
    await flush();
    assert.match(s.main.innerHTML, /Nothing here/);
    s.tick(1);
    assert.doesNotMatch(s.main.innerHTML, /data-retry/);
  });
  await test('a successful view clears its timer and remains visible', async () => {
    const s = await scenario();
    s.tab('feedback');
    s.requests.at(-1).reply(emptyFeedback);
    await flush();
    assert.match(s.main.innerHTML, /Nothing here/);
    assert.equal(s.timers.size, 1, 'only the unresolved previous tab still has a timer');
    const rendered = s.main.innerHTML;
    s.tick(24000);
    assert.equal(s.main.innerHTML, rendered);
  });
  await test('rendered content is preserved even while a view promise is pending', async () => {
    const s = await scenario();
    // A view may draw its main content before its remaining asynchronous work finishes.
    s.main.innerHTML = '<h2>Already drawn</h2>';
    s.tick(12000);
    assert.equal(s.main.innerHTML, '<h2>Already drawn</h2>');
  });
  await test('a previous tab deadline cannot replace the new tab loading indicator', async () => {
    const s = await scenario();
    s.tick(6000);
    s.tab('users');
    s.tick(6000);
    assert.match(s.main.innerHTML, /data-loading/);
    assert.equal(s.buttons.find((b) => b.dataset.tab === 'users').attributes['aria-selected'], 'true');
    s.tick(6000);
    assert.match(s.main.innerHTML, /data-retry/);
  });
  await test('a failed request clears its timer and keeps the escaped error visible', async () => {
    const s = await scenario();
    s.requests[0].reject(new Error('<offline>'));
    await flush();
    assert.equal(s.timers.size, 0);
    assert.match(s.main.innerHTML, /&lt;offline&gt;/);
    const error = s.main.innerHTML;
    s.tick(12000);
    assert.equal(s.main.innerHTML, error);
  });
  await test('a late success recovers a slow tab without requiring retry', async () => {
    const s = await scenario();
    s.tab('feedback');
    s.tick(12000);
    assert.match(s.main.innerHTML, /data-retry/);
    s.requests.at(-1).reply(emptyFeedback);
    await flush();
    assert.match(s.main.innerHTML, /Nothing here/);
    assert.doesNotMatch(s.main.innerHTML, /data-retry/);
    assert.equal(s.timers.size, 0);
  });
  await test('a late failure replaces the slow warning with the actual error', async () => {
    const s = await scenario();
    s.tick(12000);
    s.requests[0].reject(new Error('Connection lost'));
    await flush();
    assert.match(s.main.innerHTML, /Connection lost/);
    assert.doesNotMatch(s.main.innerHTML, /data-retry/);
  });
  for (const abortController of [true, false]) {
    await test(`stale success and failure cannot replace a retried view (AbortController=${abortController})`, async () => {
      const s = await scenario({ abortController });
      s.tab('feedback');
      const stale = s.requests.at(-1);
      s.tick(12000);
      s.retry.onclick();
      const current = s.requests.at(-1);
      stale.reply({ items: [{ message: 'STALE', category: 'idea', status: 'new' }], total: 1, pageSize: 20 });
      s.requests[0].reject(new Error('Old overview failure'));
      await flush();
      assert.match(s.main.innerHTML, /data-loading/);
      s.tick(12000);
      assert.match(s.main.innerHTML, /data-retry/, 'settling stale requests did not cancel the retry timer');
      current.reply(emptyFeedback);
      await flush();
      assert.match(s.main.innerHTML, /Nothing here/);
      assert.doesNotMatch(s.main.innerHTML, /STALE|Old overview/);
    });
  }
  console.log(`\n${passed} passed`);
})();
