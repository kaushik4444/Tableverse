'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const formSection = $('resetFormSection');
  const doneSection = $('resetDoneSection');
  const newLinkSection = $('resetNewLinkSection');
  const newLinkTitle = $('newLinkTitle');
  const newLinkMsg = $('newLinkMsg');
  const resetForm = $('resetForm');
  const resetPassword = $('resetPassword');
  const resetConfirm = $('resetConfirm');
  const resetSubmit = $('resetSubmit');
  const resetMsg = $('resetMsg');
  const forgotForm = $('forgotForm');
  const forgotEmail = $('forgotEmail');
  const forgotSubmit = $('forgotSubmit');
  const forgotMsg = $('forgotMsg');

  // The one-time token lives only in memory; take it out of the address bar and history straight away.
  const token = new URLSearchParams(location.search).get('token');
  if (location.search) history.replaceState(null, '', location.pathname);

  function show(section) {
    [formSection, doneSection, newLinkSection].forEach((el) => { el.hidden = el !== section; });
  }

  // Maps a failed response to what the person should do next. Only a dead link sends them to ask for a new one.
  function explain(status, message) {
    if (status === 429) return { retryable: true, text: 'Too many attempts. Please wait a moment and try again.' };
    if (status >= 500 || status === 0) return { retryable: true, text: 'The service is temporarily unavailable. Please try again.' };
    if (typeof message === 'string' && /expired|already been used|invalid reset token/i.test(message)) return { retryable: false, text: message };
    return { retryable: true, text: typeof message === 'string' && message ? message : 'Could not update the password. Please try again.' };
  }

  async function postJson(url, body) {
    const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    if (!csrfRes.ok) return { ok: false, status: csrfRes.status, error: '' };
    const csrfData = await csrfRes.json().catch(() => null);
    const csrfToken = csrfData && typeof csrfData.csrfToken === 'string' ? csrfData.csrfToken : '';
    if (!csrfToken) return { ok: false, status: 0, error: '' };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, error: data.error || '' };
  }

  function showNewLink(title, message) {
    newLinkTitle.textContent = title;
    newLinkMsg.textContent = message;
    show(newLinkSection);
    newLinkTitle.focus();
  }

  if (!token) {
    showNewLink('This reset link is incomplete', 'The link did not include its code. Enter your account email and we\'ll send a new reset link.');
    forgotForm.addEventListener('submit', requestNewLink);
    return;
  }

  show(formSection);
  $('resetTitle').focus();

  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    resetMsg.hidden = false;
    const password = resetPassword.value;
    if (password.length < 8) { resetMsg.textContent = 'Use at least 8 characters.'; return; }
    if (password !== resetConfirm.value) { resetMsg.textContent = 'The two passwords do not match.'; return; }
    resetSubmit.disabled = true;
    resetMsg.textContent = 'Updating…';
    try {
      // The token is sent only in the request body; it is never shown or logged.
      const out = await postJson('/api/auth/reset-password', { token, newPassword: password });
      if (out.ok) {
        resetPassword.value = '';
        resetConfirm.value = '';
        show(doneSection);
        $('doneTitle').focus();
        return;
      }
      const verdict = explain(out.status, out.error);
      if (verdict.retryable) {
        resetMsg.textContent = verdict.text;
      } else {
        showNewLink('This reset link can\'t be used', verdict.text + ' Enter your account email and we\'ll send a new reset link.');
      }
    } catch {
      resetMsg.textContent = 'Could not reach the server. Check your connection and try again.';
    } finally {
      resetSubmit.disabled = false;
    }
  });

  async function requestNewLink(event) {
    event.preventDefault();
    const email = String(forgotEmail.value || '').trim();
    forgotMsg.hidden = false;
    if (!email) { forgotMsg.textContent = 'Enter the email address you signed up with.'; return; }
    forgotSubmit.disabled = true;
    forgotMsg.textContent = 'Sending…';
    try {
      const out = await postJson('/api/auth/forgot-password', { email });
      if (out.status === 429) forgotMsg.textContent = 'Too many requests. Please wait a while before asking again.';
      else if (!out.ok) forgotMsg.textContent = 'We could not send a new link right now. Please try again in a moment.';
      else { forgotMsg.textContent = 'If an account with that email exists, a reset link has been sent. Check your inbox and spam folder.'; forgotEmail.value = ''; }
    } catch {
      forgotMsg.textContent = 'Could not reach the server. Check your connection and try again.';
    } finally {
      forgotSubmit.disabled = false;
    }
  }
  forgotForm.addEventListener('submit', requestNewLink);
})();
