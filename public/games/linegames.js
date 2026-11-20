/* Tic-Tac-Toe and Four in a Row (Four or Five, by option): one renderer for the line games (see games/linegames).
 * Tic-Tac-Toe taps a square, Four/Five in a Row taps a column. Styles in linegames.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;
  // One set of timings drives the animation (they reach the CSS as variables on .lg) and the sound schedule.
  const T = { dropBase: 280, dropStep: 70, land: 240, draw: 380, win: 260 };
  const ENTER_MARGIN_MS = 60;
  // enter: the cell that has just been played ({ cell, seq, at }). It animates once; a redraw while it runs continues the
  // animation from where it is (see enterStyle) and a redraw after it has finished shows the mark at rest.
  const ui = { ctx: null, v: null, seq: null, enter: null };
  const dropMs = (v, cell) => T.dropBase + (Math.floor(cell / v.cols) + 1) * T.dropStep;
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
    return ['lg-cell', owner === null ? 'free' : 'full', lit >= 0 ? 'win' : '', v.last === k ? 'last' : '', ui.enter && ui.enter.cell === k ? 'enter' : ''].filter(Boolean).join(' ');
  }
  const winStyle = (v, k) => { const i = v.line.indexOf(k); return i >= 0 ? `--i:${i}` : ''; };
  /** Style for the piece of the cell being entered: how far it falls, and how long it has already been running. */
  function enterStyle(v, k) {
    if (!ui.enter || ui.enter.cell !== k) return '';
    return `--drop:${Math.floor(k / v.cols) + 1};--el:${Math.max(0, Date.now() - ui.enter.at)}ms`;
  }

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
      const piece = owner !== null ? pieceHTML(v, owner, [winStyle(v, k), enterStyle(v, k)].filter(Boolean).join(';')) : '';
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
          const style = [winStyle(v, k), enterStyle(v, k)].filter(Boolean).join(';');
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
    // the new mark animates once: a redraw of the same position does not start it again (the sound is by seq as well)
    const entering = Number.isInteger(e.cell) ? { cell: e.cell, seq: e.seq, at: Date.now() } : null;
    ui.enter = entering;
    // the entrance lasts as long as this move's animation (a disc: the fall and the landing, so a deep column takes longer)
    const land = entering && v.gravity ? dropMs(v, e.cell) : T.draw;
    const entranceMs = v.gravity ? land + T.land : T.draw;
    setTimeout(() => { if (ui.enter === entering) ui.enter = null; }, entranceMs + ENTER_MARGIN_MS);
    if (!snd) return;
    // sounds follow the animation: a tap for a square; for a column the fall now and the landing when the disc arrives
    if (v.gravity) { snd.play('fall'); setTimeout(() => snd.play('land'), land); } else snd.play('place');
    // the result sound comes after the mark has landed
    const over = e.type === 'win' ? (v.winner === v.me ? 'win' : 'lose') : e.type === 'draw' ? 'round' : null;
    if (over) setTimeout(() => snd.play(over), land + (v.gravity ? T.land : T.win));
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.v = v; react(v);
    root.innerHTML = `<div class="wz lg" data-game="${esc(v.game)}" style="--drop-base:${T.dropBase}ms;--drop-step:${T.dropStep}ms;--land:${T.land}ms;--draw:${T.draw}ms">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.win} in a row</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-lg="rules">Rules</button>', 'lg')}</div>
      ${seatsHTML(v, ctx)}
      ${boardHTML(v)}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
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
