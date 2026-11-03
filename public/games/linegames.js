/* Tic-Tac-Toe, Four in a Row and Five in a Row: one renderer for the three line games (see games/linegames).
 * Tic-Tac-Toe and Four in a Row play on tap; Five in a Row previews a stone first (tap again or press Place) because
 * its 15x15 points are small on a phone. Styles in linegames.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;
  const ui = { ctx: null, v: null, pick: null, seq: null, hoverCol: null };
  const MARKS = {
    tictactoe: [{ cls: 'x', sym: 'X', name: 'X' }, { cls: 'o', sym: 'O', name: 'O' }],
    fourinarow: [{ cls: 'red', sym: '', name: 'Red' }, { cls: 'yellow', sym: '', name: 'Yellow' }],
    fiveinarow: [{ cls: 'black', sym: '', name: 'Black' }, { cls: 'white', sym: '', name: 'White' }],
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
    if (v.game === 'fiveinarow') return ui.pick === null ? 'Your move: tap a point' : 'Tap it again, or press Place';
    return v.gravity ? 'Your move: pick a column' : 'Your move';
  }

  function pieceHTML(v, i) {
    const m = marks(v)[i];
    return `<span class="lg-piece ${m.cls}" aria-hidden="true">${esc(m.sym)}</span>`;
  }

  function seatsHTML(v, ctx) {
    return `<div class="lg-seats">${v.players.map((p, i) => `<div class="lg-seat ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}">
      <span class="lg-mark">${pieceHTML(v, i)}</span><span class="lg-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b><small>${marks(v)[i].name}</small></span></div>`).join('')}</div>`;
  }

  function cellsHTML(v) {
    const lit = new Set(v.line), legal = new Set(v.legal);
    const out = [];
    for (let k = 0; k < v.board.length; k++) {
      const r = Math.floor(k / v.cols), c = k % v.cols;
      const owner = v.board[k];
      const piece = owner !== null ? pieceHTML(v, owner) : (ui.pick === k && v.game === 'fiveinarow' ? `<span class="lg-piece ghost ${marks(v)[v.me].cls}"></span>` : '');
      const cls = ['lg-cell', owner === null ? 'free' : 'full', lit.has(k) ? 'win' : '', v.last === k ? 'last' : '', ui.pick === k ? 'pick' : ''].filter(Boolean).join(' ');
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
          const cls = ['lg-cell', owner === null ? 'free' : 'full', v.line.includes(k) ? 'win' : '', v.last === k ? 'last' : ''].filter(Boolean).join(' ');
          return `<div class="${cls}">${owner !== null ? pieceHTML(v, owner) : ''}</div>`;
        }).join('');
        return `<button type="button" class="lg-col" data-col="${c}" aria-label="Drop in column ${c + 1}" ${open ? '' : 'disabled'}>${cells}</button>`;
      }).join('');
      return `<div class="lg-board lg-gravity" style="--cols:${v.cols};--rows:${v.rows}" role="group" aria-label="Four in a Row board">${cols}</div>`;
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
    if (!snd) return;
    if (e.type === 'win') snd.play(v.winner === v.me ? 'win' : 'lose');
    else snd.play('card');
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.v = v; react(v);
    if (!v.myTurn || (ui.pick !== null && v.board[ui.pick] !== null)) ui.pick = null;
    const place = v.game === 'fiveinarow' && v.myTurn ? `<button class="btn big" data-lg="place" ${ui.pick === null ? 'disabled' : ''}>Place stone</button>` : '';
    root.innerHTML = `<div class="wz lg" data-game="${esc(v.game)}">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.win} in a row</span></div>
        <div class="row" style="gap:6px">${CardTable.sound.button()}${CardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button><button class="btn ghost small" data-lg="rules">Rules</button><button class="btn ghost small" data-lg="leave" aria-label="Leave table">✕</button></div></div>
      ${seatsHTML(v, ctx)}
      ${boardHTML(v)}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${place ? `<div class="lg-actions">${place}</div>` : ''}
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
      if (v.game === 'fiveinarow') { if (ui.pick === k) { ui.pick = null; ctx.act({ type: 'place', cell: k }); } else { ui.pick = k; ctx.rerender(); } }
      else ctx.act({ type: 'place', cell: k });
      return;
    }
    switch (el.dataset.lg) {
      case 'place': if (v.myTurn && ui.pick !== null) { const k = ui.pick; ui.pick = null; ctx.act({ type: 'place', cell: k }); } break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  for (const id of ['tictactoe', 'fourinarow', 'fiveinarow']) window.CardTable.register(id, { render });
})();
