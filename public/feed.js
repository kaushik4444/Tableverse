/* Shared "what just happened" feed: new lines of a game's public log float up over the table for a few seconds, one after
 * another, then fade. Games with a `log` in their view get it from a config below (or register their own); the app calls
 * CardTable.feed.sync() after every game render. Decoration only: the status line is still what screen readers hear. */
(() => {
  'use strict';
  window.CardTable = window.CardTable || {};
  const LIFE = 4200; // how long a message floats
  const GAP = 850; // gap between messages that arrive together
  const MAX_KEPT = 8, MAX_SHOWN = 3;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = { roll: '🎲', land: '📍', rent: '💸', tax: '💸', buy: '🏠', build: '🔨', card: '🃏', lockup: '🔒', salary: '💰', auction: '🔔', trade: '🤝', debt: '⚠️', pay: '💵', bankrupt: '💀', win: '🏆', mortgage: '🏦',
    bid: '🗣️', trump: '♠️', marriage: '👑', roundEnd: '🏁', bet: '🪙', fold: '🏳️', check: '✋', info: '🃏', capture: '💥', home: '🏠', miss: '⏭️', ladder: '🪜', snake: '🐍', mistake: '💔', star: '⭐' };
  const textOf = (e) => (e.by === 'System' || e.by === 'Table' ? e.card : `${e.by} ${e.card}`);
  const base = { host: '.pt', pos: 'upper', icon: (e) => ICONS[e.kind] || '•', text: textOf };

  // Which log kinds float, and over which element, per game. Kinds not listed stay in the log only (the cards or the dice already show them).
  // Not here, on purpose: Snakes and Ladders, Ludo (a status bar prints the last event), Property Rivals (one line in the middle of the board),
  // Poker (bets, folds and the pot are on the seats and the table) and 29 (bids and the trick are on the table). A second stream of text only competes with them.
  const configs = {
    wizard: { ...base, show: ['bid', 'trump', 'roundEnd'] },
    themind: { ...base, host: '.tm-pile', pos: 'mid', show: ['mistake', 'star'] },
  };
  /** A game can register its own config: { host, pos, show: [kinds] | skip(e), icon(e), text(e), delay(e, i, batch) }. */
  const register = (id, cfg) => { configs[id] = { ...base, ...cfg }; };

  const st = { key: null, prev: null, lastN: null, items: [], timer: null, lastBorn: 0, host: null };
  const sig = (e) => `${e.kind}|${e.by}|${e.card}`;
  const reset = (key) => Object.assign(st, { key, prev: null, lastN: null, items: [], lastBorn: 0 });

  /** The entries of `log` that were not in the previous log. Uses entry numbers when the game has them, else the overlap of the tails. */
  function fresh(log) {
    if (!log.length) { if (st.lastN === null) st.lastN = 0; st.prev = st.prev || []; return []; } // nothing yet: whatever comes next is new
    const numbered = log.length && typeof log[log.length - 1].n === 'number';
    if (numbered) {
      const top = Math.max(...log.map((e) => e.n));
      if (st.lastN === null || top < st.lastN) { st.lastN = top; return []; }
      const out = log.filter((e) => e.n > st.lastN); st.lastN = top; return out;
    }
    const now = log.map(sig);
    const prev = st.prev; st.prev = now;
    if (!prev) return []; // first look at an existing log: do not replay it
    if (!prev.length) return log; // the log was empty and has just started
    const m = Math.min(prev.length, 4), tail = prev.slice(-m).join('\n');
    for (let j = now.length; j >= m; j--) if (now.slice(j - m, j).join('\n') === tail) return log.slice(j);
    return []; // no overlap: a new game or a long gap: do not replay old lines
  }

  function take(cfg, log) {
    const entries = fresh(log).filter((e) => (cfg.skip ? !cfg.skip(e) : cfg.show.includes(e.kind)));
    let t = Math.max(Date.now(), st.lastBorn);
    entries.forEach((e, i) => {
      t += cfg.delay ? cfg.delay(e, i, entries) : 0;
      st.items.push({ id: `${e.n === undefined ? Date.now() + ':' + i : e.n}`, kind: e.kind, html: `<i aria-hidden="true">${esc(cfg.icon(e))}</i>${esc(cfg.text(e))}`, born: t });
      t += GAP;
    });
    st.lastBorn = t;
  }

  const live = (now) => st.items.filter((f) => now >= f.born && now < f.born + LIFE).slice(-MAX_SHOWN);
  function paint() {
    const el = st.host && st.host.isConnected ? st.host.querySelector(':scope > .cf-feed') : null;
    const now = Date.now();
    st.items = st.items.filter((f) => now < f.born + LIFE).slice(-MAX_KEPT);
    if (!el) { clearInterval(st.timer); st.timer = null; return; }
    const shown = live(now), ids = shown.map((f) => f.id).join();
    if (el.dataset.ids !== ids) {
      el.innerHTML = shown.map((f) => `<p class="cf-msg k-${esc(f.kind)}" style="animation-duration:${LIFE}ms;animation-delay:-${now - f.born}ms">${f.html}</p>`).join('');
      el.dataset.ids = ids;
    }
    if (!st.items.length) { clearInterval(st.timer); st.timer = null; }
  }

  /** Call after a game has rendered into `root`. */
  function sync(root, gameId, view, roomCode) {
    const cfg = configs[gameId];
    if (!cfg || !view) return;
    const key = `${gameId}:${roomCode || ''}`;
    if (st.key !== key) reset(key);
    take(cfg, Array.isArray(view.log) ? view.log : []);
    const host = root.querySelector(cfg.host);
    st.host = host;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let el = host.querySelector(':scope > .cf-feed');
    if (!el) { el = document.createElement('div'); el.className = 'cf-feed'; el.setAttribute('aria-hidden', 'true'); host.appendChild(el); }
    el.dataset.pos = cfg.pos;
    el.dataset.ids = '';
    paint();
    if (st.items.length && !st.timer) st.timer = setInterval(paint, 300);
  }

  window.CardTable.feed = { register, sync, LIFE };
})();
