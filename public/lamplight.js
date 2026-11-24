'use strict';
/* Lamplight, the little script: the glow on a game card follows the pointer, and the top bar's tab pill slides to the tab under
   the pointer (and back to the current one). Pure decoration: with this file missing nothing stops working. */
(function () {
  const hover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  // a tap (or click) on a game card: the glow blooms from the point you touched
  document.addEventListener('pointerdown', (e) => {
    const card = e.target.closest && e.target.closest('.game-card');
    if (!card || card.classList.contains('is-locked')) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    card.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
    card.classList.remove('is-tapped'); void card.offsetWidth; card.classList.add('is-tapped');
    setTimeout(() => card.classList.remove('is-tapped'), 700);
  }, { passive: true });
  if (hover) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('.game-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
      card.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
    }, { passive: true });
  }

  // The pill only moves when its target really changes, and it stays put (hidden, not shrunk) when there is no target,
  // so a redraw never makes it flash or slide in from nothing.
  const place = (tabs, to) => {
    const pill = tabs.querySelector('.tb-pill');
    if (!pill) return;
    if (!to) { pill.style.opacity = '0'; return; }
    const w = `${to.offsetWidth}px`, x = `translateX(${to.offsetLeft}px)`;
    if (pill.style.width !== w || pill.style.transform !== x || pill.style.opacity !== '1') {
      // A pill that a redraw has just painted is put in its tab without animating. Otherwise the browser would slide it
      // in from its starting place (Home) on every page change. Its transition is switched off, the position is applied
      // and read back (forcing a style pass), and only then is the transition restored.
      const fresh = !pill.dataset.placed;
      if (fresh) pill.style.transition = 'none';
      pill.style.width = w;
      pill.style.transform = x;
      pill.style.opacity = '1';
      if (fresh) { void pill.offsetWidth; pill.style.transition = ''; pill.dataset.placed = '1'; }
    }
    tabs.classList.add('placed');
  };
  const current = (tabs) => tabs.querySelector('.tb-tab[aria-current="page"]');
  document.addEventListener('pointerover', (e) => {
    const tab = e.target.closest && e.target.closest('.tb-tab');
    if (tab) place(tab.parentElement, tab);
  });
  document.addEventListener('pointerout', (e) => {
    const tabs = e.target.closest && e.target.closest('.tb-tabs');
    if (tabs && !tabs.contains(e.relatedTarget)) place(tabs, current(tabs));
  });
  document.addEventListener('focusin', (e) => { const tab = e.target.closest && e.target.closest('.tb-tab'); if (tab) place(tab.parentElement, tab); });
  document.addEventListener('focusout', (e) => { const tabs = e.target.closest && e.target.closest('.tb-tabs'); if (tabs && !tabs.contains(e.relatedTarget)) place(tabs, current(tabs)); });
  // the app redraws the top bar often: put the pill under the current tab after each redraw (and on resize, when widths change)
  let settleQueued = false;
  const settle = () => document.querySelectorAll('.tb-tabs').forEach((t) => place(t, current(t)));
  const queueSettle = () => { if (settleQueued) return; settleQueued = true; requestAnimationFrame(() => { settleQueued = false; settle(); }); };
  new MutationObserver(queueSettle).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  window.addEventListener('resize', settle);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
  settle();
})();
