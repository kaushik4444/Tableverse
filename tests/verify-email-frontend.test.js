'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'verify-email.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'verify-email.html'), 'utf8');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

async function scenario({ search = '?token=secret-token', fetch }) {
  const elements = Object.fromEntries(
    ['verifyLoading', 'verifySuccess', 'verifyError', 'successTitle', 'errorTitle', 'errorMsg', 'verifyRetry']
      .map((id) => [id, { hidden: id !== 'verifyLoading', textContent: '', handler: null, focused: false, focus() { this.focused = true; }, addEventListener(type, fn) { if (type === 'click') this.handler = fn; } }])
  );
  const historyCalls = [];
  const location = { search, pathname: '/verify-email.html' };
  const window = {};
  const context = {
    document: { getElementById(id) { return elements[id]; } },
    location,
    history: { replaceState(...args) { historyCalls.push(args); } },
    URLSearchParams,
    fetch,
    window,
  };
  vm.runInNewContext(script, context, { filename: 'verify-email.js' });
  await window.__tableverseVerification;
  return { elements, historyCalls, location };
}

async function main() {
  // Successful verification obtains CSRF first and sends the exact token/header.
  const calls = [];
  const ok = await scenario({ fetch: async (url, options = {}) => {
    calls.push({ url, options });
    return url.endsWith('/csrf') ? response(200, { csrfToken: 'csrf-value' }) : response(200, { ok: true });
  } });
  assert.equal(ok.elements.verifySuccess.hidden, false);
  assert.equal(ok.elements.verifyLoading.hidden, true);
  assert.equal(ok.elements.successTitle.focused, true);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="successTitle" tabindex="-1"/);
  assert.doesNotMatch(html, /animation:\s*spin\s+0\.8s/);
  assert.equal(ok.historyCalls.length, 1);
  assert.deepEqual(ok.historyCalls[0], [null, '', '/verify-email.html']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/auth/csrf');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[1].url, '/api/auth/verify-email');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-value');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[1].options.body), { token: 'secret-token' });

  // Missing token produces a useful terminal state and makes no request.
  let missingCalls = 0;
  const missing = await scenario({ search: '', fetch: async () => { missingCalls++; throw new Error('must not fetch'); } });
  assert.equal(missing.elements.verifyError.hidden, false);
  assert.equal(missing.elements.errorTitle.textContent, 'Missing token');
  assert.equal(missing.elements.errorTitle.focused, true);
  assert.equal(missing.elements.verifyRetry.hidden, true);
  assert.equal(missing.historyCalls.length, 0);
  assert.equal(missingCalls, 0);

  // Invalid/expired token is not retryable; a fresh email is needed.
  const invalid = await scenario({ fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(400, { ok: false, error: 'Verification token expired' }) });
  assert.equal(invalid.elements.errorTitle.textContent, 'Verification failed');
  assert.equal(invalid.elements.errorMsg.textContent, 'Verification token expired');
  assert.equal(invalid.elements.verifyRetry.hidden, true);

  // CSRF setup failure never sends the protected verification POST; retry can recover.
  let csrfAttempts = 0;
  let verifyAttempts = 0;
  const csrfFailure = await scenario({ fetch: async (url) => {
    if (url.endsWith('/csrf')) {
      csrfAttempts++;
      return csrfAttempts === 1 ? response(503, {}) : response(200, { csrfToken: 'csrf-retry' });
    }
    verifyAttempts++;
    return response(200, { ok: true });
  } });
  assert.equal(csrfFailure.elements.errorTitle.textContent, 'Could not start verification');
  assert.equal(csrfFailure.elements.verifyRetry.hidden, false);
  await csrfFailure.elements.verifyRetry.handler();
  assert.equal(csrfAttempts, 2);
  assert.equal(verifyAttempts, 1);
  assert.equal(csrfFailure.elements.verifySuccess.hidden, false);

  // A missing CSRF token is also treated as a retryable setup failure.
  const csrfMissing = await scenario({ fetch: async () => response(200, {}) });
  assert.equal(csrfMissing.elements.verifyRetry.hidden, false);

  // Network errors are retryable and do not expose the token in the UI.
  const network = await scenario({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(network.elements.errorTitle.textContent, 'Connection error');
  assert.equal(network.elements.verifyRetry.hidden, false);
  assert.ok(!network.elements.errorMsg.textContent.includes('secret-token'));

  // Transient server errors are retryable.
  const server = await scenario({ fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(503, { error: 'Temporarily unavailable' }) });
  assert.equal(server.elements.errorMsg.textContent, 'Temporarily unavailable');
  assert.equal(server.elements.verifyRetry.hidden, false);

  console.log('All verify-email frontend behavior tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
