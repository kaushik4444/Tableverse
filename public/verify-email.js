'use strict';

(async function () {
  const loadingEl = document.getElementById('verifyLoading');
  const successEl = document.getElementById('verifySuccess');
  const errorEl = document.getElementById('verifyError');
  const errorTitleEl = document.getElementById('errorTitle');
  const errorMsgEl = document.getElementById('errorMsg');
  const retryEl = document.getElementById('verifyRetry');
  const successTitleEl = document.getElementById('successTitle');
  const resendForm = document.getElementById('resendForm');
  const resendEmailEl = document.getElementById('resendEmail');
  const resendSubmitEl = document.getElementById('resendSubmit');
  const resendMsgEl = document.getElementById('resendMsg');

  const token = new URLSearchParams(location.search).get('token');

  // Keep the one-time token only in memory; do not leave it in the address bar/history.
  if (token) history.replaceState(null, '', location.pathname);

  function showError(title, message, retryable) {
    loadingEl.hidden = true;
    successEl.hidden = true;
    errorEl.hidden = false;
    errorTitleEl.textContent = title;
    errorMsgEl.textContent = message;
    retryEl.hidden = !retryable;
    // Expired, used, invalid or missing links cannot be retried, so offer a new link instead.
    resendForm.hidden = retryable;
    resendMsgEl.hidden = true;
    errorTitleEl.focus();
  }

  async function verify() {
    if (!token) {
      showError('Missing token', 'No verification token was provided in the link.', false);
      return;
    }

    loadingEl.hidden = false;
    successEl.hidden = true;
    errorEl.hidden = true;
    retryEl.hidden = true;
    resendForm.hidden = true;

    try {
      const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!csrfRes.ok) {
        showError('Could not start verification', 'We could not establish a secure connection. Please try again.', true);
        return;
      }

      let csrfData;
      try {
        csrfData = await csrfRes.json();
      } catch {
        csrfData = null;
      }
      const csrfToken = csrfData && typeof csrfData.csrfToken === 'string' ? csrfData.csrfToken : '';
      if (!csrfToken) {
        showError('Could not start verification', 'The security check could not be completed. Please try again.', true);
        return;
      }

      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'same-origin',
        body: JSON.stringify({ token })
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // A non-JSON response is handled below using the HTTP status.
      }

      if (res.ok && data && data.ok) {
        loadingEl.hidden = true;
        errorEl.hidden = true;
        successEl.hidden = false;
        successTitleEl.focus();
        return;
      }

      const serverUnavailable = res.status >= 500;
      const rateLimited = res.status === 429;
      const csrfRejected = res.status === 403
        && data && typeof data.error === 'string'
        && data.error.toLowerCase().includes('csrf');

      // A proxy may return HTML/plain text for 502/503/429, so do not label
      // those responses as an invalid verification link.
      const retryable = serverUnavailable || rateLimited || csrfRejected;
      const message = serverUnavailable
        ? 'The verification service is temporarily unavailable. Please try again.'
        : rateLimited
          ? 'Too many attempts. Please wait a moment and try again.'
          : csrfRejected
            ? 'The security check expired. Please try again.'
            : data && typeof data.error === 'string'
              ? data.error
              : 'The verification link is invalid, expired, or has already been used.';
      showError(retryable ? 'Temporary verification problem' : 'Verification failed', message, retryable);
    } catch {
      showError('Connection error', 'Could not reach the server. Check your connection and try again.', true);
    }
  }

  // Same answer whether or not the address has an account (the server never reveals which do), so this only confirms receipt.
  const RESEND_DONE = 'If an account with that email needs verifying, a new link has been sent. Check your inbox and spam folder.';

  async function requestNewLink(event) {
    event.preventDefault();
    const email = String(resendEmailEl.value || '').trim();
    resendMsgEl.hidden = false;
    if (!email) {
      resendMsgEl.textContent = 'Enter the email address you signed up with.';
      return;
    }
    resendSubmitEl.disabled = true;
    resendMsgEl.textContent = 'Sending…';
    try {
      const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!csrfRes.ok) {
        resendMsgEl.textContent = csrfRes.status === 429
          ? 'Too many requests. Please wait a while before asking for another link.'
          : 'We could not send a new link right now. Please try again in a moment.';
        return;
      }
      const csrfData = await csrfRes.json().catch(() => null);
      const csrfToken = csrfData && typeof csrfData.csrfToken === 'string' ? csrfData.csrfToken : '';
      if (!csrfToken) {
        resendMsgEl.textContent = 'The security check could not be completed. Please try again.';
        return;
      }
      // The token is never read or logged here; only the address the person typed is sent.
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify({ email })
      });
      if (res.status === 429) {
        resendMsgEl.textContent = 'Too many requests. Please wait a while before asking for another link.';
      } else if (!res.ok) {
        resendMsgEl.textContent = 'We could not send a new link right now. Please try again in a moment.';
      } else {
        resendMsgEl.textContent = RESEND_DONE;
        resendEmailEl.value = '';
      }
    } catch {
      resendMsgEl.textContent = 'Could not reach the server. Check your connection and try again.';
    } finally {
      resendSubmitEl.disabled = false;
    }
  }

  retryEl.addEventListener('click', verify);
  resendForm.addEventListener('submit', requestNewLink);
  window.__tableverseVerification = verify();
})();
