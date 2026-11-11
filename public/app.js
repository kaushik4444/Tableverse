/* Card Table client: connection, home, lobby. Games render themselves via CardTable.register(). */
(() => {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  // Older versions kept a bearer token here. The session is now an HttpOnly cookie, so the old value is never used: delete it.
  store.remove('ct_token');
  store.remove('ct_recent'); // recent tables used to be kept per browser; they now live on the account
  store.remove('ct_ann_ids'); // guest banner dismissals before revisions (id and text): never read again

  const $app = document.getElementById('app');
  const $banner = document.getElementById('banner');
  const $toasts = document.getElementById('toasts');

  const S = {
    id: null,
    token: '', // short-lived websocket auth credential (never persisted)
    csrf: '', // fetched from the server (cookie-backed), never stored
    emailVerified: false,
    email: '',
    name: store.get('ct_name') || '',
    username: store.get('ct_username') || '',
    games: [],
    room: null,
    view: null,
    ready: false,
    draftCode: '',
    avatar: store.get('ct_avatar') || '',
    avatars: [],
    emotes: [],
    named: !!store.get('ct_name'),
    chat: [],
    chatOpen: false,
    reportMenuFor: null, // message id whose report reason menu is open; kept in state so redraws keep it
    unread: 0,
    skew: 0, // server clock minus this device's clock, for the turn countdown
    announcement: '',
    banners: [], // managed announcements from /api/announcements (server decides schedule, audience and dismissals)
    isStaff: false, // a hint for showing the menu entry only; the server checks the role on every admin request
    dismissedAnnouncement: store.get('ct_ann'), // the text that was dismissed, so a changed announcement shows again
    recentTables: [], // the signed-in player's recent tables, from the server (follow the account across devices)
    friends: [],
    friendRequests: { incoming: [], outgoing: [] },
    invitations: { incoming: [], outgoing: [] },
    socialLoading: false,
    socialError: '',
    socialNotice: '',
    friendSearch: [],
    friendSearchBusy: false,
    inviteFriendOptions: '',
    friendQuery: '',
    page: 'home', // 'home' | 'profile' | 'player' (a public profile); the table and game screens take over while a room is open
    profile: null, // own profile page: { loading, error, data, tab, history }
    player: null, // a public profile page: { username, loading, error, data }
    publicTables: [],
    rejoin: [], // running games where a bot is playing this player's seat
    avatarOpen: false,
    pendingModalTarget: null, // player id acted on by an open modal (make host / kick)
    menuOpen: false, // the account dropdown in the top bar
    bellOpen: false, // the notifications dropdown in the top bar
    toolsOpen: false, // the "more" menu in a game's toolbar
    wnSeen: store.get('ct_wn_seen') || '', // the last What's new version this person opened
    createVisibility: 'private',
    sessionListOpen: store.get('ct_sessions_open') !== '0',
    guest: false, // true when the home screen is the public snapshot (no socket, no session)
    signingIn: false, // logged in on the server, waiting for the socket's welcome: the top bar shows the profile and taps are blocked
    auth: null, // the open auth sheet: 'login' or 'register'
    requireEmailVerification: true, // current server policy; secure default until the server says otherwise
    pending: [], // play actions that wait for a successful login, then run once the lobby opens
  };
  const plugins = {};
  let ws = null;
  let retry = 0;
  let loginBusy = false;
  let wasMyTurn = false;
  let nameTimer = null;

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    $toasts.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /**
   * One line of a game log, the same for every game. Engines log { by, card }: Wizard writes whole sentences under
   * "System" (the names are already inside), the other games put the actor in `by` and only the action in `card`
   * ("played 12", "folds", "bids 16"). Showing `card` alone is what dropped the names.
   */
  const logLine = (e) => {
    const text = String((e && (e.card || e.text)) || '').trim();
    const by = String((e && e.by) || '').trim();
    if (!by || by === 'System' || by === 'Table' || text.startsWith(by)) return text;
    return `${by} ${text}`;
  };


  // This node lives outside #app, whose innerHTML is replaced on every game update.
  // Keeping it mounted lets assistive technology observe text changes reliably.
  function announceStatus(text) {
    let node = document.getElementById('game-status-announcer');
    if (!node) {
      node = document.createElement('div');
      node.id = 'game-status-announcer';
      node.className = 'game-status-announcer';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.setAttribute('aria-atomic', 'true');
      document.body.appendChild(node);
    }
    const next = String(text || '').trim();
    if (node.textContent !== next) node.textContent = next;
  }

  const isSpectator = () => !!(S.room && (S.room.spectators || []).some((s) => s.id === S.id));

  window.CardTable = Object.assign(window.CardTable || {}, {
    esc,
    toast,
    register: (id, p) => { plugins[id] = p; },
    announceStatus,
    chat: {
      button: () => `<button class="btn ghost small chat-btn" data-act="chat" aria-label="Open chat">💬<span class="cb" ${S.unread ? '' : 'hidden'}>${S.unread}</span></button>`,
    },
    // Shared toolbar seed: sound, chat, reactions, game-specific controls, then leave.
    toolbarSeed: (midHTML, leaveKey, cls) => `<div class="${cls || 'row'}"${cls ? '' : ' style="gap:6px"'}>${window.CardTable.sound.button()}${window.CardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button>${midHTML}<button class="btn ghost small" data-${leaveKey}="leave" aria-label="Leave table">✕</button></div>`,
  });

  const gameMeta = (id) => S.games.find((g) => g.id === id);
  const inviteUrl = () => `${location.origin}/#${S.room.code}`;
  const safeTableUrl = () => S.room && S.room.visibility === 'public' ? inviteUrl() : `${location.origin}/`;

  // ------------------------------------------------------------ rules dialog
  function showRules(gameId) {
    const g = gameMeta(gameId);
    if (!g) return;
    const variants = (g.options || [])
      .filter((o) => (o.type === 'select' || o.desc) && !o.noRules)
      .map((o) => {
        if (o.type === 'boolean') return `<dt>${esc(o.label)}</dt><dd>${esc(o.desc)}</dd>`;
        return o.choices.filter((c) => c.value !== o.default || o.choices.length > 2).map((c) => `<dt>${esc(o.label)}: ${esc(c.label)}</dt><dd>${esc(c.desc)}</dd>`).join('');
      })
      .join('');
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="sheet" role="dialog" aria-label="How to play ${esc(g.name)}">
      <h2>${esc(g.icon)} How to play ${esc(g.name)}</h2>
      ${(g.rules || []).map((p) => `<p class="rule">${esc(p)}</p>`).join('')}
      ${variants ? `<h3 style="margin:16px 0 6px">Options</h3><dl class="variants">${variants}</dl>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn" data-close="1">Got it</button></div></div>`;
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
    document.body.appendChild(el);
  }
  window.CardTable.showRules = showRules;

  // ------------------------------------------------------------ auth + connection
  // Every click that waits on the server puts up a spinner that blocks all other taps until the answer arrives.
  // Socket messages (table actions) clear it when the server answers; HTTP actions use withBusy().
  const BUSY_LABELS = {
    join: 'Joining table…', create: 'Creating your table…', start: 'Starting the game…', rematch: 'Setting up another game…', sit: 'Taking your seat…', leave: 'Leaving…',
    addBot: 'Adding a bot…', removeBot: 'Removing the bot…', setSeats: 'Updating seats…', setOptions: 'Saving table options…', setVisibility: 'Updating the table…',
    makeHost: 'Making them the host…', kick: 'Removing the player…', block: 'Blocking…', unblock: 'Unblocking…', report: 'Sending your report…',
  };
  // Quick table tweaks: if the server somehow stays silent, give up sooner than for joining or starting a game.
  const BUSY_FAST = new Set(['addBot', 'removeBot', 'setSeats', 'setOptions', 'setVisibility', 'makeHost', 'kick', 'block', 'unblock', 'report']);
  const BUSY_MOD = new Set(['block', 'unblock', 'report']); // answered with a 'notice' or 'blocks' message instead of a new table state
  let busyTimer = null;
  let busyKind = '';
  let httpBusy = 0; // HTTP actions in flight: socket messages must not take their spinner away
  let httpBusyEpoch = 0;
  let busyFocus = null;
  const inerted = [];
  function showBusy(label, ms = 20000, kind = '') {
    let el = document.getElementById('busyBlock');
    if (!el) {
      el = document.createElement('div');
      el.id = 'busyBlock'; el.className = 'busy-block'; el.setAttribute('role', 'alert'); el.setAttribute('aria-live', 'assertive');
      el.innerHTML = '<div class="busy-card"><span class="busy-spin" aria-hidden="true"></span><b></b></div>';
      document.body.appendChild(el);
    }
    el.querySelector('b').textContent = label;
    busyKind = kind;
    // Nothing behind the spinner can be tapped, tabbed to or typed into: the app, open dialogs, the chat panel.
    // Chat block/report act in place on the open chat, which keeps keyboard focus on the button the person used, so they
    // get the spinner (taps are blocked) but are not made inert.
    if (!inerted.length && !BUSY_MOD.has(kind)) {
      busyFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      for (const n of document.body.children) {
        if (n === el || n.id === 'toasts' || n.id === 'banner' || n.tagName === 'SCRIPT' || n.hasAttribute('inert')) continue;
        n.setAttribute('inert', '');
        inerted.push(n);
      }
    }
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => {
      const wasSigningIn = S.signingIn;
      if (httpBusy) { httpBusy = 0; httpBusyEpoch++; }
      S.signingIn = false;
      hideBusy();
      toast('That is taking longer than usual. Check your connection and try again.');
      if (wasSigningIn) render(); // back to Log in / Sign up if the sign-in never finished
    }, ms);
  }
  function hideBusy() {
    clearTimeout(busyTimer);
    busyKind = '';
    const el = document.getElementById('busyBlock');
    if (el) el.remove();
    for (const n of inerted.splice(0)) n.removeAttribute('inert');
    // an inert subtree drops keyboard focus: give it back before the next redraw reads it
    if (busyFocus && busyFocus.isConnected) { try { busyFocus.focus({ preventScroll: true }); } catch { /* ignore */ } }
    busyFocus = null;
  }
  /** Run an HTTP action behind the spinner. Always clears it, whether the action worked or threw. */
  async function withBusy(label, fn) {
    const epoch = httpBusyEpoch;
    httpBusy++;
    showBusy(label);
    try { return await fn(); } finally {
      if (epoch === httpBusyEpoch) { httpBusy--; if (!httpBusy) hideBusy(); }
    }
  }
  /** Right after a successful login the socket still has to say welcome. Until then show the profile, spin, and block taps. */
  function beginSignIn() {
    S.signingIn = true;
    showBusy('Signing you in…');
    render();
  }
  const send = (msg) => {
    if (!(ws && ws.readyState === 1)) return;
    ws.send(JSON.stringify(msg));
    if (BUSY_LABELS[msg.t]) showBusy(BUSY_LABELS[msg.t], BUSY_FAST.has(msg.t) ? 8000 : 20000, msg.t);
  };

  // ------------------------------------------------------------ table voice chat (public/voice.js)
  const voiceAudio = document.createElement('div');
  // the <audio> elements of the other people at the table live here. Visually hidden, NOT display:none: some mobile
  // browsers (iOS Safari) do not play audio from an element that is not rendered.
  voiceAudio.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  document.body.appendChild(voiceAudio);
  const voice = window.TVVoice({ send, getIce: () => S.ice, myId: () => S.id, onChange: () => { refreshVoiceUI(); if (voice.state.error && voice.state.error !== lastVoiceError) toast(voice.state.error); lastVoiceError = voice.state.error; }, audioRoot: voiceAudio });
  let lastVoiceError = '';
  /** Microphone and speaker buttons: shown in the lobby header and in every game's toolbar. */
  function voiceButtonsHTML() {
    const st = voice.state;
    if (!S.voiceEnabled || !st.supported || (S.room && isSpectator())) return ''; // off on the server (VOICE_ENABLED), or watchers can listen to nobody and talk to nobody: take a seat first
    const talking = st.joined && !st.muted;
    const hearing = st.joined && !st.deafened;
    return `<button type="button" class="btn ghost small vc-btn vc-mic ${talking ? 'on' : st.joined ? 'muted' : ''}" data-act="voiceMic" aria-pressed="${talking}" aria-label="${talking ? 'Mute your microphone' : st.joined ? 'Unmute your microphone' : 'Join voice chat and talk'}" title="${talking ? 'Microphone on: tap to mute' : st.joined ? 'Microphone muted: tap to talk' : 'Talk to the table'}">🎙️</button>`
      + `<button type="button" class="btn ghost small vc-btn vc-spk ${hearing ? 'on' : st.joined ? 'muted' : ''}" data-act="voiceSpeaker" aria-pressed="${hearing}" aria-label="${hearing ? 'Silence the other players' : st.joined ? 'Hear the other players' : 'Join voice chat and listen'}" title="${hearing ? 'Hearing everyone: tap to silence' : st.joined ? 'Silenced: tap to hear' : 'Listen to the table'}">${hearing ? '🔊' : '🔈'}</button>`;
  }
  /** Update the voice buttons, the little mic next to people in voice, and the ring around whoever is talking, in place. */
  function refreshVoiceUI() {
    const st = voice.state;
    const root = $app;
    if (!root) return;
    const html = voiceButtonsHTML();
    const mic = root.querySelector('.vc-mic'), spk = root.querySelector('.vc-spk');
    if (mic && spk && html) {
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      mic.className = tmp.children[0].className; mic.setAttribute('aria-pressed', tmp.children[0].getAttribute('aria-pressed')); mic.setAttribute('aria-label', tmp.children[0].getAttribute('aria-label')); mic.title = tmp.children[0].title;
      spk.className = tmp.children[1].className; spk.setAttribute('aria-pressed', tmp.children[1].getAttribute('aria-pressed')); spk.setAttribute('aria-label', tmp.children[1].getAttribute('aria-label')); spk.title = tmp.children[1].title; spk.textContent = tmp.children[1].textContent;
    }
    const byId = new Map(st.list.map((v) => [v.id, v]));
    root.querySelectorAll('[data-vid], .pseat[data-pid]').forEach((el) => {
      const id = el.dataset.vid || el.dataset.pid;
      const v = byId.get(id);
      if (v) el.dataset.voice = v.muted && id !== S.id ? 'muted' : id === S.id && st.muted ? 'muted' : 'on'; else delete el.dataset.voice;
      el.classList.toggle('speaking', st.speaking.has(id));
    });
    const note = root.querySelector('.vc-note');
    if (note) { note.textContent = st.error; note.hidden = !st.error; }
  }
  // browsers start audio only after a tap
  document.addEventListener('click', () => voice.resumeAudio(), true);

  // CSRF: the server sets a ct_csrf cookie; every POST repeats its value in a header (the cookie alone proves nothing).
  async function ensureCsrf(force) {
    if (S.csrf && !force) return S.csrf;
    try {
      const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const out = await r.json();
      S.csrf = (out && out.csrfToken) || '';
    } catch { S.csrf = ''; }
    return S.csrf;
  }

  async function postJson(url, body, retried) {
    await ensureCsrf();
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': S.csrf },
        body: JSON.stringify(body || {}),
      });
    } catch {
      const err = new Error('Could not reach the server. Check your connection, wait a moment, then try again.');
      throw err; // no answer at all: the sign-in may still finish on the server, so it is not retried automatically
    }
    let data = {};
    try { data = await r.json(); } catch { /* ignore */ }
    if (r.status === 403 && /CSRF/i.test(data.error || '') && !retried) { // cookie expired or was cleared: fetch a fresh pair once
      await ensureCsrf(true);
      return postJson(url, body, true);
    }
    if (data && data.csrfToken) S.csrf = data.csrfToken;
    if (!r.ok || data.ok === false) {
      const err = new Error(data.error || `Request failed (${r.status})`);
      err.status = r.status;
      err.retryable = data.retryable === true;
      throw err;
    }
    return data;
  }

  /** Take the account the server returned into client state and remember it for the next visit. `fallback` is used when the server omits a field. */
  function adoptPlayer(player, fallback = {}) {
    S.name = player && player.display_name ? player.display_name : (fallback.name !== undefined ? fallback.name : S.name);
    S.username = player && player.username ? player.username : (fallback.username !== undefined ? fallback.username : S.username);
    S.avatar = player && player.avatar ? player.avatar : S.avatar;
    S.email = player && player.email ? player.email : '';
    S.named = !!S.name;
    if (S.name) store.set('ct_name', S.name);
    if (S.username) store.set('ct_username', S.username);
    if (S.avatar) store.set('ct_avatar', S.avatar);
  }

  async function hydrateSession() {
    try {
      const r = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const out = await r.json();
      if (out && out.csrfToken) S.csrf = out.csrfToken;
      if (out && out.ok) S.requireEmailVerification = policyRequiresVerification(out); // secure default stays true when field is missing/invalid
      if (!out || !out.ok || !out.authenticated) return false;
      adoptPlayer(out.player);
      S.emailVerified = !!out.emailVerified;
      return true;
    } catch {
      return false;
    }
  }

  function clearClientSession() {
    S.isStaff = false;
    S.banners = [];
    S.token = '';
    S.csrf = '';
    S.emailVerified = false;
    S.email = '';
    S.id = null;
    store.set('ct_csrf', ''); // older versions kept it in localStorage
    S.ping = null; S.page = 'home'; S.profile = null; S.player = null; S.recentTables = []; // nothing of the old account stays on screen
    if (location.hash === '#profile') { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  }

  async function doLogoutAll() {
    await withBusy('Logging out everywhere…', async () => {
      try {
        await postJson('/api/auth/logout-all', {});
      } catch {
        // ignore network failures; clear local state regardless
      }
      S.signedOutIntentionally = true;
      clearClientSession();
      S.ready = false;
      S.room = null;
      S.view = null;
      await loadSnapshot();
    });
    toast('Logged out everywhere.');
  }

  async function doLogout() {
    await withBusy('Logging out…', async () => {
      try {
        await postJson('/api/auth/logout', {});
      } catch {
        // ignore network failures; clear local state regardless
      }
      S.signedOutIntentionally = true;
      clearClientSession();
      S.ready = false;
      S.room = null;
      S.view = null;
      await loadSnapshot();
    });
    toast('Logged out.');
  }

  function policyRequiresVerification(out) {
    if (Object.prototype.hasOwnProperty.call(out || {}, 'emailVerificationRequired')) return !!out.emailVerificationRequired;
    if (Object.prototype.hasOwnProperty.call(out || {}, 'requiresVerification')) return !!out.requiresVerification;
    return true;
  }

  function authPolicyHintHTML() {
    if (S.requireEmailVerification) {
      return '<p class="auth-policy-hint">Email verification is required before entering the lobby.</p>';
    }
    return '<p class="auth-policy-hint optional" role="status">Friend-testing mode: email verification is optional right now. You can play immediately after creating your account.</p>';
  }

  // The auth sheet: a small dialog over the (public) home page. Logging in is never a place you get sent to —
  // it is a step you take when you try to play, and afterwards you land where you were heading.
  // `isError` makes the message an alert, so a failed login or sign-up is announced at once by screen readers.
  function openAuthSheet(tab = 'login', msg = '', isError = false) {
    S.auth = tab;
    closeOverlay();
    const loginOn = tab === 'login';
    const resend = S.requireEmailVerification ? '<button class="btn ghost small" data-act="resendVerification">Resend verification email</button>' : '';
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="sheet auth-sheet" data-stop="1" role="dialog" aria-label="${loginOn ? 'Log in' : 'Create account'}">
      <div class="row" style="justify-content:space-between"><h2>${loginOn ? 'Welcome back' : 'Create your account'}</h2><button class="btn ghost small" data-auth-close aria-label="Close">✕</button></div>
      ${msg ? `<p class="auth-msg" role="${isError ? 'alert' : 'status'}">${esc(msg)}</p>` : ''}
      <div class="row auth-tabs">
        <button class="btn ${loginOn ? '' : 'ghost'} small" data-act="showLogin">Log in</button>
        <button class="btn ${loginOn ? 'ghost' : ''} small" data-act="showRegister">Create account</button>
      </div>
      ${loginOn ? `
        <form id="loginForm" class="auth-form">
          <input id="loginEmail" type="email" required placeholder="Email" autocomplete="email">
          <input id="loginPassword" type="password" required minlength="8" placeholder="Password" autocomplete="current-password">
          <label class="check-row"><input id="loginRemember" type="checkbox"> Keep me signed in on this device <small class="hint">Only on a device you own.</small></label>
          <button class="btn big" type="submit">Log in</button>
        </form>
        <div class="row auth-links"><button class="btn ghost small" data-act="forgotPassword">Forgot password?</button>${resend}</div>
      ` : `
        <form id="registerForm" class="auth-form">
          <input id="registerName" type="text" maxlength="20" required placeholder="Display name" autocomplete="nickname">
          <input id="registerUsername" type="text" maxlength="24" required pattern="[a-z0-9_]{3,24}" placeholder="Username (lowercase)" autocomplete="username" autocapitalize="off" spellcheck="false">
          <small id="registerUsernameHint" class="hint"></small>
          <input id="registerEmail" type="email" required placeholder="Email" autocomplete="email">
          ${authPolicyHintHTML()}
          <input id="registerPassword" type="password" required minlength="8" placeholder="Password (8+ characters)" autocomplete="new-password">
          <label class="auth-check"><input id="registerAdult" type="checkbox" required> I am 18 or older.</label>
          <button class="btn big" type="submit">Create account</button>
        </form>
      `}
    </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-auth-close]')) closeOverlay(); });
    document.body.appendChild(overlay);
    const first = document.getElementById(loginOn ? 'loginEmail' : 'registerName');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
    if (!loginOn) {
      const u = document.getElementById('registerUsername');
      if (u) u.addEventListener('input', async () => {
        const hint = document.getElementById('registerUsernameHint');
        const value = String(u.value || '').trim().toLowerCase();
        u.value = value;
        if (!hint) return;
        if (!value) { hint.textContent = ''; return; }
        if (!/^[a-z0-9_]{3,24}$/.test(value)) { hint.textContent = 'Use 3-24 chars: lowercase letters, numbers, underscore.'; return; }
        try {
          const out = await fetch(`/api/auth/username-available?username=${encodeURIComponent(value)}`).then((r) => r.json());
          hint.textContent = out.available ? 'Username is available.' : 'Username is already taken.';
        } catch { hint.textContent = ''; }
      });
    }
  }

  function closeOverlay() {
    const el = document.getElementById('auth-overlay');
    if (el) el.remove();
    S.auth = null;
  }

  // Only retry a database lookup explicitly marked safe by the server; ambiguous responses may have created a session.
  async function postLogin(email, password, rememberDevice = false) {
    for (let attempt = 0; ; attempt++) {
      try { return await postJson('/api/auth/login', { email, password, rememberDevice: rememberDevice === true }); } catch (err) {
        if (!err.retryable || attempt >= 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      }
    }
  }

  async function doLogin(email, password, rememberDevice = false) {
    const out = await withBusy('Logging in…', () => postLogin(email, password, rememberDevice));
    S.token = '';
    if (out.csrfToken) S.csrf = out.csrfToken;
    adoptPlayer(out.player);
    S.requireEmailVerification = policyRequiresVerification(out);
    S.emailVerified = !!(out.player && out.player.email_verified);
    S.signedOutIntentionally = false;
    if (S.requireEmailVerification && !S.emailVerified) {
      openAuthSheet('login', 'Please verify your email before playing. Use “Resend verification email” if the link did not arrive.');
      return;
    }
    closeOverlay();
    beginSignIn();
    connect();
    if (!S.emailVerified) toast('Email verification pending. Friend-testing mode lets you play while unverified.');
  }

  async function doRegister(name, username, email, password, adultConfirmed) {
    const out = await withBusy('Creating your account…', () => postJson('/api/auth/register', { displayName: name, username, email, password, avatar: S.avatar || undefined, adultConfirmed: adultConfirmed === true }));
    S.token = '';
    if (out.csrfToken) S.csrf = out.csrfToken;
    S.requireEmailVerification = policyRequiresVerification(out);
    S.signedOutIntentionally = false;
    // Registration never signs the browser in. The player verifies the email, then logs in here. The same answer is given
    // whether or not the address already had an account.
    openAuthSheet('login', out.message || 'Check your email for a verification link, then log in here.');
  }

  async function doResendVerification() {
    const email = window.prompt('Enter the email you registered with:');
    if (!email) return;
    try {
      await withBusy('Sending the email…', () => postJson('/api/auth/resend-verification', { email }));
      toast('If this account needs verifying, a new link has been sent.');
    } catch (e) {
      toast(e.message || 'Could not send the email');
    }
  }

  async function doForgotPassword() {
    const email = window.prompt('Enter your account email:');
    if (!email) return;
    try {
      await withBusy('Sending the email…', () => postJson('/api/auth/forgot-password', { email }));
      toast('If this account exists, a reset link has been sent.');
    } catch (e) {
      toast(e.message || 'Could not send reset link');
    }
  }

  // The session cookie rides along with the WebSocket upgrade, so the page never handles the session token.
  let reconnectTimer = null;
  function connect() {
    // Exactly one socket at a time. A second one (a reconnect timer firing after a login, or a slow first connection)
    // would take the account over from the first with "replaced", and the page could end up talking to the dead one.
    clearTimeout(reconnectTimer); reconnectTimer = null;
    if (ws) { const old = ws; ws = null; old.onopen = old.onmessage = old.onclose = null; try { old.close(); } catch { /* already closed */ } }
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws = sock;
    ws.onopen = () => {
      if (sock !== ws) return;
      retry = 0;
      $banner.hidden = true;
      send({ t: 'hello' });
    };
    ws.onmessage = (e) => {
      if (sock !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onMessage(m);
    };
    ws.onclose = (e) => {
      if (sock !== ws) return;
      S.ready = false;
      voice.reset(); // the server drops us from voice when the connection drops
      if (e.code === 4000) {
        $banner.textContent = 'Tableverse is open in another tab. Reload to play here.';
        $banner.hidden = false;
        return;
      }
      if (e.code === 4001) { // signed out elsewhere, or the password was reset
        S.signingIn = false;
        hideBusy();
        clearClientSession();
        $banner.hidden = true;
        loadSnapshot();
        if (S.signedOutIntentionally) S.signedOutIntentionally = false; // this tab clicked Log out: show the public home, do not nag
        else openAuthSheet('login', 'You have been signed out. Please log in again.');
        return;
      }
      if (e.code === 4002) { // a newer login (another device) took over the single active session
        S.signingIn = false;
        hideBusy();
        clearClientSession();
        $banner.hidden = true;
        loadSnapshot();
        openAuthSheet('login', 'You signed in on another device, so this one was signed out. Log in again to play here.');
        return;
      }
      if (e.code === 1008) { if (S.signingIn) { S.signingIn = false; hideBusy(); loadSnapshot(); } return; } // refused (not logged in, not verified): the login sheet is already showing, do not loop
      $banner.textContent = 'Reconnecting…';
      $banner.hidden = false;
      reconnectTimer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  }

  const hashCode = () => {
    const c = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    return /^[A-Z]{6}$/.test(c) ? c : '';
  };
  const setHash = (code) => {
    try { history.replaceState(null, '', code ? '#' + code : location.pathname + location.search); } catch { /* ignore */ }
  };

  /** Recent tables belong to the account: fetched from the server, so every device shows the same list. */
  async function loadRecent() {
    if (S.guest) { S.recentTables = []; return; }
    try {
      const r = await fetch('/api/me/recent', { credentials: 'same-origin' });
      const out = await r.json();
      if (!r.ok || !out.ok) return;
      S.recentTables = (out.tables || []).map((t) => ({ code: t.code, gameId: t.gameId, status: t.status, name: (gameMeta(t.gameId) || {}).name || t.gameId }));
      if (!S.room) render();
    } catch { /* offline: the list simply stays as it was */ }
  }

  async function loadSocial({ quiet = false } = {}) {
    if (!S.ready || S.guest) return;
    let before = -1;
    if (!quiet) { S.socialLoading = true; S.socialError = ''; render(); }
    try {
      const paths = [
      '/api/me/friends',
      '/api/me/friend-requests?direction=incoming',
      '/api/me/friend-requests?direction=outgoing',
      '/api/me/table-invitations?direction=incoming',
      '/api/me/table-invitations?direction=outgoing',
    ];
      const results = await Promise.all(paths.map(async (url) => {
        const r = await fetch(url, { credentials: 'same-origin' });
        const data = await r.json();
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load friends.');
        return data;
      }));
      before = (S.friendRequests.incoming || []).length + (S.invitations.incoming || []).length;
      S.friends = results[0].friends || [];
      S.friendRequests = { incoming: results[1].requests || [], outgoing: results[2].requests || [] };
      S.invitations = { incoming: results[3].invitations || [], outgoing: results[4].invitations || [] };
      S.socialError = '';
    } catch (error) {
      S.socialError = error.message || 'Could not load friends.';
    } finally {
      S.socialLoading = false;
      const after = (S.friendRequests.incoming || []).length + (S.invitations.incoming || []).length;
      if (!S.room || S.room.status === 'lobby' || after !== before) render(); // in a running game only redraw when the bell count changed
    }
  }

  async function searchFriends(query) {
    S.friendQuery = query.trim();
    if (S.friendQuery.length < 1) { S.friendSearch = []; render(); return; }
    S.friendSearchBusy = true;
    render();
    try {
      const r = await fetch(`/api/me/friends/search?username=${encodeURIComponent(S.friendQuery)}`, { credentials: 'same-origin' });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Search failed.');
      S.friendSearch = data.players || [];
      S.socialError = '';
    } catch (error) { S.friendSearch = []; S.socialError = error.message || 'Search failed.'; } // a failed search must not leave older results on screen
    finally { S.friendSearchBusy = false; if (!S.room) render(); }
  }

  async function socialPost(path, body, success, label = 'Updating…') {
    await withBusy(label, async () => {
      try {
        await postJson(path, body);
        S.socialError = '';
        if (success) toast(success);
        await loadSocial({ quiet: true });
      } catch (error) {
        S.socialError = error.message || 'Could not update friends.';
        if (!S.room) render();
      }
    });
  }

  function joinAcceptedInvitation(invitation) {
    if (!invitation || invitation.status !== 'accepted') { hideBusy(); return toast('Accept the invitation before joining.'); }
    const game = gameMeta(invitation.game_id || invitation.gameId);
    toast(`Joining ${(game && game.name) || 'private'} table…`);
    const code = invitation.room_code || invitation.roomCode;
    if (!code) { hideBusy(); return toast('This invitation has no table code. Ask the host to invite you again.'); }
    joinTable(code, 'join');
  }

  function recentTablesHTML() {
    if (!S.recentTables.length) return '';
    const rows = S.recentTables.map((r) => {
      const mine = S.rejoin.some((x) => x.code === r.code);
      const status = mine ? 'Your seat is waiting' : r.status === 'playing' ? 'In progress' : 'Open';
      return `<button class="recent-table ${mine ? 'mine' : ''}" data-act="rejoin" data-code="${esc(r.code)}"><span>↺</span><b>${esc(r.name)}</b><code>${esc(r.code)}</code>${mine ? '<em class="rj-badge">Rejoin</em>' : `<small>${status}</small>`}</button>`;
    }).join('');
    return `<section class="home-section"><h2 class="section">Recent tables</h2><div class="recent-tables">${rows}</div></section>`;
  }

  /** Big banner at the top of the home screen: a game is running and a bot is playing your seat. */
  function rejoinBannerHTML() {
    if (!S.rejoin.length) return '';
    return S.rejoin.map((r) => {
      const g = gameMeta(r.gameId) || { name: r.gameId, icon: '🎴' };
      return `<div class="rejoin-banner panel" role="status"><span class="rj-ico">${esc(g.icon || '🎴')}</span><div class="rj-text"><b>Your ${esc(g.name)} game is still running</b><span>${r.paused ? 'Everyone stepped out, so it is paused' : 'A bot is playing your seat'} at table <code>${esc(r.code)}</code>. Jump back in to carry on.</span></div><button class="btn" data-act="rejoin" data-code="${esc(r.code)}">Rejoin</button></div>`;
    }).join('');
  }

  function tableByCode(code) {
    return S.publicTables.find((t) => t.code === code) || null;
  }

  // ---- managed announcements (Stage 20.5). Legacy ANNOUNCEMENT text above keeps working; these are added next to it.
  const LEVEL_ICON = { info: 'ℹ️', warning: '⚠️', success: '✅' };
  // Guest dismissals live under their own key, `ct_ann_rev`, as `id:revision` entries. The key the earlier format used is never
  // read, so no old entry can hide a banner (whatever its text, even "2").
  const GUEST_DISMISS_KEY = 'ct_ann_rev';
  const guestDismissed = () => { try { return JSON.parse(store.get(GUEST_DISMISS_KEY) || '[]').filter((e) => typeof e === 'string'); } catch { return []; } };
  // A dismissal is kept per revision: an edit of a banner (text, level, audience or schedule) makes a new revision, and the banner
  // shows again. Signed-in dismissals are stored on the account with the revision the player saw; guests keep the same key here.
  // The highest revision this guest dismissed, per announcement. A dismissal of revision N hides N and any older revision (a
  // server instance may still send an older cached copy); a newer revision is shown.
  const dismissedMax = () => {
    const max = new Map();
    for (const e of guestDismissed()) {
      const i = e.lastIndexOf(':'); const id = e.slice(0, i); const rev = Number(e.slice(i + 1));
      if (id && Number.isSafeInteger(rev) && rev >= 1 && rev > (max.get(id) || 0)) max.set(id, rev);
    }
    return max;
  };
  // Guest entries written before revisions (`id:text`) are not honoured: an edit made after such an entry was written cannot be
  // told from an unedited banner, so the safe choice is to show it once more rather than hide a changed banner.
  function guestHidden(list) {
    const max = dismissedMax();
    return new Set(list.filter((a) => (max.get(a.id) || 0) >= a.revision).map((a) => a.id));
  }
  async function loadBanners() {
    try {
      const r = await fetch('/api/announcements', { credentials: 'same-origin' });
      const out = await r.json();
      if (!out || !out.ok) return;
      const all = out.announcements || [];
      const hidden = out.signedIn ? new Set() : guestHidden(all); // signed-in dismissals are already applied by the server
      const next = all.filter((a) => !hidden.has(a.id));
      if (JSON.stringify(next) !== JSON.stringify(S.banners)) { S.banners = next; render(); }
    } catch { /* offline: keep what is shown */ }
  }
  async function loadStaffHint() {
    try {
      const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
      const out = await r.json();
      const staff = !!(out && out.ok && out.isAdmin);
      if (staff !== S.isStaff) { S.isStaff = staff; render(); }
    } catch { /* ignore */ }
  }
  const bannersHTML = () => S.banners.map((b) => `<div class="notice-bar notice-${esc(b.level)}" role="status"><span><span aria-hidden="true">${LEVEL_ICON[b.level] || ''}</span> ${esc(b.message)}</span><button type="button" class="wn-close" data-act="dismissBanner" data-id="${esc(b.id)}" aria-label="Dismiss announcement">✕</button></div>`).join('');
  async function dismissBanner(id) {
    const dismissed = S.banners.find((b) => b.id === id);
    S.banners = S.banners.filter((b) => b.id !== id);
    render();
    if (S.guest) {
      if (dismissed) {
        const max = dismissedMax();
        // keep the highest revision, and re-insert the id so it counts as the most recent one: Map.set on an existing key keeps its old
        // position, and the oldest entries are the ones trimmed below
        const highest = Math.max(max.get(dismissed.id) || 0, dismissed.revision);
        max.delete(dismissed.id);
        max.set(dismissed.id, highest);
        store.set(GUEST_DISMISS_KEY, JSON.stringify([...max].map(([id, rev]) => `${id}:${rev}`).slice(-50)));
      }
      return;
    }
    // the revision on screen is sent, so an edit that lands meanwhile is not hidden by this dismissal
    try { await postJson('/api/announcements/dismiss', { id, revision: dismissed ? dismissed.revision : undefined }); } catch { /* it comes back on the next refresh if the server did not record it */ }
  }
  // the schedule is decided on the server, so a banner can appear, expire or be ended while the page is open: look again now and then
  setInterval(() => { if (document.visibilityState === 'visible') loadBanners(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadBanners(); });

  function openFeedbackModal() {
    openModal('Send feedback', `<form id="fbForm" class="fb-form">
        <label class="label" for="fbCat">What is it about?</label>
        <select id="fbCat"><option value="idea">An idea</option><option value="bug">A problem</option><option value="other">Something else</option></select>
        <label class="label" for="fbMsg">Your message</label>
        <textarea id="fbMsg" rows="5" maxlength="1000" required placeholder="Tell us what happened or what you would like."></textarea>
        <small class="hint">We read every message. Please do not include passwords or personal details.</small>
        <p id="fbOut" role="status"></p>
        <button class="btn" type="submit">Send</button>
      </form>`, (o) => {
      const form = o.querySelector('#fbForm');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const out = o.querySelector('#fbOut');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const r = await postJson('/api/feedback', { category: form.querySelector('#fbCat').value, message: form.querySelector('#fbMsg').value });
          closeModal();
          toast(r.message || 'Thank you!');
        } catch (err) { out.textContent = err.message; btn.disabled = false; }
      });
    });
  }

  /** Home data for visitors (no socket): the public games list, the live table directory and the site announcement. */
  async function loadSnapshot() {
    S.guest = true;
    S.rejoin = []; // a stale "your game is waiting" banner must not survive into guest browsing
    try {
      const r = await fetch('/api/games', { credentials: 'same-origin' });
      const out = await r.json();
      if (out && out.ok) {
        S.games = out.games || [];
        S.publicTables = out.tables || [];
        S.announcement = typeof out.announcement === 'string' ? out.announcement : '';
      }
    } catch { /* offline: the home screen still renders, just without live data */ }
    render();
    loadBanners();
  }

  /** Play actions need a live lobby session: guests are asked to log in, and the action they tapped runs right after. */
  const authed = () => !S.guest && !!ws && ws.readyState === 1;
  function gateLogin(fn) {
    if (authed()) {
      fn();
      return;
    }
    S.pending = [fn];
    if (S.signingIn) return; // the login already succeeded: run the action when the table connection is ready, do not ask again
    if (!S.guest) {
      // logged in with a valid session, the socket is just down: keep the action for the reconnect instead of nagging
      if (!ws || ws.readyState >= 2) connect();
      return;
    }
    const code = hashCode();
    openAuthSheet('login', code ? `Log in to join table ${code}.` : 'Log in to play — you will go straight where you tapped.');
  }

  function tableJoinModeOptions(t) {
    if (!t) return ['join', 'spectate'];
    if (t.status === 'playing') return ['spectate'];
    return ['join', 'spectate'];
  }

  function openJoinModeDialog(code, t, onPick) {
    const modes = tableJoinModeOptions(t);
    if (modes.length === 1) return onPick(modes[0]);
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const label = t
      ? (t.status === 'playing' ? 'This table is in progress.' : 'This table is waiting in the lobby.')
      : 'Choose how to enter this table.';
    overlay.innerHTML = `<div class="sheet" data-stop="1" role="dialog" aria-label="Join or spectate"><h2>Join table ${esc(code)}</h2><p class="hint">${esc(label)}</p><div class="row" style="margin-top:12px; gap:10px; flex-wrap:wrap">${modes.includes('join') ? '<button class="btn" data-join-mode="join">Join as player</button>' : ''}${modes.includes('spectate') ? '<button class="btn ghost" data-join-mode="spectate">Spectate</button>' : ''}</div><div class="row" style="margin-top:10px"><button class="btn ghost small" data-join-close="1">Cancel</button></div></div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-join-close]')) {
        overlay.remove();
        return;
      }
      const pick = e.target.closest('[data-join-mode]');
      if (!pick) return;
      overlay.remove();
      onPick(pick.dataset.joinMode);
    });
    document.body.appendChild(overlay);
  }

  /** Joining any table (directory, recent, code box or invite link) goes through the same gate: guests are asked to log in first. */
  function askJoinMode(code, t) {
    if (!authed()) return gateLogin(() => askJoinMode(code, tableByCode(code)));
    openJoinModeDialog(code, t, (mode) => joinTable(code, mode));
  }

  function publicTableAction(t) {
    if (t.status === 'playing') return { label: 'Spectate', disabled: false, cls: 'ghost' };
    if (t.members >= t.seats) return { label: 'Full', disabled: true, cls: 'ghost' };
    return { label: 'Join / Spectate', disabled: false, cls: '' };
  }

  function publicTablesHTML() {
    const count = S.publicTables.length;
    if (!count) return ''; // nothing open: no empty block on the home page
    const rows = S.publicTables.map((t) => {
      const g = gameMeta(t.gameId) || { name: t.gameId, icon: '🎴' };
      const action = publicTableAction(t);
      return `<div class="public-table"><span class="public-game-icon">${esc(g.icon || '🎴')}</span><div class="public-table-info"><b>${esc(g.name)}</b><span>${esc(t.host)}'s table · ${t.members}/${t.seats} players${t.spectators ? ` · 👁 ${t.spectators}` : ''}</span></div><button class="btn ${action.cls} small" data-act="joinPublic" data-code="${esc(t.code)}" ${action.disabled ? 'disabled' : ''}>${action.label}</button></div>`;
    }).join('');
    return `<section class="home-section public-tables-panel"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 class="section">Open tables <span class="session-count">${count}</span></h2></div><button class="btn ghost small" data-act="toggleSessions" aria-expanded="${S.sessionListOpen}">${S.sessionListOpen ? 'Hide' : 'Show'}</button></div>${S.sessionListOpen ? count ? `<div class="public-tables">${rows}</div>` : emptyState('🪑', 'No open tables', 'Create a table and make it public, and it appears here for everyone.') : ''}</section>`;
  }

  function joinTable(code, mode) {
    if (!S.named || !S.name) return toast('Choose your player name first');
    const msg = { t: 'join', code, name: S.name, avatar: S.avatar || undefined };
    if (mode === 'spectate') msg.spectate = true;
    send(msg);
  }


  // TURN logins expire (see lib/voiceRelay.js). Ask for new ones ten minutes before the current ones stop working.
  const ICE_REFRESH_LEAD_MS = 10 * 60 * 1000;
  const ICE_ASK_GAP_MS = 21000; // the server answers at most once per 20 s (ICE_REFRESH_MIN_MS); a closer request is ignored
  let iceTimer = null;
  let lastIceAsk = 0;
  function scheduleIceRefresh() {
    clearTimeout(iceTimer); iceTimer = null;
    if (!S.iceExpiresAt) return; // no time-limited logins: nothing to refresh
    // Due when the lead time is reached. If that is already past (for example after a sleep, or a late reply), ask now,
    // but no sooner than the gap after the last request, so the request is not ignored by the server.
    const due = S.iceExpiresAt - ICE_REFRESH_LEAD_MS - Date.now();
    const wait = Math.max(0, due, lastIceAsk + ICE_ASK_GAP_MS - Date.now());
    iceTimer = setTimeout(() => { iceTimer = null; lastIceAsk = Date.now(); send({ t: 'ice' }); }, wait);
  }

  // Voice relay (TURN) status from the server. Tells the player once when it stops working, and when it works again.
  const TURN_NOTICE = {
    unavailable: 'The voice relay cannot be reached right now. Players on strict networks may not hear each other; it is retried automatically.',
    quota: 'The voice relay refused new logins, so some players may not be able to connect through it. It is retried automatically.',
  };
  // one notice when the relay stops working; the "back" notice only after that one. Pending or other states change nothing.
  function noteTurnStatus(s) {
    if (!s || s === S.turnStatus) return;
    S.turnStatus = s;
    if (TURN_NOTICE[s]) {
      if (!S.turnNoticeOpen) toast(TURN_NOTICE[s]);
      S.turnNoticeOpen = true;
    } else if (s === 'ready' && S.turnNoticeOpen) {
      S.turnNoticeOpen = false;
      toast('The voice relay is back.');
    }
  }

  function onMessage(m) {
    if (m.t === 'state' || m.t === 'left' || m.t === 'error' || m.t === 'welcome') { S.signingIn = false; if (!httpBusy) hideBusy(); }
    else if ((m.t === 'notice' || m.t === 'blocks') && BUSY_MOD.has(busyKind) && !httpBusy) hideBusy();
    switch (m.t) {
      case 'welcome': {
        S.id = m.id;
        S.token = '';
        S.guest = false;
        S.games = m.games;
        S.publicTables = m.tables || [];
        S.rejoin = m.rejoin || [];
        S.announcement = typeof m.announcement === 'string' ? m.announcement : '';
        loadBanners();
        loadStaffHint();
        S.avatars = m.avatars || [];
        S.emotes = m.emotes || [];
        S.ice = Array.isArray(m.ice) ? m.ice : [];
        S.iceExpiresAt = typeof m.iceExpiresAt === 'number' ? m.iceExpiresAt : null;
        S.voiceEnabled = m.voiceEnabled === true; // the server decides; voice controls stay hidden unless it says yes
        noteTurnStatus(m.turnStatus);
        scheduleIceRefresh();
        if (!S.name) S.name = m.name;
        if (!S.avatar) S.avatar = m.avatar;
        S.ready = true;
        render();
        loadRecent();
        loadSocial({ quiet: true });
        if (!S.routed) { S.routed = true; applyRoute(); } // open #profile or #u/<name> if that is where the person came in
        const queue = S.pending;
        S.pending = [];
        for (const fn of queue) {
          try { fn(); } catch { /* a stale action must not break the session */ }
        }
        const code = hashCode();
        if (code && !S.room && !queue.length) {
          const t = tableByCode(code);
          askJoinMode(code, t);
        }
        break;
      }
      case 'authRequired':
        S.signingIn = false;
        hideBusy();
        clearClientSession();
        S.ready = false;
        loadSnapshot();
        openAuthSheet('login', m.message || 'Log in to play.');
        break;
      case 'blocks':
        S.blocked = Array.isArray(m.blocks) ? m.blocks : [];
        if (S.page === 'profile') render();
        break;
      case 'ice':
        // fresh TURN logins: used by new connections, and applied to the ones already open
        S.ice = Array.isArray(m.ice) ? m.ice : [];
        S.iceExpiresAt = typeof m.iceExpiresAt === 'number' ? m.iceExpiresAt : null;
        S.voiceEnabled = m.voiceEnabled === true;
        noteTurnStatus(m.turnStatus);
        scheduleIceRefresh();
        if (voice) voice.refreshIce();
        break;
      case 'tables': {
        const key = JSON.stringify([m.tables, m.rejoin]);
        S.publicTables = m.tables || [];
        S.rejoin = m.rejoin || [];
        if (key === S.tablesKey) break; // nothing changed: do not rebuild the screen
        S.tablesKey = key;
        if (!S.room) render();
        break;
      }
      case 'emote':
        showEmote(m.id, m.e);
        CardTable.sound.play('emote');
        break;
      case 'chat':
        onChat(m.m);
        break;
      case 'voice':
        voice.updateList(m.ids);
        break;
      case 'rtc':
        voice.handleRtc(m.from, m.data);
        break;
      case 'chatlog':
        S.chat = m.messages || [];
        S.unread = 0;
        drawChat();
        updateBadges();
        break;
      case 'notice':
        toast(m.text);
        break;
      case 'socialNotice':
        S.socialNotice = m.text || 'You have a new friends update.';
        toast(S.socialNotice);
        if (S.ready) loadSocial({ quiet: true });
        render();
        break;
      case 'latency':
        S.ping = Number.isFinite(m.ms) ? m.ms : null;
        for (const el of document.querySelectorAll('[data-ping-self]')) el.outerHTML = pingBadge(S.ping, { label: el.dataset.label === '1', live: 'self' });
        break;
      case 'socialPresence':
        if (Array.isArray(m.friends)) S.friends = m.friends;
        else {
          const friend = S.friends.find((f) => f.id === m.playerId);
          if (friend) { friend.online = Boolean(m.online); friend.playing = m.playing || null; friend.ping = Number.isFinite(m.ping) ? m.ping : null; friend.last_seen = m.lastSeen || friend.last_seen; }
        }
        if (!S.room) render();
        break;
      case 'state': {
        const { now, ...stable } = m.room;
        const stateKey = JSON.stringify([stable, m.view]);
        const same = stateKey === S.stateKey && S.room;
        S.stateKey = stateKey;
        S.room = m.room;
        S.view = m.view;
        S.skew = (m.room.now || Date.now()) - Date.now();
        if (same) break; // identical to what is on screen (a presence or ping tick): keep the DOM, the focus and any animation
        setHash(m.room.code);
        soundsFor(prevView, m.view);
        prevView = m.view;
        const mine = !!(m.view && m.view.myTurn);
        if (mine && !wasMyTurn) {
          try { navigator.vibrate && navigator.vibrate(70); } catch { /* ignore */ }
          if (document.hidden) document.title = '● Your turn · Tableverse';
        }
        wasMyTurn = mine;
        render();
        break;
      }
      case 'left':
        voice.reset();
        S.card = null; closeModal();
        S.page = 'home';
        loadRecent();
        S.room = null;
        S.view = null;
        S.chat = [];
        // Refresh directory after returning to the home screen; the last tables
        // update may have arrived while this client was still inside a room.
        S.unread = 0;
        closeChat();
        wasMyTurn = false;
        setHash('');
        render();
        break;
      case 'error':
        toast(m.message);
        if (!S.room && hashCode()) setHash('');
        break;
    }
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Tableverse'; });

  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'loginForm') {
      e.preventDefault();
      const email = (document.getElementById('loginEmail') || {}).value;
      const password = (document.getElementById('loginPassword') || {}).value;
      if (loginBusy) return; // a second press while the first is still running would end the first one's session
      loginBusy = true;
      const btn = e.target.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
      try {
        await doLogin(email, password, !!(document.getElementById('loginRemember') || {}).checked);
      } catch (err) {
        openAuthSheet('login', err.message || 'Login failed', true);
        const again = document.getElementById('loginEmail');
        if (again) again.value = email || ''; // keep what was typed
      } finally {
        loginBusy = false;
      }
    }
    if (e.target.id === 'registerForm') {
      e.preventDefault();
      const name = (document.getElementById('registerName') || {}).value;
      const username = String((document.getElementById('registerUsername') || {}).value || '').trim().toLowerCase();
      const email = (document.getElementById('registerEmail') || {}).value;
      const password = (document.getElementById('registerPassword') || {}).value;
      const adultConfirmed = Boolean((document.getElementById('registerAdult') || {}).checked);
      try {
        await doRegister(name, username, email, password, adultConfirmed);
      } catch (err) {
        openAuthSheet('register', err.message || 'Registration failed', true);
      }
    }
  });

  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'showLogin') return openAuthSheet('login');
    if (a.dataset.act === 'showRegister') return openAuthSheet('register');
    if (a.dataset.act === 'showAuth') return openAuthSheet(S.auth || 'login');
    if (a.dataset.act === 'forgotPassword') return doForgotPassword();
    if (a.dataset.act === 'resendVerification') return doResendVerification();
    if (a.dataset.act === 'gameSettings') return openGameSettings();
  });

  window.addEventListener('popstate', () => { if (!S.room) applyRoute(); });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pseat[role="button"]')) { e.preventDefault(); openPlayerCard(e.target.dataset.pid); return; }
    if (e.key !== 'Escape') return;
    if (S.auth) closeOverlay();
    else if (document.getElementById('modal-overlay')) closeModal();
    else if (S.toolsOpen) { setTools(false); document.querySelector('.tb-more-btn')?.focus(); }
    else if (S.bellOpen) { S.bellOpen = false; render(); document.querySelector('.tb-bell')?.focus(); }
    else if (S.menuOpen) { closeMenu(); document.querySelector('.tb-avatar-btn')?.focus(); }
  });
  // a click anywhere outside the open account menu closes it
  document.addEventListener('click', (e) => {
    if (S.toolsOpen && (!e.target.closest('.tb-more-wrap') || e.target.closest('.tb-pop button'))) setTools(false);
    if (S.bellOpen && !e.target.closest('.bell-wrap')) { S.bellOpen = false; render(); }
    if (S.menuOpen && !e.target.closest('.menu-wrap')) closeMenu();
  });

  const verifyToken = new URLSearchParams(location.search).get('token');
  if (location.pathname.endsWith('/verify-email.html') && verifyToken) {
    withBusy('Verifying your email…', () => postJson('/api/auth/verify-email', { token: verifyToken }))
      .then(() => { loadSnapshot(); openAuthSheet('login', 'Email verified. You can log in now.'); })
      .catch((e) => { loadSnapshot(); openAuthSheet('login', e.message || 'Verification failed.'); });
  }
  if (location.pathname.endsWith('/reset-password.html') && verifyToken) {
    // a real form (hidden password field, confirmation) instead of window.prompt, which shows the password in plain text
    loadSnapshot();
    openModal('Choose a new password', `<form id="resetForm" class="auth-form"><input id="resetPw" type="password" minlength="8" required placeholder="New password (8+ characters)" autocomplete="new-password"><input id="resetPw2" type="password" minlength="8" required placeholder="Repeat the password" autocomplete="new-password"><p id="resetMsg" class="auth-msg" role="status" hidden></p><button class="btn big" type="submit">Update password</button></form>`, (o) => {
      o.querySelector('#resetForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = o.querySelector('#resetMsg');
        const show = (t) => { msg.textContent = t; msg.hidden = false; };
        const pw = o.querySelector('#resetPw').value;
        if (pw !== o.querySelector('#resetPw2').value) return show('The two passwords do not match.');
        try {
          await withBusy('Updating your password…', () => postJson('/api/auth/reset-password', { token: verifyToken, newPassword: pw }));
          closeModal();
          history.replaceState(null, '', '/');
          openAuthSheet('login', 'Password updated. Log in with the new one.');
        } catch (err) { show(err.message || 'Reset failed. Ask for a new link.'); }
      });
    });
  }

  (async () => {
    await ensureCsrf();
    const ok = await hydrateSession();
    if (!ok) {
      clearClientSession();
      await loadSnapshot(); // the home page must open for visitors without a session
      S.routed = true;
      if (routeFromHash().page === 'player') applyRoute();
      if (hashCode()) {
        const code = hashCode();
        openAuthSheet('login', `Log in to join table ${code}.`);
      }
      return;
    }
    if (S.requireEmailVerification && !S.emailVerified) {
      await loadSnapshot();
      openAuthSheet('login', 'Please verify your email to enter the lobby.');
      return;
    }
    connect();
    if (!S.emailVerified) toast('Email verification pending. Friend-testing mode lets you play while unverified.');
  })();

  // ------------------------------------------------------------ rendering
  const avatarColor = (s) => {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 42%)`;
  };
  const initial = (name) => esc([...name][0] || '?').toUpperCase();
  /** A round avatar for anything with a name and an optional emoji; `cls` adds a size/placement class ('big', 'tb-av'). */
  const avatar = (m, cls = '') => `<span class="avatar${cls ? ' ' + cls : ''}" style="background:${avatarColor(m.name)}">${m.avatar ? esc(m.avatar) : initial(m.name)}</span>`;

  function profileHTML() {
    const userBadge = S.username ? `<div class="profile-user">@${esc(S.username)}</div>` : '';
    const picks = S.avatars
      .map((a) => `<button type="button" class="av-pick ${a === S.avatar ? 'on' : ''}" data-act="avatar" data-a="${esc(a)}" aria-label="Avatar ${esc(a)}" aria-pressed="${a === S.avatar}">${esc(a)}</button>`)
      .join('');
    const myName = S.named ? S.name : '';
    const initialChar = myName ? esc([...myName][0] || '?').toUpperCase() : '★';
    const previewBg = myName ? avatarColor(myName) : 'hsl(260 55% 42%)';
    return `<div class="profile">
      <div class="profile-header">
        <div class="profile-preview">
          <span class="avatar big" style="background:${previewBg}">${S.avatar ? esc(S.avatar) : initialChar}</span>
          <div class="profile-meta">
            <span class="profile-welcome">${myName ? `Playing as <b>${esc(myName)}</b>` : 'Choose your player persona'}</span>
            ${userBadge}
            <span class="profile-hint">Seen by friends at the table</span>
          </div>
        </div>
      </div>
      <label class="label" for="name">Your name</label>
      <input id="name" type="text" maxlength="20" autocomplete="nickname" placeholder="Type your nickname" value="${esc(myName)}">
      <div class="row" style="justify-content:space-between;margin-top:12px"><span class="label">Avatar</span><button type="button" class="btn ghost small" data-act="toggleAvatars" aria-expanded="${S.avatarOpen}">${S.avatarOpen ? 'Done' : 'Change'}</button></div>
      ${S.avatarOpen ? `<div class="av-picks">${picks}</div>` : ''}
    </div>`;
  }

  let prevView = null;
  const bidSig = (v) => JSON.stringify(v.bids || (v.players || []).map((p) => (p.bid !== undefined && p.bid !== null ? p.bid : p.hasBid ? 1 : null)));
  /** Play a sound for whatever changed between two game views. Only the trick-taking games (Wizard, 29) have the
   *  `trick`/`lastTrick`/`bids` fields this looks at; every other game plays its own sounds, including its final
   *  result (a plain "gameOver" check here could not tell a winner from a loser without knowing each game's shape). */
  function soundsFor(a, b) {
    const snd = CardTable.sound;
    if (!b || !snd) return;
    if (!a || a.phase === undefined) return;
    if ((b.phase === 'roundEnd' || b.phase === 'handEnd') && a.phase !== b.phase) return snd.play('round');
    if (b.lastTrick && (!a.lastTrick || JSON.stringify(a.lastTrick) !== JSON.stringify(b.lastTrick)) && b.trick && !b.trick.length) {
      snd.play(b.lastTrick.winner === b.me ? 'win' : 'card');
    } else if (b.trick && a.trick && b.trick.length > a.trick.length) snd.play('card');
    else if (b.phase === 'bidding' && bidSig(a) !== bidSig(b)) snd.play('tick');
    else if (a.phase !== b.phase && (b.phase === 'bidding' || b.phase === 'playing') && !(b.trick && b.trick.length)) snd.play('deal');
    // after a finished trick the winner is asked to lead only once the cards have been collected
    const trickDone = b.lastTrick && b.trick && !b.trick.length && (!a.lastTrick || a.trickNo !== b.trickNo || a.round !== b.round || a.handNo !== b.handNo);
    if (b.myTurn && (!a.myTurn || trickDone)) setTimeout(() => snd.play('turn'), trickDone ? CardTable.TRICK_HOLD_MS + 80 : 220);
  }

  function showEmote(id, e) {
    const seat = document.querySelector(`[data-pid="${CSS.escape(id)}"] .av`);
    const r = seat ? seat.getBoundingClientRect() : { left: innerWidth / 2, top: 80, width: 0, height: 0 };
    const el = document.createElement('div');
    el.className = 'emote-pop';
    el.textContent = e;
    el.style.left = r.left + r.width / 2 + 'px';
    el.style.top = r.top + r.height / 2 + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function toggleEmoteBar() {
    const old = document.getElementById('emote-bar');
    if (old) return old.remove();
    const bar = document.createElement('div');
    bar.id = 'emote-bar';
    bar.className = 'emote-bar';
    bar.innerHTML = S.emotes.map((e) => `<button type="button" data-e="${esc(e)}" aria-label="Send ${esc(e)}">${esc(e)}</button>`).join('');
    bar.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-e]');
      if (b) { send({ t: 'emote', e: b.dataset.e }); bar.remove(); }
    });
    document.body.appendChild(bar);
    setTimeout(() => document.addEventListener('click', function close(ev) {
      if (!bar.contains(ev.target)) { bar.remove(); document.removeEventListener('click', close); }
      else if (!bar.isConnected) document.removeEventListener('click', close);
    }), 0);
  }


  // ------------------------------------------------------------ player card (tap a player at the table)
  const sameName = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  /** How you and this person are connected right now: me | bot | guest | friend | outgoing | incoming | none. */
  function relationTo(person) {
    if (!person) return { kind: 'gone' };
    if (person.id === S.id) return { kind: 'me' };
    if (person.bot) return { kind: 'bot' };
    if (!person.username) return { kind: 'guest' };
    const friend = (S.friends || []).find((f) => sameName(f.username, person.username));
    if (friend) return { kind: 'friend', friend };
    const out = ((S.friendRequests || {}).outgoing || []).find((r) => sameName(r.username, person.username));
    if (out) return { kind: 'outgoing', request: out };
    const inc = ((S.friendRequests || {}).incoming || []).find((r) => sameName(r.username, person.username));
    if (inc) return { kind: 'incoming', request: inc };
    return { kind: 'none' };
  }
  const roomPerson = (pid) => S.room && [...(S.room.members || []), ...(S.room.spectators || [])].find((x) => x.id === pid);

  function cardHTML() {
    const C = S.card;
    const person = roomPerson(C.pid) || C.last;
    if (!person) return '<p class="hint">This player is no longer at the table.</p>';
    C.last = person;
    const rel = relationTo(person);
    const here = Boolean(roomPerson(C.pid));
    const prof = C.profile;
    const stats = prof ? `<div class="pcard-stats"><div><b>${prof.played}</b><span>Games</span></div><div><b>${prof.wins}</b><span>Wins</span></div><div><b>${prof.winRate === null ? '–' : prof.winRate + '%'}</b><span>Win rate</span></div></div>` : '';
    const sub = person.bot ? 'Bot' : person.username ? `@${esc(person.username)}` : 'Guest player';
    const conn = !person.bot && here ? `<p class="pp-conn">📶 ${person.connected === false ? 'Disconnected' : pingBadge(person.ping, { label: true })}</p>` : '';
    const busy = C.busy ? ' disabled' : '';
    const add = [];
    if (rel.kind === 'none') add.push(`<button type="button" class="btn"${busy} data-modal-act="cardAdd">➕ Add friend</button>`);
    if (rel.kind === 'outgoing') add.push(`<button type="button" class="btn ghost"${busy} data-modal-act="cardCancel">⏳ Request sent · Cancel</button>`);
    if (rel.kind === 'incoming') add.push(`<button type="button" class="btn"${busy} data-modal-act="cardAccept">✔ Accept friend request</button>`, `<button type="button" class="btn ghost"${busy} data-modal-act="cardDecline">Decline</button>`);
    if (rel.kind === 'friend') add.push('<p class="pcard-note">✔ You are friends.</p>', `<button type="button" class="btn ghost"${busy} data-modal-act="cardRemove">Remove friend</button>`);
    if (rel.kind === 'guest') add.push('<p class="pcard-note">Guests have no username, so they cannot be added as friends.</p>');
    if (rel.kind === 'none' && S.guest) add.length = 0;
    const others = [];
    if (rel.kind === 'me') others.push('<button type="button" class="btn ghost" data-modal-act="cardEditMe">Edit my profile</button>');
    if (person.username && rel.kind !== 'me') others.push(`<a class="btn ghost" href="/#u/${encodeURIComponent(person.username)}" target="_blank" rel="noopener">View full profile</a>`);
    if (rel.kind !== 'me' && rel.kind !== 'bot') others.push(`<button type="button" class="btn ghost" data-modal-act="cardMute">${muted.has(person.id) ? '🔔 Unmute in chat' : '🔇 Mute in chat'}</button>`);
    return `<div class="pcard-head">${avatar(person, 'big')}<div><h3>${esc(person.name)}</h3><p>${sub}${person.id === S.id ? ' · you' : ''}</p>${conn}</div></div>${stats}${C.error ? `<p class="auth-msg" role="alert">${esc(C.error)}</p>` : ''}<div class="pcard-actions">${add.join('')}${others.join('')}</div>${S.guest && rel.kind === 'none' ? '<p class="pcard-note">Log in to add friends.</p>' : ''}`;
  }
  function drawCard() {
    if (!S.card) return;
    const body = document.querySelector('#modal-overlay .modal-body');
    if (body && body.dataset.card === S.card.pid) body.innerHTML = cardHTML();
    else openModal('Player', cardHTML(), (o) => { o.querySelector('.modal-body').dataset.card = S.card.pid; });
  }
  function openPlayerCard(pid) {
    const person = roomPerson(pid);
    if (!person) return;
    S.card = { pid, profile: null, busy: false, error: '', last: person };
    drawCard();
    if (person.username && !person.bot) {
      getJson(`/api/players/${encodeURIComponent(person.username)}`)
        .then((d) => { if (S.card && S.card.pid === pid) { S.card.profile = d.profile; drawCard(); } })
        .catch(() => { /* the card works without the numbers */ });
    }
  }
  async function cardAction(path, body, success, label = 'Updating…') {
    const C = S.card; if (!C || C.busy) return;
    C.busy = true; C.error = ''; drawCard();
    await withBusy(label, async () => {
      try {
        await postJson(path, body);
        if (success) toast(success);
        await loadSocial({ quiet: true });
      } catch (e) { C.error = e.message || 'That did not work. Try again.'; }
    });
    C.busy = false;
    drawCard();
  }

  // ------------------------------------------------------------ chat, watchers, turn timer
  const $chat = document.createElement('div');
  $chat.id = 'chat';
  $chat.className = 'chat';
  $chat.hidden = true;
  $chat.innerHTML = `<div class="chat-head"><b>Table chat</b><span class="chat-watch"></span><button type="button" class="chat-x" data-chat="close" aria-label="Close chat">✕</button></div>
    <div class="chat-list" id="chat-list" aria-live="polite"></div>
    <form class="chat-form" id="chat-form"><input id="chat-input" type="text" maxlength="200" placeholder="Say something…" autocomplete="off"><button class="btn small" type="submit">Send</button></form>`;
  document.body.appendChild($chat);
  const $watch = document.createElement('button');
  $watch.id = 'watchers';
  $watch.type = 'button';
  $watch.className = 'watchers';
  $watch.hidden = true;
  document.body.appendChild($watch);

  /** People you muted in chat (kept on this device only). Their messages are hidden for you; nobody is told. */
  const muted = new Set((() => { try { return JSON.parse(store.get('ct_muted') || '[]').filter((x) => typeof x === 'string').slice(-200); } catch { return []; } })());
  const saveMuted = () => store.set('ct_muted', JSON.stringify([...muted].slice(-200)));

  function msgHTML(m) {
    if (!m.sys && muted.has(m.id) && m.id !== S.id) return '';
    if (m.sys) return `<div class="msg sys">${esc(m.text)}</div>`;
    const mine = m.id === S.id;
    // Block and report are enforced by the server; these buttons only send the request.
    const actions = mine ? '' : `<span class="mod-actions"><button type="button" class="mod-btn" data-mod="block" data-id="${esc(m.id)}" data-mid="${esc(m.mid || '')}" title="Hide this player's table chat and voice from you, and stop invitations between you. You can still share a table. They are not told." aria-label="Block ${esc(m.name)}">Block</button>${m.mid ? `<button type="button" class="mod-btn" data-mod="report-open" data-mid="${esc(m.mid)}">Report</button>` : ''}</span>`;
    const menu = !mine && m.mid && S.reportMenuFor === m.mid ? reportMenuHTML(m.mid) : '';
    return `<div class="msg ${mine ? 'mine' : ''}"><span class="mav" style="background:${avatarColor(m.name)}">${m.avatar ? esc(m.avatar) : initial(m.name)}</span><div class="mb"><b>${esc(m.name)}${m.spec ? ' <i title="Spectator">👁</i>' : ''}</b><p>${esc(m.text)}</p>${actions}${menu}</div></div>`;
  }
  const REPORT_REASONS = [['harassment', 'Harassment'], ['hate', 'Hate'], ['threats', 'Threats'], ['sexual', 'Sexual content'], ['spam', 'Spam'], ['other', 'Other']];
  function reportMenuHTML(mid) {
    return `<div class="report-menu" role="group" aria-label="Reason for report">${REPORT_REASONS.map(([k, l]) => `<button type="button" class="mod-btn" data-mod="report-send" data-mid="${esc(mid)}" data-reason="${k}">${l}</button>`).join('')}</div>`;
  }
  /** A signature for the chat control that has focus, so the same control can be found after the list is rebuilt. */
  function focusedChatControl(list) {
    const el = document.activeElement;
    if (!el || !list.contains(el) || !el.matches('[data-mod]')) return null;
    return [el.dataset.mod, el.dataset.mid || '', el.dataset.id || '', el.dataset.reason || ''].join('|');
  }
  function restoreChatFocus(list, sig) {
    if (!sig) return;
    const match = [...list.querySelectorAll('[data-mod]')].find((b) => [b.dataset.mod, b.dataset.mid || '', b.dataset.id || '', b.dataset.reason || ''].join('|') === sig);
    if (match) match.focus({ preventScroll: true });
  }
  function drawChat() {
    const list = document.getElementById('chat-list');
    if (!list) return;
    const focusSig = focusedChatControl(list);
    const previousScrollTop = list.scrollTop;
    list.innerHTML = S.chat.length ? S.chat.map(msgHTML).join('') : '<p class="hint">No messages yet. Say hello!</p>';
    restoreChatFocus(list, focusSig);
    // Do not auto-scroll a focused moderation control out of view when new chat arrives. Without keyboard focus,
    // retain the existing behaviour of following the latest message.
    list.scrollTop = focusSig ? previousScrollTop : list.scrollHeight;
    const w = S.room && S.room.spectators && S.room.spectators.length ? `👁 ${S.room.spectators.map((x) => esc(x.name)).join(', ')} watching` : '';
    $chat.querySelector('.chat-watch').innerHTML = w;
  }
  function updateBadges() {
    document.querySelectorAll('[data-act="chat"] .cb').forEach((el) => {
      el.textContent = S.unread;
      el.hidden = !S.unread;
    });
  }
  function onChat(m) {
    S.chat.push(m);
    if (S.chat.length > 60) S.chat.shift();
    if (S.chatOpen) drawChat();
    else if (!m.sys && m.id !== S.id && !muted.has(m.id)) {
      S.unread++;
      updateBadges();
      CardTable.sound.play('chat');
    }
  }
  function openChat() {
    S.chatOpen = true;
    S.unread = 0;
    $chat.hidden = false;
    drawChat();
    updateBadges();
    const inp = document.getElementById('chat-input');
    if (inp && !matchMedia('(pointer: coarse)').matches) inp.focus();
  }
  function closeChat() {
    S.chatOpen = false;
    S.reportMenuFor = null;
    $chat.hidden = true;
  }
  $chat.addEventListener('click', (e) => {
    if (e.target.closest('[data-chat="close"]')) return closeChat();
    const b = e.target.closest('[data-mod]');
    if (!b) return;
    if (b.dataset.mod === 'block') {
      send({ t: 'block', id: b.dataset.id });
    } else if (b.dataset.mod === 'report-open') {
      S.reportMenuFor = S.reportMenuFor === b.dataset.mid ? null : b.dataset.mid;
      drawChat();
      const first = S.reportMenuFor && $chat.querySelector('.report-menu [data-reason]');
      if (first) first.focus();
    } else if (b.dataset.mod === 'report-send') {
      send({ t: 'report', messageId: b.dataset.mid, reason: b.dataset.reason });
      S.reportMenuFor = null;
      drawChat();
      // the menu's buttons are gone now: keyboard focus goes back to the Report button of the same message
      const back = $chat.querySelector(`[data-mod="report-open"][data-mid="${b.dataset.mid}"]`);
      if (back) back.focus();
    }
  });
  $chat.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('chat-input');
    const text = inp.value.trim();
    if (text) send({ t: 'chat', text });
    inp.value = '';
  });
  $watch.addEventListener('click', openChat);

  function updateWatchers() {
    const sp = (S.room && S.room.spectators) || [];
    if (!S.room || !sp.length) {
      $watch.hidden = true;
      return;
    }
    if (isSpectator()) $watch.textContent = `👁 You are watching · ${sp.length} spectator${sp.length === 1 ? '' : 's'}`;
    else $watch.textContent = `👁 ${sp.length}`;
    $watch.hidden = false;
  }

  let lastTickSec = -1;
  function updateTimer() {
    if (!S.room && lastTickSec === -1) return; // home screen: no timers to update
    const dl = S.room && S.room.status === 'playing' ? S.room.deadline : null;
    const left = dl ? Math.max(0, Math.ceil((dl - (Date.now() + S.skew)) / 1000)) : null;
    document.querySelectorAll('.ct-timer').forEach((el) => {
      if (left === null) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      el.classList.toggle('warn', left <= 10);
    });
    if (left !== null && left <= 5 && left > 0 && left !== lastTickSec && S.view && S.view.myTurn) CardTable.sound.play('tick');
    lastTickSec = left === null ? -1 : left;
  }
  setInterval(updateTimer, 500);

  const range = (s) => (s.min === s.max ? `${s.min} players` : `${s.min}–${s.max} players`);

  // ------------------------------------------------------------ profile pages
  const emptyState = (icon, title, text) => `<div class="empty"><span class="empty-ico" aria-hidden="true">${icon}</span><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
  const loadingBlock = (text = 'Loading…') => `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(text)}</div>`;
  const errorBlock = (text, retryAct) => `<div class="error-block" role="alert"><p>${esc(text)}</p>${retryAct ? `<button type="button" class="btn ghost small" data-act="${retryAct}">Try again</button>` : ''}</div>`;
  const RESULT_LABEL = { won: 'Won', lost: 'Lost', left: 'Left early' };

  async function getJson(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    let out = null;
    try { out = await r.json(); } catch { /* not json */ }
    if (r.status === 401) { const e = new Error('Please log in again.'); e.status = 401; throw e; }
    if (!r.ok || !out || out.ok === false) { const e = new Error((out && out.error) || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return out;
  }

  /** Hash routes: #profile (own page) and #u/<username> (public). A 6-letter hash is still a table code. */
  function routeFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === 'profile') return { page: 'profile' };
    if (h === 'friends') return { page: 'friends' };
    const m = /^u\/([a-z0-9_]{3,24})$/i.exec(h);
    if (m) return { page: 'player', username: m[1].toLowerCase() };
    return { page: 'home' };
  }
  function applyRoute() {
    const r = routeFromHash();
    if (r.page === 'profile' && S.guest) { S.page = 'home'; openAuthSheet('login', 'Log in to see your profile.'); return; }
    if (r.page === 'friends' && S.guest) { S.page = 'home'; openAuthSheet('login', 'Log in to see your friends.'); return; }
    if (r.page === 'profile') return void openPage('profile', null, true);
    if (r.page === 'friends') return void openPage('friends', null, true);
    if (r.page === 'player') return void openPage('player', r.username, true);
    S.page = 'home';
    render();
  }
  function openPage(page, arg, fromHash) {
    S.menuOpen = false; S.bellOpen = false;
    S.page = page;
    if (!fromHash) { try { history.pushState(null, '', page === 'profile' ? '#profile' : page === 'friends' ? '#friends' : page === 'player' ? '#u/' + arg : location.pathname + location.search); } catch { /* ignore */ } }
    window.scrollTo(0, 0);
    if (page === 'profile') loadProfile(); else if (page === 'player') loadPlayer(arg); else if (page === 'friends') { render(); loadSocial({ quiet: true }); } else render();
  }

  async function loadProfile(historyPage = 1) {
    const keepTab = S.profile && S.profile.tab;
    S.profile = { loading: true, error: '', data: null, history: null, tab: keepTab || 'overview', historyPage };
    render();
    try {
      const [me, hist] = await Promise.all([getJson('/api/me/profile'), getJson(`/api/me/history?page=${historyPage}`)]);
      S.profile = { ...S.profile, loading: false, data: me, history: hist };
      S.name = me.profile.displayName; S.named = true;
    } catch (e) {
      S.profile = { ...S.profile, loading: false, error: e.message || 'Could not load your profile.' };
    }
    render();
  }
  async function loadPlayer(username) {
    S.player = { username, loading: true, error: '', data: null };
    render();
    try { S.player.data = (await getJson(`/api/players/${encodeURIComponent(username)}`)).profile; }
    catch (e) { S.player.error = e.status === 404 ? 'There is no player with that username.' : (e.message || 'Could not load this profile.'); }
    S.player.loading = false;
    render();
  }

  const joinedText = (iso) => (iso ? `Joined ${fmtDate(iso)}` : '');

  /** Connection quality from a round-trip time in ms. Colour is never the only signal: the label is always there. */
  const pingQuality = (ms) => (ms < 60 ? ['great', 'Excellent'] : ms < 120 ? ['good', 'Good'] : ms < 250 ? ['fair', 'Fair'] : ['poor', 'Poor']);
  const pingBadge = (ms, { label = false, live = '' } = {}) => {
    const attrs = `${live ? ` data-ping-${live}` : ''}${label ? ' data-label="1"' : ''}`;
    if (!Number.isFinite(ms)) return `<span class="ping none"${attrs}>– ms</span>`;
    const [cls, word] = pingQuality(ms);
    return `<span class="ping q-${cls}" title="Round trip to the server: ${word}"${attrs}>${ms} ms${label ? ' · ' + word : ''}</span>`;
  };

  function historyHTML(h) {
    if (!h || !h.total) return emptyState('🕘', 'No games yet', 'Finished games show up here with the game, the date and how it went.');
    const rows = h.items.map((g) => {
      const meta = statsGame(g.gameId);
      return `<li class="hist-row"><span class="hist-ico" aria-hidden="true">${esc(meta.icon || '🎴')}</span><span class="hist-main"><b>${esc(meta.name)}</b><small>${esc(fmtDate(g.finishedAt))} · ${g.humans} player${g.humans === 1 ? '' : 's'}${g.seats > g.humans ? ` + ${g.seats - g.humans} bot${g.seats - g.humans === 1 ? '' : 's'}` : ''}</small></span><span class="result ${g.result}">${RESULT_LABEL[g.result]}</span></li>`;
    }).join('');
    const pager = h.pages > 1 ? `<nav class="pager" aria-label="History pages"><button type="button" class="btn ghost small" data-act="historyPage" data-page="${h.page - 1}" ${h.page <= 1 ? 'disabled' : ''}>← Newer</button><span>Page ${h.page} of ${h.pages}</span><button type="button" class="btn ghost small" data-act="historyPage" data-page="${h.page + 1}" ${h.page >= h.pages ? 'disabled' : ''}>Older →</button></nav>` : '';
    return `<ul class="hist-list">${rows}</ul>${pager}<p class="hint" style="text-align:left">Games you left early are listed but not counted in your statistics.</p>`;
  }

  /** Accounts this person has blocked, with a button to unblock each. Names are shown only here, to the blocker. */
  function blockedHTML() {
    const list = S.blocked;
    const head = `<div class="setting-row"><div><b>Blocked players</b><small>You will not see their table chat, and you will not hear each other in table voice. You cannot invite each other. You can still share a table. They are not told. Unblocking restores chat and voice.</small></div></div>`;
    if (!list) return `${head}<p class="hint" style="text-align:left">Loading…</p>`;
    if (!list.length) return `${head}<p class="hint" style="text-align:left">You have not blocked anyone.</p>`;
    const rows = list.map((b) => `<div class="setting-row"><div><b>${esc(b.name || 'Player')}</b></div><button type="button" class="btn ghost small" data-act="unblock" data-id="${esc(b.id)}" aria-label="Unblock ${esc(b.name || 'player')}">Unblock</button></div>`).join('');
    return `${head}${rows}`;
  }

  function renderProfilePage() {
    const P = S.profile || { loading: true };
    let inner;
    if (P.loading) inner = loadingBlock('Loading your profile…');
    else if (P.error) inner = errorBlock(P.error, 'reloadProfile');
    else {
      const me = P.data.profile;
      const name = me.displayName;
      const tab = P.tab || 'overview';
      const tabBtn = (id, label) => `<button type="button" role="tab" class="tab ${tab === id ? 'on' : ''}" aria-selected="${tab === id}" data-act="profileTab" data-tab="${id}">${label}</button>`;
      const panel = tab === 'history' ? historyHTML(P.history)
        : tab === 'account' ? `<div class="account-list">
            ${blockedHTML()}
            <div class="setting-row"><div><b>Email</b><small>${esc(me.email || 'No email on this account')}${me.email ? (me.emailVerified ? ' · verified' : ' · not verified') : ''}. Only you can see this.</small></div></div>
            <div class="setting-row"><div><b>Public profile</b><small>Anyone with the link can see your username, display name, avatar, join date and win totals.</small></div><button type="button" class="btn ghost small" data-act="copyProfileLink">Copy link</button></div>
            <div class="setting-row"><div><b>Sessions</b><small>Sign out of this device, or of every device you are logged in on.</small></div><span class="row" style="gap:6px"><button type="button" class="btn ghost small" data-act="logout">Log out</button><button type="button" class="btn ghost small" data-act="logoutAll">Everywhere</button></span></div>
            <div class="danger-zone"><div><b>Delete account</b><small>Permanently removes your account and sign-in. This cannot be undone.</small></div><button type="button" class="btn danger small" data-act="openDeleteAccount">Delete account…</button></div>
          </div>`
        : statsHTML(P.data.stats);
      inner = `<header class="pp-head">
          ${avatar({ name, avatar: me.avatar }, 'big')}
          <div class="pp-id"><h1>${esc(name)}</h1><p>${me.username ? `@${esc(me.username)} · ` : ''}${esc(joinedText(me.joinedAt))}</p><p class="pp-conn">📶 Connection ${pingBadge(S.ping, { label: true, live: 'self' })}</p></div>
          <button type="button" class="btn ghost small" data-act="editProfile">Edit profile</button>
        </header>
        <div class="tabs" role="tablist">${tabBtn('overview', 'Overview')}${tabBtn('history', `History${P.history && P.history.total ? ` <small>${P.history.total}</small>` : ''}`)}${tabBtn('account', 'Account')}</div>
        <section class="tab-panel" role="tabpanel">${panel}</section>`;
    }
    $app.innerHTML = `${topbarHTML()}<main class="page profile-page"><a class="back-link" href="/" data-act="goHome">← Back to games</a>${inner}</main>`;
  }

  /** Only people you are friends with show their status and connection on their page (it comes from your own friends list). */
  function friendLine(username) {
    const f = (S.friends || []).find((x) => String(x.username).toLowerCase() === String(username).toLowerCase());
    if (!f) return '';
    if (!f.online) return '<p class="pp-conn">Friend · offline</p>';
    return `<p class="pp-conn">Friend · ${f.playing ? '🎮 Playing ' + esc((gameMeta(f.playing) || {}).name || f.playing) : '🟢 Online'} · ${pingBadge(f.ping, { label: true })}</p>`;
  }

  function renderPlayerPage() {
    const P = S.player || { loading: true };
    let inner;
    if (P.loading) inner = loadingBlock('Loading profile…');
    else if (P.error) inner = errorBlock(P.error);
    else {
      const d = P.data;
      inner = `<header class="pp-head">${avatar({ name: d.displayName, avatar: d.avatar }, 'big')}<div class="pp-id"><h1>${esc(d.displayName)}</h1><p>@${esc(d.username)} · ${esc(joinedText(d.joinedAt))}</p>${d.blockedByViewer ? '<p class="pp-blocked"><b>Blocked</b></p>' : friendLine(d.username)}</div></header>
        <div class="stat-grid"><div class="stat-tile"><span class="stat-v">${d.played}</span><span class="stat-l">Games played</span></div><div class="stat-tile good"><span class="stat-v">${d.wins}</span><span class="stat-l">Wins</span></div><div class="stat-tile"><span class="stat-v">${d.winRate === null ? '–' : d.winRate + '%'}</span><span class="stat-l">Win rate</span></div></div>`;
    }
    $app.innerHTML = `${topbarHTML()}<main class="page profile-page"><a class="back-link" href="/" data-act="goHome">← Back to games</a>${inner}</main>`;
  }

  // ---- account deletion
  function openDeleteAccountDialog() {
    openModal('Delete your account', `<form id="deleteForm" class="auth-form">
        <p class="hint" style="text-align:left;color:var(--ink)">This permanently deletes your account. It cannot be undone.</p>
        <ul class="plain-list">
          <li><b>Deleted:</b> your login (email and password), your username and display name, your avatar, your sessions on every device and your recent tables.</li>
          <li><b>Kept:</b> the games you finished, so other players’ history and results stay correct. Your seat in them is shown as “Deleted player” and is no longer linked to you.</li>
        </ul>
        <label class="label" for="deletePw">Enter your password to confirm</label>
        <input id="deletePw" type="password" required autocomplete="current-password" placeholder="Password">
        <p id="deleteMsg" class="auth-msg" role="alert" hidden></p>
        <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn ghost" data-modal-close>Cancel</button><button type="submit" class="btn danger">Delete my account</button></div>
      </form>`, (o) => {
      o.addEventListener('submit', async (e) => {
        if (e.target.id !== 'deleteForm') return;
        e.preventDefault();
        const msg = o.querySelector('#deleteMsg');
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const pw = o.querySelector('#deletePw').value;
          await withBusy('Deleting your account…', () => postJson('/api/me/delete-account', { password: pw }));
          closeModal();
          S.signedOutIntentionally = true;
          clearClientSession();
          for (const k of ['ct_name', 'ct_username', 'ct_avatar']) store.remove(k);
          S.name = ''; S.username = ''; S.named = false; S.avatar = ''; S.profile = null; S.recentTables = [];
          S.ready = false; S.room = null; S.view = null; S.page = 'home';
          try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
          loadSnapshot();
          toast('Your account has been deleted.');
        } catch (err) {
          msg.textContent = err.message || 'Could not delete the account.';
          msg.hidden = false;
          btn.disabled = false;
        }
      });
    });
  }

  // ------------------------------------------------------------ top bar, account menu and its dialogs
  const WHATS_NEW_VERSION = '2026-11-property-cards-settings';
  const WHATS_NEW = [
    ['🏙️', 'Property Rivals: city cards', 'Tap a city in a player’s holdings to see its mortgage value, the rent right now and the full rent table, and what houses and hotels cost. Each rival shows cash and net worth; the crown follows net worth.'],
    ['⚙️', 'Game settings at a glance', 'Every game shows its current settings at the top right. Tap them for the full list with each choice explained.'],
    ['🎙️', 'Talk at the table — voice chat', 'Tap the microphone to join voice and talk with everyone at your table, in the lobby or during a game. Tap it again to mute yourself. Use the speaker to listen without speaking or silence table audio. A mic marks people in voice and a green ring shows who is speaking. Voice supports up to 8 people. Allow microphone access when your browser asks; a headset helps prevent echo.', 'voice'],
  ];
  const HU = window.TVHomeUI({ S, esc, gameMeta, pingBadge, pendingSocial: () => pendingSocial() });
  const { socialHTML, inviteFriendsHTML, friendsStripHTML, friendsPageHTML, bellHTML, comingSoonHTML } = HU;
  /** Friend requests + table invitations waiting for an answer (drives the menu badge and the home strip). */
  const pendingSocial = () => S.friendRequests.incoming.length + S.invitations.incoming.length;
  const hasNewNews = () => S.wnSeen !== WHATS_NEW_VERSION;

  function topbarHTML() {
    const brand = '<a class="tb-brand" href="/" aria-label="Tableverse home"><span class="tb-mark">🂡</span><span class="tb-name">Tableverse</span></a>';
    if (S.guest && S.signingIn) {
      const who = S.named && S.name ? S.name : 'Player';
      return `<nav class="topbar" aria-label="Main">${brand}<div class="tb-right"><span class="tb-avatar-btn tb-signing" role="status" aria-live="polite" aria-atomic="true"><span class="sr-only">Signing in as ${esc(who)}</span>${avatar({ name: who, avatar: S.avatar }, 'tb-av')}<span class="spinner" aria-hidden="true"></span></span></div></nav>`;
    }
    if (S.guest) {
      return `<nav class="topbar" aria-label="Main">${brand}<div class="tb-right"><button type="button" class="btn ghost small" data-act="openFeedback">Feedback</button><button type="button" class="btn ghost small" data-act="showLogin">Log in</button><button type="button" class="btn small" data-act="showRegister">Sign up</button></div></nav>`;
    }
    const name = S.named ? S.name : 'Player';
    const av = avatar({ name, avatar: S.avatar }, 'tb-av');
    const item = (act, icon, label, extra = '', cls = '') => `<button type="button" role="menuitem" class="menu-item ${cls}" data-act="${act}"><span class="mi-ico" aria-hidden="true">${icon}</span><span class="mi-label">${label}</span>${extra}</button>`;
    const menu = S.menuOpen ? `<div class="menu" role="menu" aria-label="Account">
        <div class="menu-head">${av}<div class="menu-who"><b>${esc(name)}</b>${S.username ? `<small>@${esc(S.username)}</small>` : ''}</div></div>
        ${item('openProfilePage', '👤', 'Profile and history')}
        ${item('openFriendsPage', '👥', 'Friends')}
        ${item('openSettings', '⚙️', 'Settings')}
        ${item('openWhatsNew', '🎉', 'What’s new', hasNewNews() ? '<span class="mi-new">New</span>' : '')}
        ${item('openFeedback', '💬', 'Send feedback')}
        ${S.isStaff ? item('openAdmin', '🛠️', 'Admin console') : ''}
        <div class="menu-sep" role="separator"></div>
        ${item('logout', '🚪', 'Log out')}
        ${item('logoutAll', '🔒', 'Log out everywhere', '', 'dim')}
      </div>` : '';
    return `<nav class="topbar" aria-label="Main">${brand}<div class="tb-right">${bellHTML()}<div class="menu-wrap"><button type="button" class="tb-avatar-btn" data-act="toggleMenu" aria-haspopup="menu" aria-expanded="${S.menuOpen}" aria-label="Account menu for ${esc(name)}">${av}${hasNewNews() ? '<span class="tb-dot" aria-hidden="true"></span>' : ''}<span class="tb-caret" aria-hidden="true">▾</span></button>${menu}</div></div></nav>`;
  }

  /**
   * Every game gets the same compact toolbar: chat, reactions, a "more" menu (sound, log, scores/chips/stats) and leave.
   * The games render their own buttons; this moves the secondary ones into the menu so one row fits any phone.
   */
  function unifyToolbar() {
    const bar = $app.querySelector('.wz-top > .row, .ludo-tools');
    if (!bar) return;
    const isLeave = (b) => Object.values(b.dataset).includes('leave');
    const leave = [...bar.querySelectorAll('button')].find(isLeave);
    const chat = bar.querySelector('.chat-btn');
    const emote = bar.querySelector('[data-act="emotes"]');
    const extras = [...bar.querySelectorAll('button')].filter((b) => b !== leave && b !== chat && b !== emote);
    // Go Fish has no log: it would show what other players asked for
    if (!bar.closest('.gf') && !extras.some((b) => b.dataset.act === 'activityLog')) {
      const log = document.createElement('button');
      log.type = 'button'; log.className = 'btn ghost small'; log.dataset.act = 'activityLog'; log.setAttribute('aria-label', 'Open game log'); log.textContent = '📜 Log';
      extras.push(log);
    }
    const wrap = document.createElement('div');
    wrap.className = 'tb-more-wrap';
    wrap.innerHTML = `<button type="button" class="btn ghost small tb-more-btn" data-act="toggleTools" aria-haspopup="true" aria-expanded="${!!S.toolsOpen}" aria-label="More options">⋯</button><div class="tb-pop" role="group" aria-label="More options" ${S.toolsOpen ? '' : 'hidden'}></div>`;
    const pop = wrap.querySelector('.tb-pop');
    extras.forEach((b) => pop.appendChild(b));
    const vc = document.createElement('span'); vc.innerHTML = voiceButtonsHTML(); // microphone and speaker
    const bell = document.createElement('span'); bell.innerHTML = S.guest || !pendingSocial() ? '' : bellHTML(); // friend requests and invitations waiting
    bar.replaceChildren(...[chat, emote, ...bell.children, ...vc.children, wrap, leave].filter(Boolean)); // chat, reactions, voice, ⋯, then leave as the last button
  }
  function setTools(open) {
    S.toolsOpen = open;
    const btn = $app.querySelector('.tb-more-btn'); const pop = $app.querySelector('.tb-pop');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (pop) pop.hidden = !open;
  }

  function closeMenu() {
    if (!S.menuOpen) return false;
    S.menuOpen = false;
    render();
    return true;
  }

  const modalActions = {
    cardAdd: () => { const p = S.card && S.card.last; if (p && p.username) cardAction('/api/me/friend-requests', { username: p.username }, 'Friend request sent.', 'Sending request…'); },
    cardCancel: () => { const r = relationTo(S.card && S.card.last); if (r.request) cardAction('/api/me/friend-requests/cancel', { requestId: r.request.id }, undefined, 'Cancelling…'); },
    cardAccept: () => { const r = relationTo(S.card && S.card.last); if (r.request) cardAction('/api/me/friend-requests/accept', { requestId: r.request.id }, 'Friend request accepted.', 'Accepting…'); },
    cardDecline: () => { const r = relationTo(S.card && S.card.last); if (r.request) cardAction('/api/me/friend-requests/decline', { requestId: r.request.id }, undefined, 'Declining…'); },
    cardRemove: () => { const r = relationTo(S.card && S.card.last); if (!r.friend) return; openModal('Remove friend', '<p class="hint">Remove this friend? Any pending invitations between you will also be revoked.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Cancel</button><button type="button" class="btn danger" data-modal-act="cardRemoveConfirm">Remove friend</button></div>'); },
    cardRemoveConfirm: () => { const r = relationTo(S.card && S.card.last); closeModal(); if (r.friend) cardAction('/api/me/friends/remove', { friendId: r.friend.id }, 'Friend removed.', 'Removing friend…'); },
    removeFriendConfirm: () => { const id = S.pendingFriendRemovalId; S.pendingFriendRemovalId = null; closeModal(); if (id) socialPost('/api/me/friends/remove', { friendId: id }, 'Friend removed.', 'Removing friend…'); },
    leaveGameConfirm: () => { closeModal(); send({ t: 'leave' }); },
    cardMute: () => { const p = S.card && S.card.last; if (!p) return; if (muted.has(p.id)) muted.delete(p.id); else muted.add(p.id); saveMuted(); drawChat(); drawCard(); },
    cardEditMe: () => { closeModal(); openEditProfileDialog(); },
      makeHostConfirm: () => { closeModal(); if (S.pendingModalTarget) { const id = S.pendingModalTarget; S.pendingModalTarget = null; send({ t: 'makeHost', id }); } },
      kickPlayerConfirm: () => { closeModal(); if (S.pendingModalTarget) { const id = S.pendingModalTarget; S.pendingModalTarget = null; send({ t: 'kick', id }); } },
  };
  // an optional one-shot hook that runs when the dialog closes (used to return focus to the control that opened it)
  let modalOnClose = null;
  function closeModal() {
    const o = document.getElementById('modal-overlay');
    if (o) o.remove();
    const done = modalOnClose; modalOnClose = null;
    if (done) done();
  }
  function openModal(title, bodyHTML, onMount) {
    closeModal();
    const o = document.createElement('div');
    o.id = 'modal-overlay';
    o.className = 'overlay';
    o.innerHTML = `<div class="sheet modal-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="row modal-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost small" data-modal-close aria-label="Close">✕</button></div><div class="modal-body">${bodyHTML}</div></div>`;
    o.addEventListener('click', (e) => {
      if (e.target === o || e.target.closest('[data-modal-close]')) return closeModal();
      const el = e.target.closest('[data-modal-act]');
      if (el && !el.disabled && Object.hasOwn(modalActions, el.dataset.modalAct)) modalActions[el.dataset.modalAct](el, o);
    });
    document.body.appendChild(o);
    const first = o.querySelector('input, button:not([data-modal-close])');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
    if (onMount) onMount(o);
  }

  /** Edit name and avatar. The name is saved over HTTP (validated on the server); the avatar goes through the table socket as before. */
  /**
   * Change the profile picture. Signed-in players save it on their account (validated by the server, which also updates
   * the table they are sitting at); guests only have it for this session, so it goes over the socket as before.
   * The old picture comes back if the server refuses, so the screen never shows something that was not saved.
   */
  async function changeAvatar(next) {
    if (!next || next === S.avatar) return;
    const previous = S.avatar;
    S.avatar = next;
    store.set('ct_avatar', next);
    render();
    if (S.guest) { send({ t: 'setName', name: S.name || undefined, avatar: next }); return; }
    try {
      const out = await withBusy('Saving your picture…', () => postJson('/api/me/avatar', { avatar: next }));
      S.avatar = out.avatar;
      store.set('ct_avatar', out.avatar);
      if (S.profile && S.profile.data) S.profile.data.profile.avatar = out.avatar;
      toast('Profile picture saved');
    } catch (err) {
      S.avatar = previous;
      store.set('ct_avatar', previous || '');
      toast(err.message || 'Could not save the profile picture.');
    }
    render();
  }

  function openEditProfileDialog() {
    const body = () => {
      const name = S.named ? S.name : '';
      const picks = S.avatars.map((a) => `<button type="button" class="av-pick ${a === S.avatar ? 'on' : ''}" data-modal-act="pickAvatar" data-a="${esc(a)}" aria-label="Avatar ${esc(a)}" aria-pressed="${a === S.avatar}">${esc(a)}</button>`).join('');
      return `<form id="nameForm" class="auth-form">
          <label class="label" for="profileName">Display name</label>
          <input id="profileName" type="text" minlength="2" maxlength="20" required autocomplete="nickname" value="${esc(name)}">
          <small class="hint" style="text-align:left">2 to 20 characters. Other players at your tables see this name.</small>
          <p id="nameMsg" class="auth-msg" role="alert" hidden></p>
          <button class="btn" type="submit">Save name</button>
        </form>
        <span class="label" style="margin-top:6px">Avatar</span>
        <div class="av-picks">${picks}</div>`;
    };
    openModal('Edit profile', body(), (o) => {
      modalActions.pickAvatar = async (el) => {
        await changeAvatar(el.dataset.a);
        const keep = o.querySelector('#profileName').value;
        o.querySelector('.modal-body').innerHTML = body();
        o.querySelector('#profileName').value = keep;
      };
      o.addEventListener('submit', async (e) => {
        if (e.target.id !== 'nameForm') return;
        e.preventDefault();
        const msg = o.querySelector('#nameMsg');
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const newName = o.querySelector('#profileName').value;
          const out = await withBusy('Saving your name…', () => postJson('/api/me/display-name', { displayName: newName }));
          S.name = out.displayName; S.named = true;
          store.set('ct_name', S.name);
          if (S.profile && S.profile.data) S.profile.data.profile.displayName = S.name;
          closeModal();
          toast('Name saved');
          render();
        } catch (err) {
          msg.textContent = err.message || 'Could not save the name.';
          msg.hidden = false;
          btn.disabled = false;
        }
      });
    });
  }

  function openSettingsDialog() {
    const body = () => `<div class="setting-row"><div><b>Sound effects</b><small>Card sounds, turn alerts and fanfares. Saved on this device.</small></div><button type="button" class="btn ${CardTable.sound.isMuted() ? 'ghost' : ''} small" data-modal-act="toggleSound" aria-pressed="${!CardTable.sound.isMuted()}">${CardTable.sound.isMuted() ? 'Off' : 'On'}</button></div>
      <div class="setting-row"><div><b>Recent tables</b><small>${S.recentTables.length ? `${S.recentTables.length} saved on your account.` : 'Nothing saved yet.'}</small></div><button type="button" class="btn ghost small" data-modal-act="clearRecent" ${S.recentTables.length ? '' : 'disabled'}>Clear</button></div>
      <div class="setting-row"><div><b>Account</b><small>Profile, history and account deletion are on your profile page.</small></div><button type="button" class="btn ghost small" data-modal-act="openProfileFromSettings">Open</button></div>`;
    openModal('Settings', body(), (o) => {
      const redraw = () => { o.querySelector('.modal-body').innerHTML = body(); };
      modalActions.toggleSound = () => { CardTable.sound.toggle(); redraw(); };
      modalActions.clearRecent = async () => {
        try { await withBusy('Clearing…', () => postJson('/api/me/recent/clear', {})); S.recentTables = []; redraw(); render(); } catch (err) { toast(err.message || 'Could not clear recent tables'); }
      };
      modalActions.openProfileFromSettings = () => { closeModal(); openPage('profile'); };
    });
  }

  function openWhatsNewDialog() {
    S.wnSeen = WHATS_NEW_VERSION;
    store.set('ct_wn_seen', S.wnSeen);
    render();
    openModal('What’s new', `<ul class="wn-list">${WHATS_NEW.filter((w) => S.voiceEnabled || w[3] !== 'voice').map(([ico, t, d]) => `<li><span class="wn-ico" aria-hidden="true">${ico}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('')}</ul>`);
  }

  /** Fields whose text must survive a redraw (someone joins, a friend comes online) while the person is typing or choosing. */
  const KEEP_FIELDS = ['name', 'friendSearch', 'tableInviteFriend', 'code'];
  const VALUE_FIELDS = ['friendSearch', 'tableInviteFriend']; // the others are driven by state (S.name, S.draftCode): only focus and cursor come back
  function render() {
    const ae = document.activeElement;
    const focusedId = ae && KEEP_FIELDS.includes(ae.id) ? ae.id : null;
    // A folded panel the person opened (game options, spectators) stays open when the screen redraws, and a changed option
    // keeps its keyboard focus: changing one setting must not slam the panel shut.
    const openFolds = [...document.querySelectorAll('details[id]')].filter((d) => d.open).map((d) => d.id);
    const focusedOpt = ae && ae.dataset && ae.dataset.opt ? ae.dataset.opt : null;
    const saved = {};
    for (const id of KEEP_FIELDS) {
      const el = document.getElementById(id);
      if (el && el.value !== undefined) saved[id] = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
    }
    if (!S.room || S.room.status !== 'finished') S.endFlow = null;
    if (!S.ready && !S.guest && !S.room) {
      $app.innerHTML = '<div class="page"><div class="brand"><div class="mark">🂡</div><h1>Tableverse</h1><p>Connecting…</p></div></div>';
    } else if (!S.room && S.page === 'profile' && !S.guest) renderProfilePage();
    else if (!S.room && S.page === 'player') renderPlayerPage();
    else if (!S.room && S.page === 'friends' && !S.guest) $app.innerHTML = topbarHTML() + friendsPageHTML();
    else if (!S.room) renderHome();
    else if (S.room.status === 'lobby') renderLobby();
    else renderGame();
    updateWatchers();
    if ($chat && S.chatOpen) drawChat();
    for (const id of openFolds) { const d = document.getElementById(id); if (d && d.tagName === 'DETAILS') d.open = true; }
    if (focusedOpt) { const el = $app.querySelector(`[data-opt="${CSS.escape(focusedOpt)}"]`); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
    for (const id of KEEP_FIELDS) {
      const el = document.getElementById(id);
      const was = saved[id];
      if (!el || !was) continue;
      if (VALUE_FIELDS.includes(id) && el.value !== was.value && (el.tagName === 'SELECT' ? [...el.options].some((o) => o.value === was.value) : true)) el.value = was.value;
      if (id === focusedId) {
        el.focus();
        try { if (was.start !== null && was.start !== undefined) el.setSelectionRange(was.start, was.end); } catch { /* selects and some input types have no selection */ }
      }
    }
  }

  function renderHome() {
    const tiles = S.games.map((g) => `
      <article class="game-card" style="--accent:${esc(g.accent || '#7b4bd0')}">
        <div class="game-art" aria-hidden="true">${esc(g.icon || '🎴')}</div>
        <div class="game-body">
          <h3>${esc(g.name)} <small>${range(g.seats)}</small></h3>
          <p>${esc(g.tagline)}</p>
          <div class="row game-actions">
            <button class="btn small" type="button" data-act="create" data-game="${esc(g.id)}">Create table</button>
            <button class="btn ghost small" type="button" data-act="rules" data-game="${esc(g.id)}">Rules</button>
            ${g.id === 'wizard' ? (S.guest ? `<button class="btn ghost small" type="button" data-act="showLogin">Log in for offline scorecard</button>` : `<a class="btn ghost small" href="/scorecard.html?game=wizard">Wizard offline scorecard</a>`) : ''}
          </div>
        </div>
      </article>`).join('');
    const name = S.guest ? '' : (S.named ? S.name : '');
    $app.innerHTML = `
    ${topbarHTML()}
    <main class="page wide home">
      <section class="home-hero">
        <div class="home-intro">
          <h1>${name ? `Hi, ${esc(name)}` : 'Your friends. Your games. One table.'}</h1>
          <p>${name ? 'Pick a game to host a table, or join one with a code.' : 'Play card and board games with friends in your browser. Bots can fill any empty seat.'}</p>
          ${S.guest ? '<div class="row" style="gap:8px"><button type="button" class="btn" data-act="showRegister">Create account</button><button type="button" class="btn ghost" data-act="showLogin">Log in</button></div>' : ''}
        </div>
        <form class="join-form" id="joinForm" aria-label="Join a table">
          <label class="label" for="code">Have a table code?</label>
          <div class="join-row"><input id="code" type="text" maxlength="6" placeholder="ABCDEF" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(S.draftCode)}"><button class="btn" type="submit">Join</button></div>
          <small class="hint">Private tables open with an invitation from the host.</small>
        </form>
      </section>
      ${rejoinBannerHTML()}
      ${bannersHTML()}
      ${S.announcement && S.dismissedAnnouncement !== S.announcement ? `<div class="notice-bar" role="status"><span>${esc(S.announcement)}</span><button type="button" class="wn-close" data-act="dismissAnnouncement" aria-label="Dismiss announcement">✕</button></div>` : ''}
      ${friendsStripHTML()}
      <section class="home-section" id="games">
        <h2 class="section">Games</h2>
        ${tiles ? `<div class="game-grid">${tiles}</div>` : loadingBlock('Loading games…')}
      </section>
      ${comingSoonHTML()}
      ${recentTablesHTML()}
      ${publicTablesHTML()}
      <footer class="home-foot">${S.guest ? '' : '<button type="button" class="linklike" data-act="openWhatsNew">What’s new</button>'}</footer>
    </main>`;
  }

  function optionHTML(o, r, isHost) {
    const dis = isHost ? '' : 'disabled';
    if (o.type === 'boolean') {
      return `<div class="opt-card"><label class="opt"><input type="checkbox" data-opt="${esc(o.key)}" ${r.options[o.key] ? 'checked' : ''} ${dis}><span><b>${esc(o.label)}</b></span></label>${o.desc ? `<p class="opt-desc">${esc(o.desc)}</p>` : ''}</div>`;
    }
    const cur = o.choices.find((c) => c.value === r.options[o.key]) || o.choices[0];
    return `<div class="opt-card"><label class="opt-label" for="opt-${esc(o.key)}">${esc(o.label)}</label>
      <select id="opt-${esc(o.key)}" data-opt="${esc(o.key)}" ${dis}>${o.choices.map((c) => `<option value="${esc(c.value)}" ${c.value === cur.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      <p class="opt-desc">${esc(cur.desc)}</p></div>`;
  }

  /** One short line describing the current options, e.g. "Standard · Full game · No limit". */
  function optionsSummary(g, r) {
    return (g.options || []).map((o) => {
      if (o.type === 'boolean') return r.options[o.key] ? o.label : '';
      const cur = o.choices.find((c) => c.value === r.options[o.key]) || o.choices[0];
      return cur ? cur.label : '';
    }).filter(Boolean).join(' · ') || 'Standard rules';
  }

  /** The game's settings, as the host set them in the lobby, with each choice's explanation. Read only during a game. */
  function openGameSettings() {
    const r = S.room; const g = r && gameMeta(r.gameId);
    if (!g) return;
    const rows = (g.options || []).map((o) => {
      if (o.type === 'boolean') return `<li><b>${esc(o.label)}</b>: ${r.options[o.key] ? 'on' : 'off'}${o.desc ? `<br><small class="hint">${esc(o.desc)}</small>` : ''}</li>`;
      const cur = o.choices.find((c) => c.value === r.options[o.key]) || o.choices[0];
      return cur ? `<li><b>${esc(o.label)}</b>: ${esc(cur.label)}${cur.desc ? `<br><small class="hint">${esc(cur.desc)}</small>` : ''}</li>` : '';
    }).join('');
    openModal('Game settings', `<p class="hint">Set by the host in the lobby. They cannot be changed during a game.</p><ul class="gs-list">${rows || '<li>Standard rules</li>'}</ul>`, (o) => {
      // the dialog's only control is its close button: focus it, and keep Tab on it, so focus never reaches the game behind
      const close = o.querySelector('[data-modal-close]');
      if (!close) return;
      close.focus();
      o.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); close.focus(); } });
      // when it closes, focus returns to the settings chip; the chip is looked up at close time because a redraw may have replaced it
      modalOnClose = () => { const chip = document.querySelector('.gs-chip'); if (chip) chip.focus(); };
    });
  }

  /** A chip in the top-right of every game showing the current settings in one line; tapping it opens the full list. */
  function addSettingsChip() {
    const r = S.room; const g = r && gameMeta(r.gameId);
    if (!g || !r.options) return;
    const summary = optionsSummary(g, r);
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'btn ghost small gs-chip'; chip.dataset.act = 'gameSettings';
    chip.title = `Game settings: ${summary}`;
    chip.setAttribute('aria-label', `Game settings: ${summary}. Open for details.`);
    chip.innerHTML = `<span aria-hidden="true">⚙</span> <span class="gs-sum">${esc(summary)}</span>`;
    // Space on the focused chip opens the settings; it must not reach the document-level Space shortcuts (The Mind plays a card on Space)
    chip.addEventListener('keydown', (e) => { if (e.code === 'Space') e.stopPropagation(); });
    // In the title row, at its right end: the shared toolbar keeps exactly its own buttons, and no extra row is added.
    const title = $app.querySelector('.wz-top > .wz-round');
    if (title) { title.classList.add('gs-host'); title.after(chip); }
    else { chip.classList.add('gs-float'); $app.prepend(chip); }
  }

  function renderLobby() {
    const r = S.room;
    const g = gameMeta(r.gameId) || { name: r.gameId, options: [], seats: { min: r.min, max: r.max }, icon: '🎴' };
    const isHost = r.hostId === S.id;
    const n = r.members.length;
    const open = r.seats - n;
    const spectating = isSpectator();
    const seats = [];
    for (let i = 0; i < r.seats; i++) {
      const m = r.members[i];
      const label = r.seatLabels ? `<span class="tag team t${i % 2}">${esc(r.seatLabels[i])}</span>` : '';
      if (m) {
        seats.push(`
      <li class="seat" data-vid="${esc(m.id)}">
        ${avatar(m)}
        <span class="nm">${esc(m.name)}${m.id === S.id ? ' <em>(you)</em>' : ''}</span>
        ${label}
        ${m.id === r.hostId ? '<span class="tag host">host</span>' : ''}
        <span class="dot ${m.connected ? '' : 'off'}" title="${m.connected ? 'online' : 'offline'}"></span>
        ${isHost && m.bot ? `<button class="btn ghost small" data-act="removeBot" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">✕</button>` : ''}
        ${isHost && !m.bot && m.id !== S.id ? `<span class="seat-actions"><button class="btn ghost small" data-act="makeHost" data-id="${esc(m.id)}" data-name="${esc(m.name)}" aria-label="Make ${esc(m.name)} the host" title="Make host">👑</button><button class="btn ghost small" data-act="kickPlayer" data-id="${esc(m.id)}" data-name="${esc(m.name)}" aria-label="Remove ${esc(m.name)} from the table" title="Remove from table">✕</button></span>` : ''}
      </li>`);
      } else {
        seats.push(`<li class="seat empty"><span class="avatar ghost">?</span><span class="nm">Open seat</span>${label}</li>`);
      }
    }
    // A disabled seat control is explained in visible text (the seat status line), linked to the button, not only in a tooltip.
    const lessWhy = r.seats > g.seats.min ? '' : `${g.name} needs at least ${g.seats.min} players.`;
    const moreWhy = r.seats < g.seats.max ? '' : `${g.name} allows at most ${g.seats.max} players.`;
    const seatReason = (why) => (why ? ' disabled aria-describedby="seat-why"' : '');
    const stepper =
      g.seats.min !== g.seats.max
        ? `<div class="stepper" role="group" aria-label="Number of players">
            <button class="btn ghost small" data-act="seats" data-n="${r.seats - 1}" ${seatReason(lessWhy)} aria-label="Fewer players">−</button>
            <span><b>${r.seats}</b> players</span>
            <button class="btn ghost small" data-act="seats" data-n="${r.seats + 1}" ${seatReason(moreWhy)} aria-label="More players">+</button>
          </div>`
        : `<span class="label">${r.seats} players</span>`;
    const seatStatus = `${n} of ${r.seats} seat${r.seats === 1 ? '' : 's'} filled${open > 0 ? `; empty seats become bots when the game starts` : ''}.`;
    const opts = (g.options || []).map((o) => optionHTML(o, r, isHost)).join('');
    $app.innerHTML = `
    <main class="page">
      <div class="row" style="justify-content:space-between">
        <button class="btn ghost small" data-act="leave">← Leave</button>
        <h2>${esc(g.icon)} ${esc(g.name)}</h2>
        <span class="row" style="gap:6px">${S.guest || !pendingSocial() ? '' : bellHTML()}${voiceButtonsHTML()}${CardTable.chat.button()}<button class="btn ghost small" data-act="rules" data-game="${esc(r.gameId)}">Rules</button></span>
      </div>
      ${spectating ? `<section class="panel"><h3>👁 You are watching</h3><p class="hint" style="text-align:left;margin:6px 0 10px">The next game starts when the host presses Start. ${open > 0 ? 'There is an open seat if you want to play.' : 'Ask the host to free a seat if you want to play.'}</p>${open > 0 ? '<button class="btn" data-act="sit">Take a seat</button>' : ''}</section>` : ''}
      ${r.spectators && r.spectators.length ? `<details id="fold-spectators" class="spectator-list"><summary>👁 ${r.spectators.length} watching</summary>${isHost ? `<ul class="spectator-people">${r.spectators.map((x) => `<li><span class="nm">${esc(x.name)}</span><button class="btn ghost small" data-act="kickPlayer" data-id="${esc(x.id)}" data-name="${esc(x.name)}" aria-label="Remove ${esc(x.name)} from the table" title="Remove from table">✕</button></li>`).join('')}</ul>` : `<div class="spectator-names">${r.spectators.map((x) => esc(x.name)).join(', ')}</div>`}</details>` : ''}
      <section class="panel code-card">
        <div class="label">Table code</div>
        <div class="code">${esc(r.code)}</div>
        ${r.visibility === 'public' ? `<div class="row" style="justify-content:center">
          <button class="btn small" data-act="copyLink">Copy invite link</button>
          <button class="btn small wa" data-act="whatsapp">WhatsApp</button>
          ${navigator.share ? '<button class="btn ghost small" data-act="share">Share…</button>' : ''}
        </div>` : ''}
        ${isHost ? `<div class="visibility-control"><span class="visibility-status ${r.visibility === 'public' ? 'public' : 'private'}" title="${r.visibility === 'public' ? 'Anyone can find this table in Open tables.' : 'Only friends with an accepted invitation can join.'}">${r.visibility === 'public' ? '🌐 Public table' : '🔒 Private table'}</span><button class="btn ghost small" data-act="toggleVisibility">${r.visibility === 'public' ? 'Make private' : 'Make public'}</button></div>` : ''}
        ${inviteFriendsHTML()}
      </section>
      <section class="panel">
        <div class="row" style="justify-content:space-between">
          <h3>Players <span class="label">${n} joined</span></h3>
          ${isHost ? stepper : `<span class="label">${r.seats} seats</span>`}
        </div>
        <p class="hint seat-status" id="seat-why" style="text-align:left;margin:8px 0 0">${esc([seatStatus, lessWhy, moreWhy].filter(Boolean).join(' '))}</p>
        <ul class="seats">${seats.join('')}</ul>
        ${isHost && open > 0 ? `<div class="row" style="margin-top:12px"><button class="btn ghost small" data-act="addBot">+ Add a bot</button><button class="btn ghost small" data-act="fillBots">Fill ${open} open seat${open === 1 ? '' : 's'} with bots</button></div>` : ''}
      </section>
      ${opts ? `<details id="fold-options" class="panel fold"><summary><span class="fold-title">Game options</span><span class="fold-hint">${esc(optionsSummary(g, r))}</span></summary><div class="opts">${opts}</div>${isHost ? '' : '<p class="hint" style="margin-top:8px">Only the host can change these.</p>'}</details>` : ''}
      ${
        isHost
          ? `<div class="start-bar"><button class="btn big" data-act="start">Start game${open > 0 ? ` <small>· ${open} bot${open === 1 ? '' : 's'} will join</small>` : ''}</button></div>`
          : `<div class="start-bar wait"><p class="label" style="text-align:center;margin:0">Waiting for the host to start… ${esc(seatStatus)}</p></div>`
      }
    </main>`;
    refreshVoiceUI();
  }

  // ------------------------------------------------------------ player stats
  const statsGame = (id) => gameMeta(id) || { name: id, icon: '🎴' };
  const KIND_NOTE = { team: 'team game: a win means your team won', coop: 'co-operative: the whole table wins or loses together' };
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

  /** The statistics block of a profile. Games you left early and bot seats are never counted (the server leaves them out). */
  function statsHTML(s) {
    if (!s || !s.played) return emptyState('🃏', 'No finished games yet', 'Finish a game with friends or bots and your record shows up here. Games you leave early are not counted.');
    const fav = s.favouriteGame ? statsGame(s.favouriteGame) : null;
    const tile = (label, value, cls = '') => `<div class="stat-tile ${cls}"><span class="stat-v">${value}</span><span class="stat-l">${label}</span></div>`;
    const games = s.perGame.map((g) => {
      const meta = statsGame(g.gameId);
      return `<div class="stat-game"><span class="stat-game-name">${esc(meta.icon || '🎴')} ${esc(meta.name)}${KIND_NOTE[g.kind] ? ` <small class="stat-kind" title="${esc(KIND_NOTE[g.kind])}">${g.kind === 'coop' ? 'co-op' : 'teams'}</small>` : ''}</span><span class="stat-game-rec">${g.wins}W · ${g.losses}L</span><span class="stat-bar" aria-hidden="true"><i style="width:${g.winRate || 0}%"></i></span><span class="stat-game-pct">${g.winRate}%</span>${g.best !== null && g.bestLabel ? `<span class="stat-game-best">${esc(g.bestLabel)}: <b>${esc(g.bestText)}</b></span>` : ''}</div>`;
    }).join('');
    const recent = s.recent.map((r) => `<span class="stat-chip ${r.won ? 'w' : 'l'}" title="${esc(statsGame(r.gameId).name)} · ${esc(fmtDate(r.finishedAt))}">${esc(statsGame(r.gameId).icon || '🎴')}<b>${r.won ? 'W' : 'L'}</b></span>`).join('');
    return `
      <div class="stat-grid">
        ${tile('Games played', s.played)}
        ${tile('Wins', s.wins, 'good')}
        ${tile('Losses', s.losses)}
        ${tile('Win rate', s.winRate + '%')}
        ${tile('Favourite game', fav ? `${esc(fav.icon || '🎴')} ${esc(fav.name)}` : '–', 'wide')}
        ${tile('Win streak', s.streak.current)}
        ${tile('Best streak', s.streak.best)}
      </div>
      <h3 class="stat-h">By game</h3>
      <div class="stat-games">${games}</div>
      <h3 class="stat-h">Last ${s.recent.length} games <small>(newest first)</small></h3>
      <div class="stat-recent">${recent}</div>
      <p class="hint" style="text-align:left;margin-top:12px">Ties share the win. Games you left early are not counted.</p>`;
  }

  function openActivityLog() {
    const entries = (S.view && S.view.log) || [];
    const overlay = document.createElement('div');
    overlay.className = 'overlay activity-overlay';
    overlay.innerHTML = `<div class="sheet activity-sheet" data-stop="1"><div class="row" style="justify-content:space-between"><h2>Game log</h2><button class="btn ghost small" data-log-close>Close</button></div>${entries.length ? `<ol class="activity-list">${entries.slice(-60).reverse().map((e) => `<li><span>${esc(logLine(e))}</span></li>`).join('')}</ol>` : '<p class="hint">No plays yet.</p>'}</div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-log-close]')) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /**
   * A bot is playing a seat for a person who left or went offline: a small robot on that player's seat or list row, removed
   * again when they come back. Games mark their players with data-pid; this works the same for every game.
   */
  function markStandIns(root) {
    if (!root || !S.room) return;
    const standIn = new Set((S.room.members || []).filter((m) => m.standIn).map((m) => m.id));
    root.querySelectorAll('[data-pid]').forEach((el) => {
      if (el.classList.contains('ludo-token')) return;
      const want = standIn.has(el.dataset.pid);
      const has = el.querySelector('.standin');
      if (want && !has) {
        const m = S.room.members.find((x) => x.id === el.dataset.pid);
        const badge = document.createElement('span');
        badge.className = 'standin';
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', `A bot is playing for ${m ? m.name : 'this player'}`);
        badge.title = `A bot is playing for ${m ? m.name : 'this player'} until they come back`;
        badge.textContent = '🤖';
        (el.querySelector(':scope > .av') || el.querySelector('.sl-pname, .pr-pn > b, .ludo-player > b') || el).appendChild(badge);
      } else if (!want && has) has.remove();
    });
  }
  let standInWatch = null;
  function watchStandIns() {
    if (standInWatch || typeof MutationObserver === 'undefined') return;
    let queued = false;
    standInWatch = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (S.room && S.view) markStandIns($app); });
    });
    standInWatch.observe($app, { childList: true, subtree: true });
  }

  function renderGame() {
    const plugin = plugins[S.room.gameId];
    if (!plugin || !S.view) {
      $app.innerHTML = '<div class="page"><p>This game is not available in your browser version. Reload the page.</p></div>';
      return;
    }
    plugin.render($app, S.view, {
      room: S.room,
      game: gameMeta(S.room.gameId),
      isHost: S.room.hostId === S.id,
      activityLog: () => { if (!S.room || S.room.gameId !== 'gofish') openActivityLog(); },
      act: (action) => send({ t: 'act', action }),
      leave: () => {
        const playing = S.room.status === 'playing' && !isSpectator();
        if (!playing) send({ t: 'leave' });
        else openModal('Leave game', '<p class="hint">Leave this game? A bot will take your seat, and you can rejoin from the home screen.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Stay</button><button type="button" class="btn danger" data-modal-act="leaveGameConfirm">Leave game</button></div>');
      },
      rematch: () => send({ t: 'rematch' }),
      showRules: () => showRules(S.room.gameId),
      rerender: render,
      toast,
    });
    markStandIns($app);
    watchStandIns();
    const statusText = $app.querySelector('.ludo-status b, .tm-status-guidance, .wz-status > span');
    announceStatus(statusText ? statusText.textContent : '');
    unifyToolbar();
    addSettingsChip();
    refreshVoiceUI();
    endFlow();
    if (CardTable.feed) CardTable.feed.sync($app, S.room.gameId, S.view, S.room.code);
    const surface = $app.querySelector('.wz, .ludo, .tm, .pk') || $app.firstElementChild;
    const gameInfo = gameMeta(S.room.gameId);
    if (surface && gameInfo) {
      const log = S.room.gameId === 'gofish' ? [] : (S.view.log || []).slice(-12).reverse(); // Go Fish has no log: it would reveal what others asked for
      const supporting = document.createElement('section');
      supporting.className = 'game-supporting-details';
      supporting.innerHTML = `${log.length ? `<details class="game-info-panel"><summary>📜 Game log <span>${S.view.log.length} plays</span></summary><ol>${log.map((e) => `<li><span>${esc(logLine(e))}</span></li>`).join('')}</ol></details>` : ''}${(gameInfo.rules || []).length ? `<details class="game-info-panel"><summary>📖 How to play</summary>${gameInfo.rules.map((rule) => `<p>${esc(rule)}</p>`).join('')}</details>` : ''}`;
      if (supporting.innerHTML) surface.appendChild(supporting);
    }
    const bar = $app.querySelector('.wz-status');
    if (bar) bar.insertAdjacentHTML('beforeend', '<span class="ct-timer" hidden></span>');
    updateTimer();
  }

  // ------------------------------------------------------------ end of a game
  const END_BOARD_MS = 3500; // the finished table stays visible
  const END_WINNER_MS = 2800; // then the "<name> won" pop-up
  /** Board → winner pop-up → result with Leave / Play again (or a vote). Every game's own result sheet stays hidden until the last stage. */
  function endFlow() {
    const r = S.room;
    if (!r || r.status !== 'finished') { $app.classList.remove('endhold'); return; }
    if (!S.endFlow || S.endFlow.code !== r.code) S.endFlow = { code: r.code, start: Date.now() - Math.max(0, (r.outcome && r.outcome.sinceMs) || 0), timer: null };
    const f = S.endFlow;
    clearTimeout(f.timer);
    const t = Date.now() - f.start;
    const stage = t < END_BOARD_MS ? 'board' : t < END_BOARD_MS + END_WINNER_MS ? 'winner' : 'result';
    $app.classList.toggle('endhold', stage !== 'result');
    if (stage !== 'result') f.timer = setTimeout(() => { if (S.room && S.room.code === f.code && S.room.status === 'finished') render(); }, (stage === 'board' ? END_BOARD_MS : END_BOARD_MS + END_WINNER_MS) - t + 30);
    if (stage === 'winner') {
      const w = (r.outcome && r.outcome.winners) || [];
      const names = w.map((x) => (x.id === S.id ? 'You' : x.name));
      const text = !names.length ? 'Game over' : names.length === 1 ? (w[0].id === S.id ? 'You won! 🎉' : `${esc(names[0])} won!`) : `${esc(names.join(' & '))} won!`;
      $app.insertAdjacentHTML('beforeend', `<div class="end-pop" role="status" aria-live="polite"><div class="end-pop-card"><div class="end-pop-ico" aria-hidden="true">🏆</div><b>${text}</b></div></div>`);
    }
    if (stage === 'result') {
      const spectator = isSpectator();
      const isHost = r.hostId === S.id;
      const humans = r.members.filter((m) => !m.bot);
      const voters = humans.filter((m) => m.id !== r.hostId).length;
      const votes = (r.votes || []).filter((id) => id !== r.hostId).length;
      const mine = (r.votes || []).includes(S.id);
      const again = isHost ? '<button class="btn" type="button" data-act="endAgain">Play again</button>'
        : spectator ? ''
        : `<button class="btn${mine ? ' ghost' : ''}" type="button" data-act="endVote">${mine ? 'Voted ✓ (tap to undo)' : 'Vote to play again'}</button>`;
      const count = voters ? `<span class="hint end-votes">${isHost ? 'Players who want another game' : 'Votes to play again'}: <b>${votes}/${voters}</b></span>` : '';
      const html = `<div class="row end-actions">${again}<button class="btn ghost" type="button" data-act="endLeave">Leave game</button></div>${count}`;
      for (const b of $app.querySelectorAll('button')) {
        if (!Object.values(b.dataset).includes('again') || b.dataset.act) continue;
        const row = b.closest('.row') || b.parentElement;
        row.classList.add('end-actions-wrap');
        row.innerHTML = html;
      }
      // Games whose non-host sees only a hint (no button) are covered by the row of the host button; if none was found, add a bar.
      for (const h of $app.querySelectorAll('.overlay .hint, .ludo-end .hint')) if (/waiting for the host/i.test(h.textContent)) h.remove();
      if (!$app.querySelector('.end-actions')) $app.insertAdjacentHTML('beforeend', `<div class="end-bar">${html}</div>`);
    }
  }

  // ------------------------------------------------------------ events
  const actions = {
    endAgain: () => send({ t: 'rematch' }),
    endVote: () => send({ t: 'rematchVote', on: !(S.room.votes || []).includes(S.id) }),
    endLeave: () => send({ t: 'leave' }),
    playerCard: (el) => openPlayerCard(el.dataset.pid),
    avatar: (el) => { S.avatarOpen = false; changeAvatar(el.dataset.a); },
    scrollGames: () => document.getElementById('games')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }),
    goHome: (el, e) => { if (e) e.preventDefault(); openPage('home'); },
    reloadProfile: () => loadProfile(),
    profileTab: (el) => { if (S.profile) { S.profile.tab = el.dataset.tab; if (el.dataset.tab === 'account') send({ t: 'blocks' }); render(); } },
    unblock: (el) => {
      const id = el.dataset.id;
      S.blocked = (S.blocked || []).filter((b) => b.id !== id); // the server confirms with the full list straight after
      render();
      send({ t: 'unblock', id });
    },
    historyPage: (el) => loadProfile(Number(el.dataset.page) || 1),
    editProfile: () => openEditProfileDialog(),
    openDeleteAccount: () => openDeleteAccountDialog(),
    copyProfileLink: async () => {
      const u = S.profile && S.profile.data && S.profile.data.profile.username;
      if (!u) return;
      const url = `${location.origin}/#u/${u}`;
      try { await navigator.clipboard.writeText(url); toast('Profile link copied'); } catch { window.prompt('Copy this link:', url); }
    },
    toggleMenu: () => { S.menuOpen = !S.menuOpen; S.bellOpen = false; render(); },
    toggleTools: () => setTools(!S.toolsOpen),
    toggleBell: () => { S.bellOpen = !S.bellOpen; S.menuOpen = false; render(); if (S.bellOpen) loadSocial({ quiet: true }); },
    openProfilePage: () => { S.menuOpen = false; openPage('profile'); },
    openFriendsPage: () => { S.menuOpen = false; S.bellOpen = false; openPage('friends'); },
    openSettings: () => { S.menuOpen = false; render(); openSettingsDialog(); },
    openWhatsNew: () => { S.menuOpen = false; openWhatsNewDialog(); },
    toggleAvatars: () => { S.avatarOpen = !S.avatarOpen; render(); },
    emotes: () => toggleEmoteBar(),
    activityLog: () => { if (!S.room || S.room.gameId !== 'gofish') openActivityLog(); },
    voiceMic: () => voice.toggleMic(),
    voiceSpeaker: () => voice.toggleSpeaker(),
    sound: () => { CardTable.sound.toggle(); render(); },
    create: (el) => {
      if (!authed()) return gateLogin(() => actions.create(el));
      const game = el.dataset.game;
      send({ t: 'create', gameId: game, visibility: 'private', name: S.name || undefined, avatar: S.avatar || undefined });
    },
    toggleVisibility: () => {
      const cur = S.room && S.room.visibility;
      send({ t: 'setVisibility', visibility: cur === 'public' ? 'private' : 'public' });
    },
    // The server decides: your old seat if you had one (a bot is playing it), otherwise a seat in a lobby, otherwise watching.
    rejoin: (el) => askJoinMode(el.dataset.code, tableByCode(el.dataset.code)),
    joinPublic: (el) => askJoinMode(el.dataset.code, tableByCode(el.dataset.code)),
    toggleSessions: () => { S.sessionListOpen = !S.sessionListOpen; store.set('ct_sessions_open', S.sessionListOpen ? '1' : '0'); render(); },
    leave: () => send({ t: 'leave' }),
    chat: () => (S.chatOpen ? closeChat() : openChat()),
    sit: () => send({ t: 'sit' }),
    rules: (el) => showRules(el.dataset.game),
    addBot: () => send({ t: 'addBot' }),
    fillBots: () => {
      for (let i = 0; i < S.room.seats - S.room.members.length; i++) send({ t: 'addBot' });
    },
    removeBot: (el) => send({ t: 'removeBot', id: el.dataset.id }),
    makeHost: (el) => { S.pendingModalTarget = el.dataset.id; openModal('Make host', `<p class="hint">Make ${esc(el.dataset.name || 'this player')} the host of this table? You will stay at the table, but only the host can start the game and change settings.</p><div class="row" style="margin-top:12px; gap:10px"><button class="btn ghost small" data-modal-close>Cancel</button><button class="btn" data-modal-act="makeHostConfirm">Make host</button></div>`); },
    kickPlayer: (el) => { S.pendingModalTarget = el.dataset.id; openModal('Remove player', `<p class="hint">Remove ${esc(el.dataset.name || 'this player')} from this table? They will not be able to come back.</p><div class="row" style="margin-top:12px; gap:10px"><button class="btn ghost small" data-modal-close>Cancel</button><button class="btn" data-modal-act="kickPlayerConfirm">Remove</button></div>`); },
    seats: (el) => send({ t: 'setSeats', seats: Number(el.dataset.n) }),
    start: () => send({ t: 'start' }),
    dismissBanner: (el) => dismissBanner(el.dataset.id),
    openAdmin: () => { S.menuOpen = false; location.href = '/admin.html'; },
    openFeedback: () => { S.menuOpen = false; openFeedbackModal(); },
    dismissAnnouncement: () => {
      S.dismissedAnnouncement = S.announcement;
      store.set('ct_ann', S.announcement);
      render();
    },
    refreshSocial: () => loadSocial(),
    openProfile: (el) => openPage('player', el.dataset.username),
    sendFriend: (el) => socialPost('/api/me/friend-requests', { username: el.dataset.username }, 'Friend request sent.', 'Sending request…'),
    acceptFriend: (el) => socialPost('/api/me/friend-requests/accept', { requestId: el.dataset.id }, 'Friend request accepted.', 'Accepting…'),
    declineFriend: (el) => socialPost('/api/me/friend-requests/decline', { requestId: el.dataset.id }, undefined, 'Declining…'),
    cancelFriend: (el) => socialPost('/api/me/friend-requests/cancel', { requestId: el.dataset.id }, undefined, 'Cancelling…'),
    removeFriend: (el) => { S.pendingFriendRemovalId = el.dataset.id; openModal('Remove friend', '<p class="hint">Remove this friend? Any pending invitations between you will also be revoked.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Cancel</button><button type="button" class="btn danger" data-modal-act="removeFriendConfirm">Remove friend</button></div>'); },
    acceptInvitation: async (el) => {
      try {
        const known = S.invitations.incoming.find((i) => String(i.id) === String(el.dataset.id)); // the list is reloaded below, so keep what we know about it
        showBusy('Joining table…');
        const out = await postJson('/api/me/table-invitations/accept', { invitationId: el.dataset.id });
        await loadSocial({ quiet: true });
        joinAcceptedInvitation({ ...(known || {}), ...(out.invitation || {}), status: (out.invitation && out.invitation.status) || 'accepted' });
      } catch (error) { hideBusy(); S.socialError = error.message || 'Could not accept invitation.'; render(); }
    },
    declineInvitation: (el) => socialPost('/api/me/table-invitations/decline', { invitationId: el.dataset.id }, undefined, 'Declining…'),
    revokeInvitation: (el) => socialPost('/api/me/table-invitations/revoke', { invitationId: el.dataset.id }, undefined, 'Revoking…'),
    logout: () => { S.menuOpen = false; doLogout(); },
    logoutAll: () => { S.menuOpen = false; doLogoutAll(); },
    copyLink: async () => {
      const url = safeTableUrl();
      try {
        await navigator.clipboard.writeText(url);
        toast(S.room.visibility === 'public' ? 'Table link copied' : 'Private code is not an access grant. Invite friends from the table.');
      } catch {
        window.prompt('Copy this link:', url);
      }
    },
    whatsapp: () => {
      const g = gameMeta(S.room.gameId);
      const url = safeTableUrl();
      const text = S.room.visibility === 'public'
        ? `Join my ${g ? g.name : 'card'} table on Tableverse: ${url} (code ${S.room.code})`
        : `Join my private ${g ? g.name : 'card'} table on Tableverse. I will send you a friend invitation in the app.`;
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    },
    share: () => {
      const url = safeTableUrl();
      const text = S.room.visibility === 'public' ? `Join my table (code ${S.room.code})` : 'I will send you a private table invitation in the app.';
      navigator.share({ title: 'Tableverse', text, url }).catch(() => {});
    },
  };

  $app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled && Object.hasOwn(actions, el.dataset.act)) actions[el.dataset.act](el, e);
  });
  $app.addEventListener('input', (e) => {
    if (e.target.id === 'name') {
      S.name = e.target.value.trim().slice(0, 20);
      S.named = !!S.name;
      if (S.name) store.set('ct_name', S.name);
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => S.name && send({ t: 'setName', name: S.name, avatar: S.avatar || undefined }), 400);
    } else if (e.target.id === 'code') {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
      S.draftCode = e.target.value;
    }
  });
  $app.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.opt && S.room) {
      const options = {};
      $app.querySelectorAll('[data-opt]').forEach((c) => { options[c.dataset.opt] = c.type === 'checkbox' ? c.checked : c.value; });
      send({ t: 'setOptions', options });
    }
  });
  $app.addEventListener('submit', async (e) => {
    if (e.target.id === 'joinForm') {
      e.preventDefault();
      if (S.draftCode.length !== 6) return toast('Enter the 6-letter table code');
      const code = S.draftCode;
      gateLogin(() => askJoinMode(code, tableByCode(code)));
    } else if (e.target.id === 'friendSearchForm') {
      e.preventDefault();
      searchFriends(document.getElementById('friendSearch')?.value || '');
    } else if (e.target.id === 'tableInviteForm') {
      e.preventDefault();
      const username = document.getElementById('tableInviteFriend')?.value;
      if (!username || !S.room || S.room.visibility !== 'private') return;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      try {
        await withBusy('Sending invitation…', async () => {
          await postJson('/api/me/table-invitations', { username, gameId: S.room.gameId, roomCode: S.room.code, expiresAt });
          await loadSocial({ quiet: true });
        });
        toast('Invitation sent.');
        render();
      } catch (error) {
        S.socialError = error.message || 'Could not send invitation.';
        render();
      }
    }
  });

  setInterval(() => { if (S.ready && !S.room) loadSocial({ quiet: true }); }, 60000);

})();
