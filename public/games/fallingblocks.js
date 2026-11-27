/* Falling Blocks: everybody builds at once. Your well is large, with the piece in hand, a landing preview and buttons to move,
 * turn and drop it. The other wells are small and read-only. Styles in fallingblocks.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { root: null, ctx: null, v: null, seq: null, piece: -1, x: 3, rot: 0 };
  const COLOURS = ['Blue', 'Red', 'Green', 'Gold'];

  /** Whether the piece fits with its top-left at (x, y) in a board (same rules as the server). */
  function fits(board, cells, x, y, v) {
    return cells.every(([r, c]) => {
      const rr = y + r, cc = x + c;
      return cc >= 0 && cc < v.W && rr >= 0 && rr < v.H && !board[rr * v.W + cc];
    });
  }

  /** The row the piece lands on in column x, or -1 when it does not fit at the top. */
  function landingY(board, cells, x, v) {
    if (!fits(board, cells, x, 0, v)) return -1;
    let y = 0;
    while (fits(board, cells, x, y + 1, v)) y++;
    return y;
  }

  /** The cells of the piece in hand at its landing place (empty when it cannot be dropped there). */
  function ghostOf(v) {
    if (!v.current || ui.rot == null) return new Set();
    const cells = v.shapes[v.current][ui.rot];
    const y = landingY(v.boards[v.me], cells, ui.x, v);
    if (y < 0) return new Set();
    return new Set(cells.map(([r, c]) => (y + r) * v.W + ui.x + c));
  }

  function guidance(v) {
    if (v.phase === 'gameOver') {
      if (v.draw) return 'A draw';
      if (v.winner === null) return 'The game is over';
      return v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won!' : `${esc(v.players[v.winner].name)} won`;
    }
    if (v.me < 0) return 'Watching the game';
    if (v.players[v.me].out) return 'You are out. Watch the others finish';
    if (ui.v === v && landingY(v.boards[v.me], v.shapes[v.current][ui.rot], ui.x, v) < 0) return 'That turn does not fit here: move or turn it';
    return 'Move, turn and drop: nobody waits for anybody';
  }

  function nameOf(v, i) { return i === v.me ? 'You' : esc(v.players[i].name); }

  function seatsHTML(v) {
    return `<div class="fb-seats">${v.players.map((p, i) => `<div class="fb-seat s${i} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''} ${p.out ? 'out' : ''}">
      <span class="fb-swatch" aria-hidden="true"></span><span class="fb-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b>
      <small>${COLOURS[i]} · <span class="fb-lines">${p.lines}</span> ${p.lines === 1 ? 'row' : 'rows'}${p.out ? ' · out' : ''}</small></span></div>`).join('')}</div>`;
  }

  /** One well. Filled cells take their piece's colour, garbage is grey, and the landing preview is outlined. */
  function wellHTML(v, i, { mine = false, ghost = new Set() } = {}) {
    const cells = [];
    const board = v.boards[i];
    for (let k = 0; k < board.length; k++) {
      const val = board[k];
      const cls = val === 'G' ? 'g' : val ? `k-${val}` : '';
      const preview = ghost.has(k) ? ' ghost' : '';
      cells.push(`<span class="fb-cell ${cls}${preview}"></span>`);
    }
    const top = board.findIndex(Boolean);
    const stack = top < 0 ? 0 : v.H - Math.floor(top / v.W); // rows the stack reaches from the bottom
    const label = mine ? 'Your well' : `${esc(v.players[i].name)}'s well`;
    return `<div class="fb-well ${mine ? 'mine' : 'mini'} s${i}" style="--w:${v.W};--h:${v.H}" role="img" aria-label="${label}, stack ${stack} of ${v.H} rows high, ${v.players[i].lines} rows cleared${v.players[i].out ? ', out' : ''}">${cells.join('')}</div>`;
  }

  function controlsHTML(v) {
    const can = v.myTurn && v.phase === 'playing' && landingY(v.boards[v.me], v.shapes[v.current][ui.rot], ui.x, v) >= 0;
    const dis = (ok) => (ok ? '' : 'disabled');
    return `<div class="fb-controls" role="group" aria-label="Move the block">
      <button type="button" class="btn ghost" data-fb="left" aria-label="Move left" ${dis(v.myTurn)}>◀</button>
      <button type="button" class="btn ghost" data-fb="rotate" aria-label="Turn" ${dis(v.myTurn)}>⟳ Turn</button>
      <button type="button" class="btn ghost" data-fb="right" aria-label="Move right" ${dis(v.myTurn)}>▶</button>
      <button type="button" class="btn" data-fb="drop" aria-label="Drop the block" ${dis(can)}>Drop</button></div>`;
  }

  function nextHTML(v) {
    if (!v.current) return '';
    // a 2 x 4 window: every piece's first rotation fits in it
    const preview = (kind) => {
      const set = new Set(v.shapes[kind][0].map(([r, c]) => r * 4 + c));
      let html = '';
      for (let k = 0; k < 8; k++) html += `<span class="fb-cell ${set.has(k) ? `k-${kind}` : ''}"></span>`;
      return `<span class="fb-pv" aria-label="${kind}">${html}</span>`;
    };
    return `<div class="fb-next"><span class="label">Now</span> ${preview(v.current)}<span class="label">Next</span> ${v.next.map(preview).join('')}</div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const title = v.draw ? 'A draw' : v.winner === null ? 'Game over' : v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    const score = v.players.map((p) => `${esc(p.name)} ${p.lines} ${p.lines === 1 ? 'row' : 'rows'}`).join(' · ');
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${score}</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-fb-act="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-fb-act="leave">Leave table</button></div></div></div>`;
  }

  /** A soft click for a locked piece, a thud for garbage sent to you, and the result when the game ends. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'over') { snd.play('place'); setTimeout(() => snd.play(v.winner === v.me ? 'win' : v.me < 0 || v.winner === null ? 'round' : 'lose'), 260); return; }
    if (e.type === 'out') { snd.play(e.by === v.me ? 'lose' : 'land'); return; }
    snd.play(e.sent && e.by !== v.me ? 'land' : 'place');
  }

  function render(root, v, ctx) {
    const active = root.ownerDocument.activeElement;
    const focused = root.contains(active) && active.dataset.fb ? active.dataset.fb : null;
    // a new piece for me: reset the column and turn
    const count = v.me >= 0 ? v.players[v.me].pieces : -1;
    if (count !== ui.piece) { ui.piece = count; ui.x = v.spawnX; ui.rot = 0; }
    ui.root = root; ui.ctx = ctx; ui.v = v; react(v);
    const ghost = v.me >= 0 && v.current ? ghostOf(v) : new Set();
    const others = v.players.map((_, i) => i).filter((i) => i !== v.me);
    root.innerHTML = `<div class="wz fb" data-game="fallingblocks">
      <div class="wz-top"><div class="wz-round"><b>Falling Blocks</b><span class="label"> · ${v.players.length} players · ${v.W}×${v.H} wells</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-fb-act="rules">Rules</button>', 'fb')}</div>
      ${seatsHTML(v)}
      <div class="fb-stage">
        ${v.me >= 0 ? `<div class="fb-mine">${wellHTML(v, v.me, { mine: true, ghost })}</div>` : ''}
        <div class="fb-others">${others.map((i) => wellHTML(v, i)).join('')}</div>
      </div>
      ${v.me >= 0 && v.current ? nextHTML(v) : ''}
      ${v.me >= 0 && v.current ? controlsHTML(v) : ''}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    if (focused) root.querySelector(`[data-fb="${focused}"]:enabled`)?.focus({ preventScroll: true });
    root.onclick = onClick;
  }

  /** Moves the piece to column x and turn r if it fits there. */
  function place(x, rot) {
    const v = ui.v;
    if (!v || !v.current) return false;
    if (landingY(v.boards[v.me], v.shapes[v.current][rot], x, v) < 0) return false;
    ui.x = x; ui.rot = rot;
    return true;
  }

  function onClick(e) {
    const el = e.target.closest('[data-fb], [data-fb-act]');
    const ctx = ui.ctx, v = ui.v;
    if (!el || !ctx || el.disabled) return;
    if (el.dataset.fbAct) {
      if (el.dataset.fbAct === 'again') ctx.rematch();
      else if (el.dataset.fbAct === 'leave') ctx.leave();
      else if (el.dataset.fbAct === 'rules') ctx.showRules();
      return;
    }
    if (!v || !v.myTurn) return;
    switch (el.dataset.fb) {
      // step to the nearest column the piece fits in that direction, so no valid column is skipped
      case 'left': for (let d = 1; d <= 10; d++) if (place(ui.x - d, ui.rot)) break; break;
      case 'right': for (let d = 1; d <= 10; d++) if (place(ui.x + d, ui.rot)) break; break;
      case 'rotate': {
        const next = (ui.rot + 1) % 4;
        // turning next to a wall or a stack shifts the piece back into the well
        for (const dx of [0, -1, 1, -2, 2]) if (place(ui.x + dx, next)) break;
        break;
      }
      case 'drop':
        if (landingY(v.boards[v.me], v.shapes[v.current][ui.rot], ui.x, v) >= 0) ctx.act({ type: 'drop', x: ui.x, rot: ui.rot });
        break;
    }
    // redraw so the landing preview and the disabled states match the new position
    if (ui.root) render(ui.root, v, ctx);
  }

  window.CardTable.register('fallingblocks', { render });
})();
