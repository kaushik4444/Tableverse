/* Dots and Boxes: a grid of dots; tap a line between two dots. A box takes the colour of the seat that closes it, and a
 * closed box keeps that seat's turn. Lines and boxes are positioned in percentages of the board, so any size fits. Styles
 * in dotsboxes.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, v: null, seq: null, resultSeen: null };
  const COLOURS = ['Blue', 'Red', 'Green', 'Gold'];
  const nameOf = (v, i) => (i === v.me ? 'You' : esc(v.players[i].name));

  function guidance(v) {
    if (v.phase === 'gameOver') {
      if (v.draw) return 'A draw';
      return v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won!' : `${esc(v.players[v.winner].name)} won`;
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} to move`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} is thinking…`;
    if (v.event && v.event.type === 'box' && v.event.by === v.me) return 'You closed a box: draw another line';
    return 'Your move: draw a line between two dots';
  }

  function seatsHTML(v) {
    return `<div class="db-seats">${v.players.map((p, i) => `<div class="db-seat s${i} ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}">
      <span class="db-swatch" aria-hidden="true"></span><span class="db-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b><small>${COLOURS[i]} · <span class="db-count">${p.boxes}</span> ${p.boxes === 1 ? 'box' : 'boxes'}</small></span></div>`).join('')}</div>`;
  }

  /** Dots, boxes and lines. An undrawn line is a button with a 44px tap band; a drawn line is a coloured bar. */
  function boardHTML(v) {
    const n = v.n, pct = (x) => `${(x / n) * 100}%`, frac = `${100 / n}%`;
    const dots = [];
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) dots.push(`<span class="db-dot" style="left:${pct(c)};top:${pct(r)}"></span>`);
    const boxes = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const k = r * n + c, owner = v.owner[k];
      if (owner === null) continue;
      boxes.push(`<span class="db-box s${owner}" style="left:${pct(c)};top:${pct(r)};width:${frac};height:${frac}" aria-hidden="true">${esc(COLOURS[owner][0])}</span>`);
    }
    const lines = v.lines.map((l, i) => {
      const style = l.kind === 'h' ? `left:${pct(l.c)};top:${pct(l.r)};width:${frac}` : `left:${pct(l.c)};top:${pct(l.r)};height:${frac}`;
      const where = `${l.kind === 'h' ? 'Horizontal' : 'Vertical'} line, row ${l.r + 1}, column ${l.c + 1}`;
      if (v.drawn[i]) {
        const cls = ['db-line', `db-${l.kind}`, 'on', `s${v.lineBy[i]}`, v.last === i ? 'last' : ''].filter(Boolean).join(' ');
        return `<span class="${cls}" style="${style}" aria-label="${where}, drawn by ${esc(v.players[v.lineBy[i]].name)}"></span>`;
      }
      const can = v.myTurn;
      return `<button type="button" class="db-line db-${l.kind}" style="${style}" data-line="${i}" aria-label="${where}, not drawn" ${can ? '' : 'disabled'}></button>`;
    }).join('');
    return `<div class="db-board" style="--n:${n}" role="group" aria-label="Dots and boxes board">${boxes.join('')}${lines}${dots.join('')}</div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') { ui.resultSeen = null; return ''; }
    const key = v.event ? v.event.seq : null;
    const settled = ui.resultSeen === key;
    if (ui.ctx.resultVisible !== false) ui.resultSeen = key;
    const title = v.draw ? 'A draw' : v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    const score = v.players.map((p) => `${esc(p.name)} ${p.boxes}`).join(' · ');
    return `<div class="overlay${settled ? ' settled' : ''}"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${score}</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-db="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-db="leave">Leave table</button></div></div></div>`;
  }

  /** A click for each line, a soft tone for a box, and the result when the last line is drawn. The first look plays nothing. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'over') { snd.play('place'); setTimeout(() => snd.play(v.draw ? 'round' : v.winner === v.me ? 'win' : 'lose'), 260); return; }
    if (e.type === 'box') { snd.play('land'); return; }
    snd.play('place');
  }

  function render(root, v, ctx) {
    const active = root.ownerDocument.activeElement;
    const focusedLine = root.contains(active) && active.matches('.db-line[data-line]') ? active.dataset.line : null;
    ui.ctx = ctx; ui.v = v; react(v);
    root.innerHTML = `<div class="wz db" data-game="dotsboxes">
      <div class="wz-top"><div class="wz-round"><b>Dots and Boxes</b><span class="label"> · ${v.n} × ${v.n} · ${v.remaining} lines left</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-db="rules">Rules</button>', 'db')}</div>
      ${seatsHTML(v)}
      ${boardHTML(v)}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    if (focusedLine !== null) {
      const next = root.querySelector(`.db-line[data-line="${focusedLine}"]:enabled`)
        || root.querySelector('.db-line:enabled');
      next?.focus({ preventScroll: true });
    }
    root.onclick = onClick;
  }

  // Tap bands overlap near dots. Pick the closest visible line within its band instead of using paint order.
  function nearestLine(board, x, y) {
    let nearest = null, best = Infinity;
    for (const line of board.querySelectorAll('.db-line')) {
      const { left, right, top, bottom } = line.getBoundingClientRect();
      if (x < left || x > right || y < top || y > bottom) continue;
      const distance = line.classList.contains('db-h') ? Math.abs(y - (top + bottom) / 2) : Math.abs(x - (left + right) / 2);
      if (distance < best) { nearest = line; best = distance; }
    }
    return nearest;
  }

  function onClick(e) {
    const line = e.target.closest('.db-line');
    if (line) {
      if (!ui.v?.myTurn) return;
      // Keyboard and assistive technology clicks use the activated button directly.
      const pick = e.detail ? nearestLine(line.closest('.db-board'), e.clientX, e.clientY) : line;
      if (pick?.dataset.line === undefined || pick.disabled) return;
      if (pick !== line && line === line.ownerDocument.activeElement) pick.focus({ preventScroll: true });
      ui.ctx.act({ type: 'line', index: Number(pick.dataset.line) });
      return;
    }
    const el = e.target.closest('[data-db]'); const ctx = ui.ctx;
    if (!el || !ctx || el.disabled) return;
    switch (el.dataset.db) {
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('dotsboxes', { render });
})();
