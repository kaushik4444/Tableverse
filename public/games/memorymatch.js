/* Memory Match: a grid of face-down cards. Turn over two a turn; a match stays on the table in the colour of the seat that
 * found it. A missed pair stays face up for a moment so everyone sees it. Styles in memorymatch.css. */
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
    if (v.pending !== null) return `You turned over ${esc(v.board[v.pending].symbol)}. Now turn over a second card`;
    if (v.event && v.event.type === 'match' && v.event.by === v.me) return `A pair of ${esc(v.event.symbol)}! Play again`;
    return 'Your move: turn over a card';
  }

  function seatsHTML(v) {
    return `<div class="mm-seats">${v.players.map((p, i) => `<div class="mm-seat s${i} ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}" data-pid="${esc(p.id)}">
      <span class="mm-swatch" aria-hidden="true"></span><span class="mm-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b><small>${COLOURS[i]} · <span class="mm-count">${p.pairs}</span> ${p.pairs === 1 ? 'pair' : 'pairs'}</small></span></div>`).join('')}</div>`;
  }

  function boardHTML(v) {
    const cards = v.board.map((c, k) => {
      const r = Math.floor(k / v.cols) + 1, col = (k % v.cols) + 1;
      if (c.owner !== null) return `<span class="mm-card matched s${c.owner}" aria-label="Row ${r}, column ${col}, ${esc(c.symbol)}, pair of ${esc(v.players[c.owner].name)}">${esc(c.symbol)}</span>`;
      if (c.symbol !== null) {
        const cls = ['mm-card', 'up', v.last === k ? 'last' : ''].filter(Boolean).join(' ');
        const label = `Row ${r}, column ${col}, ${esc(c.symbol)}, face up`;
        // a missed card stays selectable for the next player; the card in play is not
        if (v.myTurn && v.pending !== k) return `<button type="button" class="${cls}" data-card="${k}" aria-label="${label}">${esc(c.symbol)}</button>`;
        return `<span class="${cls}" aria-label="${label}">${esc(c.symbol)}</span>`;
      }
      const can = v.myTurn && v.pending !== k;
      return `<button type="button" class="mm-card down" data-card="${k}" aria-label="Row ${r}, column ${col}, face down" ${can ? '' : 'disabled'}><span class="mm-back" aria-hidden="true">✦</span></button>`;
    }).join('');
    return `<div class="mm-board" style="--cols:${v.cols}" role="group" aria-label="Memory Match cards">${cards}</div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') { ui.resultSeen = null; return ''; }
    const key = v.event ? v.event.seq : null;
    const settled = ui.resultSeen === key;
    if (ui.ctx.resultVisible !== false) ui.resultSeen = key;
    const title = v.draw ? 'A draw' : v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    const score = v.players.map((p) => `${esc(p.name)} ${p.pairs} ${p.pairs === 1 ? 'pair' : 'pairs'}`).join(' · ');
    return `<div class="overlay${settled ? ' settled' : ''}"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${score}</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-mm="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-mm="leave">Leave table</button></div></div></div>`;
  }

  /** A turn over for each card, a chime for a pair, a low note for a miss. The first look plays nothing. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'flip') { snd.play('place'); return; }
    if (e.type === 'match') { snd.play('land'); return; }
    if (e.type === 'miss') { snd.play('fall'); return; }
    if (e.type === 'over') setTimeout(() => snd.play(v.draw ? 'round' : v.winner === v.me ? 'win' : 'lose'), 200);
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.v = v; react(v);
    // a card turned over replaces the board: keep the keyboard place on the card the person used
    const active = root.ownerDocument.activeElement;
    const cardKey = active && root.contains(active) && active.dataset && active.dataset.card !== undefined ? active.dataset.card : null;
    root.innerHTML = `<div class="wz mm" data-game="memorymatch">
      <div class="wz-top"><div class="wz-round"><b>Memory Match</b><span class="label"> · ${v.rows} × ${v.cols} · ${v.left} cards left</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-mm="rules">Rules</button>', 'mm')}</div>
      ${seatsHTML(v)}
      ${boardHTML(v)}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    if (cardKey !== null) {
      const again = root.querySelector(`[data-card="${cardKey}"]:not([disabled])`) || root.querySelector('[data-mm="rules"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function onClick(e) {
    const el = e.target.closest('[data-card],[data-mm]'); const v = ui.v, ctx = ui.ctx;
    if (!el || !v || !ctx || el.disabled) return;
    if (el.dataset.card !== undefined) { if (v.myTurn) ctx.act({ type: 'flip', index: Number(el.dataset.card) }); return; }
    switch (el.dataset.mm) {
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('memorymatch', { render });
})();
