'use strict';
/**
 * One SVG mark per game (a coloured tile with a white glyph), used everywhere a game is shown: the home menu, open tables,
 * rejoin banner, history, stats, the game pages and the admin console. A game id with no mark falls back to its emoji icon.
 * Marks are drawn on a 48 x 48 grid and sized by the surrounding text (1em), so they follow the existing font sizes.
 */
(function () {
  const INK = '#f0fdf4'; // the ivory glyph colour (brand)
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Each mark: [tile colour, glyph markup]. Glyphs use INK, or the tile colour for cut-outs.
  const MARKS = {
    hiddenminers: ['#c98a2b', `<path d="M10 38 L24 12 L38 38 Z" fill="${INK}"/><rect x="20" y="26" width="8" height="12" rx="2" fill="#c98a2b"/><circle cx="35" cy="13" r="4.5" fill="#f5b700"/>`],
    colorclash: ['#e0533f', `<rect x="12" y="8" width="24" height="32" rx="5" fill="${INK}"/><rect x="16" y="13" width="7.5" height="10" rx="1.6" fill="#e0533f"/><rect x="24.5" y="13" width="7.5" height="10" rx="1.6" fill="#f5b700"/><rect x="16" y="25" width="7.5" height="10" rx="1.6" fill="#1a8a46"/><rect x="24.5" y="25" width="7.5" height="10" rx="1.6" fill="#2c62d6"/>`],
    bingo: ['#be185d', `<rect x="10" y="10" width="28" height="28" rx="6" fill="${INK}"/><g fill="#be185d"><circle cx="17" cy="17" r="2.6"/><circle cx="17" cy="24" r="2.6"/><circle cx="17" cy="31" r="2.6"/><circle cx="24" cy="17" r="2.6"/><circle cx="24" cy="31" r="2.6"/><circle cx="31" cy="17" r="2.6"/><circle cx="31" cy="24" r="2.6"/><circle cx="31" cy="31" r="2.6"/></g><circle cx="24" cy="24" r="3.4" fill="#fbbf24"/>`],
    gofish: ['#0891b2', `<ellipse cx="22" cy="24" rx="13" ry="8" fill="${INK}"/><path d="M33 24 L42 16 L42 32 Z" fill="${INK}"/><circle cx="16" cy="22" r="2.2" fill="#0891b2"/>`],
    ludo: ['#dc2626', `<rect x="12" y="12" width="24" height="24" rx="5" fill="${INK}"/><g fill="#dc2626"><circle cx="18" cy="18" r="2.6"/><circle cx="30" cy="18" r="2.6"/><circle cx="24" cy="24" r="2.6"/><circle cx="18" cy="30" r="2.6"/><circle cx="30" cy="30" r="2.6"/></g>`],
    penaltyrows: ['#92400e', `<g fill="${INK}"><rect x="10" y="11" width="24" height="5" rx="2.5"/><rect x="10" y="19" width="24" height="5" rx="2.5"/><rect x="10" y="27" width="24" height="5" rx="2.5"/><rect x="10" y="35" width="24" height="5" rx="2.5"/></g><g fill="#fbbf24"><circle cx="38" cy="13.5" r="3"/><circle cx="38" cy="21.5" r="3"/><circle cx="38" cy="29.5" r="3"/><circle cx="38" cy="37.5" r="3"/></g>`],
    poker: ['#111827', `<path d="M24 9 C24 9 11 21 11 30 C11 35.5 15.5 37.5 19.5 36 C20.5 35.6 21.5 35 22.3 34.3 L19.5 40 L28.5 40 L25.7 34.3 C26.5 35 27.5 35.6 28.5 36 C32.5 37.5 37 35.5 37 30 C37 21 24 9 24 9 Z" fill="#fbbf24"/>`],
    propertyrivals: ['#15803d', `<polygon points="24,10 39,23 35,23 35,38 13,38 13,23 9,23" fill="${INK}"/><rect x="21" y="28" width="6" height="10" rx="1" fill="#15803d"/>`],
    snakesladders: ['#059669', `<path d="M15 40 C30 36 14 28 28 24 S36 14 26 10" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/><circle cx="26" cy="10" r="3.4" fill="${INK}"/><circle cx="24.6" cy="9" r="0.9" fill="#059669"/>`],
    stagerummy: ['#2563eb', `<g fill="${INK}"><rect x="14" y="8" width="3.5" height="32" rx="1.5"/><rect x="30.5" y="8" width="3.5" height="32" rx="1.5"/><rect x="14" y="13" width="20" height="2.8" rx="1.4"/><rect x="14" y="20" width="20" height="2.8" rx="1.4"/><rect x="14" y="27" width="20" height="2.8" rx="1.4"/><rect x="14" y="34" width="20" height="2.8" rx="1.4"/></g>`],
    themind: ['#7c3aed', `<circle cx="24" cy="21" r="12.5" fill="${INK}"/><circle cx="15" cy="36" r="3" fill="${INK}"/><circle cx="11" cy="41" r="1.8" fill="${INK}"/><g fill="#7c3aed"><circle cx="18" cy="21" r="2.2"/><circle cx="24" cy="21" r="2.2"/><circle cx="30" cy="21" r="2.2"/></g>`],
    twentynine: ['#db2777', `<text x="24" y="31" text-anchor="middle" font-family="Poppins, Inter, sans-serif" font-weight="800" font-size="20" fill="${INK}">29</text>`],
    wizard: ['#4f46e5', `<polygon points="24,8 27.5,20.5 40,24 27.5,27.5 24,40 20.5,27.5 8,24 20.5,20.5" fill="${INK}"/><circle cx="37" cy="11" r="2.4" fill="${INK}"/><circle cx="11" cy="37" r="1.8" fill="${INK}"/>`],
    tictactoe: ['#0f766e', `<g stroke="${INK}" stroke-width="2.6" stroke-linecap="round"><line x1="19" y1="11" x2="19" y2="37"/><line x1="29" y1="11" x2="29" y2="37"/><line x1="11" y1="19" x2="37" y2="19"/><line x1="11" y1="29" x2="37" y2="29"/></g><g stroke="#fbbf24" stroke-width="3.2" stroke-linecap="round"><line x1="20.8" y1="20.8" x2="27.2" y2="27.2"/><line x1="27.2" y1="20.8" x2="20.8" y2="27.2"/></g>`],
    fourinarow: ['#e17055', `<rect x="9" y="12" width="30" height="24" rx="4" fill="${INK}"/><g fill="#e17055">${[18, 24, 30].map((cy) => [15, 21, 27, 33].map((cx) => `<circle cx="${cx}" cy="${cy}" r="2.4"/>`).join('')).join('')}</g>`],
    chess: ['#8b5e3c', `<g fill="${INK}"><path d="M14 38h20v3H14z"/><path d="M17 36l2-16h10l2 16z"/><rect x="14" y="14" width="20" height="4" rx="1"/><path d="M17 14v-5h3v2h2v-2h4v2h2v-2h3v5z"/></g>`],
    carrom: ['#a16207', `<circle cx="24" cy="24" r="14" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="24" cy="24" r="5" fill="${INK}"/><circle cx="38" cy="14" r="3" fill="${INK}"/>`],
  };

  /** The mark for a game id as an inline SVG string, or the escaped fallback (the emoji icon) when the id has no mark. */
  function html(id, fallback) {
    const m = Object.hasOwn(MARKS, id) ? MARKS[id] : null; // own entries only: 'constructor' is not a game
    if (!m) return esc(fallback || '🎴');
    return `<svg class="gmark" viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false"><rect width="48" height="48" rx="12" fill="${m[0]}"/>${m[1]}</svg>`;
  }

  window.GameMarks = { html, ids: () => Object.keys(MARKS) };
})();
