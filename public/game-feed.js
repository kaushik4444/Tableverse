/* Shared feed and spotlight for the table games that need them (Take 5 and Stage 10). Human-facing: the feed says who did
 * what, and the spotlight holds a card in the middle of the screen for a moment when something worth noticing happens
 * (a skip, a row taken, a stage laid). Callers pass HTML they have already escaped. Styles in game-feed.css. */
(() => {
  'use strict';
  const feeds = new Map(); // table key -> [{ id, html, tone, at }]
  const KEEP = 40;   // entries remembered per table
  const SHOW = 6;    // entries shown at once
  const TTL = 9000;  // an entry stays in the feed this long
  let spotTimer = null;

  /** Adds entries once each (by id). Returns the ones that were new. */
  function add(key, items) {
    if (!key) return [];
    let list = feeds.get(key);
    if (!list) { list = []; feeds.set(key, list); }
    const fresh = [];
    for (const it of items) {
      if (!it || !it.id || list.some((x) => x.id === it.id)) continue;
      const entry = { id: it.id, html: it.html, tone: it.tone || 'info', at: Date.now() };
      list.push(entry);
      fresh.push(entry);
    }
    while (list.length > KEEP) list.shift();
    return fresh;
  }

  /** The feed block: the newest few entries that are not too old, oldest first, newest at the bottom. */
  function html(key, cls = '') {
    const now = Date.now();
    const items = (feeds.get(key) || []).filter((x) => now - x.at < TTL).slice(-SHOW);
    if (!items.length) return '';
    return `<ol class="gf-feed ${cls}" role="log" aria-live="polite" aria-label="What just happened">${items.map((x) => `<li class="gf-item gf-${x.tone}${now - x.at < 1500 ? ' gf-new' : ''}">${x.html}</li>`).join('')}</ol>`;
  }

  /** Holds a card and a caption in the middle of the screen for a moment. Replaces one already showing. */
  function spotlight({ card = '', caption = '', tone = 'info', ms = 1200 } = {}) {
    if (typeof document === 'undefined' || !document.body) return;
    document.querySelectorAll('.gf-spot').forEach((el) => el.remove());
    clearTimeout(spotTimer);
    const el = document.createElement('div');
    el.className = `gf-spot gf-${tone}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `${card ? `<div class="gf-spot-card">${card}</div>` : ''}<div class="gf-spot-cap">${caption}</div>`;
    document.body.appendChild(el);
    spotTimer = setTimeout(() => el.remove(), ms);
  }

  window.GameFeed = { add, html, spotlight };
})();
