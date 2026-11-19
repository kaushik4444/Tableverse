/* Tic-Tac-Toe and Four in a Row (Four or Five, by option): one renderer for the line games (see games/linegames).
 * Tic-Tac-Toe taps a square, Four/Five in a Row taps a column. Styles in linegames.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;
  const ENTER_MS = 900;
  // enter: the cell that has just been played (it animates once, then the mark rests), see react()
  const ui = { ctx: null, v: null, seq: null, enter: null, enterShown: false };
  const MARKS = {
    tictactoe: [{ cls: 'x', name: 'X' }, { cls: 'o', name: 'O' }],
    fourinarow: [{ cls: 'red', name: 'Red' }, { cls: 'yellow', name: 'Yellow' }],
  };
  // X and O are drawn as strokes that fill their square exactly, so a mark never changes the size of a square.
  const GLYPH = {
    x: '<svg class="lg-glyph" viewBox="0 0 100 100" focusable="false"><path d="M24 24 76 76M76 24 24 76" pathLength="100"/></svg>',
    o: '<svg class="lg-glyph" viewBox="0 0 100 100" focusable="false"><circle cx="50" cy="50" r="28" pathLength="100"/></svg>',
  };
  const marks = (v) => MARKS[v.game];
  const nameOf = (v, i) => (i === v.me ? 'You' : esc(v.players[i].name));

  function guidance(v) {
    if (v.phase === 'gameOver') {
      if (v.draw) return 'A draw';
      return v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won!' : `${esc(v.players[v.winner].name)} won`;
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} to move`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} is thinking…`;
    return v.gravity ? 'Your move: pick a column' : 'Your move';
  }

  function pieceHTML(v, i, style) {
    const m = marks(v)[i];
    return `<span class="lg-piece ${m.cls}"${style ? ` style="${style}"` : ''} aria-hidden="true">${GLYPH[m.cls] || ''}</span>`;
  }
  /** Extra classes for the cell that was just played, and for a winning cell (its position in the line sets the delay). */
  function cellClass(v, k, owner) {
    const lit = v.line.indexOf(k);
    return ['lg-cell', owner === null ? 'free' : 'full', lit >= 0 ? 'win' : '', v.last === k ? 'last' : '', ui.enter && !ui.enterShown && ui.enter.cell === k ? 'enter' : ''].filter(Boolean).join(' ');
  }
  const winStyle = (v, k) => { const i = v.line.indexOf(k); return i >= 0 ? `--i:${i}` : ''; };

  function seatsHTML(v, ctx) {
    return `<div class="lg-seats">${v.players.map((p, i) => `<div class="lg-seat ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}">
      <span class="lg-mark">${pieceHTML(v, i)}</span><span class="lg-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b><small>${marks(v)[i].name}</small></span></div>`).join('')}</div>`;
  }

  function cellsHTML(v) {
    const legal = new Set(v.legal);
    const out = [];
    for (let k = 0; k < v.board.length; k++) {
      const r = Math.floor(k / v.cols), c = k % v.cols;
      const owner = v.board[k];
      const piece = owner !== null ? pieceHTML(v, owner, winStyle(v, k)) : '';
      const cls = cellClass(v, k, owner);
      const label = `Row ${r + 1}, column ${c + 1}, ${owner === null ? 'empty' : marks(v)[owner].name}`;
      if (v.gravity) out.push(`<div class="${cls}" data-col="${c}" role="presentation">${piece}</div>`);
      else out.push(`<button type="button" class="${cls}" data-cell="${k}" aria-label="${label}" ${owner === null && legal.has(k) ? '' : 'disabled'}>${piece}</button>`);
    }
    return out.join('');
  }

  function boardHTML(v) {
    if (v.gravity) {
      const cols = Array.from({ length: v.cols }, (_, c) => {
        const open = v.legal.some((k) => k % v.cols === c);
        const cells = Array.from({ length: v.rows }, (_, r) => {
          const k = r * v.cols + c, owner = v.board[k];
          const cls = cellClass(v, k, owner);
          // --drop: how many squares the disc falls, so a higher drop takes a little longer
          const style = [winStyle(v, k), ui.enter && ui.enter.cell === k ? `--drop:${r + 1}` : ''].filter(Boolean).join(';');
          return `<div class="${cls}">${owner !== null ? pieceHTML(v, owner, style) : ''}</div>`;
        }).join('');
        return `<button type="button" class="lg-col" data-col="${c}" aria-label="Drop in column ${c + 1}" ${open ? '' : 'disabled'}>${cells}</button>`;
      }).join('');
      return `<div class="lg-board lg-gravity" style="--cols:${v.cols};--rows:${v.rows}" role="group" aria-label="${esc(v.name)} board">${cols}</div>`;
    }
    return `<div class="lg-board lg-${v.game}" style="--cols:${v.cols};--rows:${v.rows}" role="group" aria-label="${esc(v.name)} board">${cellsHTML(v)}</div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const title = v.draw ? 'A draw' : v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${v.draw ? 'The board is full with no line.' : `${nameOf(v, v.winner) === 'You' ? 'You' : esc(v.players[v.winner].name)} made ${v.win} in a row.`}</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-lg="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-lg="leave">Leave table</button></div></div></div>`;
  }

  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    // the new mark animates once; a later redraw of the same position shows it at rest
    ui.enter = Number.isInteger(e.cell) ? { cell: e.cell, seq: e.seq } : null;
    ui.enterShown = false;
    const mine = ui.enter;
    setTimeout(() => { if (ui.enter === mine) ui.enter = null; }, ENTER_MS);
    if (!snd) return;
    snd.play(v.gravity ? 'drop' : 'place');
    // the result sound follows the move once the mark has landed
    const over = e.type === 'win' ? (v.winner === v.me ? 'win' : 'lose') : e.type === 'draw' ? 'round' : null;
    // a disc falls (row + 1) squares, then lands; a draw's last stroke ends at about 380 ms
    const landMs = v.gravity ? 280 + (Math.floor(e.cell / v.cols) + 1) * 70 + 240 : 380;
    if (over) setTimeout(() => snd.play(over), landMs);
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.v = v; react(v);
    root.innerHTML = `<div class="wz lg" data-game="${esc(v.game)}">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.win} in a row</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-lg="rules">Rules</button>', 'lg')}</div>
      ${seatsHTML(v, ctx)}
      ${boardHTML(v)}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    if (ui.enter) ui.enterShown = true; // the entrance has been drawn: a redraw shows the mark at rest
  }

  function onClick(e) {
    const el = e.target.closest('[data-lg],[data-cell],[data-col]'); const v = ui.v, ctx = ui.ctx;
    if (!el || !v || !ctx || el.disabled) return;
    if (el.dataset.col !== undefined && el.classList.contains('lg-col')) { if (v.myTurn) ctx.act({ type: 'drop', col: Number(el.dataset.col) }); return; }
    if (el.dataset.cell !== undefined) {
      if (!v.myTurn) return;
      const k = Number(el.dataset.cell);
      ctx.act({ type: 'place', cell: k });
      return;
    }
    switch (el.dataset.lg) {
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  for (const id of ['tictactoe', 'fourinarow']) window.CardTable.register(id, { render });
})();
