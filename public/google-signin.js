/* Sign in with Google (Google Identity Services). Loaded only when the server says it is configured: nothing is requested from
   Google otherwise. The page asks the server for the client ID and a nonce, shows Google's button, and hands the ID token it
   receives back to app.js, which sends it to the server. The server checks the token; nothing here is trusted. */
(function () {
  'use strict';
  const SRC = 'https://accounts.google.com/gsi/client';
  let config = null; // { enabled, clientId, nonce } once fetched
  let loading = null;

  async function fetchConfig() {
    try {
      const r = await fetch('/api/auth/google/config', { credentials: 'same-origin' });
      const c = await r.json();
      config = c && c.enabled && c.clientId && c.nonce ? c : { enabled: false };
    } catch { config = { enabled: false }; }
    return config;
  }

  function loadScript() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC; s.async = true; s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => { loading = null; reject(new Error('Google sign-in could not be loaded.')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  /** True when the server offers it. Asked once per page load. */
  async function available() { return (config || (await fetchConfig())).enabled === true; }

  /** Puts Google's button into `el`. `onCredential(idToken)` runs when the person finishes Google's own dialog. */
  async function mount(el, onCredential, onError) {
    try {
      const c = await fetchConfig(); // fresh each time: the nonce follows this browser's CSRF cookie, which can be replaced
      if (!c.enabled || !el || !el.isConnected) return false;
      await loadScript();
      const id = window.google.accounts.id;
      // a new nonce is fetched when the page's CSRF cookie changed since: the server only accepts tokens minted for this browser
      id.initialize({ client_id: c.clientId, nonce: c.nonce, callback: (resp) => { if (resp && resp.credential) onCredential(resp.credential); }, auto_select: false, cancel_on_tap_outside: true, itp_support: true });
      const width = Math.min(320, Math.max(200, el.clientWidth || 280));
      id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'left', width });
      return true;
    } catch (err) { if (onError) onError(err); return false; }
  }

  /** The nonce must match the CSRF cookie, which can be replaced; refetch before mounting after a sign-out. */
  function reset() { config = null; }

  window.TvGoogle = { available, mount, reset };
})();
