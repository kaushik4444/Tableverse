'use strict';

(async function () {
  const loadingEl = document.getElementById('verifyLoading');
  const successEl = document.getElementById('verifySuccess');
  const errorEl = document.getElementById('verifyError');
  const errorTitleEl = document.getElementById('errorTitle');
  const errorMsgEl = document.getElementById('errorMsg');
  const retryEl = document.getElementById('verifyRetry');

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
        return;
      }

      const message = data && typeof data.error === 'string'
        ? data.error
        : 'The verification link is invalid, expired, or has already been used.';
      // Client/token errors need a new email; transient server errors can be retried.
      const retryable = res.status >= 500 || res.status === 429;
      showError('Verification failed', message, retryable);
    } catch {
      showError('Connection error', 'Could not reach the server. Check your connection and try again.', true);
    }
  }

  retryEl.addEventListener('click', verify);
  window.__tableverseVerification = verify();
})();
