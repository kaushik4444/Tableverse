'use strict';

(async function () {
  const loadingEl = document.getElementById('verifyLoading');
  const successEl = document.getElementById('verifySuccess');
  const errorEl = document.getElementById('verifyError');
  const errorTitleEl = document.getElementById('errorTitle');
  const errorMsgEl = document.getElementById('errorMsg');

  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  if (!token) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorTitleEl.textContent = 'Missing token';
    errorMsgEl.textContent = 'No verification token was provided in the link.';
    return;
  }

  try {
    // Fetch CSRF token first
    let csrfToken = '';
    try {
      const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const csrfData = await csrfRes.json();
      if (csrfData && csrfData.csrfToken) csrfToken = csrfData.csrfToken;
    } catch {
      // Ignore CSRF fetch error if API handles or doesn't strictly require for this call
    }

    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
      },
      credentials: 'same-origin',
      body: JSON.stringify({ token })
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      // non-JSON response
    }

    if (res.ok && data.ok) {
      loadingEl.hidden = true;
      successEl.hidden = false;
    } else {
      loadingEl.hidden = true;
      errorEl.hidden = false;
      errorTitleEl.textContent = 'Verification failed';
      errorMsgEl.textContent = data.error || 'The verification link is invalid, expired, or has already been used.';
    }
  } catch (err) {
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorTitleEl.textContent = 'Connection error';
    errorMsgEl.textContent = 'Could not reach the server. Please check your connection and try again.';
  }
})();
