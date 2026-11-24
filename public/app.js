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

  let sessionGen = 0; // bumped when the signed-in account changes, so an answer for the previous account is dropped
  // how long a seat change may hold the seat controls while waiting for the server's state (a fallback; an error or the new order ends it sooner)
  const SEAT_CHANGE_FALLBACK_MS = 10000;
  const S = {
    id: null,
    token: '', // short-lived websocket auth credential (never persisted)
    csrf: '', // fetched from the server (cookie-backed), never stored
    emailVerified: false,
    email: '',
    name: store.get('ct_name') || '',
    username: store.get('ct_username') || '',
    games: [],
    gamesLoaded: false, // the game list has arrived at least once (an empty list is then an answer, not a loading state)
    gamesFailed: false, // the guest request for the list failed and nothing has arrived since
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
    sessionListOpen: store.get('ct_sessions_open') !== '0',
    guest: false, // true when the home screen is the public snapshot (no socket, no session)
    isGuest: false, // a guest session: a temporary account made by "Play as a guest" (lib/guestPolicy.js)
    role: null, // owner | admin | user | guest, once known (decides which games are open, see gameOpenFor)
    guestPlay: false, // the server allows new guest sessions (GUEST_PLAY_ENABLED)
    guestHours: 72, // how long a guest session lasts, from the server
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
  /** Other people are still playing this game with us: leaving then counts as a loss. Against bots only it does not. */
  const otherHumansPlaying = () => !!(S.room && S.room.status === 'playing' && !isSpectator() && (S.room.members || []).some((m) => m.id !== S.id && !m.bot));
  /** What leaving now does, as the server decides it: 'counts' (a loss), 'abandons' (the game is abandoned, only final penalties count) or 'abandoned'. */
  const leaveInfo = () => (S.room && S.room.leaveInfo) || { abandoned: false, pending: [], counts: {} };
  /** What leaving now does for this player: 'counts' (a loss), 'abandons' (someone else's penalty is pending) or 'abandoned'. */
  const leaveState = () => { const li = leaveInfo(); if (li.abandoned) return 'abandoned'; return li.pending.some((id) => id !== S.id) ? 'abandons' : 'counts'; };
  /** How many times this player has left this game. The third leave is final: its penalty stays even after a rejoin. */
  const leavesSoFar = () => leaveInfo().counts[S.id] || 0;
  /** Extra sentence for the prompt when this leave would be the third (or a later) one. */
  const finalLeaveNote = () => (leavesSoFar() >= 2 ? ' This would be your third leave in this game: the penalty is final, and coming back inside the time window does not remove it.' : '');
  /** One sentence for the profile and leave prompts, matching what leaving now actually does. */
  const leaveConsequence = () => {
    const state = leaveState();
    if (state === 'abandons') return ' Another player has already left, so leaving now abandons the game: only non-final penalties are removed; final penalties still count.';
    if (state === 'abandoned') return ' The game is already abandoned, so leaving costs nothing.';
    return ' Leaving counts as a loss for you.';
  };
  /** How long a person who leaves may take the seat back, as the server sets it (REJOIN_GRACE_SECONDS). */
  const rejoinWithin = () => { const s = (S.room && S.room.rejoinWindowSeconds) ?? 120; return s % 60 === 0 ? (s / 60) + ' minute' + (s === 60 ? '' : 's') : s + ' seconds'; };
  /** Every leave goes through here: with other people still playing, ask first, because the leave may cost something. */
  /** The result is written in the background and can finish after the player has left: refresh the level a few times. */
  function scheduleLevelRefresh() {
    refreshLevel();
    setTimeout(refreshLevel, 4000);
    setTimeout(refreshLevel, 15000);
  }
  /** Leaves the table. A finished game refreshes the level once the result is written, even if the player leaves early. */
  function leaveNow() {
    if (S.room && S.room.status === 'finished') scheduleLevelRefresh();
    send({ t: 'leave' });
  }
  function requestLeave() {
    if (!otherHumansPlaying()) { leaveNow(); return; }
    const state = leaveState();
    if (state === 'abandoned') {
      openModal('Leave game?', '<p class="hint">The game is already abandoned, so leaving costs nothing. A bot takes your seat, and the others keep playing. You can watch the game from the home screen.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Stay</button><button type="button" class="btn danger" data-modal-act="leaveGameConfirm">Leave</button></div>');
      return;
    }
    if (state === 'abandons') {
      openModal('Leave game?', '<p class="hint">Another player has already left, so leaving now abandons the game. Only non-final penalties are removed; final penalties still count, and the people who stayed get no result.' + finalLeaveNote() + ' A bot takes your seat. Once the game is abandoned, you cannot take your seat back. You can watch the game from the home screen.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Stay</button><button type="button" class="btn danger" data-modal-act="leaveGameConfirm">Leave and abandon the game</button></div>');
      return;
    }
    openModal('Leave game?', '<p class="hint">Are you sure? Leaving counts as a loss for you if the game finishes.' + finalLeaveNote() + ' A bot takes your seat, and the others keep playing. If another player also leaves, the game is abandoned: only non-final penalties are removed; final penalties still count. You can take your seat back from the home screen within ' + rejoinWithin() + ' of your first leave in this game. The time does not restart if you leave and come back again. After that the bot keeps the seat. Taking your seat back removes only non-final penalties; a final penalty still counts. Once the game is abandoned, you cannot take your seat back.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Stay</button><button type="button" class="btn danger" data-modal-act="leaveGameConfirm">Leave and count as a loss</button></div>');
  }

  window.CardTable = Object.assign(window.CardTable || {}, {
    esc,
    toast,
    register: (id, p) => { plugins[id] = p; },
    announceStatus,
    chat: {
      button: () => `<button class="btn ghost small chat-btn" data-act="chat" aria-label="Open chat">💬<span class="cb" ${S.unread ? '' : 'hidden'}>${S.unread}</span></button>`,
    },
    // Shared toolbar seed: sound, chat, reactions, game-specific controls, then leave.
    toolbarSeed: (midHTML, leaveKey, cls) => `<div class="${cls || 'row'}" data-table-tools${cls ? '' : ' style="gap:6px"'}>${window.CardTable.sound.button()}${window.CardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button>${midHTML}<button class="btn ghost small" data-${leaveKey}="leave" aria-label="Leave table">✕</button></div>`,
  });

  const gameMeta = (id) => S.games.find((g) => g.id === id);
  // the game's SVG mark (public/game-marks.js); the emoji icon when there is no mark
  const gameMark = (g) => (window.GameMarks ? window.GameMarks.html(g.id, g.icon || '🎴') : esc(g.icon || '🎴'));
  /** The account reminder for a guest on this page (lib/guest.js decides whether it may show now); '' for everybody else. */
  const guestNudge = (ctx) => (S.isGuest && window.TvGuest ? window.TvGuest.nudgeHTML(ctx, { guest: true, hours: S.guestHours }) : '');
  const addNudge = (ctx) => {
    const host = $app.querySelector('main, .page');
    if (!host || host.querySelector(`.guest-nudge[data-guest-ctx="${ctx}"]`)) return; // a reminder already on screen is not repeated
    const n = guestNudge(ctx);
    if (n) host.insertAdjacentHTML('afterbegin', n);
  };
  /** May this viewer play the game now: the owner's access mode (public/game-access.js) for this viewer's role. Before the
   *  viewer is known (the public page), only a game open to everybody counts. The server is the authority. */
  const gameOpenFor = (g) => {
    if (!g) return false;
    if (S.role && window.TvGameAccess && g.access) return window.TvGameAccess.allows(g.access, S.role);
    return g.enabled !== false;
  };
  /** Locked only because this viewer is a guest: a registered player could play it, so the account prompt applies. */
  const guestLockedFor = (g) => !!g && !gameOpenFor(g) && S.role === 'guest' && !!window.TvGameAccess && window.TvGameAccess.allows(g.access, 'user');
  const inviteUrl = () => `${location.origin}/#${S.room.code}`;
  const safeTableUrl = () => S.room && S.room.visibility === 'public' ? inviteUrl() : `${location.origin}/`;

  // ------------------------------------------------------------ how to play: cards
  // Each rule paragraph of a game is one card (the "made with our own cards" notice goes under the last one). Games can draw
  // a picture for a card: CardTable.howtoArt[gameId] = (cardIndex, game) => html; without one the game's mark is shown.
  // The cards open by themselves the first time someone is seated in a running game, and from "How to play" in the ⋯ menu.
  window.CardTable.howtoArt = window.CardTable.howtoArt || {};
  const OWN_GAME = /made with our own cards/i;
  function howtoCards(g) {
    const rules = g.rules || [], titles = g.ruleTitles || [];
    const cards = [];
    let note = '';
    rules.forEach((text, i) => {
      if (OWN_GAME.test(text)) { note = text; return; }
      cards.push({ title: titles[i] || `Step ${cards.length + 1}`, text, art: i });
    });
    const variants = (g.options || [])
      .filter((o) => (o.type === 'select' || o.desc) && !o.noRules)
      .map((o) => {
        if (o.type === 'boolean') return `<dt>${esc(o.label)}</dt><dd>${esc(o.desc)}</dd>`;
        return o.choices.filter((c) => c.value !== o.default || o.choices.length > 2).map((c) => `<dt>${esc(o.label)}: ${esc(c.label)}</dt><dd>${esc(c.desc)}</dd>`).join('');
      })
      .join('');
    if (variants) cards.push({ title: 'Options', html: `<dl class="variants">${variants}</dl>`, art: -1 });
    return { cards, note };
  }

  let howtoOpen = null; // the open overlay, so there is only ever one
  function showRules(gameId, opts = {}) {
    const g = gameMeta(gameId);
    if (!g) return;
    if (howtoOpen) howtoOpen.close();
    const { cards, note } = howtoCards(g);
    if (!cards.length) return;
    let i = 0;
    const el = document.createElement('div');
    el.className = 'overlay ht-overlay';
    const inerted = [...document.body.children].filter((n) => n.tagName !== 'SCRIPT' && n.id !== 'toasts' && !n.hasAttribute('inert'));
    const opener = document.activeElement;
    const close = () => {
      inerted.forEach((n) => n.removeAttribute('inert'));
      el.remove();
      howtoOpen = null;
      store.set(`tv_howto_${gameId}`, '1');
      // A redraw can replace the opener while the dialog is open.
      const back = opener && opener.isConnected && opener.focus ? opener
        : document.querySelector(`button[data-act="rules"][data-game="${CSS.escape(gameId)}"]:not([hidden], [hidden] *)`) || document.querySelector('.tb-more-btn');
      if (back && back.focus) back.focus();
    };
    const paint = () => {
      const c = cards[i], last = i === cards.length - 1;
      const artFn = window.CardTable.howtoArt[gameId];
      const art = (c.art >= 0 && artFn && artFn(c.art, g)) || `<span class="ht-mark">${gameMark(g)}</span>`;
      el.innerHTML = `<div class="sheet ht-sheet" role="dialog" aria-modal="true" aria-label="How to play ${esc(g.name)}">
        <div class="ht-kicker">How to play ${esc(g.name)} · ${i + 1} of ${cards.length}</div>
        <h2>${esc(c.title)}</h2>
        <div class="ht-art" aria-hidden="true">${art}</div>
        ${c.html || `<p class="rule">${esc(c.text)}</p>`}
        ${last && note ? `<p class="ht-note">${esc(note)}</p>` : ''}
        <div class="ht-dots" aria-hidden="true">${cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="row ht-actions">${i > 0 ? '<button class="btn ghost" type="button" data-ht="back">Back</button>' : ''}${last ? '<button class="btn" type="button" data-ht="done" data-close="1">Got it</button>' : '<button class="btn" type="button" data-ht="next">Next</button>'}${last ? '' : '<button class="btn ghost" type="button" data-ht="done" data-close="1">Skip</button>'}</div>
      </div>`;
      const primary = el.querySelector('[data-ht="next"], [data-ht="done"]');
      if (primary) primary.focus();
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ht]');
      if (e.target === el) return close();
      if (!b) return;
      if (b.dataset.ht === 'next') { i = Math.min(cards.length - 1, i + 1); paint(); }
      else if (b.dataset.ht === 'back') { i = Math.max(0, i - 1); paint(); }
      else close();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && i < cards.length - 1) { i++; paint(); }
      else if (e.key === 'ArrowLeft' && i > 0) { i--; paint(); }
      else if (e.key === 'Tab') { // keep focus inside the card
        const f = [...el.querySelectorAll('button')];
        if (!f.length) return;
        const first = f[0], lastB = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastB.focus(); }
        else if (!e.shiftKey && document.activeElement === lastB) { e.preventDefault(); first.focus(); }
        else if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    });
    document.body.appendChild(el);
    inerted.forEach((n) => n.setAttribute('inert', ''));
    howtoOpen = { close };
    paint();
  }
  window.CardTable.showRules = showRules;

  /** The first time someone is seated in a running game of this kind on this device, the cards open by themselves. */
  function autoHowTo() {
    const r = S.room;
    if (!r || r.status !== 'playing' || isSpectator() || howtoOpen || store.get('tv_howto_all') || store.get(`tv_howto_${r.gameId}`)) return;
    store.set(`tv_howto_${r.gameId}`, '1'); // decided once: a closed or skipped card is not shown again
    showRules(r.gameId, { auto: true });
  }

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
      reqVeilOwned = false; // the veil is gone: a request that settles later must not hide a veil that comes after it
      // The person was told to try again. Requests still waiting stop counting toward the veil, so they cannot bring it back;
      // a request started later counts again.
      reqPending.clear();
      clearTimeout(reqVeilTimer); reqVeilTimer = null;
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
      if (epoch === httpBusyEpoch) { httpBusy--; if (!httpBusy && !reqVeilOwned) hideBusy(); }
    }
  }
  // Every user-started request (postJson / getJson) shows a loading veil if it is still running after a short delay,
  // so quick answers do not flash. Background polls pass { quiet: true } and never show it.
  let reqPending = new Set(); // requests that may still own the veil; a timed-out veil clears it
  let reqVeilTimer = null;
  let reqVeilOwned = false;
  // After 350 ms, take the veil unless another action holds it. If one does, look again shortly: the veil must still come
  // when that action releases it while this request is still waiting.
  function armReqVeil() {
    reqVeilTimer = setTimeout(() => {
      reqVeilTimer = null;
      if (reqPending.size === 0 || reqVeilOwned) return;
      if (httpBusy || document.getElementById('busyBlock')) { armReqVeil(); return; }
      reqVeilOwned = true;
      showBusy('Loading…', 20000, 'load');
    }, 350);
  }
  async function trackRequest(opts, fn) {
    if (opts && opts.quiet) return fn();
    const token = {};
    reqPending.add(token);
    if (!reqVeilTimer && !reqVeilOwned) armReqVeil();
    try { return await fn(); } finally {
      reqPending.delete(token);
      if (reqPending.size === 0) {
        clearTimeout(reqVeilTimer); reqVeilTimer = null;
        if (reqVeilOwned) {
          reqVeilOwned = false;
          // a sign-in that is waiting for the socket keeps its own veil until welcome arrives
          if (!httpBusy && !S.signingIn) hideBusy();
        }
      }
    }
  }
  /** Right after a successful login the socket still has to say welcome. Until then show the profile, spin, and block taps. */
  function beginSignIn() {
    S.signingIn = true;
    showBusy('Signing you in…');
    render();
  }
  const send = (msg) => {
    if (!(ws && ws.readyState === 1)) return false; // nothing was sent (not connected)
    ws.send(JSON.stringify(msg));
    if (BUSY_LABELS[msg.t]) showBusy(BUSY_LABELS[msg.t], BUSY_FAST.has(msg.t) ? 8000 : 20000, msg.t);
    return true;
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

  function postJson(url, body, retried, opts) {
    return trackRequest(opts, () => postJsonNow(url, body, retried));
  }
  async function postJsonNow(url, body, retried) {
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
      return postJsonNow(url, body, true); // the outer call is already tracked, so the retry skips a second count
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
      S.isGuest = out.isGuest === true;
      S.role = out.role || (S.isGuest ? 'guest' : 'user');
      S.welcomeDue = out.welcome === true; // first login: the welcome dialog is shown once, after the lobby starts
      refreshLevel();
      return true;
    } catch {
      return false;
    }
  }

  function clearClientSession() {
    S.isStaff = false;
    S.welcomeBack = null; S.welcomeFor = null; S.welcomeLoaded = undefined; // another account must not see this one's card
    // requests of the previous session must not hold the loading veil into the next sign-in
    reqVeilOwned = false; reqPending.clear(); clearTimeout(reqVeilTimer); reqVeilTimer = null;
    S.banners = [];
    S.token = '';
    S.csrf = '';
    S.emailVerified = false;
    S.email = '';
    S.isGuest = false; S.role = null;
    S.id = null;
    store.set('ct_csrf', ''); // older versions kept it in localStorage
    S.ping = null; S.page = 'home'; S.profile = null; S.account = null; S.levelUp = null; S.country = undefined; sessionGen += 1; levelRequest += 1; S.latestProgress = null; S.latestProgressUser = null; S.latestProgressRequest = 0; closeModal(); S.player = null; S.recentTables = []; // nothing of the old account stays on screen
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

  // Always the same: a registered account verifies its e-mail first. (Not tied to the flag a guest session changes.)
  function authPolicyHintHTML() {
    return '<p class="auth-policy-hint">Email verification is required before entering the lobby.</p>';
  }

  /** What a guest is told when the owner has locked an area for guests (server code guest_locked, with the feature name). */
  const GUEST_LOCK_TEXT = {
    private_tables: 'Create a free account to open a private table.',
    rejoin: 'Create a free account to go back to a table you left.',
    profiles: 'Create a free account to see player profiles and stats.',
    blocking: 'Create a free account to block players.',
    reports: 'Create a free account to report players or messages.',
  };
  const guestLockedHere = (feature) => !!S.isGuest && Array.isArray(S.guestLocked) && S.guestLocked.includes(feature);
  /** Marks a control as locked for this guest (styled by [data-guest-lock]). Empty when the area is open. */
  const lockAttr = (feature) => guestLockedHere(feature) ? ` data-guest-lock="${feature}" aria-disabled="true"` : '';
  // A tap on a locked control shows the account reminder and sends nothing (the server would refuse it anyway).
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-guest-lock]');
    if (!el || !guestLockedHere(el.dataset.guestLock)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openAuthSheet('register', GUEST_LOCK_TEXT[el.dataset.guestLock]);
  }, true);

  // The auth sheet: a small dialog over the (public) home page. Logging in is never a place you get sent to —
  // it is a step you take when you try to play, and afterwards you land where you were heading.
  // `isError` makes the message an alert, so a failed login or sign-up is announced at once by screen readers.
  // the sign-in sheet may already be open when the server's answer arrives: add or remove its guest option to match
  function syncGuestOption() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    const want = S.guestPlay && !S.isGuest;
    const have = overlay.querySelector('[data-act="playAsGuest"]');
    if (want && !have) { const tabs = overlay.querySelector('.auth-tabs'); if (tabs) tabs.insertAdjacentHTML('afterend', '<button type="button" class="btn ghost auth-guest" data-act="playAsGuest">Play as a guest</button>'); }
    if (!want && have) have.remove();
  }
  // the display name the owner typed when a sign-up was refused: the sheet is rebuilt with it, not with the guest's old name
  let pendingRegisterName = null;
  // Changes only the message of an open sheet, so what was typed and the focus stay as they are.
  function setAuthMessage(overlay, msg, isError) {
    const slot = overlay.querySelector('.auth-msg-slot');
    if (!slot || !msg) return;
    slot.innerHTML = `<p class="auth-msg" role="${isError ? 'alert' : 'status'}">${esc(msg)}</p>`;
  }
  function openAuthSheet(tab = 'login', msg = '', isError = false) {
    // Already open on this tab (a reconnect, a refused login, a failed sign-up): keep what was typed and where the focus is.
    // The sheet is rebuilt only when it opens on another tab or was not open.
    const open = document.getElementById('auth-overlay');
    if (open && open.dataset.tab === tab) { S.auth = tab; setAuthMessage(open, msg, isError); return; }
    const draftName = pendingRegisterName;
    pendingRegisterName = null;
    S.auth = tab;
    const origin = authOpener || document.activeElement; // the control that started this sheet keeps focus-return
    closeOverlay();
    const loginOn = tab === 'login';
    const resend = S.requireEmailVerification ? '<button class="btn ghost small" data-act="resendVerification">Resend verification email</button>' : '';
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'overlay';
    overlay.dataset.tab = tab;
    overlay.innerHTML = `<div class="sheet auth-sheet" data-stop="1" role="dialog" aria-label="${loginOn ? 'Log in' : 'Create account'}">
      <div class="row" style="justify-content:space-between"><h2>${loginOn ? 'Welcome back' : 'Create your account'}</h2><button class="btn ghost small" data-auth-close aria-label="Close">✕</button></div>
      <div class="auth-msg-slot">${msg ? `<p class="auth-msg" role="${isError ? 'alert' : 'status'}">${esc(msg)}</p>` : ''}</div>
      <div class="row auth-tabs">
        <button class="btn ${loginOn ? '' : 'ghost'} small" data-act="showLogin">Log in</button>
        <button class="btn ${loginOn ? 'ghost' : ''} small" data-act="showRegister">Create account</button>
      </div>
      ${S.guestPlay && !S.isGuest ? '<button type="button" class="btn ghost auth-guest" data-act="playAsGuest">Play as a guest</button>' : ''}
      <div id="googleSlot" class="google-slot" hidden><div id="googleBtn"></div><label class="check-row"><input id="googleRemember" type="checkbox"> Keep me signed in on this device</label><p class="auth-or"><span>or use your email</span></p></div>
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
          <input id="registerName" type="text" maxlength="20" required placeholder="Display name" autocomplete="nickname" value="${esc(draftName ?? (S.isGuest ? (S.name || '') : ''))}">
          <input id="registerUsername" type="text" maxlength="24" required pattern="[a-z0-9_]{3,24}" placeholder="Username (lowercase)" autocomplete="username" autocapitalize="off" spellcheck="false">
          <small id="registerUsernameHint" class="hint"></small>
          <input id="registerEmail" type="email" required placeholder="Email" autocomplete="email">
          ${authPolicyHintHTML()}
          <input id="registerPassword" type="password" required minlength="8" placeholder="Password (8+ characters)" autocomplete="new-password" aria-describedby="registerPwHint">
          <small id="registerPwHint" class="hint" aria-live="polite">Use at least 8 characters. Avoid obvious words such as "password".</small>
          <label class="auth-check"><input id="registerAdult" type="checkbox" required> I am 18 or older.</label>
          <button class="btn big" type="submit">Create account</button>
        </form>
      `}
      ${legalLinksHtml()}
    </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-auth-close]')) closeOverlay(); });
    authOpener = origin;
    authOpenerSel = openerSelector(origin);
    document.body.appendChild(overlay);
    mountGoogle();
    const first = document.getElementById(loginOn ? 'loginEmail' : 'registerName');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
    if (!loginOn) {
      // The hint is wired once, when the sheet opens, so it follows the password, the e-mail and the username in any order.
      // It uses the same check as the server (public/password-policy.js), so it cannot say "Looks good." for a refused password.
      const pwInput = document.getElementById('registerPassword');
      const pwHint = document.getElementById('registerPwHint');
      const emailInput = document.getElementById('registerEmail');
      const u = document.getElementById('registerUsername');
      const trimmed = (el) => String((el && el.value) || '').trim().toLowerCase();
      const updateHint = () => {
        if (!pwInput || !pwHint || !window.TvPassword) return;
        const h = window.TvPassword.hint(pwInput.value, { email: trimmed(emailInput), username: trimmed(u) });
        pwHint.classList.toggle('bad', h.bad);
        pwHint.textContent = h.text;
      };
      if (pwInput) pwInput.addEventListener('input', updateHint);
      if (emailInput) emailInput.addEventListener('input', updateHint);
      updateHint();
      if (u) u.addEventListener('input', async () => {
        const value = trimmed(u);
        u.value = value;
        updateHint();
        const hint = document.getElementById('registerUsernameHint');
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

  // "Continue with Google": shown only when the server has it configured. The page never decides who someone is: it forwards
  // Google's token to the server, which verifies it.
  async function mountGoogle() {
    const slot = document.getElementById('googleSlot');
    if (!slot || !window.TvGoogle) return;
    if (!(await window.TvGoogle.available())) return;
    const btn = document.getElementById('googleBtn');
    if (!btn || !btn.isConnected) return;
    slot.hidden = false;
    window.TvGoogle.mount(btn, onGoogleCredential, () => { slot.hidden = true; });
  }

  let googleBusy = false;
  async function onGoogleCredential(credential) {
    if (googleBusy) return;
    googleBusy = true;
    try {
      const remember = !!(document.getElementById('googleRemember') || {}).checked;
      const out = await withBusy('Signing in with Google…', () => postJson('/api/auth/google', { credential, rememberDevice: remember }));
      if (out.needsSignup) return openGoogleSignupSheet(credential, { ...out, remember });
      finishSignIn(out);
    } catch (err) {
      openAuthSheet(S.auth || 'login', err.message || 'Google sign-in failed.', true);
    } finally { googleBusy = false; }
  }

  // A new person: Google proved the address, they still choose a username and confirm they are an adult.
  function openGoogleSignupSheet(credential, info, msg = '') {
    closeOverlay();
    S.auth = 'google';
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="sheet auth-sheet" data-stop="1" role="dialog" aria-label="Finish creating your account">
      <div class="row" style="justify-content:space-between"><h2>Almost there</h2><button class="btn ghost small" data-auth-close aria-label="Close">✕</button></div>
      <p class="hint" style="text-align:left">Signing up with Google as <b>${esc(info.email)}</b>. Choose how you appear at the table.</p>
      ${msg ? `<p class="auth-msg" role="alert">${esc(msg)}</p>` : ''}
      <form id="googleSignupForm" class="auth-form">
        <input id="googleName" type="text" maxlength="20" required placeholder="Display name" autocomplete="nickname" value="${esc(info.suggestedName || '')}">
        <input id="googleUsername" type="text" maxlength="24" required pattern="[a-z0-9_]{3,24}" placeholder="Username (lowercase)" autocomplete="username" autocapitalize="off" spellcheck="false">
        <small id="googleUsernameHint" class="hint"></small>
        <label class="auth-check"><input id="googleAdult" type="checkbox" required> I am 18 or older.</label>
        <label class="auth-check"><input id="googleKeep" type="checkbox"${info.remember ? ' checked' : ''}> Keep me signed in on this device <small class="hint">Only on a device you own.</small></label>
        <button class="btn big" type="submit">Create account</button>
      </form>
      ${legalLinksHtml()}
    </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-auth-close]')) closeOverlay(); });
    overlay.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = String(overlay.querySelector('#googleUsername').value || '').trim().toLowerCase();
      const displayName = overlay.querySelector('#googleName').value;
      const adultConfirmed = overlay.querySelector('#googleAdult').checked;
      const remember = overlay.querySelector('#googleKeep').checked;
      try {
        const out = await withBusy('Creating your account…', () => postJson('/api/auth/google/complete', { credential, username, displayName, avatar: S.avatar || undefined, adultConfirmed, rememberDevice: remember }));
        finishSignIn(out);
      } catch (err) { openGoogleSignupSheet(credential, { ...info, remember }, err.message || 'Could not create the account.'); }
    });
    const u = overlay.querySelector('#googleUsername');
    u.addEventListener('input', async () => {
      const value = String(u.value || '').trim().toLowerCase(); u.value = value;
      const hint = overlay.querySelector('#googleUsernameHint');
      if (!value) { hint.textContent = ''; return; }
      if (!/^[a-z0-9_]{3,24}$/.test(value)) { hint.textContent = 'Use 3-24 chars: lowercase letters, numbers, underscore.'; return; }
      try { const o = await fetch(`/api/auth/username-available?username=${encodeURIComponent(value)}`).then((r) => r.json()); hint.textContent = o.available ? 'Username is available.' : 'Username is already taken.'; } catch { hint.textContent = ''; }
    });
    document.body.appendChild(overlay);
    if (!matchMedia('(pointer: coarse)').matches) overlay.querySelector('#googleUsername').focus();
  }

  let authOpener = null; // the control that opened the sheet: focus returns to it when the sheet closes
  let authOpenerSel = null; // a selector for that control (data-act and data-game), used when a redraw has replaced it
  // The selector finds the same control again after a redraw: the action and, for a per-game button, its game.
  const openerSelector = (el) => {
    const act = el && el.getAttribute ? el.getAttribute('data-act') : null;
    if (!act) return null;
    const game = el.getAttribute('data-game');
    return `[data-act="${act}"]` + (game ? `[data-game="${game}"]` : '');
  };
  function closeOverlay() {
    const el = document.getElementById('auth-overlay');
    if (el) el.remove();
    S.auth = null;
    const back = authOpener, sel = authOpenerSel; authOpener = null; authOpenerSel = null;
    const target = back && back.isConnected ? back : (sel ? document.querySelector(sel) : null);
    if (target && target.focus) target.focus();
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
    finishSignIn(out);
  }

  // After the server has started a session (password login or Google): adopt the player and connect.
  function finishSignIn(out) {
    S.token = '';
    if (out.csrfToken) S.csrf = out.csrfToken;
    adoptPlayer(out.player);
    // a registered sign-in is not a guest, even if this page was a guest a moment ago (the welcome message confirms the role)
    S.isGuest = false; S.role = null;
    S.requireEmailVerification = policyRequiresVerification(out);
    S.emailVerified = !!(out.player && out.player.email_verified);
    S.signedOutIntentionally = false;
    if (S.requireEmailVerification && !S.emailVerified) {
      openAuthSheet('login', 'Please verify your email before playing. Use “Resend verification email” if the link did not arrive.');
      return;
    }
    S.welcomeDue = out.welcome === true;
    closeOverlay();
    beginSignIn();
    if (S.welcomeDue) showWelcome();
    connect();
    if (!S.emailVerified) toast('Email verification pending. Verify your email to enter the lobby.');
  }

  /** "Play as a guest": the server makes a temporary account and a session cookie. The page connects as that guest. */
  function finishGuestSignIn(out) {
    S.token = '';
    if (out.csrfToken) S.csrf = out.csrfToken;
    adoptPlayer(out.player || {}, { name: out.player && out.player.name });
    S.isGuest = true; S.role = 'guest';
    S.guestHours = Number(out.expiresInHours) || 72;
    S.requireEmailVerification = false; S.emailVerified = false;
    S.signedOutIntentionally = false;
    S.welcomeDue = false;
    closeOverlay();
    beginSignIn();
    connect();
  }
  async function doPlayAsGuest(name) {
    const out = await withBusy('Starting your guest visit…', () => postJson('/api/auth/guest', { displayName: name || undefined, avatar: S.avatar || undefined }));
    finishGuestSignIn(out);
  }
  function openGuestSheet(msg = '') {
    // the control that started this (even through the login sheet) gets focus back when the guest sheet closes
    const origin = authOpener || document.activeElement;
    closeOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'overlay';
    overlay.innerHTML = window.TvGuest.guestSheetHTML({ hours: S.guestHours }) + (msg ? `<p class="auth-msg" role="status">${esc(msg)}</p>` : '');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
    // Tab stays inside the sheet, as in the other dialogs
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = [...overlay.querySelectorAll('button, input, select, textarea, a[href]')].filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const inside = overlay.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    });
    authOpener = origin;
    authOpenerSel = openerSelector(origin);
    document.body.appendChild(overlay);
    // a text field would open the on-screen keyboard on touch screens, so focus a button there
    const coarse = matchMedia('(pointer: coarse)').matches;
    const target = coarse ? overlay.querySelector('button') : document.getElementById('guestName');
    if (target && target.focus) target.focus();
  }
  // The guest sheet's "create a free account" and the reminder's button both open the register sheet. guest.js loads after this
  // file, so it announces the tap with an event rather than through a hook that would not exist yet.
  document.addEventListener('tv:guest-upgrade', () => openAuthSheet('register'));
  document.addEventListener('tv:guest-close', () => closeOverlay());

  /**
   * Asks to turn the guest into an account. Nothing changes yet: the server e-mails a confirmation link, and the guest stays a
   * guest (same game, same locks) until that link is used. The account then takes effect on the server at once.
   */
  async function doUpgradeGuest(name, username, email, password, adultConfirmed) {
    const out = await withBusy('Sending your confirmation…', () => postJson('/api/auth/upgrade-guest', { displayName: name, username, email, password, adultConfirmed: adultConfirmed === true }));
    if (out.csrfToken) S.csrf = out.csrfToken;
    closeOverlay();
    toast(out.message || 'Check your email to confirm your account.');
  }

  async function doRegister(name, username, email, password, adultConfirmed) {
    if (S.isGuest) return doUpgradeGuest(name, username, email, password, adultConfirmed);
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
      // A block or unblock still waiting when the socket drops may never have reached the server, so the optimistic state on
      // screen is not trusted: show the last state the server confirmed, and check again when the socket is back (welcome).
      if (S.player && S.player.busy && S.player.data && S.player.confirmedBlockedByMe !== undefined && S.player.data.blockedByMe !== S.player.confirmedBlockedByMe) {
        S.player.data.blockedByMe = S.player.confirmedBlockedByMe;
        if (S.page === 'player') render();
      }
      clearPlayerBusy(S.player); // an answer to a request sent on this socket can no longer arrive
      // A profile waiting for the server's 'left' cannot open after a drop: the leave may never arrive, and a later leave must not open it.
      S.pendingPage = null;
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
    if (!quiet) { S.socialLoading = true; S.socialError = ''; }
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
        // a proxy or server error page is not JSON: say the friends list could not load, not show a parse error
        const data = await r.json().catch(() => ({ ok: false }));
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load friends. Try again.');
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
      const mine = S.rejoin.find((x) => x.code === r.code);
      if (mine && mine.canReclaim === false && mine.noSeatedHumans) {
        return `<div class="recent-table"><span>↺</span><b>${esc(r.name)}</b><code>${esc(r.code)}</code><small>Game paused</small></div>`;
      }
      const reclaim = mine && mine.canReclaim !== false;
      const status = reclaim ? 'Your seat is waiting' : mine ? 'Watch game' : r.status === 'playing' ? 'In progress' : 'Open';
      const action = mine && !reclaim ? 'watch' : 'rejoin';
      return `<button class="recent-table ${reclaim ? 'mine' : ''}" data-act="${action}" data-code="${esc(r.code)}"><span>↺</span><b>${esc(r.name)}</b><code>${esc(r.code)}</code>${reclaim ? '<em class="rj-badge">Rejoin</em>' : `<small>${status}</small>`}</button>`;
    }).join('');
    return `<section class="home-section"><h2 class="section">Recent tables</h2><div class="recent-tables">${rows}</div></section>`;
  }

  /** Big banner at the top of the home screen: a game is running and a bot is playing your seat. */
  function rejoinBannerHTML() {
    if (!S.rejoin.length) return '';
    return S.rejoin.map((r) => {
      const g = gameMeta(r.gameId) || { id: r.gameId, name: r.gameId, icon: '🎴' };
      const canReclaim = r.canReclaim !== false;
      const message = canReclaim
        ? `${r.paused ? 'Everyone stepped out, so it is paused' : 'A bot is playing your seat'} at table <code>${esc(r.code)}</code>. Jump back in to carry on.`
        : `${r.noSeatedHumans ? 'The rejoin window has passed, so this game cannot resume.' : 'The rejoin window has passed, but you can still watch'} at table <code>${esc(r.code)}</code>.`;
      const action = canReclaim
        ? `<button class="btn" data-act="rejoin" data-code="${esc(r.code)}">Rejoin</button>`
        : r.noSeatedHumans ? '' : `<button class="btn" data-act="watch" data-code="${esc(r.code)}">Watch</button>`;
      return `<div class="rejoin-banner panel" role="status"><span class="rj-ico">${gameMark(g)}</span><div class="rj-text"><b>Your ${esc(g.name)} game is still running</b><span>${message}</span></div>${action}</div>`;
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
  // only the newest request may set the staff flag, so a delayed older answer cannot undo a newer role change
  let staffHintSeq = 0;
  async function loadStaffHint() {
    const seq = ++staffHintSeq;
    try {
      const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
      const out = await r.json();
      if (seq !== staffHintSeq) return;
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
  // Background refreshes follow use: they run only while the page is visible and the person has done something in the last
  // 5 minutes. A tab left open all day would otherwise ask the server (and so the database) every minute, which keeps the
  // database awake for nobody. Coming back, or the first input after a pause, refreshes at once.
  const POLL_IDLE_MS = 5 * 60 * 1000;
  let lastInputAt = Date.now();
  let polling = true; // false once the pause has begun
  const pollWanted = () => document.visibilityState === 'visible' && Date.now() - lastInputAt < POLL_IDLE_MS;
  const refreshBackground = () => { loadBanners(); if (S.ready && !S.room) loadSocial({ quiet: true }); };
  const noteInput = () => {
    lastInputAt = Date.now();
    if (!polling && document.visibilityState === 'visible') { polling = true; refreshBackground(); }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove']) window.addEventListener(ev, noteInput, { passive: true, capture: true });
  setInterval(() => { if (pollWanted()) refreshBackground(); else polling = false; }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lastInputAt = Date.now(); polling = true; refreshBackground(); } });

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
  // The server says which legal pages are live (privacy, terms, Impressum). Each link is shown only when its page answers 200.
  function applyLegal(m) {
    if (typeof m.impressumPublished === 'boolean') S.impressumPublished = m.impressumPublished;
    if (typeof m.privacyPublished === 'boolean') S.privacyPublished = m.privacyPublished;
    if (typeof m.termsPublished === 'boolean') S.termsPublished = m.termsPublished;
  }
  /** Links for the sign-in and sign-up sheet. Empty when no legal page is live. */
  function legalLinksHtml() {
    const links = [];
    if (S.privacyPublished) links.push('<a href="/privacy">Privacy notice</a>');
    if (S.termsPublished) links.push('<a href="/terms">Terms</a>');
    if (S.impressumPublished) links.push('<a href="/impressum.html">Impressum</a>');
    return links.length ? `<p class="hint auth-legal">${links.join(' · ')}</p>` : '';
  }
  // A sign-in sheet that was already open when the flags arrived gets the links added (or removed) in place, so typed input survives.
  function syncImpressumLink() {
    const sheet = document.querySelector('#auth-overlay .sheet');
    if (!sheet) return;
    sheet.querySelectorAll('.auth-legal').forEach((el) => el.remove());
    const html = legalLinksHtml();
    if (html) sheet.insertAdjacentHTML('beforeend', html);
  }

  async function loadSnapshot() {
    S.guest = true;
    S.rejoin = []; // a stale "your game is waiting" banner must not survive into guest browsing
    try {
      const r = await fetch('/api/games', { credentials: 'same-origin' });
      const out = await r.json();
      if (out && out.ok) {
        S.games = out.games || [];
        S.gamesLoaded = true; S.gamesFailed = false;
        S.guestPlay = out.guestPlay === true;
        if (Number(out.guestHours) > 0) S.guestHours = Number(out.guestHours);
        syncGuestOption();
        S.publicTables = out.tables || [];
        S.announcement = typeof out.announcement === 'string' ? out.announcement : '';
        // signed-out visitors get the publication flag here (they have no welcome); only a real boolean may change it
        applyLegal(out);
        syncImpressumLink();
      } else if (!S.gamesLoaded) S.gamesFailed = true; // the server answered with an error: say so, do not show a loading state forever
    } catch { S.gamesFailed = !S.gamesLoaded; /* offline: the home screen still renders; the game list says so instead of loading forever */ }
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
      const g = gameMeta(t.gameId) || { id: t.gameId, name: t.gameId, icon: '🎴' };
      const action = publicTableAction(t);
      return `<div class="public-table"><span class="public-game-icon">${gameMark(g)}</span><div class="public-table-info"><b>${esc(g.name)}</b><span>${esc(t.host)}'s table · ${t.members}/${t.seats} players <span class="seat-dots" aria-hidden="true">${Array.from({ length: Math.min(t.seats, 8) }, (_, k) => `<i class="${k < t.members ? 'on' : ''}"></i>`).join('')}</span>${t.spectators ? ` · 👁 ${t.spectators}` : ''}</span></div><button class="btn ${action.cls} small" data-act="joinPublic" data-code="${esc(t.code)}" ${action.disabled ? 'disabled' : ''}>${action.label}</button></div>`;
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
    // A veil that a loading request owns stays until that request settles; any other veil (sign-in, an action) goes now
    if (m.t === 'state' || m.t === 'left' || m.t === 'error' || m.t === 'welcome') { S.signingIn = false; if (!httpBusy && !reqVeilOwned) hideBusy(); }
    else if ((m.t === 'notice' || m.t === 'blocks') && BUSY_MOD.has(busyKind) && !httpBusy) hideBusy();
    switch (m.t) {
      case 'role': {
        // the owner changed this account's role while it was connected
        S.role = m.role; S.isGuest = m.role === 'guest';
        loadStaffHint();
        render();
        break;
      }
      case 'games': {
        // the owner switched a game on or off: the home page and the create buttons update at once
        S.games = m.games;
        S.gamesLoaded = true; S.gamesFailed = false;
        render();
        break;
      }
      case 'identity': {
        // this guest's account was confirmed (from the e-mail link, in this tab or another): the page drops its guest state now
        S.isGuest = m.isGuest === true;
        S.role = m.role || S.role;
        S.guestLocked = Array.isArray(m.guestLocked) ? m.guestLocked : [];
        if (m.username) { S.username = m.username; store.set('ct_username', S.username); }
        if (!S.isGuest) toast('Your account is confirmed. Your games and history are yours.');
        render();
        break;
      }
      case 'welcome': {
        S.id = m.id;
        S.role = m.role || 'user'; // owner | admin | user | guest: decides which games are open (see gameOpenFor)
        S.isGuest = S.role === 'guest'; // the server's role decides guest reminders and the upgrade path, not an earlier sign-in
        S.guestLocked = Array.isArray(m.guestLocked) ? m.guestLocked : []; // areas the owner has locked for guests
        if (S.page === 'player' && S.player && S.player.data) resyncPlayerBlock(); // the server's state after a drop, not the optimistic one
        applyLegal(m); // the server decides each link (see server.js legalFlags)
        S.token = '';
        S.guest = false;
        refreshLevel(); // detect levels only after welcome confirms the signed-in account
        S.games = m.games;
        S.gamesLoaded = true; S.gamesFailed = false;
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
        applyLegal(m); // signed-out sheet has no welcome, so the flags ride on this message too
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
        else if (S.page === 'player') resyncPlayerBlock();
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
        showEmote(m.id, m.e, m);
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
        // a seat change is confirmed when the table shows a new order; an error or the fallback timeout also ends the wait
        if (S.seatChange && (Date.now() > S.seatChange.until || m.room.members.map((x) => x.id).join() !== S.seatChange.from)) S.seatChange = null;
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
        $app.classList.remove('gate-locked', 'ready-wait');
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
        // A profile asked for from a table opens only now: the table is gone, so the page can show.
        if (S.pendingPage) { const pending = S.pendingPage; S.pendingPage = null; openPage(pending.page, pending.arg); break; }
        setHash('');
        render();
        break;
      case 'gameTotals':
        // the skill ratings for the finished game at this table; the game-over table is redrawn with them
        if (S.room && S.room.code === m.code && S.room.outcome && S.room.outcome.id === m.id) {
          // a late pending reply, or a failed lookup, must not replace a final answer already stored for this match
          const haveFinal = S.gameTotals && S.gameTotals.code === m.code && S.gameTotals.id === m.id && !S.gameTotals.pending && !S.gameTotals.failed;
          if (!((m.pending || m.failed) && haveFinal)) { S.gameTotals = { code: m.code, id: m.id, ratings: m.ratings || null, pending: Boolean(m.pending), failed: Boolean(m.failed) }; if (!updateEndCard()) render(); }
        }
        break;
      case 'error':
        S.seatChange = null; // a rejected seat change must not keep the seat controls blocked
        // Leave a newer link alone if the rejected join was for a different table.
        if (!S.room && m.tableCode && (m.code === 'join_failed' || m.code === 'guest_locked') && m.tableCode === hashCode()) setHash('');
        if (m.code === 'guest_locked') { openAuthSheet('register', (m.feature && GUEST_LOCK_TEXT[m.feature]) || m.message || 'Create a free account to play this game.'); break; }
        toast(m.message);
        // a refused leave means the profile this tap asked for must not open later, on some other leave. Only the server's
        // leave_failed says so: an unrelated error (a totals lookup, say) arriving before 'left' must not cancel the profile.
        if (m.code === 'leave_failed') S.pendingPage = null;
        if (S.page === 'player') resyncPlayerBlock(true, m.message); // a refused block or unblock must not stay on the page
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
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Log in'; } // the sheet stays open on a failed login
      }
    }
    if (e.target.id === 'guestForm') {
      e.preventDefault();
      const name = String((document.getElementById('guestName') || {}).value || '').trim();
      const btn = e.target.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      try { await doPlayAsGuest(name); } catch (err) { toast(err.message || 'Could not start a guest visit'); if (btn) btn.disabled = false; }
    }
    if (e.target.id === 'registerForm') {
      e.preventDefault();
      const name = (document.getElementById('registerName') || {}).value;
      const username = String((document.getElementById('registerUsername') || {}).value || '').trim().toLowerCase();
      const email = (document.getElementById('registerEmail') || {}).value;
      const password = (document.getElementById('registerPassword') || {}).value;
      const adultConfirmed = Boolean((document.getElementById('registerAdult') || {}).checked);
      // check the password here first, so a weak one is explained without the sheet being rebuilt and the fields emptied
      const weakPw = window.TvPassword && window.TvPassword.check(password, { email: String(email || '').trim().toLowerCase(), username });
      if (weakPw) { const hint = document.getElementById('registerPwHint'); if (hint) { hint.textContent = weakPw; hint.classList.add('bad'); } const pwEl = document.getElementById('registerPassword'); if (pwEl) pwEl.focus(); return; }
      try {
        await doRegister(name, username, email, password, adultConfirmed);
      } catch (err) {
        pendingRegisterName = name; // keep what was typed; the password is left blank
        openAuthSheet('register', err.message || 'Registration failed', true);
      }
    }
  });

  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'showLogin') return openAuthSheet('login');
    if (a.dataset.act === 'showRegister') return openAuthSheet('register');
    if (a.dataset.act === 'playAsGuest') return openGuestSheet();
    if (a.dataset.act === 'showAuth') return openAuthSheet(S.auth || 'login');
    if (a.dataset.act === 'forgotPassword') return doForgotPassword();
    if (a.dataset.act === 'resendVerification') return doResendVerification();
    if (a.dataset.act === 'gameSettings') return openGameSettings();
  });

  window.addEventListener('popstate', () => { if (!S.room) applyRoute(); });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pseat[role="button"]')) { e.preventDefault(); openPlayerCard(e.target.dataset.pid); return; }
    if (e.key !== 'Escape') return;
    if (S.auth || document.getElementById('auth-overlay')) closeOverlay();
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
    if (S.welcomeDue) showWelcome();
    connect();
    if (!S.emailVerified) toast('Email verification pending. Verify your email to enter the lobby.');
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

  function showEmote(id, e, who) {
    const seat = document.querySelector(`[data-pid="${CSS.escape(id)}"] .av`);
    const r = seat ? seat.getBoundingClientRect() : { left: innerWidth / 2, top: 80, width: 0, height: 0 };
    const el = document.createElement('div');
    el.className = 'emote-pop';
    el.textContent = e;
    // A spectator has no seat: the reaction names them, so the table knows it came from someone watching.
    if (who && who.spectator) { const tag = document.createElement('div'); tag.className = 'emote-tag'; tag.textContent = '👁 ' + (who.name || 'Spectator'); el.appendChild(tag); }
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

  /** The level on a player card (from time played). Game XP is not shown; skill ratings are on the profile. */
  function cardXpHTML(prof) {
    const prog = prof && prof.progress;
    if (!prog || prog.level == null) return '';
    return `<p class="pcard-xp">Level ${Number(prog.level)}</p>`;
  }

  function cardHTML() {
    const C = S.card;
    const person = roomPerson(C.pid) || C.last;
    if (!person) return '<p class="hint">This player is no longer at the table.</p>';
    C.last = person;
    // Show the whole card at once: while the numbers are loading, nothing else appears, so the dialog does not change in steps.
    if (C.loading) return `<div class="pcard-loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span> Loading profile…</div>`;
    const rel = relationTo(person);
    const here = Boolean(roomPerson(C.pid));
    const prof = C.profile;
    const stats = prof ? `<div class="pcard-stats"><div><b>${prof.played}</b><span>Games</span></div><div><b>${prof.wins}</b><span>Wins</span></div><div><b>${prof.winRate === null ? '–' : prof.winRate + '%'}</b><span>Win rate</span></div></div>${cardXpHTML(prof)}` : '';
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
    if (person.username && rel.kind !== 'me') others.push(`<button type="button" class="btn ghost"${busy} data-modal-act="cardProfile">View full profile</button>`);
    // The loaded profile says whether this account is already blocked; the button then undoes that block instead.
    if (here && rel.kind !== 'me' && rel.kind !== 'bot') {
      others.push(prof && prof.blockedByMe
        ? `<button type="button" class="btn ghost"${busy} data-modal-act="cardUnblock">Unblock</button>`
        : `<button type="button" class="btn ghost"${busy} data-modal-act="cardBlock"${lockAttr('blocking')}>🚫 Block</button>`);
    }
    // A report about a registered player (their conduct, not one message): a reason menu, like the chat report's.
    if (person.username && rel.kind !== 'me' && rel.kind !== 'bot' && rel.kind !== 'guest') {
      if (C.reporting) others.push(`<div class="report-menu" role="group" aria-label="Reason for report">${REPORT_REASONS.map(([k, l]) => `<button type="button" class="mod-btn" data-modal-act="cardReportSend" data-reason="${k}">${l}</button>`).join('')}<button type="button" class="btn ghost" data-modal-act="cardReport">Cancel</button></div>`);
      else others.push(`<button type="button" class="btn ghost"${busy} data-modal-act="cardReport" aria-expanded="false"${lockAttr('reports')}>🚩 Report player</button>`);
    }
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
    const loading = Boolean(person.username && !person.bot);
    const card = { pid, profile: null, busy: false, error: '', last: person, loading };
    S.card = card;
    drawCard();
    // While loading, the body has no buttons, so keep keyboard focus in the dialog on its Close control.
    if (loading) { const x = document.querySelector('#modal-overlay [data-modal-close][aria-label="Close"]'); if (x) x.focus(); }
    if (loading) {
      // Redraw only into this card's own dialog: if it was closed (or replaced by another dialog) while loading, leave it alone.
      const done = () => {
        if (S.card !== card) return; // this request belongs to an earlier opening of the card
        card.loading = false;
        const body = document.querySelector('#modal-overlay .modal-body');
        if (body && body.dataset.card === pid) drawCard();
      };
      getJson(`/api/players/${encodeURIComponent(person.username)}`)
        .then((d) => { if (S.card === card) card.profile = d.profile; })
        .catch(() => { /* the card works without the numbers */ })
        .finally(done);
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
    const actions = mine ? '' : `<span class="mod-actions"><button type="button" class="mod-btn" data-mod="block" data-id="${esc(m.id)}"${lockAttr('blocking')} data-mid="${esc(m.mid || '')}" title="Hide this player's table chat and voice from you, and stop invitations between you. You can still share a table. They are not told." aria-label="Block ${esc(m.name)}">Block</button>${m.mid ? `<button type="button" class="mod-btn" data-mod="report-open" data-mid="${esc(m.mid)}"${lockAttr('reports')}>Report</button>` : ''}</span>`;
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
  let timebarDl = null, timebarTotal = 0; // the deadline being drawn, and its length as first seen (used when the server does not say)
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
    // the same clock as a bar under the status line: it drains and turns red in the last ten seconds
    if (left !== null && dl !== timebarDl) { timebarDl = dl; timebarTotal = left; }
    const total = S.room && S.room.turnMs ? S.room.turnMs / 1000 : timebarTotal;
    document.querySelectorAll('.ct-timebar').forEach((el) => {
      el.classList.toggle('on', left !== null);
      el.classList.toggle('warn', left !== null && left <= 10);
      const fill = el.firstElementChild;
      if (fill) fill.style.transform = `scaleX(${left === null || !total ? 0 : Math.max(0, Math.min(1, (dl - (Date.now() + S.skew)) / 1000 / total))})`;
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
  const RESULT_LABEL = { won: 'Won', lost: 'Lost', draw: 'Draw', left: 'Left (not counted)', forfeit: 'Left (counts as a loss)' };

  function getJson(url, opts) {
    return trackRequest(opts, () => getJsonNow(url));
  }
  async function getJsonNow(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    let out = null;
    try { out = await r.json(); } catch { /* not json */ }
    if (r.status === 401) { const e = new Error('Please log in again.'); e.status = 401; throw e; }
    if (r.status === 403 && out && out.code === 'guest_locked') {
      openAuthSheet('register', GUEST_LOCK_TEXT[out.feature] || out.error || 'Create a free account to use this.');
      const e = new Error(out.error || 'Create a free account to use this.'); e.status = 403; e.code = 'guest_locked'; throw e;
    }
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
    if (r.page === 'profile' && S.guest) { S.page = 'home'; openAuthSheet('register', GUEST_LOCK_TEXT.profiles); return; }
    if (r.page === 'friends' && S.guest) { S.page = 'home'; openAuthSheet('register', 'Create a free account to use friends.'); return; }
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

  /** Overall level (time played) shown beside the avatar. Null when the progress is missing. */
  function setAccount(progress) {
    const a = progress && progress.account;
    S.account = a ? { level: a.level, into: a.into, need: a.need } : null;
  }
  /**
   * The last level this device showed for this account, kept per device (a convenience, not a record). The first time a
   * device sees an account it only remembers the level: nothing is announced for levels reached before.
   */
  function noteLevelUp() {
    if (!S.username || !S.account || S.guest) return;
    const k = 'ct_level_seen_' + S.username;
    const seen = store.get(k);
    if (seen === null) { S.levelUp = null; store.set(k, String(S.account.level)); return; }
    S.levelUp = S.account.level > Number(seen) ? { username: S.username, from: Number(seen), to: S.account.level } : null;
  }
  /**
   * The level-up dialog: shown once, on the next menu (home) visit after a new level. The level is remembered on this
   * device as soon as the dialog opens, so closing it in any way (OK, the close button, a click outside) counts as seen.
   */
  function showLevelUpDialog() {
    const n = S.levelUp;
    if (!n || n.username !== S.username || S.guest || S.room || S.page !== 'home') return;
    if (document.getElementById('modal-overlay')) return; // one dialog at a time: the notice waits for the next visit
    store.set('ct_level_seen_' + n.username, String(n.to));
    S.levelUp = null;
    const left = S.account ? Math.max(0, Number(S.account.need) - Number(S.account.into)) : null;
    openModal('Level up', `<p>Congratulations on reaching level ${Number(n.to)}!</p>${left !== null ? `<p class="hint">Next level in ${left} min of play.</p>` : ''}<div class="row" style="margin-top:12px"><button class="btn" type="button" data-modal-close="1">OK</button></div>`);
  }
  /** Refreshes the overall level. Silent on failure: the badge just stays as it was. Redraws when progress or its notice changes. */
  let levelRequest = 0; // shared ordering for both profile loaders
  // Welcome-back answers come from three profile requests (first load, reconnect refresh, profile page). They are applied in
  // the order they were asked for, so an older answer that arrives late cannot overwrite a newer one.
  let welcomeAsked = 0;
  let welcomeAccepted = 0;
  function applyWelcome(me, gen, asked) {
    if (gen !== sessionGen || asked < welcomeAccepted) return;
    welcomeAccepted = asked;
    const wb = (me && me.welcomeBack) || null;
    const changed = JSON.stringify(wb) !== JSON.stringify(S.welcomeBack) || S.welcomeFor !== gen;
    S.welcomeBack = wb; S.welcomeFor = gen; S.welcomeLoaded = gen;
    if (changed && S.page === 'home') render();
  }
  async function refreshLevel() {
    const gen = sessionGen;
    const mine = ++levelRequest;
    const asked = ++welcomeAsked;
    try {
      const me = await getJson('/api/me/profile', { quiet: true });
      if (gen !== sessionGen) return; // another account signed in
      // a returning socket reconnect keeps the session, so the welcome-back answer is taken from this refresh too
      if (!S.guest) applyWelcome(me, gen, asked);
      if (mine !== levelRequest) return; // a newer profile response won the progress
      const progress = me && me.stats && me.stats.progress;
      const key = (a) => (a ? `${a.level}|${a.into}|${a.need}` : '');
      const before = key(S.account);
      const priorProgress = S.latestProgressUser === (S.username || null) && S.latestProgress ? S.latestProgress : (S.profile && S.profile.data && S.profile.data.stats && S.profile.data.stats.progress || null);
      const progressBefore = JSON.stringify(priorProgress);
      const noticeBefore = JSON.stringify(S.levelUp);
      S.latestProgress = progress || null;
      S.latestProgressUser = S.username || null;
      S.latestProgressRequest = mine;
      setAccount(progress);
      noteLevelUp();
      // Keep the open profile in step, including game changes that do not advance a time-based level.
      if (S.profile && S.profile.data && S.profile.data.stats && progress) S.profile.data.stats.progress = progress;
      const progressAfter = JSON.stringify(S.profile && S.profile.data && S.profile.data.stats && S.profile.data.stats.progress || null);
      if (key(S.account) !== before || progressAfter !== progressBefore || JSON.stringify(S.levelUp) !== noticeBefore) render();
    } catch { /* the level badge is optional */ }
  }

  async function loadProfile(historyPage = 1) {
    const keepTab = S.profile && S.profile.tab;
    const gen = sessionGen; // an answer for an account that has since signed out (or changed) is dropped
    const mine = ++levelRequest; // profile and background refreshes share one response-ordering policy
    const asked = ++welcomeAsked;
    S.profile = { loading: true, error: '', data: null, history: null, tab: keepTab || 'overview', historyPage };
    render();
    try {
      const [me, hist] = await Promise.all([getJson('/api/me/profile'), getJson(`/api/me/history?page=${historyPage}`)]);
      if (gen !== sessionGen) return;
      if (!S.guest) applyWelcome(me, gen, asked); // this profile is as current as any, so its welcome-back answer counts too
      const hasNewerAcceptedProgress = S.latestProgressRequest > mine
        && S.latestProgressUser === (S.username || null)
        && S.latestProgress;
      if (hasNewerAcceptedProgress) {
        // A newer request has already succeeded; don't put this older snapshot back on screen.
        if (me && me.stats) me.stats.progress = S.latestProgress;
      } else {
        // A newer request may still be pending or may fail. Accept this successful profile response
        // unless a newer response has already been accepted, then let any later success supersede it.
        const progress = me && me.stats && me.stats.progress;
        S.latestProgress = progress || null;
        S.latestProgressUser = S.username || null;
        S.latestProgressRequest = mine;
        setAccount(progress);
        noteLevelUp();
      }
      S.profile = { ...S.profile, loading: false, data: me, history: hist };
      S.name = me.profile.displayName; S.named = true;
    } catch (e) {
      if (gen !== sessionGen) return;
      S.profile = { ...S.profile, loading: false, error: e.message || 'Could not load your profile.' };
    }
    render();
  }
  async function loadPlayer(username) {
    const req = { username, loading: true, error: '', data: null };
    S.player = req;
    render();
    try {
      const profile = (await getJson(`/api/players/${encodeURIComponent(username)}`)).profile;
      if (S.player !== req) return; // the person has opened another profile since: that answer is the one on screen
      req.data = profile; req.confirmedBlockedByMe = profile.blockedByMe;
    } catch (e) {
      if (S.player !== req) return;
      req.error = e.status === 404 ? 'There is no player with that username.' : (e.message || 'Could not load this profile.');
    }
    req.loading = false;
    render();
  }
  // The profile page shows a block or unblock at once, before the server has answered. When the server answers (the new list,
  // or an error such as a cooldown or the block limit), the page is checked against the server again, so it never keeps
  // showing a block that was refused or hiding one that went through. It redraws only if something changed.
  // `failed` is true when the server refused the request. If the check itself cannot be made after a refusal, the page goes back to
  // the last state the server confirmed (confirmedBlockedByMe) instead of leaving a refused block on screen.
  let playerResync = 0;
  let playerBlockAction = 0;
  // One block or unblock is awaiting the server at a time (playerBusy). The other button then says it is saving, so an
  // acknowledgement always belongs to the optimistic state on screen. The lock is released only by the server's answer
  // (a list or a refusal) or by the socket closing; the check against the server then settles the state.
  function clearPlayerBusy(P) {
    if (P) P.busy = false;
  }
  function playerBusy(P) {
    if (P.busy) { toast('Saving… one moment.'); return true; }
    P.busy = true;
    return false;
  }
  // The refusals a block or unblock can get back. Other errors (a report, a chat message) say nothing about the lock.
  const isBlockRefusal = (text) => /^(That player could not be found\.|You cannot block yourself\.|You can block up to |Slow down a little$|Could not save that (block|unblock)\. Your profile has been checked again\.$)/.test(String(text || ''));
  async function resyncPlayerBlock(failed = false, reason = '') {
    const P = S.player;
    if (failed && !isBlockRefusal(reason)) return; // not an answer to this page's block or unblock
    clearPlayerBusy(P); // the server has answered (a list, or a refusal)
    if (S.page !== 'player' || !P || !P.data) return;
    const stamp = ++playerResync;
    const action = playerBlockAction;
    if (!failed) P.confirmedBlockedByMe = P.data.blockedByMe;
    let confirmed; let fresh = false;
    try {
      confirmed = (await getJson(`/api/players/${encodeURIComponent(P.data.username)}`)).profile.blockedByMe;
      fresh = true;
    } catch {
      if (!failed) return;
      confirmed = P.confirmedBlockedByMe;
    }
    if (stamp !== playerResync || action !== playerBlockAction || S.player !== P || S.page !== 'player') return; // a newer check, action, or page took over
    // Only a response that passed the guard above may change the confirmed state; a discarded one must not.
    if (fresh) P.confirmedBlockedByMe = confirmed;
    if (confirmed === undefined || P.data.blockedByMe === confirmed) return;
    // The redraw replaces the block button, so keep the keyboard on the control if it was there.
    const hadFocus = /^player(Block|Unblock)$/.test((document.activeElement && document.activeElement.dataset.act) || '');
    P.data.blockedByMe = confirmed;
    render();
    if (hadFocus) { const el = document.querySelector('.pp-actions [data-act="playerBlock"], .pp-actions [data-act="playerUnblock"]'); if (el) el.focus(); }
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
      return `<li class="hist-row"><span class="hist-ico" aria-hidden="true">${gameMark(meta)}</span><span class="hist-main"><b>${esc(meta.name)}</b><small>${esc(fmtDate(g.finishedAt))} · ${g.humans} player${g.humans === 1 ? '' : 's'}${g.seats > g.humans ? ` + ${g.seats - g.humans} bot${g.seats - g.humans === 1 ? '' : 's'}` : ''}</small></span><span class="result ${g.result}">${RESULT_LABEL[g.result]}</span></li>`;
    }).join('');
    const pager = h.pages > 1 ? `<nav class="pager" aria-label="History pages"><button type="button" class="btn ghost small" data-act="historyPage" data-page="${h.page - 1}" ${h.page <= 1 ? 'disabled' : ''}>← Newer</button><span>Page ${h.page} of ${h.pages}</span><button type="button" class="btn ghost small" data-act="historyPage" data-page="${h.page + 1}" ${h.page >= h.pages ? 'disabled' : ''}>Older →</button></nav>` : '';
    return `<ul class="hist-list">${rows}</ul>${pager}<p class="hint" style="text-align:left">Leaving while others were still playing counts as a loss. Leaving against bots only, or in a game that was abandoned, is listed but not counted.</p>`;
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
            <div class="setting-row"><div><b>Appearance</b><small>Dark, light, or whatever your device uses. Saved on this device.</small></div><span class="row" style="gap:6px" role="group" aria-label="Appearance">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'System']].map(([m, l]) => `<button type="button" class="btn ${themeMode() === m ? '' : 'ghost'} small" aria-pressed="${themeMode() === m}" data-act="setTheme" data-theme="${m}">${l}</button>`).join('')}</span></div>
            <div class="setting-row"><div><b>Email</b><small>${esc(me.email || 'No email on this account')}${me.email ? (me.emailVerified ? ' · verified' : ' · not verified') : ''}. Only you can see this.</small></div></div>
            <div class="setting-row"><div><b>Public profile</b><small>Anyone with the link can see your username, display name, avatar, join date and win totals.</small></div><button type="button" class="btn ghost small" data-act="copyProfileLink">Copy link</button></div>
            <div class="setting-row"><div><b>Sessions</b><small>Sign out of this device, or of every device you are logged in on.</small></div><span class="row" style="gap:6px"><button type="button" class="btn ghost small" data-act="logout">Log out</button><button type="button" class="btn ghost small" data-act="logoutAll">Everywhere</button></span></div>
            <div class="danger-zone"><div><b>Delete account</b><small>Permanently removes your account and sign-in. This cannot be undone.</small></div><button type="button" class="btn danger small" data-act="openDeleteAccount">Delete account…</button></div>
          </div>`
        : P.game ? gameDetailHTML(P) : statsHTML(P.data.stats);
      inner = `<header class="pp-head">
          ${avatar({ name, avatar: me.avatar }, 'big')}
          <div class="pp-id"><h1>${esc(name)}</h1><p>${me.username ? `@${esc(me.username)} · ` : ''}${esc(joinedText(me.joinedAt))}</p><p class="pp-conn">📶 Connection ${pingBadge(S.ping, { label: true, live: 'self' })}</p></div>
          <button type="button" class="btn ghost small" data-act="editProfile">Edit profile</button>
        </header>
        <div class="tabs" role="tablist">${tabBtn('overview', 'Overview')}${tabBtn('history', `History${P.history && P.history.total ? ` <small>${P.history.total}</small>` : ''}`)}${tabBtn('account', 'Account')}</div>
        <section class="tab-panel" role="tabpanel">${panel}</section>`;
    }
    paintApp(`${topbarHTML()}<main class="page profile-page"><a class="back-link" href="/" data-act="goHome">← Back to games</a>${inner}</main>`);
  }

  /** Only people you are friends with show their status and connection on their page (it comes from your own friends list). */
  function friendLine(username) {
    const f = (S.friends || []).find((x) => String(x.username).toLowerCase() === String(username).toLowerCase());
    if (!f) return '';
    if (!f.online) return '<p class="pp-conn">Friend · offline</p>';
    return `<p class="pp-conn">Friend · ${f.playing ? '🎮 Playing ' + esc((gameMeta(f.playing) || {}).name || f.playing) : '🟢 Online'} · ${pingBadge(f.ping, { label: true })}</p>`;
  }

  /** Block / unblock and report for another registered player's page. Signed-in viewers only; the server resolves the username. */
  function playerActionsHTML(P, d) {
    // Unblock only for a block this viewer made; a block the other player made is theirs to lift.
    const blockBtn = d.blockedByMe
      ? '<button type="button" class="btn ghost small" data-act="playerUnblock">Unblock</button>'
      : `<button type="button" class="btn ghost small" data-act="playerBlock"${lockAttr('blocking')}>🚫 Block</button>`;
    const reportPart = P.reporting
      ? `<div class="report-menu" role="group" aria-label="Reason for report">${REPORT_REASONS.map(([k, l]) => `<button type="button" class="mod-btn" data-act="playerReportSend" data-reason="${k}">${l}</button>`).join('')}<button type="button" class="btn ghost small" data-act="playerReport" aria-expanded="true">Cancel</button></div>`
          : `<button type="button" class="btn ghost small" data-act="playerReport" aria-expanded="false"${lockAttr('reports')}>🚩 Report player</button>`;
    return `<div class="pp-actions">${blockBtn}${reportPart}</div>`;
  }

  function renderPlayerPage() {
    const P = S.player || { loading: true };
    let inner;
    if (P.loading) inner = loadingBlock('Loading profile…');
    else if (P.error) inner = errorBlock(P.error);
    else {
      const d = P.data;
      inner = `<header class="pp-head">${avatar({ name: d.displayName, avatar: d.avatar }, 'big')}<div class="pp-id"><h1>${esc(d.displayName)}</h1><p>@${esc(d.username)} · ${esc(joinedText(d.joinedAt))}</p>${d.blockedByMe ? '<p class="pp-blocked"><b>Blocked</b></p>' : friendLine(d.username)}</div></header>
        ${progressHTML(d.progress, false)}
        <div class="stat-grid"><div class="stat-tile"><span class="stat-v">${d.played}</span><span class="stat-l">Games played</span></div><div class="stat-tile good"><span class="stat-v">${d.wins}</span><span class="stat-l">Wins</span></div><div class="stat-tile"><span class="stat-v">${d.winRate === null ? '–' : d.winRate + '%'}</span><span class="stat-l">Win rate</span></div></div>
        ${!S.guest && S.username && S.username.toLowerCase() !== String(d.username).toLowerCase() ? playerActionsHTML(P, d) : ''}`;
    }
    paintApp(`${topbarHTML()}<main class="page profile-page"><a class="back-link" href="/" data-act="goHome">← Back to games</a>${inner}</main>`);
  }

  // ---- account deletion
  function openDeleteAccountDialog() {
    const viaGoogle = !!(S.profile && S.profile.data && S.profile.data.profile && S.profile.data.profile.hasPassword === false);
    openModal('Delete your account', `<form id="deleteForm" class="auth-form">
        <p class="hint" style="text-align:left;color:var(--ink)">This permanently deletes your account. It cannot be undone.</p>
        <ul class="plain-list">
          <li><b>Deleted:</b> your login (email and password), your username and display name, your avatar, your sessions on every device and your recent tables.</li>
          <li><b>Kept:</b> the games you finished, so other players’ history and results stay correct. Your seat in them is shown as “Deleted player” and is no longer linked to you.</li>
        </ul>
        ${viaGoogle
          ? `<p class="hint" style="text-align:left;color:var(--ink)">This account signs in with Google. Confirm it is you with Google, and it is deleted straight away.</p><div id="deleteGoogleBtn" class="google-slot"></div>`
          : `<label class="label" for="deletePw">Enter your password to confirm</label>
        <input id="deletePw" type="password" required autocomplete="current-password" placeholder="Password">`}
        <p id="deleteMsg" class="auth-msg" role="alert" hidden></p>
        <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn ghost" data-modal-close>Cancel</button>${viaGoogle ? '' : '<button type="submit" class="btn danger">Delete my account</button>'}</div>
      </form>`, (o) => {
      const finishDeletion = () => {
        closeModal();
        S.signedOutIntentionally = true;
        clearClientSession();
        for (const k of ['ct_name', 'ct_username', 'ct_avatar']) store.remove(k);
        S.name = ''; S.username = ''; S.named = false; S.avatar = ''; S.profile = null; S.recentTables = [];
        S.ready = false; S.room = null; S.view = null; S.page = 'home';
        try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
        loadSnapshot();
        toast('Your account has been deleted.');
      };
      if (viaGoogle && window.TvGoogle) {
        const target = o.querySelector('#deleteGoogleBtn');
        const msg = o.querySelector('#deleteMsg');
        window.TvGoogle.mount(target, async (credential) => {
          try {
            await withBusy('Deleting your account…', () => postJson('/api/me/delete-account', { credential }));
            finishDeletion();
          } catch (err) { msg.textContent = err.message || 'Could not delete the account.'; msg.hidden = false; }
        }, () => { msg.textContent = 'Google could not be loaded. Try again later.'; msg.hidden = false; }, { forDelete: true });
      }
      o.addEventListener('submit', async (e) => {
        if (e.target.id !== 'deleteForm') return;
        e.preventDefault();
        const msg = o.querySelector('#deleteMsg');
        const btn = e.target.querySelector('button[type=submit]');
        if (!btn) return; // Google accounts confirm with Google's button instead
        btn.disabled = true;
        try {
          const pw = o.querySelector('#deletePw').value;
          await withBusy('Deleting your account…', () => postJson('/api/me/delete-account', { password: pw }));
          finishDeletion();
        } catch (err) {
          msg.textContent = err.message || 'Could not delete the account.';
          msg.hidden = false;
          btn.disabled = false;
        }
      });
    });
  }

  // ------------------------------------------------------------ top bar, account menu and its dialogs
  // Release history lives in public/whats-new-data.js. The home page shows the newest release's first three items.
  const RELEASES = Array.isArray(window.TV_RELEASES) ? window.TV_RELEASES : [];
  const WHATS_NEW_VERSION = RELEASES.length ? RELEASES[0].version : '';
  const WHATS_NEW = RELEASES.length ? RELEASES[0].items.slice(0, 3) : [];
  const HU = window.TVHomeUI({ S, esc, gameMeta, pingBadge, pendingSocial: () => pendingSocial() });
  const { socialHTML, inviteFriendsHTML, friendsStripHTML, friendsPageHTML, bellHTML, comingSoonHTML } = HU;
  /** "Friday evening": the day and the part of it, from the player's own clock. */
  function dayPart(d = new Date()) {
    const h = d.getHours(), part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${part}`;
  }
  /** Friend requests + table invitations waiting for an answer (drives the menu badge and the home strip). */
  const pendingSocial = () => S.friendRequests.incoming.length + S.invitations.incoming.length;
  const hasNewNews = () => S.wnSeen !== WHATS_NEW_VERSION;

  function topbarHTML() {
    const brand = '<a class="tb-brand" href="/" aria-label="Tableverse home"><svg class="tb-mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><ellipse cx="128" cy="126" rx="84" ry="58" fill="#153228" stroke="#86efac" stroke-opacity=".65" stroke-width="5"/><circle cx="128" cy="32" r="21" fill="#86efac"/><circle cx="24" cy="126" r="21" fill="#86efac"/><circle cx="232" cy="126" r="21" fill="#86efac"/><circle cx="128" cy="216" r="27" fill="#fbbf24"/></svg><span class="tb-name">Tableverse</span></a>';
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
        ${item('openVersionHistory', '📜', 'Version history')}
        ${item('openFeedback', '💬', 'Send feedback')}
        ${S.isStaff ? item('openAdmin', '🛠️', 'Admin console') : ''}
        <div class="menu-sep" role="separator"></div>
        ${item('logout', '🚪', 'Log out')}
        ${item('logoutAll', '🔒', 'Log out everywhere', '', 'dim')}
      </div>` : '';
    const tab = (act, label, on) => `<button type="button" class="tb-tab" data-act="${act}"${on ? ' aria-current="page"' : ''}>${label}</button>`;
    const tabs = `<div class="tb-tabs" role="group" aria-label="Sections"><span class="tb-pill" aria-hidden="true"></span>${tab('goHome', 'Home', S.page !== 'friends' && S.page !== 'profile')}${tab('goGames', 'Games', false)}${tab('openFriendsPage', 'Friends', S.page === 'friends')}${tab('openProfilePage', 'Profile', S.page === 'profile')}</div>`;
    const ICON = {
      goHome: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', goGames: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
      openFriendsPage: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14c2.6 0 4.5 1.8 4.5 4.5"/>', openProfilePage: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    };
    const btab = (act, label, on) => `<button type="button" class="tb-tab bn-tab" data-act="${act}"${on ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[act]}</svg><span>${label}</span></button>`;
    const bottom = `<nav class="tb-tabs bn" aria-label="Sections"><span class="tb-pill" aria-hidden="true"></span>${btab('goHome', 'Home', S.page !== 'friends' && S.page !== 'profile')}${btab('goGames', 'Games', false)}${btab('openFriendsPage', 'Friends', S.page === 'friends')}${btab('openProfilePage', 'Profile', S.page === 'profile')}</nav>`;
    return `<nav class="topbar" aria-label="Main">${brand}${tabs}<div class="tb-right">${bellHTML()}<div class="menu-wrap"><button type="button" class="tb-avatar-btn" data-act="toggleMenu" aria-haspopup="menu" aria-expanded="${S.menuOpen}" aria-label="Account menu for ${esc(name)}${S.account ? `, level ${Number(S.account.level)}` : ''}">${av}${S.account ? `<span class="tb-level" title="Your overall level">Lv ${Number(S.account.level)}</span>` : ''}${hasNewNews() ? '<span class="tb-dot" aria-hidden="true"></span>' : ''}<span class="tb-caret" aria-hidden="true">▾</span></button>${menu}</div></div></nav>${bottom}`;
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
    // How to play lives in the ⋯ menu for every game. A game that already has its own rules entry keeps it.
    const isRules = (b) => b.dataset.act === 'rules' || /rules|how to play/i.test(b.textContent || '');
    if (S.room && !extras.some(isRules)) {
      const rb = document.createElement('button');
      rb.type = 'button'; rb.className = 'btn ghost small'; rb.dataset.act = 'rules'; rb.dataset.game = S.room.gameId;
      rb.setAttribute('aria-label', 'How to play'); rb.textContent = '📖 How to play';
      // Space on a focused button must not reach the document-level Space shortcuts (Mind plays a card on Space)
      rb.addEventListener('keydown', (e) => { if (e.code === 'Space') e.stopPropagation(); });
      extras.push(rb);
    }
    // Go Fish has no log: it would show what other players asked for
    if (!bar.closest('.gf') && !extras.some((b) => b.dataset.act === 'activityLog')) {
      const log = document.createElement('button');
      log.type = 'button'; log.className = 'btn ghost small'; log.dataset.act = 'activityLog'; log.setAttribute('aria-label', 'Open game log'); log.textContent = '📜 Log';
      extras.push(log);
    }
    // One label and one order in every game: a game's own Rules button says How to play, and the items run in the same order
    // (the game's figures, How to play, the log). Game settings is added after these, as the last item.
    extras.forEach((b) => {
      if (isRules(b)) b.dataset.toolbarRules = '';
      if ((b.textContent || '').trim() === 'Rules') { b.textContent = '📖 How to play'; b.setAttribute('aria-label', 'How to play'); }
    });
    const menuRank = (b) => (/^(Scores|Stats|Chips)$/i.test((b.textContent || '').trim()) ? 0
      : b.dataset.act === 'rules' || /how to play/i.test(b.textContent || '') ? 1
      : b.dataset.act === 'activityLog' ? 2 : 3);
    extras.sort((a, b) => menuRank(a) - menuRank(b)); // stable: equal ranks keep their order
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
    versionHistory: () => openVersionHistoryDialog(),
    welcomeStart: () => closeModal(),
    cardAdd: () => { const p = S.card && S.card.last; if (p && p.username) cardAction('/api/me/friend-requests', { username: p.username }, 'Friend request sent.', 'Sending request…'); },
    cardCancel: () => { const r = relationTo(S.card && S.card.last); if (r.request) cardAction('/api/me/friend-requests/cancel', { requestId: r.request.id }, undefined, 'Cancelling…'); },
    cardAccept: () => { const r = relationTo(S.card && S.card.last); if (r.request) cardAction('/api/me/friend-requests/accept', { requestId: r.request.id }, 'Friend request accepted.', 'Accepting…'); },
    cardDecline: () => { const r = relationTo(S.card && S.card.last); if (r.request) cardAction('/api/me/friend-requests/decline', { requestId: r.request.id }, undefined, 'Declining…'); },
    cardRemove: () => { const r = relationTo(S.card && S.card.last); if (!r.friend) return; openModal('Remove friend', '<p class="hint">Remove this friend? Any pending invitations between you will also be revoked.</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Cancel</button><button type="button" class="btn danger" data-modal-act="cardRemoveConfirm">Remove friend</button></div>'); },
    cardRemoveConfirm: () => { const r = relationTo(S.card && S.card.last); closeModal(); if (r.friend) cardAction('/api/me/friends/remove', { friendId: r.friend.id }, 'Friend removed.', 'Removing friend…'); },
    removeFriendConfirm: () => { const id = S.pendingFriendRemovalId; S.pendingFriendRemovalId = null; closeModal(); if (id) socialPost('/api/me/friends/remove', { friendId: id }, 'Friend removed.', 'Removing friend…'); },
    leaveGameConfirm: () => { closeModal(); leaveNow(); },
    cardMute: () => { const p = S.card && S.card.last; if (!p) return; if (muted.has(p.id)) muted.delete(p.id); else muted.add(p.id); saveMuted(); drawChat(); drawCard(); },
    cardEditMe: () => { closeModal(); openEditProfileDialog(); },
    // Opening a profile is a page, and the app only shows a page when no table is open. From a table, confirm first:
    // leaving the table is what makes room for the profile.
    cardProfile: () => {
      const p = S.card && S.card.last;
      if (!p || !p.username) return;
      if (!S.room) { closeModal(); openPage('player', p.username); return; }
      // Only a seated player in a running game has a seat a bot takes; in the lobby, after a game, or spectating, opening the profile just leaves the table.
      const seatedInGame = S.room.status === 'playing' && !isSpectator();
      const leaveText = seatedInGame ? 'This leaves the game: a bot takes your seat, and you can take your seat back within 2 minutes from the home screen.' + (otherHumansPlaying() ? leaveConsequence() : '') : 'This leaves the table.';
      openModal(seatedInGame ? 'Leave game' : 'Leave table', `<p class="hint">Open ${esc(p.name)}’s profile? ${leaveText}</p><div class="row" style="margin-top:12px;gap:10px"><button type="button" class="btn ghost small" data-modal-close>Stay</button><button type="button" class="btn small" data-modal-act="cardProfileConfirm">View profile</button></div>`);
    },
    cardProfileConfirm: () => {
      const p = S.card && S.card.last;
      closeModal();
      if (!p || !p.username) return;
      // Without a live connection nothing is sent, so nothing would open the page later: do not keep the navigation for a
      // later, unrelated leave. The player can try again once connected.
      if (!(ws && ws.readyState === 1)) { toast('Connection lost. Reconnect, then open the profile again.'); return; }
      // The page opens when the server confirms the leave ('left'); opening it now would be undone by that message.
      S.pendingPage = { page: 'player', arg: p.username };
      leaveNow();
    },
    // Blocking is account-level and works the same from a table as from chat: the blocked person is hidden from table
    // chat and table voice in both directions. The block itself is sent to the server by the player's id.
    // Reporting a player is a reason menu on the card; the server checks the account and keeps one report per reporter and player.
    // Redrawing the card replaces the focused button, so focus moves on purpose: to the first reason when the menu opens,
    // and back to Report when it closes (Cancel) or a report is sent.
    cardReport: () => {
      if (!S.card) return;
      S.card.reporting = !S.card.reporting;
      drawCard();
      const target = S.card.reporting ? '#modal-overlay .report-menu .mod-btn' : '#modal-overlay [data-modal-act="cardReport"]';
      const el = document.querySelector(target);
      if (el) el.focus();
    },
    cardReportSend: (el) => {
      const C = S.card;
      if (!C || !C.last || !C.last.id || !el.dataset.reason) return;
      send({ t: 'reportPlayer', id: C.last.id, reason: el.dataset.reason });
      C.reporting = false;
      drawCard(); // the server's notice confirms the report
      const again = document.querySelector('#modal-overlay [data-modal-act="cardReport"]');
      if (again) again.focus();
    },
    cardBlock: () => {
      const p = S.card && S.card.last;
      if (!p || p.bot || !p.id || p.id === S.id) return;
      if (!(ws && ws.readyState === 1)) { toast('Connection lost. Reconnect, then try again.'); return; } // send() would drop it
      send({ t: 'block', id: p.id });
      closeModal();
    },
    cardUnblock: () => {
      const p = S.card && S.card.last;
      if (!p || p.bot || !p.id || p.id === S.id || !S.card.profile) return;
      if (!(ws && ws.readyState === 1)) { toast('Connection lost. Reconnect, then try again.'); return; }
      send({ t: 'unblock', id: p.id }); // closes like Block: the server's notice says whether it went through
      closeModal();
    },
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

  /** Optional country, chosen by the player and visible only to them and to the site's staff. Names come from the browser in the player's language. */
  function countryForm() {
    const codes = (window.TvCountries && window.TvCountries.CODES) || [];
    let names = null;
    try { names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }); } catch { names = null; }
    const label = (c) => { try { return (names && names.of(c)) || c; } catch { return c; } };
    const loaded = S.country !== undefined;
    const cur = S.country || '';
    const opts = codes.map((c) => ({ c, n: label(c) })).sort((x, y) => x.n.localeCompare(y.n)).map((o) => `<option value="${o.c}" ${o.c === cur ? 'selected' : ''}>${esc(o.n)}</option>`).join('');
    return `<form id="countryForm" class="auth-form" style="margin-top:10px">
          <label class="label" for="profileCountry">Country (optional)</label>
          <select id="profileCountry" ${loaded ? '' : 'disabled'}><option value="">${loaded ? 'Not set' : 'Loading…'}</option>${opts}</select>
          <small class="hint" style="text-align:left">Only you and the site's staff can see this. It helps us see where players come from.</small>
          <p id="countryMsg" class="auth-msg" role="alert" hidden></p>
          <button class="btn" type="submit" ${loaded ? '' : 'disabled'}>Save country</button>
        </form>`;
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
        <div class="av-picks">${picks}</div>
        ${S.guest ? '' : countryForm()}`;
    };
    openModal('Edit profile', body(), (o) => {
      modalActions.pickAvatar = async (el) => {
        await changeAvatar(el.dataset.a);
        const keep = o.querySelector('#profileName').value;
        const keepCountry = o.querySelector('#profileCountry');
        const pickedCountry = keepCountry && !keepCountry.disabled ? keepCountry.value : null;
        o.querySelector('.modal-body').innerHTML = body();
        o.querySelector('#profileName').value = keep;
        const again = o.querySelector('#profileCountry');
        if (again && pickedCountry !== null) again.value = pickedCountry;
      };
      if (!S.guest && S.country === undefined) {
        const mineGen = sessionGen;
        getJson('/api/me/profile', { quiet: true }).then((me) => {
          if (mineGen !== sessionGen) return; // another account signed in meanwhile
          S.country = (me && me.profile && me.profile.country) || '';
          const sel = o.querySelector('#profileCountry');
          if (!sel || !sel.disabled) return; // closed, or already usable
          const name = o.querySelector('#profileName').value;
          o.querySelector('.modal-body').innerHTML = body();
          o.querySelector('#profileName').value = name;
        }).catch(() => { const m = o.querySelector('#countryMsg'); if (m) { m.textContent = 'Could not load your country. Close this window and try again.'; m.hidden = false; } });
      }
      o.addEventListener('submit', async (e) => {
        if (e.target.id === 'countryForm') {
          e.preventDefault();
          const cmsg = o.querySelector('#countryMsg');
          const cbtn = e.target.querySelector('button[type=submit]');
          cbtn.disabled = true;
          try {
            const mineGen = sessionGen;
            const out = await withBusy('Saving your country…', () => postJson('/api/me/country', { country: o.querySelector('#profileCountry').value }));
            if (mineGen !== sessionGen) return; // another account signed in meanwhile: this answer is not theirs
            S.country = out.country || '';
            if (S.profile && S.profile.data && S.profile.data.profile) S.profile.data.profile.country = out.country;
            cmsg.textContent = out.country ? 'Country saved.' : 'Country cleared.';
            cmsg.hidden = false;
          } catch (err) {
            cmsg.textContent = err.message || 'Could not save the country.';
            cmsg.hidden = false;
          }
          cbtn.disabled = false;
          return;
        }
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
    const newest = RELEASES[0] || { title: '', items: [] };
    const list = WHATS_NEW.filter((w) => S.voiceEnabled || !w.voice).map((w) => `<li><span class="wn-ico" aria-hidden="true">${w.ico}</span><div><b>${esc(w.title)}</b><p>${esc(w.text)}</p></div></li>`).join('');
    openModal('What’s new', `<p class="hint" style="text-align:left">${esc(newest.title)}</p><ul class="wn-list">${list}</ul><div class="row" style="margin-top:12px"><button type="button" class="btn ghost small" data-modal-act="versionHistory">All versions</button></div>`);
  }

  /**
   * First login: a welcome dialog, shown once. It says what Tableverse is and shows the newest release's highlights.
   * It is marked as seen on the server when it opens, so a reload or another device does not show it again.
   */
  function showWelcome() {
    S.welcomeDue = false;
    const newest = RELEASES[0] || { items: [] };
    const list = (newest.items || []).filter((w) => S.voiceEnabled || !w.voice).slice(0, 3)
      .map((w) => `<li><span class="wn-ico" aria-hidden="true">${w.ico}</span><div><b>${esc(w.title)}</b><p>${esc(w.text)}</p></div></li>`).join('');
    openModal('Welcome to Tableverse', `<p class="hint" style="text-align:left">Tableverse is a place to play classic card and board games online, with friends and other players. Find a table, sit down and play. Your games and progress are kept on your profile, so you can see how you are getting on.</p>${list ? `<h3>What’s new</h3><ul class="wn-list">${list}</ul>` : ''}<div class="row" style="margin-top:12px"><button type="button" class="btn primary" data-modal-act="welcomeStart">Start playing</button></div>`);
    postJson('/api/me/welcome-seen', {}, false, { quiet: true }).catch(() => {}); // shown: remember it on the account (a failed save only means it may show once more)
  }

  /** Every release, newest first, with its items (voice items only when voice chat is on). */
  function openVersionHistoryDialog() {
    const body = RELEASES.map((r) => {
      const items = r.items.filter((w) => S.voiceEnabled || !w.voice).map((w) => `<li><span class="wn-ico" aria-hidden="true">${w.ico}</span><div><b>${esc(w.title)}</b><p>${esc(w.text)}</p></div></li>`).join('');
      return `<section class="wn-release" aria-label="${esc(r.title)}"><h3 class="stat-h" style="margin:14px 0 6px">${esc(r.title)}${r.version || r.date ? ` <small>${esc([r.version, r.date].filter(Boolean).join(' · '))}</small>` : ''}</h3><ul class="wn-list">${items}</ul></section>`;
    }).join('');
    openModal('Version history', body || '<p class="hint">No releases yet.</p>', (o) => {
      // the dialog's only control is its close button: focus it, and keep Tab on it, so focus never reaches the page behind
      const close = o.querySelector('[data-modal-close]');
      if (!close) return;
      close.focus();
      o.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); close.focus(); } });
      // both entry points remove the trigger on open, so focus goes back to the account button when it closes
      modalOnClose = () => { const b = document.querySelector('.tb-avatar-btn'); if (b) b.focus(); };
    });
  }

  /** Fields whose text must survive a redraw (someone joins, a friend comes online) while the person is typing or choosing. */
  const KEEP_FIELDS = ['name', 'friendSearch', 'tableInviteFriend', 'code'];
  const VALUE_FIELDS = ['friendSearch', 'tableInviteFriend']; // the others are driven by state (S.name, S.draftCode): only focus and cursor come back
  /** The last HTML written to the app root. A redraw with the same markup does nothing: no DOM churn, no replayed animations. */
  let lastAppHtml = null;
  /** Appearance: 'dark' (the default), 'light', or 'system'. Kept on this device; the page's first script applies it before paint. */
  let themeChoice = null; // the choice made in this visit, kept even if storage refuses to save it
  function themeMode() {
    if (themeChoice) return themeChoice;
    try { const m = localStorage.getItem('tv_theme'); return m === 'light' || m === 'system' ? m : 'dark'; } catch { return 'dark'; }
  }
  function applyTheme() {
    const m = themeMode();
    const light = m === 'light' || (m === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    if (light) document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
  }
  // System mode follows the device appearance while the page stays open
  if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (themeMode() === 'system') applyTheme(); });
  let cardsShownAt = 0; // when the game cards last appeared (their entrance takes about half a second)
  function paintApp(html) {
    if (html === lastAppHtml) return;
    lastAppHtml = html;
    const hadCards = !!$app.querySelector('.game-card');
    const now = performance.now();
    $app.innerHTML = html;
    if (!hadCards && $app.querySelector('.game-card')) cardsShownAt = now;
    // the entrance animation of the game cards runs when they first appear, not on every redraw once they have settled
    $app.classList.toggle('no-anim', hadCards && now - cardsShownAt >= 600);
  }
  /** Which screen is showing: a redraw of the same screen keeps the person's scroll position. */
  function screenKey() { return `${S.page}|${S.room ? S.room.code + ':' + S.room.status : ''}|${S.ready ? 1 : 0}`; }
  function render() {
    const scrollBefore = window.scrollY, screenBefore = screenKey();
    const ae = document.activeElement;
    const focusedId = ae && KEEP_FIELDS.includes(ae.id) ? ae.id : null;
    // A folded panel the person opened (game options, spectators) stays open when the screen redraws, and a changed option
    // keeps its keyboard focus: changing one setting must not slam the panel shut.
    const openFolds = [...document.querySelectorAll('details[id]')].filter((d) => d.open).map((d) => d.id);
    const focusedOpt = ae && ae.dataset && ae.dataset.opt ? ae.dataset.opt : null;
    // seat swap and shuffle controls keep keyboard focus across a redraw, including one caused by another player's change
    const focusedSeat = ae && ae.dataset && (ae.dataset.act === 'pickSeat' || ae.dataset.act === 'shuffleSeats') ? { act: ae.dataset.act, vid: ae.dataset.vid || null } : null;
    const saved = {};
    for (const id of KEEP_FIELDS) {
      const el = document.getElementById(id);
      if (el && el.value !== undefined) saved[id] = { value: el.value, start: el.selectionStart, end: el.selectionEnd };
    }
    if (!S.room || S.room.status !== 'finished') S.endFlow = null;
    if (!S.ready && !S.guest && !S.room) {
      paintApp('<div class="page"><div class="brand"><svg class="brand-seat" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><ellipse cx="128" cy="126" rx="84" ry="58" fill="#153228" stroke="#86efac" stroke-opacity=".65" stroke-width="5"/><circle cx="128" cy="32" r="21" fill="#86efac"/><circle cx="24" cy="126" r="21" fill="#86efac"/><circle cx="232" cy="126" r="21" fill="#86efac"/><circle class="seat-halo" cx="128" cy="216" r="27" fill="#fbbf24" fill-opacity=".25"/><circle cx="128" cy="216" r="27" fill="#fbbf24"/></svg><h1>Tableverse</h1><p>Connecting…</p></div></div>');
    } else if (!S.room && S.page === 'profile' && !S.guest) renderProfilePage();
    else if (!S.room && S.page === 'player') renderPlayerPage();
    else if (!S.room && S.page === 'friends' && !S.guest) paintApp(topbarHTML() + friendsPageHTML());
    else if (!S.room) renderHome();
    else if (S.room.status === 'lobby') renderLobby();
    else renderGame();
    // Account reminders for a guest: never over a game in progress (the game-over card has its own, see endFlow)
    if (S.isGuest && !S.room && S.page === 'profile') addNudge('profile');
    if (S.isGuest && !S.room && S.page === 'friends') addNudge('friends');
    if (S.isGuest && S.room && S.room.status === 'lobby' && S.room.hostId === S.id) addNudge('create');
    updateWatchers();
    if ($chat && S.chatOpen) drawChat();
    showLevelUpDialog();
    for (const id of openFolds) { const d = document.getElementById(id); if (d && d.tagName === 'DETAILS') d.open = true; }
    if (screenKey() === screenBefore && Math.abs(window.scrollY - scrollBefore) > 1) window.scrollTo(0, scrollBefore);
    if (focusedOpt) { const el = $app.querySelector(`[data-opt="${CSS.escape(focusedOpt)}"]`); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
    if (focusedSeat) { const el = $app.querySelector(focusedSeat.vid ? `[data-act="${focusedSeat.act}"][data-vid="${CSS.escape(focusedSeat.vid)}"]` : `[data-act="${focusedSeat.act}"]`); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
    for (const id of KEEP_FIELDS) {
      const el = document.getElementById(id);
      const was = saved[id];
      if (!el || !was) continue;
      if (VALUE_FIELDS.includes(id) && el.value !== was.value && (el.tagName === 'SELECT' ? [...el.options].some((o) => o.value === was.value) : true)) el.value = was.value;
      if (id === focusedId) {
        el.focus({ preventScroll: true });
        try { if (was.start !== null && was.start !== undefined) el.setSelectionRange(was.start, was.end); } catch { /* selects and some input types have no selection */ }
      }
    }
  }

  /** Once per session, a signed-in player's profile tells us whether they are returning after a break. */
  function loadWelcome() {
    if (S.guest || S.welcomeLoaded === sessionGen) return;
    S.welcomeLoaded = sessionGen;
    const mineGen = sessionGen;
    const asked = ++welcomeAsked;
    getJson('/api/me/profile', { quiet: true }).then((me) => {
      if (mineGen !== sessionGen) return; // another account signed in meanwhile
      applyWelcome(me, mineGen, asked);
    }).catch(() => {});
  }

  /** The welcome-back card: shown once per visit after a day or more away. Dismissing it stores that visit, so a reload does not bring it back. */
  function welcomeHTML() {
    const w = S.welcomeBack;
    if (!w || S.welcomeFor !== sessionGen || store.get('ct_welcome') === w.since) return '';
    const away = w.awayDays === 1 ? 'a day' : `${w.awayDays} days`;
    const streak = w.streak >= 2 ? `<span>You're on a ${w.streak}-day streak. Play today to keep it going.</span>` : '';
    return `<section class="notice-bar welcome-back" role="status" aria-label="Welcome back">
      <div class="welcome-text"><strong>Welcome back!</strong><span>It's been ${away} since your last visit.</span>${streak}</div>
      <button type="button" class="wn-close" data-act="dismissWelcome" aria-label="Dismiss">✕</button>
    </section>`;
  }

  function renderHome() {
    loadWelcome();
    const tiles = S.games.map((g) => {
      const open = gameOpenFor(g);
      const guestLocked = guestLockedFor(g); // a tap opens the account prompt (the button stays enabled)
      const note = open ? '' : guestLocked && window.TvGuest ? window.TvGuest.lockedLabel(g.name) : '<p class="game-off" role="status">Unavailable right now.</p>';
      return `
      <article class="game-card${open ? '' : ' is-locked'}" style="--accent:${esc(g.accent || '#7b4bd0')}">
        <div class="game-art" aria-hidden="true">${gameMark(g)}</div>
        <div class="game-body">
          <h3>${esc(g.name)} <small>${range(g.seats)}</small></h3>
          <p>${esc(g.tagline)}</p>${note}
          <div class="row game-actions">
            <button class="btn small" type="button" data-act="create" data-game="${esc(g.id)}" ${open || guestLocked ? '' : 'disabled aria-disabled="true"'}>Create table</button>
            <button class="btn ghost small" type="button" data-act="rules" data-game="${esc(g.id)}">Rules</button>
          </div>
          ${g.id === 'wizard' ? `<p class="game-extra">${S.guest ? '<button type="button" class="linklike" data-act="showLogin">Log in for the offline scorecard</button>' : '<a href="/scorecard.html?game=wizard">Offline scorecard</a>'}</p>` : ''}
        </div>
      </article>`;
    }).join('');
    const name = S.guest ? '' : (S.named ? S.name : '');
    const oldTables = $app.querySelector('.public-tables'); // the open-tables list keeps its place when the home page redraws
    const tablesAt = oldTables ? { x: oldTables.scrollLeft, y: oldTables.scrollTop } : null;
    paintApp(`
    ${topbarHTML()}
    <main class="page wide home">
      <section class="home-hero">
        <div class="hero-fan" aria-hidden="true"><i class="hc c1"><b>A</b>♠</i><i class="hc c2 red"><b>K</b>♥</i><i class="hc c3"><b>Q</b>♣</i><i class="hc c4 red"><b>J</b>♦</i></div>
        <div class="home-intro">
          ${name && !S.guest ? `<small class="eyebrow">${dayPart()}</small>` : ''}
          <h1>${name ? `Hi, ${esc(name)}` : 'Your friends. Your games. One table.'}</h1>
          <p>${name ? 'Pick a game to host a table, or join one with a code.' : 'Play card and board games with friends in your browser. Bots can fill any empty seat.'}</p>
          ${S.guest ? `<div class="row" style="gap:8px"><button type="button" class="btn" data-act="showRegister">Create account</button><button type="button" class="btn ghost" data-act="showLogin">Log in</button>${S.guestPlay ? '<button type="button" class="btn ghost" data-act="playAsGuest">Play as a guest</button>' : ''}</div>` : ''}
        </div>
        ${guestNudge('home')}
        <form class="join-form" id="joinForm" aria-label="Join a table">
          <label class="label" for="code">Have a table code?</label>
          <div class="join-row"><input id="code" type="text" maxlength="6" placeholder="ABCDEF" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(S.draftCode)}"><button class="btn" type="submit">Join</button></div>
          <small class="hint">Private tables open with an invitation from the host.</small>
        </form>
      </section>
      ${rejoinBannerHTML()}
      ${bannersHTML()}
      ${S.announcement && S.dismissedAnnouncement !== S.announcement ? `<div class="notice-bar" role="status"><span>${esc(S.announcement)}</span><button type="button" class="wn-close" data-act="dismissAnnouncement" aria-label="Dismiss announcement">✕</button></div>` : ''}
      ${welcomeHTML()}
      ${friendsStripHTML()}
      <div class="home-split">
        ${publicTablesHTML()}
        <section class="home-section" id="games">
          <h2 class="section">Games</h2>
          ${tiles ? `<div class="game-grid">${tiles}</div>`
            : S.gamesFailed ? '<p class="game-off" role="status">Could not load the games. Check your connection, then reload the page.</p>'
            : S.gamesLoaded ? '<p class="game-off" role="status">No games are open right now.</p>'
            : loadingBlock('Loading games…') + '<div class="game-grid skeleton" aria-hidden="true">' + '<div class="game-card sk"><i></i><b></b><span></span></div>'.repeat(4) + '</div>'}
        </section>
      </div>
      ${comingSoonHTML()}
      ${recentTablesHTML()}
      <footer class="home-foot">${[S.guest ? '' : '<button type="button" class="linklike" data-act="openWhatsNew">What’s new</button>', '<a class="foot-follow" href="https://www.instagram.com/playtableverse/" target="_blank" rel="noopener noreferrer">Follow @playtableverse</a>', S.privacyPublished ? '<a href="/privacy">Privacy notice</a>' : '', S.termsPublished ? '<a href="/terms">Terms</a>' : '', S.impressumPublished ? '<a href="/impressum.html">Impressum</a>' : ''].filter(Boolean).join(' · ')}</footer>
    </main>`);
    const tablesNow = $app.querySelector('.public-tables');
    if (tablesNow && tablesAt) { tablesNow.scrollLeft = tablesAt.x; tablesNow.scrollTop = tablesAt.y; }
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
      // the ⋯ button is the visible control that opened the menu; the settings item lives inside the (now hidden) menu
      modalOnClose = () => { const more = document.querySelector('.tb-more-btn') || document.querySelector('.gs-chip'); if (more) more.focus(); };
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
    // Space on the focused chip opens the settings; it must not reach the document-level Space shortcuts (Mind plays a card on Space)
    chip.addEventListener('keydown', (e) => { if (e.code === 'Space') e.stopPropagation(); });
    // Game settings live in the ⋯ menu (top right), not in the top bar. The menu item is a plain button with the summary.
    const pop = $app.querySelector('.tb-pop');
    if (pop) {
      chip.className = 'btn ghost small gs-chip gs-menu-item'; chip.textContent = '⚙ Game settings';
      const sub = document.createElement('small'); sub.className = 'gs-menu-sum'; sub.textContent = summary;
      chip.appendChild(sub); pop.appendChild(chip); return;
    }
    const more = $app.querySelector('.tb-more-wrap');
    if (more && more.parentElement) { more.parentElement.insertBefore(chip, more); return; }
    const title = $app.querySelector('.wz-top > .wz-round');
    if (title) { title.classList.add('gs-host'); title.after(chip); }
    else { chip.classList.add('gs-float'); $app.prepend(chip); }
  }

  function renderLobby() {
    const r = S.room;
    const g = gameMeta(r.gameId) || { id: r.gameId, name: r.gameId, options: [], seats: { min: r.min, max: r.max }, icon: '🎴' };
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
        ${isHost && r.members.length > 1 ? `<button class="btn ghost small seat-swap${S.seatPick === m.id ? ' picked' : ''}" data-act="pickSeat" data-vid="${esc(m.id)}" aria-pressed="${S.seatPick === m.id}" aria-label="Swap the seat of ${esc(m.name)}">⇄</button>` : ''}
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
    paintApp(`
    <main class="page">
      <div class="row" style="justify-content:space-between">
        <button class="btn ghost small" data-act="leave">← Leave</button>
        <h2>${gameMark(g)} ${esc(g.name)}</h2>
        <span class="row" style="gap:6px">${S.guest || !pendingSocial() ? '' : bellHTML()}${voiceButtonsHTML()}${CardTable.chat.button()}<button class="btn ghost small" data-act="rules" data-game="${esc(r.gameId)}">Rules</button></span>
      </div>
      ${spectating ? `<section class="panel"><h3>👁 You are watching</h3><p class="hint" style="text-align:left;margin:6px 0 10px">The next game starts when the host presses Start. ${open > 0 ? 'There is an open seat if you want to play.' : 'Ask the host to free a seat if you want to play.'}</p>${open > 0 ? '<button class="btn" data-act="sit">Take a seat</button>' : ''}</section>` : ''}
      ${r.spectators && r.spectators.length ? `<details id="fold-spectators" class="spectator-list"><summary>👁 ${r.spectators.length} watching</summary>${isHost ? `<ul class="spectator-people">${r.spectators.map((x) => `<li><span class="nm">${esc(x.name)}</span><button class="btn ghost small" data-act="kickPlayer" data-id="${esc(x.id)}" data-name="${esc(x.name)}" aria-label="Remove ${esc(x.name)} from the table" title="Remove from table">✕</button></li>`).join('')}</ul>` : `<div class="spectator-names">${r.spectators.map((x) => esc(x.name)).join(', ')}</div>`}</details>` : ''}
      <section class="panel code-card">
        <div class="label">Table code</div>
        <div class="code">${esc(r.code)}</div>
        <div class="row" style="justify-content:center">
          <button class="btn small" data-act="copyLink">Copy invite link</button>
          <button class="btn small wa" data-act="whatsapp">WhatsApp</button>
          ${navigator.share ? '<button class="btn ghost small" data-act="share">Share…</button>' : ''}
        </div>
        ${isHost ? `<div class="visibility-control">${guestLockedHere('private_tables') ? '<p class="guest-lock-note" role="note">🔒 Private tables need a free account. Tap Private to create one.</p>' : ''}<span class="visibility-status ${r.visibility === 'public' ? 'public' : 'private'}" title="${r.visibility === 'public' ? 'Anyone can find this table in Open tables.' : 'Only friends with an accepted invitation can join.'}">${r.visibility === 'public' ? '🌐 Public table' : '🔒 Private table'}</span><button class="btn ghost small" data-act="toggleVisibility">${r.visibility === 'public' ? 'Make private' : 'Make public'}</button></div>` : ''}
        ${inviteFriendsHTML()}
      </section>
      <section class="panel">
        <div class="row" style="justify-content:space-between">
          <h3>Players <span class="label">${n} joined</span></h3>
          ${isHost ? stepper : `<span class="label">${r.seats} seats</span>`}
        </div>
        <p class="hint seat-status" id="seat-why" style="text-align:left;margin:8px 0 0">${esc([seatStatus, lessWhy, moreWhy].filter(Boolean).join(' '))}</p>
        <ul class="seats">${seats.join('')}</ul>
        ${isHost && n >= 2 ? `<div class="row seat-tools" style="justify-content:space-between"><button class="btn ghost small" data-act="shuffleSeats">🔀 Shuffle seats</button><span class="hint">${S.seatPick ? 'Now tap the seat to swap with (tap ⇄ again to cancel).' : 'Tap ⇄ on two players to swap their seats.'}</span></div>` : ''}
        ${isHost && open > 0 ? `<div class="row" style="margin-top:12px"><button class="btn ghost small" data-act="addBot">+ Add a bot</button><button class="btn ghost small" data-act="fillBots">Fill ${open} open seat${open === 1 ? '' : 's'} with bots</button></div>` : ''}
      </section>
      ${opts ? `<details id="fold-options" class="panel fold"><summary><span class="fold-title">Game options</span><span class="fold-hint">${esc(optionsSummary(g, r))}</span></summary><div class="opts">${opts}</div>${isHost ? '' : '<p class="hint" style="margin-top:8px">Only the host can change these.</p>'}</details>` : ''}
      ${
        isHost
          ? `<div class="start-bar"><button class="btn big" data-act="start">Start game${open > 0 ? ` <small>· ${open} bot${open === 1 ? '' : 's'} will join</small>` : ''}</button></div>`
          : `<div class="start-bar wait"><p class="label" style="text-align:center;margin:0">Waiting for the host to start… ${esc(seatStatus)}</p></div>`
      }
    </main>`);
    refreshVoiceUI();
  }

  // ------------------------------------------------------------ player stats
  const statsGame = (id) => gameMeta(id) || { id, name: id, icon: '🎴' }; // the id too, so a game's mark still shows without its menu entry
  const KIND_NOTE = { team: 'team game: a win means your team won', coop: 'co-operative: the whole table wins or loses together' };
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

  /** The statistics block of a profile. Bot seats and games left without a penalty are never counted (the server leaves them out). */
  /**
   * This week's board for one game (the last 7 days, opted-in players only) and the player's own switch for it, which is off
   * by default. The board is public and read-only.
   */
  /**
   * The skill-rating board for this game: lifetime, or this UTC month (Lifetime / This month). Nothing is shown while the
   * ratings are off on the server. Only people who turned on the boards appear, with at least 5 rated games in the scope.
   */
  /** The skill ratings for one game: what they mean, all-time or this month, the board, and the switch that shows you on it. */
  function ratingBoardHTML(P, meta) {
    // Hidden until the server has confirmed the ratings are on; a board that belongs to another game is never shown.
    if (P.ratingsEnabled !== true) return '';
    const b = P.ratingBoard && P.ratingBoard.game === P.game ? P.ratingBoard : null;
    const month = P.ratingScope === 'month';
    const seg = (scope, label) => `<button type="button" class="seg-btn" data-act="ratingScope" data-scope="${scope}" aria-pressed="${month === (scope === 'month')}">${label}</button>`;
    const rows = !b ? '<p class="hint" style="text-align:left">Loading ratings…</p>'
      : b.failed ? '<p class="hint" style="text-align:left">Could not load the ratings. Try again in a moment.</p>'
      : (b.board || []).length ? `<ol class="board-list">${b.board.map((r, i) => `<li class="${S.username && r.username === S.username ? 'me' : ''}"><span class="bl-rank">${i + 1}</span><span class="bl-name">${esc(r.displayName)}</span><b class="bl-val">${r.rating}</b><small class="bl-sub">${r.ratedGames} games</small></li>`).join('')}</ol>`
      : `<p class="hint" style="text-align:left">Nobody has 5 rated ${esc(meta.name)} games ${month ? 'this month' : 'yet'}.</p>`;
    const on = !!(P.data && P.data.profile && P.data.profile.leaderboardOptIn);
    // Your own rating is shown even when you are not on the boards (the board lists opted-in players only).
    const when = month ? ' this month' : '';
    const mine = P.data && b && b.me !== undefined ? (b.me
      ? `<p class="hint" style="text-align:left">Your rating: <b>${b.me.rating}</b> from ${b.me.ratedGames} rated games${when}.</p>`
      : `<p class="hint" style="text-align:left">You have no rated games here${when} yet.</p>`) : '';
    const switchBtn = P.data ? `<button type="button" class="btn ghost small" data-act="boardOptIn" aria-pressed="${on}">${on ? 'On: your name is on the boards' : 'Off: your name is not on the boards'}</button>` : '';
    return `<section class="progress-card" aria-label="Skill ratings for ${esc(meta.name)}">
      <h3 class="stat-h">Skill ratings</h3>
      <p class="hint" style="text-align:left">Everyone starts at 1000. Beating stronger players raises your rating, losing to weaker ones lowers it. You get a rating after your first rated game. A player appears on the boards after 5 rated games.</p>
      <div class="seg" role="group" aria-label="Rating period">${seg('lifetime', 'All time')}${seg('month', 'This month')}</div>
      ${mine}
      ${rows}
      <div class="board-foot">${switchBtn}<small>Your results stay on your profile either way.</small></div>
    </section>`;
  }

  /** Account level (from time played) and penalised leaves. `pr` is the progress the server sends; nothing when absent. */
  function progressHTML(pr, interactive = true) {
    // Own profile: `account` carries the level bar. Another player's profile has only `level`, so it shows the level alone.
    if (!pr || (!pr.account && (pr.level === undefined || pr.level === null))) return '';
    const a = pr.account || null;
    const level = a ? a.level : pr.level;
    const pct = a && a.need ? Math.min(100, Math.round((a.into / a.need) * 100)) : 0;
    const levelBlock = a
      ? `<div class="pg-level"><span class="stat-v">Level ${a.level}</span><span class="stat-l">${a.minutes} min played · ${Math.max(0, a.need - a.into)} min to level ${a.level + 1}</span>
        <div class="pg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${a.need}" aria-valuenow="${a.into}" aria-label="Progress to level ${a.level + 1}"><span style="width:${pct}%"></span></div></div>`
      : `<div class="pg-level"><span class="stat-v">Level ${Number(level) || 0}</span></div>`;
    const left = pr.penalisedLeaves > 0 ? `<p class="hint" style="text-align:left">Left ${pr.penalisedLeaves} game${pr.penalisedLeaves === 1 ? '' : 's'} early (counted as a loss).</p>` : '';
    const levelUp = interactive && S.levelUp && S.levelUp.username === S.username ? `<div class="levelup-note" role="status"><b>Level up!</b> You reached level ${Number(S.levelUp.to)}. <button type="button" class="btn small" data-act="levelUpAck">Got it</button></div>` : '';
    return `<section class="progress-card" aria-label="Level">${levelUp}${levelBlock}${left}</section>`;
  }

  /** One game from "By game": the record, its skill ratings, and that game's recent results. */
  function gameDetailHTML(P) {
    const id = P.game;
    const meta = statsGame(id);
    const head = `<div class="pg-head"><button type="button" class="btn ghost small" data-act="closeGameStats">← All games</button><b>${gameMark(meta)} ${esc(meta.name)}</b></div>`;
    const st = P.data.stats;
    const g = (st.perGame || []).find((x) => x.gameId === id);
    if (!g) return `${head}${emptyState('🃏', 'Not played yet', 'Play this game and your record and ratings show up here.')}`;
    const tile = (label, value, cls = '') => `<div class="stat-tile ${cls}"><span class="stat-v">${value}</span><span class="stat-l">${label}</span></div>`;
    const hist = P.gameHistory;
    const histHTML = !hist ? '<p class="hint" style="text-align:left">Loading recent games…</p>'
      : hist.failed ? '<p class="hint" style="text-align:left">Could not load this game’s history. Try again in a moment.</p>'
      : historyHTML({ ...hist, pages: 1 });
    return `${head}
      <div class="stat-grid">
        ${tile('Played', g.played)}
        ${tile('Wins', g.wins, 'good')}
        ${tile('Losses', g.losses)}
        ${tile('Win rate', g.winRate + '%')}
        <!-- The raw per-match score ("Highest score") is the legacy scoring and is not shown. The skill rating replaces it once it is live (design/scoring-skill-ratings.md). -->
      </div>
      ${ratingBoardHTML(P, meta)}
      <h3 class="stat-h">Recent ${esc(meta.name)} games</h3>
      ${histHTML}`;
  }

  function statsHTML(s, interactive = true) {
    if (!s || !s.played) return progressHTML(s && s.progress, interactive) + emptyState('🃏', 'No finished games yet', 'Finish a game with friends or bots and your record shows up here. Leaving while others are still playing counts as a loss.');
    const fav = s.favouriteGame ? statsGame(s.favouriteGame) : null;
    const tile = (label, value, cls = '') => `<div class="stat-tile ${cls}"><span class="stat-v">${value}</span><span class="stat-l">${label}</span></div>`;
    const games = s.perGame.map((g) => {
      const meta = statsGame(g.gameId);
      const tag = interactive ? 'button' : 'div';
      return `<${tag} class="stat-game${interactive ? ' stat-game-btn' : ''}"${interactive ? ` type="button" data-act="openGameStats" data-game="${esc(g.gameId)}" aria-label="${esc(meta.name)}: details"` : ''}><span class="stat-game-name">${gameMark(meta)} ${esc(meta.name)}${KIND_NOTE[g.kind] ? ` <small class="stat-kind" title="${esc(KIND_NOTE[g.kind])}">${g.kind === 'coop' ? 'co-op' : 'teams'}</small>` : ''}</span><span class="stat-game-rec">${g.wins}W · ${g.losses}L</span><span class="stat-bar" aria-hidden="true"><i style="width:${g.winRate || 0}%"></i></span><span class="stat-game-pct">${g.winRate}%</span>${g.best !== null && g.bestLabel ? `<span class="stat-game-best">${esc(g.bestLabel)}: <b>${esc(g.bestText)}</b></span>` : ''}</${tag}>`;
    }).join('');
    const recent = s.recent.map((r) => `<span class="stat-chip ${r.draw ? 'd' : r.won ? 'w' : 'l'}" title="${esc(statsGame(r.gameId).name)} · ${esc(fmtDate(r.finishedAt))}">${gameMark({ id: r.gameId, icon: statsGame(r.gameId).icon })}<b>${r.draw ? 'D' : r.won ? 'W' : 'L'}</b></span>`).join('');
    return `
      ${progressHTML(s.progress, interactive)}
      <div class="stat-grid">
        ${tile('Games played', s.played)}
        ${tile('Wins', s.wins, 'good')}
        ${tile('Losses', s.losses)}
        ${tile('Win rate', s.winRate + '%')}
        ${tile('Favourite game', fav ? `${gameMark(fav)} ${esc(fav.name)}` : '–', 'wide')}
        ${tile('Win streak', s.streak.current)}
        ${tile('Best streak', s.streak.best)}
      </div>
      <h3 class="stat-h">By game</h3>
      <div class="stat-games">${games}</div>
      <h3 class="stat-h">Last ${s.recent.length} game${s.recent.length === 1 ? '' : 's'} <small>(newest first)</small></h3>
      <div class="stat-recent">${recent}</div>
      <p class="hint" style="text-align:left;margin-top:12px">Ties share the win. Leaving while others are still playing counts as a loss.</p>`;
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

  /** The Ready gate as a game sees it: whether this seat is seated and ready, and who the table still waits for (null when no gate). */
  function gateInfo() {
    const gate = S.room && S.room.status === 'playing' && S.room.gate;
    if (!gate) return null;
    const nameOf = (id) => { const m = S.room.members.find((x) => x.id === id); return m ? m.name : 'Someone'; };
    return {
      seated: S.room.members.some((m) => m.id === S.id && !m.bot),
      youReady: gate.ready.includes(S.id),
      ready: gate.ready.length,
      total: gate.ready.length + gate.waiting.length,
      waiting: gate.waiting.map(nameOf),
    };
  }

  /**
   * Ready is shown where the game's next thing happens: a game's round summary or bid panel carries its own Ready box
   * (marked data-ready-here); every other game gets it in place of the status line just above the hand. It never covers the table,
   * and while you have not pressed it the bid panels are hidden (the table accepts no moves until everybody is ready).
   */
  /* Until this seat has pressed Ready, the table takes no input: every press, drag and key on the game is stopped before it
     reaches the game. The Ready box, the top bar, chat, and the leave, rules and player-card buttons stay usable. The server refuses moves too. */
  const GATE_OPEN_ACTS = new Set(['readyUp', 'leave', 'activityLog', 'showRules', 'playerCard', 'toggleTools', 'rules']);
  // the table's top bar (data-table-tools): leaving, rules, reactions and sound stay open; a game's own buttons in it (Resign) do not
  const TOOLBAR_OPEN = new Set(['leave', 'rules', 'emotes', 'sound', 'chat', 'toggleTools', 'showRules', 'activityLog']);
  const gateGuard = (e) => {
    if (!$app.classList.contains('gate-locked')) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('.ready-box, .topbar, .chat, [data-chat], [data-keep-open], .bell-panel')) return; // the bell's friend requests are app chrome, not game moves
    const act = t.closest('[data-act]');
    if (e.type === 'keydown' && e.key === 'Tab') {
      e.stopPropagation(); // keep native focus navigation, including Shift+Tab
      return;
    }
    const toolbarRules = t.closest('[data-toolbar-rules]');
    const ctl = t.closest('button, a, [role="button"]');
    const inTools = !!t.closest('[data-table-tools]');
    const toolOpen = inTools && ctl && Object.values(ctl.dataset).some((v) => TOOLBAR_OPEN.has(v));
    if (toolbarRules || toolOpen || (act && GATE_OPEN_ACTS.has(act.dataset.act))) {
      // Let these buttons generate a native click without activating game keyboard shortcuts.
      if ((toolbarRules || toolOpen || act?.dataset.act === 'toggleTools') && e.type === 'keydown' && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();
      return;
    }
    e.stopPropagation(); e.preventDefault();
  };
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'keydown', 'keyup', 'dragstart'].forEach((type) => $app.addEventListener(type, gateGuard, { capture: true, passive: false }));

  /** The Ready bar: shown while the table waits for everybody to press Ready (the first round, and each round between). Generic for every game. */
  function placeReady() {
    const room = S.room;
    const gate = gateInfo();
    $app.classList.toggle('ready-wait', !!gate); // while the table waits, the bid panels keep their place and stop taking input
    $app.classList.toggle('gate-locked', !!(gate && gate.seated && !gate.youReady)); // this seat must press Ready before anything else
    // A game keeps a fixed slot under the hand, always the same height: the Ready bar goes into it while the table waits, so the
    // table above never changes size when the bar comes or goes. The bar is rebuilt on each call, so its list never goes stale.
    const root = $app.querySelector('.wz');
    if (root && !$app.querySelector('.ready-slot')) root.insertAdjacentHTML('beforeend', '<div class="ready-slot" aria-live="polite"></div>');
    const slot = $app.querySelector('.ready-slot');
    if (!slot) return;
    slot.innerHTML = '';
    if (!gate || room.status !== 'playing') return;
    if ($app.querySelector('[data-ready-here]')) return; // a game with its own Ready box (a round summary, Take 5's bar) shows that one
    slot.innerHTML = CardTable.readyBox({ gate }, { title: 'Ready to continue?' }).replace('data-ready-here', 'data-ready-here data-ready-placed');
  }

  function renderGame() {
    lastAppHtml = null; // the game draws the root itself, so the last home or lobby markup is no longer on screen
    const plugin = plugins[S.room.gameId];
    if (!plugin || !S.view) {
      paintApp('<div class="page"><p>This game is not available in your browser version. Reload the page.</p></div>');
      return;
    }
    const focusedResultAction = document.activeElement?.closest('.end-actions button, .end-bar button')?.dataset.act;
    const r = S.room;
    if (r.status === 'finished' && (!S.endFlow || S.endFlow.code !== r.code)) S.endFlow = { code: r.code, start: Date.now() - Math.max(0, (r.outcome && r.outcome.sinceMs) || 0) + Math.max(0, (r.outcome && r.outcome.playMs) || 0), timer: null };
    plugin.render($app, S.view, {
      resultVisible: r.status !== 'finished' || Date.now() - S.endFlow.start >= END_BOARD_MS + END_WINNER_MS,
      room: S.room,
      gate: gateInfo(),
      game: gameMeta(S.room.gameId),
      isHost: S.room.hostId === S.id,
      activityLog: () => { if (!S.room || S.room.gameId !== 'gofish') openActivityLog(); },
      act: (action) => send({ t: 'act', action }),
      ready: () => send({ t: 'ready' }), // this seat is ready for the next round (or the first)
      leave: () => requestLeave(),
      rematch: () => send({ t: 'rematch' }),
      showRules: () => showRules(S.room.gameId),
      rerender: render,
      toast,
    });
    placeReady();
    markStandIns($app);
    watchStandIns();
    const statusText = $app.querySelector('.ludo-status b, .tm-status-guidance, .wz-status > span');
    announceStatus(statusText ? statusText.textContent : '');
    unifyToolbar();
    addSettingsChip();
    refreshVoiceUI();
    endFlow(focusedResultAction);
    if (CardTable.feed) CardTable.feed.sync($app, S.room.gameId, S.view, S.room.code);
    const bar = $app.querySelector('.wz-status');
    if (bar) {
      bar.insertAdjacentHTML('beforeend', '<span class="ct-timer" hidden></span>');
      bar.insertAdjacentHTML('beforeend', '<div class="ct-timebar" aria-hidden="true"><i></i></div>');
    }
    updateTimer();
    autoHowTo();
  }

  // ------------------------------------------------------------ end of a game
  const END_BOARD_MS = 2600; // the finished table stays visible (the last shot plays out on top of this)
  const END_WINNER_MS = 1400; // then the "<name> won" pop-up, where the game has no result sheet of its own
  /** Board → winner pop-up → result with Leave / Play again (or a vote). Every game's own result sheet stays hidden until the last stage. */
  /**
   * Game over: per person, this match's change, the monthly rating (and this match's change in it), and the all-time rating
   * in this game. `ratings` maps player id to { rated, reason, matchDelta, monthDelta, monthRating, lifetimeRating }; a player
   * without an entry shows dashes (the answer may still be on its way).
   */
  /** state: 'loading' (asking the server), 'pending' (game saved, ratings still updating), 'ready', or 'unavailable'. */
  function endRatingHTML(rows, gameName, ratings, state = 'ready') {
    const people = rows.filter((x) => !x.isBot);
    if (!people.length) return '';
    const game = esc(gameName || 'Game');
    const mine = people.find((x) => x.id === S.id);
    const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n));
    const num = (n) => (Number.isFinite(n) ? String(Math.round(n)) : '–');
    const note = mine && !mine.saved ? '<p class="xp-note">Guest games are not kept. Sign in to keep your ratings.</p>' : '';
    const body = people.map((x) => {
      const me = Boolean(mine) && x.id === S.id;
      const name = me ? 'You' : esc(x.name || 'Player');
      const guest = x.saved ? '' : '<small class="xp-tag">guest</small>';
      const left = x.penalised ? '<small class="xp-tag">left early</small>' : '';
      const q = ratings && x.saved ? ratings[x.id] : null;
      const waiting = state === 'loading' || state === 'pending';
      const none = waiting ? '…' : '–';
      let thisMatch = none;
      let month = none;
      let life = none;
      if (q) {
        thisMatch = q.rated && q.matchDelta !== null ? signed(q.matchDelta) : (waiting && q.rated ? none : 'unrated');
        month = q.monthRating !== null ? `${num(q.monthRating)}${q.monthDelta !== null ? ` (${signed(q.monthDelta)})` : ''}` : '–';
        life = num(q.lifetimeRating);
      }
      return `<div class="xp-tr${me ? ' me' : ''}" role="row"><span class="xp-name" role="cell">${name} ${guest}${left}</span><span class="xp-c" role="cell">${thisMatch}</span><span class="xp-c" role="cell">${month}</span><span class="xp-c" role="cell">${life}</span></div>`;
    }).join('');
    const status = { loading: 'Loading ratings…', pending: 'Updating ratings…', unavailable: 'Ratings are not available right now.' }[state] || '';
    // role=status stays outside any busy region, so the loading and updating text is announced
    const statusLine = status ? `<p class="xp-status" role="status">${status}</p>` : '';
    const table = `<div class="xp-table xp-table-rating" role="table" aria-label="${game} ratings for each player"><div class="xp-tr xp-th" role="row"><span role="columnheader">Player</span><span class="xp-c" role="columnheader">This match</span><span class="xp-c" role="columnheader">This month</span><span class="xp-c" role="columnheader">All time</span></div>${body}</div>`;
    return `<section class="end-xp" aria-label="${game} ratings for this game">${note}${statusLine}${table}</section>`;
  }

  function endFlow(focusedResultAction) {
    const r = S.room;
    if (!r || r.status !== 'finished') { $app.classList.remove('endhold'); return; }
    const f = S.endFlow;
    clearTimeout(f.timer);
    if (!f.levelDone) {
      // The result is written in the background and can finish later than the screen: refresh now and again shortly after
      // (a retry may still be writing). Leaving the table does not cancel these.
      f.levelDone = true;
      scheduleLevelRefresh();
    }
    const t = Date.now() - f.start;
    const stage = t < END_BOARD_MS ? 'board' : t < END_BOARD_MS + END_WINNER_MS ? 'winner' : 'result';
    $app.classList.toggle('endhold', stage !== 'result');
    if (stage !== 'result') f.timer = setTimeout(() => { if (S.room && S.room.code === f.code && S.room.status === 'finished') render(); }, (stage === 'board' ? END_BOARD_MS : END_BOARD_MS + END_WINNER_MS) - t + 30);
    // A game that draws its own result sheet already names the winner there: a second "won!" pop-up would announce it twice.
    if (stage === 'winner' && !$app.querySelector('.overlay, .ludo-end')) {
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
      if (!$app.querySelector('.end-actions')) {
        // No action row in this game (the non-host view): the shared actions go inside the result sheet, so they scroll with
        // the XP card. The fixed bar is only for a screen with no sheet.
        const inSheet = $app.querySelector('.overlay .sheet') || $app.querySelector('.ludo-end');
        if (inSheet) inSheet.insertAdjacentHTML('beforeend', `<div class="end-bar end-bar-in">${html}</div>`);
        else $app.insertAdjacentHTML('beforeend', `<div class="end-bar">${html}</div>`);
      }
      // A game can end while a sheet of its own (Hands, Stages) has focus: that control is replaced, so focus would fall to the page.
      // Focus a visible Stages sheet, restore the prior result action, or focus the first action on arrival.
      // A rules sheet open on the page keeps focus: the result behind it must not take it.
      if ((!document.activeElement || document.activeElement === document.body) && !document.querySelector('body > .overlay')) {
        // the action that had focus if it is still there (a redraw can replace it), otherwise the first action
        const back = (focusedResultAction && Array.from($app.querySelectorAll('.end-actions button, .end-bar button')).find((b) => b.dataset.act === focusedResultAction))
          || $app.querySelector('.end-actions button, .end-bar button');
        ($app.querySelector('[aria-labelledby="sr-phases-title"] button[data-sr="closePhases"]') || back)?.focus({ preventScroll: true });
      }
      // The game-over reminder: the one stronger prompt for a guest, placed by the end actions (never during play)
      const gameNudge = guestNudge('gameover');
      if (gameNudge) { const anchor = $app.querySelector('.end-actions-wrap, .end-bar'); (anchor || $app).insertAdjacentHTML(anchor ? 'beforebegin' : 'beforeend', gameNudge); }
      const xpRows = (r.outcome && r.outcome.xp) || [];
      const totals = endTotalsState(f);
      if (xpRows.length && totals.askNow) {
        if (send({ t: 'gameTotals' })) {
          f.totalsAsked = { at: Date.now(), tries: totals.tries + 1 };
          f.sendFails = 0;
          // asked again in place (no full redraw) once the answer is due
          setTimeout(() => retryEndTotals(f), 5100);
        } else setTimeout(() => retryEndTotals(f), 1000); // not connected yet: try again shortly rather than leave the card loading
      }
      if (xpRows.length) {
        $app.querySelectorAll('.end-xp').forEach((n) => n.remove());
        const card = endCardHTML(f);
        const wrap = $app.querySelector('.end-actions-wrap');
        const sheet = $app.querySelector('.overlay .sheet') || $app.querySelector('.ludo-end') || $app.querySelector('.overlay');
        if (wrap) wrap.insertAdjacentHTML('beforebegin', card);
        else if (sheet) sheet.insertAdjacentHTML('beforeend', card);
        else $app.insertAdjacentHTML('beforeend', card); // no result sheet at all: the bar is the only place
      }
    }
  }

  /** Where the game-over ratings stand for this table: the answer, or whether another ask is due (at most three, five seconds apart). */
  function endTotalsState(f) {
    const r = S.room;
    const cached = S.gameTotals && S.gameTotals.code === r.code && r.outcome && S.gameTotals.id === r.outcome.id ? S.gameTotals : null;
    const gotTotals = cached && !cached.pending && !cached.failed ? cached : null; // only a successful final answer stops retries
    const tries = f.totalsAsked ? f.totalsAsked.tries : 0;
    const sinceAsk = f.totalsAsked ? Date.now() - f.totalsAsked.at : Infinity;
    const waiting = Boolean(cached && cached.pending);
    // A pending answer may take longer (the rebuild queue), so it gets more asks; the server answers each one on the socket.
    const maxTries = waiting ? 6 : 3;
    return { cached, gotTotals, waiting, sinceAsk, tries, maxTries, askNow: !gotTotals && sinceAsk >= 5000 && tries < maxTries };
  }

  /** The game-over ratings card for the current answer. */
  function endCardHTML(f) {
    const r = S.room;
    const xpRows = (r.outcome && r.outcome.xp) || [];
    const t = endTotalsState(f);
    // out of retries with only a pending answer: say so, rather than "updating" with nothing left to ask for
    const gaveUp = !t.gotTotals && !!f.totalsAsked && t.tries >= t.maxTries && t.sinceAsk >= 5000;
    const state = t.gotTotals ? 'ready' : (gaveUp ? 'unavailable' : (t.waiting ? 'pending' : 'loading'));
    // the stored values show as soon as they arrive, also while the settled ones are still pending
    const shown = t.cached && t.cached.ratings ? t.cached.ratings : {};
    return endRatingHTML(xpRows, statsGame(r.gameId).name, shown, state);
  }

  /** Asks for the ratings again while the game-over card is still waiting, and swaps only the card when the answer is final. */
  function retryEndTotals(f) {
    if (!S.room || S.room.status !== 'finished' || S.endFlow !== f) return;
    const t = endTotalsState(f);
    if (!t.gotTotals && t.askNow) {
      if (send({ t: 'gameTotals' })) {
        f.totalsAsked = { at: Date.now(), tries: t.tries + 1 };
        f.sendFails = 0;
        setTimeout(() => retryEndTotals(f), 5100);
        return;
      }
      // no connection: keep trying each second; after about 30 s give up, so the card says the ratings are unavailable
      f.sendFails = (f.sendFails || 0) + 1;
      if (f.sendFails < 30) { setTimeout(() => retryEndTotals(f), 1000); return; }
      f.totalsAsked = { at: Date.now() - 5000, tries: 3 };
    }
    updateEndCard();
  }

  /** Replaces only the game-over ratings card (no redraw of the game). Falls back to a full redraw when there is no card yet. */
  function updateEndCard() {
    const f = S.endFlow;
    if (!S.room || S.room.status !== 'finished' || !f) return false;
    const old = $app.querySelector('.end-xp');
    if (!old) return false;
    old.outerHTML = endCardHTML(f);
    return true;
  }


  /** The rating board for the game on this profile page, for the chosen period. Public; the server says if ratings are off. */
  function loadRatingBoard(prof) {
    const id = prof.game;
    const gen = sessionGen;
    const scope = prof.ratingScope === 'month' ? 'month' : 'lifetime';
    const boardGen = prof.ratingBoardGen = (prof.ratingBoardGen || 0) + 1;
    prof.ratingBoard = null;
    const current = () => gen === sessionGen && S.profile === prof && prof.game === id && prof.ratingBoardGen === boardGen;
    getJson(`/api/ratings/board?game=${encodeURIComponent(id)}&scope=${scope}`)
      .then((b) => { if (current()) { prof.ratingsEnabled = b.enabled === true; prof.ratingBoard = { ...b, game: id }; render(); } })
      .catch(() => { if (current()) { prof.ratingBoard = { failed: true, game: id }; render(); } });
  }

  // ------------------------------------------------------------ events
  const actions = {
    endAgain: () => send({ t: 'rematch' }),
    endVote: () => send({ t: 'rematchVote', on: !(S.room.votes || []).includes(S.id) }),
    endLeave: () => requestLeave(),
    playerCard: (el) => openPlayerCard(el.dataset.pid),
    avatar: (el) => { S.avatarOpen = false; changeAvatar(el.dataset.a); },
    scrollGames: () => document.getElementById('games')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }),
    goHome: (el, e) => { if (e) e.preventDefault(); openPage('home'); },
    goGames: () => { if (S.page !== 'home') openPage('home'); requestAnimationFrame(() => { const el = document.getElementById('games'); if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }); },
    reloadProfile: () => loadProfile(),
    ratingScope: (el) => {
      const P = S.profile; if (!P) return;
      P.ratingScope = el.dataset.scope === 'month' ? 'month' : 'lifetime'; loadRatingBoard(P); render();
      // the redraw replaces the period button, so give keyboard focus back to the same period
      document.querySelector(`[data-act="ratingScope"][data-scope="${P.ratingScope}"]`)?.focus({ preventScroll: true });
    },
    setTheme: (el) => { themeChoice = el.dataset.theme; try { localStorage.setItem('tv_theme', themeChoice); } catch { /* not kept after this visit, but applied now */ } applyTheme(); render(); },
    profileTab: (el) => { if (S.profile) { S.profile.tab = el.dataset.tab; S.profile.game = null; if (el.dataset.tab === 'account') send({ t: 'blocks' }); render(); } },
    // another player's page: the server finds the account from the username, so no id is needed here
    playerBlock: () => {
      const P = S.player; if (!P || !P.data) return;
      if (!(ws && ws.readyState === 1)) { toast('Connection lost. Reconnect, then open the profile again.'); return; } // nothing is shown as blocked unless it is sent
      if (playerBusy(P)) return;
      playerBlockAction++;
      send({ t: 'block', username: P.data.username }); P.data.blockedByMe = true; P.reporting = false; render();
      const el = document.querySelector('.pp-actions [data-act="playerUnblock"]'); if (el) el.focus(); // the redraw replaced the button
    },
    playerUnblock: () => {
      const P = S.player; if (!P || !P.data) return;
      if (!(ws && ws.readyState === 1)) { toast('Connection lost. Reconnect, then open the profile again.'); return; }
      if (playerBusy(P)) return;
      playerBlockAction++;
      send({ t: 'unblock', username: P.data.username }); P.data.blockedByMe = false; render();
      const el = document.querySelector('.pp-actions [data-act="playerBlock"]'); if (el) el.focus();
    },
    playerReport: () => {
      const P = S.player; if (!P || !P.data) return;
      P.reporting = !P.reporting;
      render();
      // the redraw replaces the focused button: focus the first reason when the menu opens, Report when it closes
      const el = document.querySelector(P.reporting ? '.report-menu .mod-btn' : '.pp-actions [data-act="playerReport"]');
      if (el) el.focus();
    },
    playerReportSend: (el) => {
      const P = S.player; if (!P || !P.data) return;
      send({ t: 'reportPlayer', username: P.data.username, reason: el.dataset.reason });
      P.reporting = false; render();
      const again = document.querySelector('.pp-actions [data-act="playerReport"]');
      if (again) again.focus();
    },
    unblock: (el) => {
      const id = el.dataset.id;
      S.blocked = (S.blocked || []).filter((b) => b.id !== id); // the server confirms with the full list straight after
      render();
      send({ t: 'unblock', id });
    },
    historyPage: (el) => loadProfile(Number(el.dataset.page) || 1),
    openGameStats: (el) => {
      const prof = S.profile;
      if (!prof || !prof.data) return;
      const id = el.dataset.game;
      prof.game = id; prof.gameHistory = null; render();
      // Apply the answer only to the same profile, still open on this game (a reload or a sign-out drops it).
      const gen = sessionGen; // another account signed in or out since the click: its answer is not for this screen
      const current = () => gen === sessionGen && S.profile === prof && prof.game === id;
      getJson(`/api/me/history?game=${encodeURIComponent(id)}&page=1`)
        .then((h) => { if (current()) { prof.gameHistory = h; render(); } })
        .catch(() => { if (current()) { prof.gameHistory = { failed: true }; render(); } });
      loadRatingBoard(prof);
    },
    boardOptIn: async () => {
      const prof = S.profile;
      if (!prof || !prof.data || !prof.data.profile || prof.boardOptInPending) return;
      prof.boardOptInPending = true;
      const gen = sessionGen;
      const next = !prof.data.profile.leaderboardOptIn;
      try {
        const out = await postJson('/api/me/leaderboard', { optIn: next });
        if (gen !== sessionGen) return;
        if (S.profile === prof) {
          prof.data.profile.leaderboardOptIn = out.optIn === true;
          if (prof.game) loadProfileBoard(prof);
        } else if (S.page === 'profile' && !S.room) {
          // The profile screen was replaced while the save was in flight: reload it, but only if it is still the screen on show.
          await loadProfile();
        }
      } catch (e) { toast(e.message || 'Could not save that. Try again.'); }
      finally { prof.boardOptInPending = false; }
      render();
    },
    closeGameStats: () => { if (S.profile) { S.profile.game = null; S.profile.gameHistory = null; S.profile.boardGen = (S.profile.boardGen || 0) + 1; render(); } },
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
    levelUpAck: () => { // "Got it": remember this level on this device and take the notice away
      if (S.levelUp && S.levelUp.username === S.username) store.set('ct_level_seen_' + S.levelUp.username, String(S.levelUp.to));
      S.levelUp = null;
      render();
    },
    openFriendsPage: () => { S.menuOpen = false; S.bellOpen = false; openPage('friends'); },
    openSettings: () => { S.menuOpen = false; render(); openSettingsDialog(); },
    openWhatsNew: () => { S.menuOpen = false; openWhatsNewDialog(); },
    openVersionHistory: () => { S.menuOpen = false; render(); openVersionHistoryDialog(); },
    toggleAvatars: () => { S.avatarOpen = !S.avatarOpen; render(); },
    emotes: () => toggleEmoteBar(),
    activityLog: () => { if (!S.room || S.room.gameId !== 'gofish') openActivityLog(); },
    voiceMic: () => voice.toggleMic(),
    voiceSpeaker: () => voice.toggleSpeaker(),
    sound: () => { CardTable.sound.toggle(); render(); },
    create: (el) => {
      if (!authed()) return gateLogin(() => actions.create(el));
      const game = el.dataset.game;
      const meta = gameMeta(game);
      if (meta && !gameOpenFor(meta)) {
        if (guestLockedFor(meta)) return openAuthSheet('register', `Create a free account to play ${meta.name}.`);
        return toast('That game is unavailable right now.');
      }
      // New tables are public by default. The host can make the table private from the table screen (Make private).
      send({ t: 'create', gameId: game, visibility: 'public', name: S.name || undefined, avatar: S.avatar || undefined });
    },
    toggleVisibility: () => {
      const cur = S.room && S.room.visibility;
      if (cur === 'public' && guestLockedHere('private_tables')) return openAuthSheet('register', GUEST_LOCK_TEXT.private_tables);
      send({ t: 'setVisibility', visibility: cur === 'public' ? 'private' : 'public' });
    },
    // The server decides: your old seat if you had one (a bot is playing it), otherwise a seat in a lobby, otherwise watching.
    rejoin: (el) => {
      const mine = S.rejoin.find((x) => x.code === el.dataset.code);
      if (mine && mine.canReclaim === false) return mine.noSeatedHumans ? toast('This game cannot resume. Start a new game instead.') : actions.watch(el);
      askJoinMode(el.dataset.code, tableByCode(el.dataset.code));
    },
    watch: (el) => gateLogin(() => joinTable(el.dataset.code, 'spectate')),
    joinPublic: (el) => askJoinMode(el.dataset.code, tableByCode(el.dataset.code)),
    toggleSessions: () => { S.sessionListOpen = !S.sessionListOpen; store.set('ct_sessions_open', S.sessionListOpen ? '1' : '0'); render(); },
    leave: () => requestLeave(),
    chat: () => (S.chatOpen ? closeChat() : openChat()),
    sit: () => send({ t: 'sit' }),
    rules: (el) => showRules(el.dataset.game),
    addBot: () => send({ t: 'addBot' }),
    fillBots: () => {
      for (let i = 0; i < S.room.seats - S.room.members.length; i++) send({ t: 'addBot' });
    },
    removeBot: (el) => send({ t: 'removeBot', id: el.dataset.id }),
    makeHost: (el) => { S.pendingModalTarget = el.dataset.id; openModal('Make host', `<p class="hint">Make ${esc(el.dataset.name || 'this player')} the host of this table? You will stay at the table, but only the host can start the game and change settings.</p><div class="row" style="margin-top:12px; gap:10px"><button class="btn ghost small" data-modal-close>Cancel</button><button class="btn" data-modal-act="makeHostConfirm">Make host</button></div>`); },
    readyUp: () => send({ t: 'ready' }),
    kickPlayer: (el) => { S.pendingModalTarget = el.dataset.id; openModal('Remove player', `<p class="hint">Remove ${esc(el.dataset.name || 'this player')} from this table? They will not be able to come back.</p><div class="row" style="margin-top:12px; gap:10px"><button class="btn ghost small" data-modal-close>Cancel</button><button class="btn" data-modal-act="kickPlayerConfirm">Remove</button></div>`); },
    seats: (el) => send({ t: 'setSeats', seats: Number(el.dataset.n) }),
    shuffleSeats: () => {
      if (S.seatChange && Date.now() < S.seatChange.until) return; // one seat change at a time: a second one would start from an order the server has not confirmed (the state update that confirms it, or an error, clears the wait)
      S.seatPick = null; render();
      S.seatChange = { from: S.room.members.map((m) => m.id).join(), until: Date.now() + SEAT_CHANGE_FALLBACK_MS };
      send({ t: 'shuffleSeats' });
    },
    // the host swaps two players' seats: tap one, then the other (tapping the same one again cancels)
    pickSeat: (el) => {
      const id = el.dataset.vid;
      const first = S.seatPick;
      if (S.seatChange && Date.now() < S.seatChange.until) { S.seatPick = null; render(); return; } // wait for the last change to be confirmed
      if (!first) { S.seatPick = id; render(); const btn = $app.querySelector('[data-act="pickSeat"][data-vid="' + CSS.escape(id) + '"]'); if (btn) btn.focus({ preventScroll: true }); return; }
      S.seatPick = null;
      const ids = S.room.members.map((m) => m.id);
      const a = ids.indexOf(first); const b = ids.indexOf(id);
      if (first === id || a < 0 || b < 0) { render(); return; }
      [ids[a], ids[b]] = [ids[b], ids[a]];
      S.seatChange = { from: S.room.members.map((m) => m.id).join(), until: Date.now() + SEAT_CHANGE_FALLBACK_MS };
      send({ t: 'arrangeSeats', order: ids });
    },
    start: () => send({ t: 'start' }),
    dismissBanner: (el) => dismissBanner(el.dataset.id),
    openAdmin: () => { S.menuOpen = false; location.href = '/admin.html'; },
    openFeedback: () => { S.menuOpen = false; openFeedbackModal(); },
    dismissWelcome: () => {
      if (S.welcomeBack) store.set('ct_welcome', S.welcomeBack.since);
      S.welcomeBack = null;
      render();
    },
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

  // friends, requests and invitations are refreshed by the same visibility/idle-aware timer as the banners (see POLL_IDLE_MS)

})();
