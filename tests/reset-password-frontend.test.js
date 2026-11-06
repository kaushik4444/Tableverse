'use strict';
// The reset page runs on its own: no app.js, no voice or home scripts. These tests run the real script in a VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'reset-password.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'reset-password.html'), 'utf8');

const IDS = ['resetFormSection', 'resetDoneSection', 'resetNewLinkSection', 'resetTitle', 'doneTitle', 'newLinkTitle', 'newLinkMsg',
  'resetForm', 'resetPassword', 'resetConfirm', 'resetSubmit', 'resetMsg', 'forgotForm', 'forgotEmail', 'forgotSubmit', 'forgotMsg'];

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

async function scenario({ search = '?token=secret-token', fetch }) {
  const elements = Object.fromEntries(IDS.map((id) => [id, {
    id, hidden: false, value: '', textContent: '', disabled: false, listeners: {}, focused: false,
    focus() { this.focused = true; }, addEventListener(type, fn) { this.listeners[type] = fn; },
  }]));
  // Sections start hidden in the page, so mirror that.
  ['resetFormSection', 'resetDoneSection', 'resetNewLinkSection'].forEach((id) => { elements[id].hidden = true; });
  elements.resetMsg.hidden = true; elements.forgotMsg.hidden = true;
  const historyCalls = [];
  const location = { search, pathname: '/reset-password.html' };
  const context = {
    document: { getElementById: (id) => elements[id] },
    location,
    history: { replaceState: (...a) => historyCalls.push(a) },
    URLSearchParams,
    fetch,
    console: { log() {}, error() {}, warn() {} }, // the script must not log anything
  };
  vm.runInNewContext(script, context, { filename: 'reset-password.js' });
  await new Promise((r) => setImmediate(r));
  return { elements, historyCalls };
}

const submit = (form, payload) => form.listeners.submit({ preventDefault() {}, ...(payload || {}) });
const csrfOr = (fn) => async (url, options) => (url.endsWith('/csrf') ? response(200, { csrfToken: 'csrf-value' }) : fn(url, options));

async function main() {
  console.log('states');
  const ok = await scenario({ fetch: async () => { throw new Error('no request expected'); } });
  assert.equal(ok.elements.resetFormSection.hidden, false);
  assert.equal(ok.elements.resetDoneSection.hidden, true);
  assert.equal(ok.elements.resetNewLinkSection.hidden, true);
  assert.deepEqual(ok.historyCalls[0], [null, '', '/reset-password.html'], 'the token leaves the address bar at once');

  const missing = await scenario({ search: '', fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal(missing.elements.resetNewLinkSection.hidden, false);
  assert.equal(missing.elements.resetFormSection.hidden, true);

  console.log('reset submission');
  const posts = [];
  const done = await scenario({ fetch: csrfOr(async (url, options) => { posts.push({ url, options }); return response(200, { ok: true }); }) });
  done.elements.resetPassword.value = 'NewPassword1';
  done.elements.resetConfirm.value = 'NewPassword1';
  await submit(done.elements.resetForm);
  const post = posts.find((p) => p.url === '/api/auth/reset-password');
  assert.ok(post, 'the reset endpoint is called');
  assert.equal(post.options.headers['X-CSRF-Token'], 'csrf-value');
  assert.deepEqual(JSON.parse(post.options.body), { token: 'secret-token', newPassword: 'NewPassword1' });
  assert.equal(done.elements.resetDoneSection.hidden, false);
  assert.equal(done.elements.resetPassword.value, '');

  const mismatch = await scenario({ fetch: csrfOr(async () => { throw new Error('must not post'); }) });
  mismatch.elements.resetPassword.value = 'NewPassword1';
  mismatch.elements.resetConfirm.value = 'Different1';
  await submit(mismatch.elements.resetForm);
  assert.match(mismatch.elements.resetMsg.textContent, /do not match/);

  const short = await scenario({ fetch: csrfOr(async () => { throw new Error('must not post'); }) });
  short.elements.resetPassword.value = 'abc';
  short.elements.resetConfirm.value = 'abc';
  await submit(short.elements.resetForm);
  assert.match(short.elements.resetMsg.textContent, /at least 8/);

  console.log('dead links and retryable errors');
  const expired = await scenario({ fetch: csrfOr(async () => response(400, { ok: false, error: 'This reset link has expired.' })) });
  expired.elements.resetPassword.value = 'NewPassword1';
  expired.elements.resetConfirm.value = 'NewPassword1';
  await submit(expired.elements.resetForm);
  assert.equal(expired.elements.resetNewLinkSection.hidden, false, 'an expired link offers a new one');
  assert.match(expired.elements.newLinkMsg.textContent, /expired/);

  const used = await scenario({ fetch: csrfOr(async () => response(400, { ok: false, error: 'This reset link has already been used.' })) });
  used.elements.resetPassword.value = 'NewPassword1';
  used.elements.resetConfirm.value = 'NewPassword1';
  await submit(used.elements.resetForm);
  assert.equal(used.elements.resetNewLinkSection.hidden, false);

  const limited = await scenario({ fetch: csrfOr(async () => response(429, { ok: false, error: 'Too many requests.' })) });
  limited.elements.resetPassword.value = 'NewPassword1';
  limited.elements.resetConfirm.value = 'NewPassword1';
  await submit(limited.elements.resetForm);
  assert.equal(limited.elements.resetNewLinkSection.hidden, true, 'a rate limit keeps the form');
  assert.match(limited.elements.resetMsg.textContent, /too many attempts/i);
  assert.equal(limited.elements.resetSubmit.disabled, false);

  const server = await scenario({ fetch: csrfOr(async () => response(503, { ok: false, error: 'x' })) });
  server.elements.resetPassword.value = 'NewPassword1';
  server.elements.resetConfirm.value = 'NewPassword1';
  await submit(server.elements.resetForm);
  assert.match(server.elements.resetMsg.textContent, /temporarily unavailable/);
  assert.equal(server.elements.resetNewLinkSection.hidden, true);

  const offline = await scenario({ fetch: async () => { throw new Error('offline'); } });
  offline.elements.resetPassword.value = 'NewPassword1';
  offline.elements.resetConfirm.value = 'NewPassword1';
  await submit(offline.elements.resetForm);
  assert.match(offline.elements.resetMsg.textContent, /could not reach the server/i);
  assert.ok(!offline.elements.resetMsg.textContent.includes('secret-token'));

  console.log('request a new reset link');
  const forgot = [];
  const req = await scenario({ search: '', fetch: csrfOr(async (url, options) => { forgot.push({ url, options }); return response(200, { ok: true }); }) });
  req.elements.forgotEmail.value = 'player@example.com';
  await submit(req.elements.forgotForm);
  const f = forgot.find((c) => c.url === '/api/auth/forgot-password');
  assert.ok(f, 'the forgot-password endpoint is called');
  assert.deepEqual(JSON.parse(f.options.body), { email: 'player@example.com' });
  assert.match(req.elements.forgotMsg.textContent, /if an account with that email exists/i);
  assert.equal(req.elements.forgotEmail.value, '');

  console.log('markup');
  assert.match(html, /<script src="\/reset-password\.js" defer><\/script>/);
  assert.doesNotMatch(html, /app\.js|table-ui|voice\.js|home-ui/, 'the reset page loads none of the game scripts');
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /<form id="forgotForm" class="reset-form">/, 'the new-link form keeps browser email validation');

  console.log('All reset-password frontend behavior tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
