/* Guest play, on the page: the account reminder ("nudge"), the locked-game label, and the "play as a guest" sheet.
 * Nothing here decides what a guest may do (that is the server, lib/guestPolicy.js). This file only tells a guest what
 * is true and offers the way to an account. Reminders never open over a game in progress; the game-over card is the one
 * stronger prompt. Frequency is kept in this browser (localStorage) and is only a convenience: losing it shows reminders again. */
(() => {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'ct_guest_nudge';
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  // At most one reminder every SHOW_GAP on different pages; a dismissed reminder stays away for its own time.
  const SHOW_GAP = 6 * HOUR;
  const DISMISS = { home: 3 * DAY, create: 3 * DAY, profile: 3 * DAY, friends: 3 * DAY, gameover: 30 * MIN };
  const CONTEXTS = Object.keys(DISMISS);

  function read() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: reminders are shown as usual */ } }

  /** True when this reminder may be shown now: not dismissed recently, and the last shown one was this page or long ago. */
  function canShow(ctx, now = Date.now()) {
    if (!CONTEXTS.includes(ctx)) return false;
    const s = read();
    const dismissedAt = (s.dismissed && s.dismissed[ctx]) || 0;
    if (now - dismissedAt < DISMISS[ctx]) return false;
    if (ctx !== 'gameover' && s.lastShown && now - s.lastShown < SHOW_GAP && s.lastCtx !== ctx) return false;
    return true;
  }
  function markShown(ctx, now = Date.now()) {
    const s = read();
    s.lastShown = now; s.lastCtx = ctx;
    write(s);
  }
  function dismiss(ctx, now = Date.now()) {
    const s = read();
    s.dismissed = { ...(s.dismissed || {}), [ctx]: now };
    write(s);
  }

  const COPY = {
    home: 'Create a free account to keep your games, stats and friends, and to continue on any device.',
    create: 'Your table works now. An account keeps your games and stats, and lets you pick them up on any device.',
    profile: 'Guest progress is kept only in this browser. An account saves your games and stats and works on any device.',
    friends: 'Friends need an account, so others can find you and you can find them.',
    gameover: 'Nice game. Keep this result: create a free account and your games and stats are saved to it.',
  };

  /**
   * The reminder for a context, or '' when a guest should not see it now (not a guest, dismissed, or the cooldown is on).
   * `hours` is the guest lifetime, `strong` makes the game-over version prominent.
   */
  function nudgeHTML(ctx, { guest = false, hours = 72, now = Date.now() } = {}) {
    if (!guest || !canShow(ctx, now)) return '';
    markShown(ctx, now);
    const strong = ctx === 'gameover';
    const title = strong ? 'Keep your result' : 'You are playing as a guest';
    const life = strong ? '' : ` <span class="guest-life">Guest progress stays in this browser for about ${Number(hours) || 72} hours.</span>`;
    return `<aside class="guest-nudge${strong ? ' strong' : ''}" data-guest-ctx="${ctx}" aria-label="Account reminder">
      <div class="guest-nudge-text"><b>${esc(title)}</b><span>${esc(COPY[ctx])}</span>${life}</div>
      <div class="guest-nudge-actions"><button type="button" class="btn small" data-guest-act="upgrade">Create free account</button>
      <button type="button" class="btn ghost small" data-guest-act="dismiss" data-guest-ctx="${ctx}" aria-label="Hide this reminder">Not now</button></div>
    </aside>`;
  }

  /** The line a locked game shows a guest, instead of the create button. */
  function lockedLabel(gameName) {
    return `<p class="game-off guest-locked" role="status">Create a free account to play ${esc(gameName)}.</p>`;
  }

  /** The "play as a guest" dialog body: a name (optional, made unique for you) and the account option. */
  function guestSheetHTML({ hours = 72 } = {}) {
    return `<div class="sheet guest-sheet" role="dialog" aria-label="Play as a guest">
      <h2>Play as a guest</h2>
      <p class="hint" style="text-align:left">Guests can create and join tables and play the games that are open to guests. Your progress stays in this browser for about ${Number(hours) || 72} hours and does not sync to other devices. A free account keeps your games and stats, and works on any device.</p>
      <form id="guestForm" class="auth-form">
        <input id="guestName" type="text" maxlength="20" placeholder="Your name (optional)" autocomplete="nickname" aria-describedby="guestNameHint">
        <small id="guestNameHint" class="hint">If someone already uses that name, a number is added to the end.</small>
        <button class="btn big" type="submit">Play as a guest</button>
      </form>
      <div class="row" style="margin-top:10px"><button class="btn ghost" type="button" data-guest-act="upgrade">Create a free account instead</button></div>
    </div>`;
  }

  const hooks = { upgrade: () => {}, dismissed: () => {} };
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-guest-act]');
    if (!el) return;
    if (el.dataset.guestAct === 'dismiss') {
      const ctx = el.dataset.guestCtx;
      dismiss(ctx);
      const box = el.closest('.guest-nudge');
      if (box) box.remove();
      hooks.dismissed(ctx);
      return;
    }
    if (el.dataset.guestAct === 'upgrade') hooks.upgrade();
  });

  window.TvGuest = { canShow, markShown, dismiss, nudgeHTML, lockedLabel, guestSheetHTML, hooks, DISMISS, SHOW_GAP, KEY };
})();
