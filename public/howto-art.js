'use strict';
/**
 * Pictures for the how-to-play cards. Each game registers CardTable.howtoArt[gameId] = (cardIndex) => svg; a card without a picture
 * (or a game without an entry) shows the game's mark. Carrom draws its own board in games/carrom.js; the others are drawn here from
 * the same board layouts and card faces the real tables use, kept small and static (no game state is read).
 */
(function () {
  const A = (window.CardTable = window.CardTable || {}).howtoArt = window.CardTable.howtoArt || {};
  const C = { ink: '#0c1f17', felt: '#14402e', line: 'rgba(240,253,244,.55)', gold: '#fbbf24', mint: '#86efac', red: '#f87171', blue: '#60a5fa', green: '#34d399', yellow: '#facc15', paper: '#f8f5ec', dark: '#1f2937', wood: '#c8985a', woodDark: '#8a5a2b' };
  const svg = (w, h, inner, cls = '') => `<svg class="ht-svg ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const T = (x, y, s, size = 16, fill = C.ink, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" ${extra}>${s}</text>`;
  const arrow = (x1, y1, x2, y2, col = C.gold) => {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 7;
    return `<g stroke="${col}" fill="${col}" stroke-width="3" stroke-linecap="round"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><path d="M${x2} ${y2} l${-h * Math.cos(a - .5)} ${-h * Math.sin(a - .5)} l${h * Math.cos(a - .5) - h * Math.cos(a + .5)} ${h * Math.sin(a - .5) - h * Math.sin(a + .5)} z" stroke="none"/></g>`;
  };
  /** A playing card, centre (x,y); `face` is the text, `col` its colour, `bg` the paper. */
  const card = (x, y, face, col = C.ink, { rot = 0, w = 40, h = 56, bg = C.paper, sub = '' } = {}) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="6" fill="${bg}" stroke="rgba(0,0,0,.35)"/>${T(0, sub ? -4 : 0, face, w * .5, col)}${sub ? T(0, 15, sub, w * .3, col) : ''}</g>`;
  const fan = (faces, y = 62, spread = 46) => faces.map((f, k) => card(160 + (k - (faces.length - 1) / 2) * spread, y + Math.abs(k - (faces.length - 1) / 2) * 3, f[0], f[1], { rot: (k - (faces.length - 1) / 2) * 7, sub: f[2] || '' })).join('');
  const grid = (cols, rows, size, x0, y0, fnFill) => { let o = ''; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) o += `<rect x="${x0 + c * size}" y="${y0 + r * size}" width="${size}" height="${size}" fill="${fnFill(c, r)}"/>`; return o; };
  const pick = (arr) => (i) => (arr[Math.min(i, arr.length - 1)] ? arr[Math.min(i, arr.length - 1)]() : '');

  // ---------------------------------------------------------------- three in a row, four in a row
  const xo = (x, y, s, k) => (k === 'x' ? `<g stroke="${C.red}" stroke-width="6" stroke-linecap="round"><line x1="${x - s}" y1="${y - s}" x2="${x + s}" y2="${y + s}"/><line x1="${x + s}" y1="${y - s}" x2="${x - s}" y2="${y + s}"/></g>` : `<circle cx="${x}" cy="${y}" r="${s}" fill="none" stroke="${C.blue}" stroke-width="6"/>`);
  const ttt = (marks, win) => {
    const o = 150, s = 56, x0 = 160 - 84;
    let g = `<rect x="${x0 - 8}" y="0" width="${s * 3 + 16}" height="${s * 3 + 16}" rx="14" fill="${C.felt}"/><g stroke="${C.line}" stroke-width="3" stroke-linecap="round"><line x1="${x0 + s}" y1="12" x2="${x0 + s}" y2="${s * 3 + 4}"/><line x1="${x0 + 2 * s}" y1="12" x2="${x0 + 2 * s}" y2="${s * 3 + 4}"/><line x1="${x0 + 8}" y1="${s}" x2="${x0 + 3 * s - 8}" y2="${s}"/><line x1="${x0 + 8}" y1="${2 * s}" x2="${x0 + 3 * s - 8}" y2="${2 * s}"/></g>`;
    marks.forEach((m, n) => { if (m) g += xo(x0 + (n % 3) * s + s / 2, 8 + Math.floor(n / 3) * s + s / 2, 14, m); });
    if (win) g += `<line x1="${x0 + win[0] * s + s / 2}" y1="${8 + win[1] * s + s / 2}" x2="${x0 + win[2] * s + s / 2}" y2="${8 + win[3] * s + s / 2}" stroke="${C.gold}" stroke-width="6" stroke-linecap="round" opacity=".9"/>`;
    return svg(320, o + 28, g);
  };
  A.tictactoe = pick([
    () => ttt(['x', 'o', '', '', 'x', '', '', '', 'o']),
    () => ttt(['x', 'o', 'o', '', 'x', '', '', '', 'x'], [0, 0, 2, 2]),
    () => ttt(['x', 'o', 'x', 'x', 'o', 'o', 'o', 'x', 'x']),
  ]);
  const c4 = (discs, win, drop) => {
    const s = 34, x0 = 160 - 3.5 * s, y0 = 14;
    let g = `<rect x="${x0 - 6}" y="${y0 - 6}" width="${7 * s + 12}" height="${6 * s + 12}" rx="14" fill="#1d4ed8"/>`;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) { const d = discs[r] && discs[r][c]; g += `<circle cx="${x0 + c * s + s / 2}" cy="${y0 + r * s + s / 2}" r="13" fill="${d === 'r' ? C.red : d === 'y' ? C.yellow : C.ink}"/>`; }
    if (win) g += `<line x1="${x0 + win[0] * s + s / 2}" y1="${y0 + win[1] * s + s / 2}" x2="${x0 + win[2] * s + s / 2}" y2="${y0 + win[3] * s + s / 2}" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".85"/>`;
    if (drop != null) g += arrow(x0 + drop * s + s / 2, -2, x0 + drop * s + s / 2, y0 + 8, C.gold);
    return svg(320, 6 * s + 36, g);
  };
  const board4 = (n) => { const b = Array.from({ length: 6 }, () => Array(7).fill('')); (n || []).forEach(([c, r, v]) => { b[r][c] = v; }); return b; };
  A.fourinarow = pick([
    () => c4(board4([[3, 5, 'r'], [2, 5, 'y'], [3, 4, 'y'], [4, 5, 'r']]), null, 3),
    () => c4(board4([[0, 5, 'r'], [1, 4, 'r'], [2, 3, 'r'], [3, 2, 'r'], [1, 5, 'y'], [2, 5, 'y'], [2, 4, 'y'], [3, 5, 'y'], [3, 4, 'y'], [3, 3, 'y']]), [0, 5, 3, 2]),
    () => c4(Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => ((c + (r >> 1)) % 2 ? 'r' : 'y')))),
  ]);

  // ---------------------------------------------------------------- chess
  const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const chessBoard = (pieces, over = '') => {
    const s = 30, x0 = 160 - 4 * s, y0 = 6;
    let g = grid(8, 8, s, x0, y0, (c, r) => ((c + r) % 2 ? '#8a5a2b' : '#e8d3a8'));
    for (const [sq, p] of Object.entries(pieces)) { const c = sq.charCodeAt(0) - 97, r = 8 - Number(sq[1]); g += T(x0 + c * s + s / 2, y0 + r * s + s / 2 + 1, GLYPH[p], 25, p === p.toUpperCase() ? '#fff' : '#111', `stroke="${p === p.toUpperCase() ? '#111' : '#fff'}" stroke-width=".6" paint-order="stroke"`); }
    return svg(320, 8 * s + 12, g + over);
  };
  const startPos = () => { const o = {}; 'rnbqkbnr'.split('').forEach((p, c) => { const f = String.fromCharCode(97 + c); o[f + '8'] = p; o[f + '7'] = 'p'; o[f + '2'] = 'P'; o[f + '1'] = p.toUpperCase(); }); return o; };
  const hint = (sq, col = 'rgba(134,239,172,.8)') => { const c = sq.charCodeAt(0) - 97, r = 8 - Number(sq[1]); return `<circle cx="${160 - 120 + c * 30 + 15}" cy="${6 + r * 30 + 15}" r="6" fill="${col}"/>`; };
  A.chess = pick([
    () => chessBoard(startPos(), hint('e3') + hint('e4')),
    () => chessBoard({ e1: 'K', d1: 'Q', a1: 'R', c1: 'B', b1: 'N', e2: 'P', e8: 'k', d8: 'q' }),
    () => chessBoard({ g1: 'K', a8: 'r', g8: 'k', f7: 'p', g7: 'p', h7: 'p', a1: 'R' }, `<rect x="${160 - 120 + 6 * 30}" y="${6 + 7 * 30}" width="30" height="30" fill="rgba(248,113,113,.45)"/>`),
    () => svg(320, 90, `<g transform="translate(130 10)"><line x1="6" y1="0" x2="6" y2="70" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/><path d="M8 4 h52 l-14 18 l14 18 h-52 z" fill="${C.paper}" stroke="rgba(0,0,0,.4)"/></g>`),
  ]);

  // ---------------------------------------------------------------- ludo
  const LUDO = [C.red, C.green, C.yellow, C.blue];
  const ludoBoard = (tokens = [], extra = '') => {
    const s = 17, x0 = 160 - 7.5 * s, y0 = 4;
    const cell = (c, r, f) => `<rect x="${x0 + c * s}" y="${y0 + r * s}" width="${s}" height="${s}" fill="${f}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>`;
    let g = `<rect x="${x0}" y="${y0}" width="${15 * s}" height="${15 * s}" rx="8" fill="#f4efe1"/>`;
    [[0, 0, 0], [9, 0, 1], [9, 9, 2], [0, 9, 3]].forEach(([c, r, k]) => { g += `<rect x="${x0 + c * s}" y="${y0 + r * s}" width="${6 * s}" height="${6 * s}" fill="${LUDO[k]}" opacity=".92"/><rect x="${x0 + (c + 1) * s}" y="${y0 + (r + 1) * s}" width="${4 * s}" height="${4 * s}" rx="10" fill="#fff" opacity=".85"/>`; });
    for (let i = 0; i < 15; i++) for (const j of [6, 7, 8]) { g += cell(i, j, '#fff'); g += cell(j, i, '#fff'); }
    for (let i = 1; i < 6; i++) { g += cell(i, 7, LUDO[0]) + cell(7, i, LUDO[1]) + cell(14 - i, 7, LUDO[2]) + cell(7, 14 - i, LUDO[3]); }
    g += cell(1, 6, LUDO[0]) + cell(8, 1, LUDO[1]) + cell(13, 8, LUDO[2]) + cell(6, 13, LUDO[3]);
    g += `<polygon points="${x0 + 6 * s},${y0 + 6 * s} ${x0 + 9 * s},${y0 + 6 * s} ${x0 + 7.5 * s},${y0 + 7.5 * s}" fill="${LUDO[1]}"/><polygon points="${x0 + 9 * s},${y0 + 6 * s} ${x0 + 9 * s},${y0 + 9 * s} ${x0 + 7.5 * s},${y0 + 7.5 * s}" fill="${LUDO[2]}"/><polygon points="${x0 + 6 * s},${y0 + 9 * s} ${x0 + 9 * s},${y0 + 9 * s} ${x0 + 7.5 * s},${y0 + 7.5 * s}" fill="${LUDO[3]}"/><polygon points="${x0 + 6 * s},${y0 + 6 * s} ${x0 + 6 * s},${y0 + 9 * s} ${x0 + 7.5 * s},${y0 + 7.5 * s}" fill="${LUDO[0]}"/>`;
    tokens.forEach(([c, r, k]) => { g += `<circle cx="${x0 + c * s + s / 2}" cy="${y0 + r * s + s / 2}" r="${s * .38}" fill="${LUDO[k]}" stroke="#fff" stroke-width="2"/>`; });
    return svg(320, 15 * s + 8, g + extra.replace(/\$X/g, x0).replace(/\$Y/g, y0).replace(/\$S/g, s));
  };
  const die = (x, y, n) => { const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[n]; return `<g><rect x="${x - 20}" y="${y - 20}" width="40" height="40" rx="9" fill="#fff" stroke="rgba(0,0,0,.35)"/>${pips.map(([a, b]) => `<circle cx="${x + a * 10}" cy="${y + b * 10}" r="3.6" fill="${C.ink}"/>`).join('')}</g>`; };
  A.ludo = pick([
    () => ludoBoard([[2, 2, 0], [3, 2, 0], [11, 2, 1], [12, 3, 1], [2, 11, 3], [12, 12, 2]]),
    () => svg(320, 110, `<g>${die(110, 55, 6)}${arrow(145, 55, 185, 55)}<circle cx="228" cy="55" r="17" fill="${C.red}" stroke="#fff" stroke-width="3"/></g>`),
    () => ludoBoard([[1, 6, 0]], `<g>${[2, 3, 4, 5].map((c) => `<circle cx="${160 - 7.5 * 17 + c * 17 + 8.5}" cy="${4 + 6 * 17 + 8.5}" r="2.5" fill="${C.ink}"/>`).join('')}</g>`),
    () => ludoBoard([[4, 6, 0], [6, 6, 1]], arrow(112, 114, 138, 114, '#111')),
    () => ludoBoard([[2, 7, 0], [3, 7, 0], [4, 7, 0], [5, 7, 0]]),
  ]);

  // ---------------------------------------------------------------- snakes & ladders
  const snl = (hl) => {
    const s = 29, x0 = 160 - 5 * s, y0 = 4, pos = (n) => { const r = Math.floor((n - 1) / 10), c = (n - 1) % 10; return [x0 + (r % 2 ? 9 - c : c) * s + s / 2, y0 + (9 - r) * s + s / 2]; };
    let g = grid(10, 10, s, x0, y0, (c, r) => ((c + r) % 2 ? '#f6d68a' : '#fde9b8'));
    const lad = (a, b) => { const [x1, y1] = pos(a), [x2, y2] = pos(b); return `<g stroke="${C.woodDark}" stroke-width="3" stroke-linecap="round"><line x1="${x1 - 5}" y1="${y1}" x2="${x2 - 5}" y2="${y2}"/><line x1="${x1 + 5}" y1="${y1}" x2="${x2 + 5}" y2="${y2}"/>${[.2, .4, .6, .8].map((t) => `<line x1="${x1 - 5 + (x2 - x1) * t}" y1="${y1 + (y2 - y1) * t}" x2="${x1 + 5 + (x2 - x1) * t}" y2="${y1 + (y2 - y1) * t}" stroke-width="2"/>`).join('')}</g>`; };
    const snake = (a, b) => { const [x1, y1] = pos(a), [x2, y2] = pos(b); const mx = (x1 + x2) / 2; return `<path d="M${x1} ${y1} C ${mx + 40} ${y1 + (y2 - y1) * .25}, ${mx - 40} ${y1 + (y2 - y1) * .75}, ${x2} ${y2}" fill="none" stroke="${C.red}" stroke-width="6" stroke-linecap="round"/><circle cx="${x1}" cy="${y1}" r="6" fill="${C.red}"/>`; };
    g += lad(4, 36) + lad(51, 79) + snake(97, 61) + snake(70, 28);
    if (hl) { const [x, y] = pos(hl); g += `<circle cx="${x}" cy="${y}" r="10" fill="${C.blue}" stroke="#fff" stroke-width="3"/>`; }
    return svg(320, 10 * s + 8, g);
  };
  A.snakesladders = pick([() => svg(320, 110, `${die(130, 55, 4)}${arrow(168, 55, 208, 55)}<circle cx="236" cy="55" r="15" fill="${C.blue}" stroke="#fff" stroke-width="3"/>`), () => snl(36), () => svg(320, 110, `${die(100, 55, 6)}${die(160, 55, 6)}${T(222, 55, '+ 🎲', 26, '#fff')}`), () => snl(100), () => snl(100)]);

  // ---------------------------------------------------------------- card games
  const SU = { s: ['♠', C.ink], h: ['♥', '#dc2626'], d: ['♦', '#dc2626'], c: ['♣', C.ink] };
  const pc = (r, s) => [r + SU[s][0], SU[s][1]];
  const felt = (inner, h = 130) => svg(320, h, `<rect x="6" y="6" width="308" height="${h - 12}" rx="22" fill="${C.felt}" stroke="rgba(255,255,255,.12)"/>${inner}`);
  A.wizard = pick([
    () => felt(fan([pc('W', 's'), pc('13', 'h'), pc('7', 'c'), pc('J', 'd')].map((f, k) => (k === 0 ? ['W', C.gold] : k === 3 ? ['J', '#9ca3af'] : f)))),
    () => felt(card(120, 65, '♥', '#dc2626', { sub: 'K' }) + card(200, 65, '♠', C.gold, { w: 56, bg: C.ink, sub: 'trump' })),
    () => felt(fan([pc('4', 'h'), pc('9', 'c'), pc('Q', 'd')]) + T(160, 22, 'I predict 2', 14, '#fff')),
    () => felt(card(100, 65, '5', C.ink, { sub: '♠' }) + card(160, 65, '9', C.ink, { sub: '♠' }) + card(220, 65, 'W', C.gold) + arrow(235, 100, 250, 40)),
    () => felt(T(160, 55, '20 + 10 per trick', 18, '#fff') + T(160, 82, 'wrong guess: −10 each', 14, C.mint)),
  ]);
  A.twentynine = pick([
    () => felt(fan([pc('J', 's'), pc('9', 's'), pc('A', 's'), pc('10', 's')])),
    () => felt(fan([pc('J', 'h'), pc('9', 'h'), pc('A', 'h'), pc('10', 'h')]) + T(160, 22, '3 · 2 · 1 · 1', 14, C.gold)),
    () => felt(T(160, 40, 'Bid 16', 26, '#fff') + T(160, 82, '4 cards, then 4 more', 14, C.mint)),
    () => felt(card(160, 65, '♠', C.ink, { sub: 'trump', w: 52, h: 70, bg: C.gold })),
    () => felt(fan([pc('A', 'c'), pc('10', 'c'), pc('K', 'c')]) + arrow(160, 118, 160, 100)),
    () => felt(card(120, 65, 'K', '#dc2626', { sub: '♥' }) + card(200, 65, 'Q', '#dc2626', { sub: '♥' }) + T(160, 24, 'Declare K–Q (+4)', 14, C.gold)),
  ]);
  A.poker = pick([
    () => felt(fan([pc('A', 's'), pc('K', 's')], 66, 56) + T(160, 20, 'your hand', 12, C.mint)),
    () => felt(`<circle cx="120" cy="65" r="20" fill="${C.blue}"/>${T(120, 65, 'SB', 14, '#fff')}<circle cx="200" cy="65" r="20" fill="${C.red}"/>${T(200, 65, 'BB', 14, '#fff')}`),
    () => felt(fan([pc('10', 'h'), pc('J', 'h'), pc('Q', 'h'), pc('2', 'c'), pc('7', 's')].slice(0, 5), 66, 52)),
    () => felt(T(160, 65, 'ALL IN', 28, C.gold)),
    () => felt(fan([pc('A', 'h'), pc('K', 'h'), pc('Q', 'h'), pc('J', 'h'), pc('10', 'h')], 66, 52)),
    () => felt(T(160, 48, 'Pair · Two pair · Trips', 14, '#fff') + T(160, 78, 'Straight · Flush · Full house', 14, '#fff')),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  A.themind = pick([
    () => felt(card(100, 65, '12', C.ink, { bg: '#e0f2fe' }) + card(160, 65, '47', C.ink, { bg: '#e0f2fe' }) + card(220, 65, '83', C.ink, { bg: '#e0f2fe' })),
    () => felt(T(160, 65, '🤫', 48, '#fff')),
    () => felt(card(110, 65, '47', C.ink, { bg: '#fee2e2' }) + card(190, 65, '12', C.ink, { bg: '#e0f2fe' }) + T(160, 18, 'out of order', 12, C.red)),
    () => felt(T(160, 65, '⭐', 52, C.gold)),
    () => felt(T(160, 50, 'Level 3', 22, '#fff') + T(160, 86, '❤️ ❤️ ❤️', 22, '#fff')),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  // ---------------------------------------------------------------- bingo
  const bingoCard = (x0, y0, cell, marked, lineRow) => {
    const nums = [[4, 19, 33, 52, 70], [9, 22, 38, 47, 64], [2, 30, 0, 59, 61], [13, 26, 41, 58, 75], [1, 18, 35, 55, 68]];
    let g = '';
    nums.forEach((row, r) => row.forEach((n, c) => {
      const x = x0 + c * cell, y = y0 + r * cell;
      const on = n === 0 || marked.includes(n);
      g += `<rect x="${x + 2}" y="${y + 2}" width="${cell - 4}" height="${cell - 4}" rx="5" fill="${on ? C.green : 'rgba(255,255,255,.14)'}"/>`
        + T(x + cell / 2, y + cell / 2, n === 0 ? '★' : n, 13, on ? C.ink : C.paper);
    }));
    if (lineRow !== undefined) g += `<rect x="${x0}" y="${y0 + lineRow * cell}" width="${cell * 5}" height="${cell}" rx="6" fill="none" stroke="${C.gold}" stroke-width="3"/>`;
    return g;
  };
  A.bingo = pick([
    () => felt(bingoCard(60, 14, 24, [4, 19, 33, 52, 70], 0) + T(160, 138, 'A full line wins', 15, '#fff'), 150),
    () => felt(`<circle cx="160" cy="62" r="34" fill="${C.paper}"/>` + T(160, 52, 'B', 11, '#9a3412') + T(160, 74, '4', 24, C.ink)
      + arrow(200, 62, 236, 62) + bingoCard(244, 36, 13, [4], undefined) + T(160, 128, 'Mark it once it is called', 14, '#fff'), 140),
    () => felt(T(160, 60, 'BINGO!', 38, C.gold) + T(160, 98, 'Shout it when your line is full', 15, '#fff'), 130),
  ]);
  // Sudoku: a 9x9 grid with thicker lines between the boxes; the picture shows givens, the player's right and wrong numbers
  const PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
  const ANSWER = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
  function sudokuGrid(cells, x0, y0, cell) {
    let out = '';
    for (let k = 0; k < 81; k++) {
      const r = Math.floor(k / 9), c = k % 9;
      const x = x0 + c * cell, y = y0 + r * cell;
      const given = cells[k] && cells[k].given;
      out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${cells[k] && cells[k].wrong ? 'rgba(239,68,68,.45)' : 'transparent'}" stroke="rgba(255,255,255,.25)" stroke-width="0.6"/>`;
      if (cells[k]) out += `<text x="${x + cell / 2}" y="${y + cell * 0.72}" text-anchor="middle" font-size="${cell * 0.8}" font-weight="${given ? 800 : 600}" fill="${given ? '#fff' : C.gold}">${cells[k].n}</text>`;
    }
    for (let b = 0; b <= 9; b += 3) {
      out += `<line x1="${x0 + b * cell}" y1="${y0}" x2="${x0 + b * cell}" y2="${y0 + 9 * cell}" stroke="#fff" stroke-width="1.6"/>`;
      out += `<line x1="${x0}" y1="${y0 + b * cell}" x2="${x0 + 9 * cell}" y2="${y0 + b * cell}" stroke="#fff" stroke-width="1.6"/>`;
    }
    return out;
  }
  const givensOnly = () => Array.from({ length: 81 }, (_, k) => (PUZZLE[k] !== '0' ? { n: PUZZLE[k], given: true } : null));
  A.sudoku = pick([
    () => felt(sudokuGrid(givensOnly(), 115, 10, 10)),
    () => felt(sudokuGrid(Array.from({ length: 81 }, (_, k) => {
      if (PUZZLE[k] !== '0') return { n: PUZZLE[k], given: true };
      if (k === 2) return { n: 7, wrong: true };
      if (k === 3) return { n: ANSWER[k] };
      return null;
    }), 115, 10, 10) + T(160, 102, 'Red is wrong, gold is yours', 9, '#fff')),
    () => felt(sudokuGrid(Array.from({ length: 81 }, (_, k) => ({ n: ANSWER[k], given: PUZZLE[k] !== '0' })), 115, 10, 10) + T(160, 102, '🏆', 16, '#fff')),
  ]);

  // Dots and Boxes: a 3x3 box grid of dots; a line, a closed box that keeps the turn, and the boxes each seat won
  const DB = { x0: 115, y0: 10, cell: 30, n: 3 };
  const dbDots = () => { let o = ''; for (let r = 0; r <= DB.n; r++) for (let c = 0; c <= DB.n; c++) o += `<circle cx="${DB.x0 + c * DB.cell}" cy="${DB.y0 + r * DB.cell}" r="2.6" fill="#fff"/>`; return o; };
  const dbH = (r, c, col = '#74b9ff') => `<line x1="${DB.x0 + c * DB.cell}" y1="${DB.y0 + r * DB.cell}" x2="${DB.x0 + (c + 1) * DB.cell}" y2="${DB.y0 + r * DB.cell}" stroke="${col}" stroke-width="5" stroke-linecap="round"/>`;
  const dbV = (r, c, col = '#74b9ff') => `<line x1="${DB.x0 + c * DB.cell}" y1="${DB.y0 + r * DB.cell}" x2="${DB.x0 + c * DB.cell}" y2="${DB.y0 + (r + 1) * DB.cell}" stroke="${col}" stroke-width="5" stroke-linecap="round"/>`;
  const dbBox = (r, c, col, letter) => `<rect x="${DB.x0 + c * DB.cell + 3}" y="${DB.y0 + r * DB.cell + 3}" width="${DB.cell - 6}" height="${DB.cell - 6}" rx="3" fill="${col}" opacity=".4"/>` + T(DB.x0 + c * DB.cell + DB.cell / 2, DB.y0 + r * DB.cell + DB.cell / 2, letter, 13, col);
  A.dotsboxes = pick([
    () => felt(dbDots() + dbH(0, 0) + T(160, 116, 'Draw a line between two dots', 10, '#fff')),
    () => felt(dbDots() + dbH(0, 0) + dbV(0, 0) + dbH(1, 0) + dbV(0, 1) + dbBox(0, 0, '#74b9ff', 'B') + dbH(1, 1, '#ff7675') + dbV(1, 2, '#ff7675') + T(160, 116, 'A closed box is yours: move again', 10, '#fff')),
    () => felt(dbDots() + dbBox(0, 0, '#74b9ff', 'B') + dbBox(0, 1, '#ff7675', 'R') + dbBox(1, 0, '#74b9ff', 'B') + T(160, 116, 'The most boxes wins', 10, '#fff')),
  ]);

  A.gofish = pick([
    () => felt(fan([pc('7', 's'), pc('7', 'h'), pc('3', 'c'), pc('J', 'd'), pc('9', 's')], 66, 44)),
    () => felt(T(160, 55, 'Ask for 7s', 20, '#fff') + arrow(110, 90, 210, 90)),
    () => felt(T(160, 65, '🐟', 48, '#fff')),
    () => felt(fan([pc('7', 's'), pc('7', 'h'), pc('7', 'd'), pc('7', 'c')], 66, 44) + T(160, 20, '📚 7s complete!', 12, C.gold)),
    () => felt(T(160, 65, 'sit out', 22, '#fff')),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  const CC = { r: '#ef4444', b: '#3b82f6', g: '#22c55e', y: '#eab308' };
  const cc = (x, face, k, rot = 0) => card(x, 65, face, '#fff', { bg: CC[k], rot, w: 44, h: 62 });
  A.colorclash = pick([
    () => felt(cc(100, '7', 'r', -6) + cc(160, '2', 'b') + cc(220, '9', 'g', 6)),
    () => felt(cc(120, '5', 'r') + arrow(150, 65, 175, 65) + cc(210, '8', 'r')),
    () => felt(cc(100, '⊘', 'g') + cc(160, '⇄', 'b') + cc(220, '+2', 'y')),
    () => felt(T(160, 65, 'One card left!', 16, '#fff')),
    () => felt(T(160, 55, 'winner scores other hands', 18, '#fff') + T(160, 85, 'highest total wins', 14, C.mint)),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  A.stagerummy = pick([
    () => felt(T(160, 65, 'Stage 1 → 10', 26, '#fff')),
    () => felt(card(60, 65, '8', '#dc2626', { sub: '●', w: 34, h: 48 }) + card(98, 65, '8', C.ink, { sub: '■', w: 34, h: 48 }) + card(136, 65, '8', C.ink, { sub: '▲', w: 34, h: 48 }) + [4, 5, 6, 7].map((n, k) => card(190 + k * 34, 65, n, '#fff', { bg: C.blue, w: 34, h: 48 })).join('') + T(98, 108, 'set', 12, C.mint) + T(253, 108, 'run', 12, C.mint), 130),
    () => felt(T(160, 50, 'draw one', 18, '#fff') + T(160, 82, 'discard one', 18, C.gold)),
    () => felt(card(160, 65, '⊘', '#fff', { bg: C.red, w: 48, h: 66 })),
    () => felt(T(160, 65, 'out of cards = out!', 20, '#fff')),
    () => felt(T(160, 65, '10 stages', 24, '#fff')),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  const penRows = (rows, hand, extra = '') => felt(rows.map((row, r) => row.map((n, c) => card(46 + c * 34, 22 + r * 26, n, C.ink, { w: 30, h: 22 })).join('')).join('') + hand.map((h, k) => card(230 + (k % 2) * 40, 40 + Math.floor(k / 2) * 52, h[0], h[1], { w: 34, h: 46 })).join('') + extra, 130);
  A.penaltyrows = pick([
    () => felt(T(160, 65, 'fewest 💣 wins', 22, '#fff')),
    () => penRows([[12, 15], [31], [48, 50], [77, 80]], [[23, C.ink], [58, C.ink], [64, C.ink]]),
    () => penRows([[12, 15, 19], [31], [48, 50], [77, 80, 83]], [[23, C.ink]], arrow(176, 52, 214, 52)),
    () => felt(card(120, 65, '4', C.ink) + T(210, 65, 'fits no row: take one', 12, C.gold)),
    () => felt(T(160, 65, '6th card takes the row', 18, '#fff')),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  A.hiddenminers = pick([
    () => felt(T(160, 65, '⛏️  🕳️', 38, '#fff')),
    () => svg(320, 130, `<rect x="6" y="6" width="308" height="118" rx="20" fill="#3b2a1d"/>${[0, 1, 2, 3, 4].map((c) => `<rect x="${44 + c * 46}" y="42" width="40" height="46" rx="6" fill="${c === 4 ? C.gold : '#7c5a3a'}"/>`).join('')}${T(266, 65, '🪙', 26, '#fff')}`),
    () => felt(fan([['⛏️', C.ink], ['🔭', C.ink], ['💥', C.red]], 66, 56)),
    () => felt(T(160, 65, '⛏️ ✖ broken', 22, '#fff')),
    () => felt(T(160, 65, '3 rounds', 26, '#fff')),
    () => felt(T(160, 65, 'move log', 24, '#fff')),
    () => felt(T(160, 65, '🏆', 44, '#fff')),
  ]);
  A.propertyrivals = pick([
    () => svg(320, 150, `<rect x="30" y="8" width="260" height="134" rx="14" fill="${C.felt}"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${42 + i * 30}" y="16" width="26" height="26" rx="4" fill="${[C.red, C.blue, C.green, C.yellow][i % 4]}"/><rect x="${42 + i * 30}" y="108" width="26" height="26" rx="4" fill="${[C.blue, C.yellow, C.red, C.green][i % 4]}"/>`).join('')}${T(160, 75, '🎲', 36, '#fff')}`),
    () => felt(T(160, 50, 'Buy it', 22, '#fff') + T(160, 86, 'others pay you rent', 14, C.mint)),
    () => felt(T(160, 65, '🏠 → 🏨', 32, '#fff')),
    () => felt(card(110, 65, '❓', C.ink, { bg: C.gold }) + card(210, 65, '💰', C.ink, { bg: C.paper })),
    () => felt(T(160, 65, 'mortgage for cash', 20, '#fff')),
    () => felt(T(160, 65, '💸 → 💀', 26, '#fff')),
  ]);
  // Real-footage pictures (public/howto/<game>/<card>.jpg, listed in howto/index.js) replace the drawn picture wherever one exists.
  const photoOf = (game, i) => (((window.CardTable.howtoImages || {})[game] || []).includes(i)
    ? `<img class="ht-photo" src="/howto/${game}/${i}.jpg" alt="" width="390" height="693" loading="lazy" decoding="async">` : '');
  for (const game of Object.keys(window.CardTable.howtoImages || {})) {
    const drawn = A[game];
    A[game] = (i, g) => photoOf(game, i) || (drawn ? drawn(i, g) : '');
  }
})();
