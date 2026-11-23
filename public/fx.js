'use strict';
// A soft light under the pointer on the game cards (the CSS reads --mx/--my). Does nothing without a mouse and is cheap: one passive listener.
(function () {
  if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;
  let raf = 0;
  document.addEventListener('pointermove', (e) => {
    const card = e.target && e.target.closest && e.target.closest('.game-card');
    if (!card || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }, { passive: true });
})();
