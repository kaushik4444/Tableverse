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

async function scenario({ search = '?token=secret-token', fetch, waitForInitial = true }) {
  const elements = Object.fromEntries(
    ['verifyLoading', 'verifySuccess', 'verifyError', 'successTitle', 'errorTitle', 'errorMsg', 'verifyRetry', 'resendForm', 'resendEmail', 'resendSubmit', 'resendMsg']
      .map((id) => [id, { hidden: id !== 'verifyLoading', value: '', disabled: false, textContent: '', handler: null, listeners: {}, focused: false, focus() { this.focused = true; }, addEventListener(type, fn) { this.listeners[type] = fn; if (type === 'click') this.handler = fn; } }])
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
  const completion = window.__tableverseVerification;
  if (waitForInitial) await completion;
  return { elements, historyCalls, location, completion };
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

  // The loading state remains visible while the initial CSRF request is pending.
  let releaseCsrf;
  let pendingPost = null;
  const pending = await scenario({
    waitForInitial: false,
    fetch: async (url, options = {}) => {
      if (url.endsWith('/csrf')) return new Promise((resolve) => { releaseCsrf = resolve; });
      pendingPost = { url, options };
      return response(200, { ok: true });
    }
  });
  assert.equal(pending.elements.verifyLoading.hidden, false);
  assert.equal(pending.elements.verifySuccess.hidden, true);
  assert.equal(pending.elements.verifyError.hidden, true);
  assert.equal(pending.historyCalls.length, 1);
  releaseCsrf(response(200, { csrfToken: 'pending-csrf' }));
  await pending.completion;
  assert.equal(pending.elements.verifySuccess.hidden, false);
  assert.equal(pendingPost.url, '/api/auth/verify-email');
  assert.equal(pendingPost.options.headers['X-CSRF-Token'], 'pending-csrf');
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

  // Non-JSON proxy failures must be presented as temporary, retryable service errors.
  for (const status of [429, 502, 503]) {
    const transient = await scenario({ fetch: async (url) => url.endsWith('/csrf')
      ? response(200, { csrfToken: 'csrf-value' })
      : { ok: false, status, async json() { throw new Error('not JSON'); } } });
    assert.equal(transient.elements.errorTitle.textContent, 'Temporary verification problem');
    assert.equal(transient.elements.verifyRetry.hidden, false);
    assert.match(transient.elements.errorMsg.textContent, /temporarily|wait a moment/i);
  }

  // A stale shared CSRF cookie can produce 403 without consuming the email token.
  // Retry fetches the current cookie/header pair and resubmits the same email token.
  let csrf403Fetches = 0;
  let verify403Posts = 0;
  const csrf403 = await scenario({ fetch: async (url, options = {}) => {
    if (url.endsWith('/csrf')) {
      csrf403Fetches++;
      return response(200, { csrfToken: csrf403Fetches === 1 ? 'stale-csrf' : 'fresh-csrf' });
    }
    verify403Posts++;
    assert.deepEqual(JSON.parse(options.body), { token: 'secret-token' });
    if (verify403Posts === 1) return response(403, { error: 'Invalid CSRF token.' });
    assert.equal(options.headers['X-CSRF-Token'], 'fresh-csrf');
    return response(200, { ok: true });
  } });
  assert.equal(csrf403.elements.verifyRetry.hidden, false);
  assert.match(csrf403.elements.errorMsg.textContent, /security check expired/i);
  await csrf403.elements.verifyRetry.handler();
  assert.equal(csrf403Fetches, 2);
  assert.equal(verify403Posts, 2);
  assert.equal(csrf403.elements.verifySuccess.hidden, false);

  const forbidden = await scenario({ fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(403, { error: 'Forbidden' }) });
  assert.equal(forbidden.elements.verifyRetry.hidden, true);
  assert.equal(forbidden.elements.errorMsg.textContent, 'Forbidden');

  // Network errors are retryable and do not expose the token in the UI.
  const network = await scenario({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(network.elements.errorTitle.textContent, 'Connection error');
  assert.equal(network.elements.verifyRetry.hidden, false);
  assert.ok(!network.elements.errorMsg.textContent.includes('secret-token'));

  // Transient server errors are retryable.
  const server = await scenario({ fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(503, { error: 'Temporarily unavailable' }) });
  assert.equal(server.elements.errorMsg.textContent, 'The verification service is temporarily unavailable. Please try again.');
  assert.equal(server.elements.verifyRetry.hidden, false);

  // An expired, used or invalid link cannot be retried, so the form for a new link is offered instead.
  const expired = await scenario({ fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(400, { ok: false, error: 'This verification link has expired.' }) });
  assert.equal(expired.elements.errorMsg.textContent, 'This verification link has expired.');
  assert.equal(expired.elements.verifyRetry.hidden, true);
  assert.equal(expired.elements.resendForm.hidden, false);
  assert.equal(expired.elements.resendMsg.hidden, true);

  // A retryable error keeps the retry button and hides the resend form.
  const transientForm = await scenario({ fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(503, { error: 'Temporarily unavailable' }) });
  assert.equal(transientForm.elements.resendForm.hidden, true);

  // A missing token offers the resend form as well.
  const noToken = await scenario({ search: '', fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal(noToken.elements.resendForm.hidden, false);

  // Submitting the form fetches CSRF, posts only the typed email with the header, and shows one neutral message.
  const sent = [];
  const resend = await scenario({ search: '', fetch: async (url, options = {}) => {
    sent.push({ url, options });
    return url.endsWith('/csrf') ? response(200, { csrfToken: 'csrf-value' }) : response(200, { ok: true, message: 'If this account exists, a verification email has been sent.' });
  } });
  resend.elements.resendEmail.value = '  Player@Example.com ';
  await resend.elements.resendForm.listeners.submit({ preventDefault() {} });
  const post = sent.find((c) => c.url === '/api/auth/resend-verification');
  assert.ok(post, 'the resend endpoint is called');
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.headers['X-CSRF-Token'], 'csrf-value');
  assert.deepEqual(JSON.parse(post.options.body), { email: 'Player@Example.com' });
  assert.equal(resend.elements.resendMsg.hidden, false);
  assert.match(resend.elements.resendMsg.textContent, /a new link has been sent/i);
  assert.equal(resend.elements.resendEmail.value, '');
  assert.equal(resend.elements.resendSubmit.disabled, false);

  // An empty address is refused without a request.
  const empty = await scenario({ search: '', fetch: async () => { throw new Error('must not fetch'); } });
  await empty.elements.resendForm.listeners.submit({ preventDefault() {} });
  assert.match(empty.elements.resendMsg.textContent, /enter the email/i);

  // Rate limiting and server errors get their own messages, and the button is re-enabled.
  const limited = await scenario({ search: '', fetch: async (url) => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'csrf-value' })
    : response(429, { ok: false, error: 'Too many requests.' }) });
  limited.elements.resendEmail.value = 'a@example.com';
  await limited.elements.resendForm.listeners.submit({ preventDefault() {} });
  assert.match(limited.elements.resendMsg.textContent, /too many requests/i);
  assert.equal(limited.elements.resendSubmit.disabled, false);

  // A network failure shows a retry message and never echoes the address or token.
  const offline = await scenario({ search: '?token=secret-token', fetch: async (url) => {
    if (url.endsWith('/csrf')) return response(200, { csrfToken: 'csrf-value' });
    throw new Error('offline');
  } });
  offline.elements.resendEmail.value = 'private@example.com';
  await offline.elements.resendForm.listeners.submit({ preventDefault() {} });
  assert.match(offline.elements.resendMsg.textContent, /could not reach the server/i);
  assert.ok(!offline.elements.resendMsg.textContent.includes('private@example.com'));
  assert.ok(!offline.elements.resendMsg.textContent.includes('secret-token'));

  assert.match(html, /id="resendForm"/);
  assert.match(html, /type="email"[^>]*required/);

  console.log('All verify-email frontend behavior tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
