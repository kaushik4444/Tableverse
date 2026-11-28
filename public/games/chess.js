/* Chess (games/chess): the board, tap-to-move, promotion, resignation and the end of the game. Styles in chess.css.
 * Tap one of your pieces to see its moves, then tap a square. The board turns to show your side at the bottom. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  // White and Black pieces use the same outline glyphs; the colour comes from CSS, so the pieces read as one set.
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const PROMO_NAMES = { Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };
  const PIECE_NAMES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
  const ui = { ctx: null, v: null, seq: null, sel: null, promo: null, resignArmed: false, lastKey: null, focusAfter: null };
  const isWhite = (p) => p === p.toUpperCase();
  const myColour = (v) => (v.me < 0 ? 'w' : v.colours[v.me]);
  const nameOf = (v, seat) => (seat === v.me ? 'You' : esc(v.players[seat].name));
  const squareName = (i) => 'abcdefgh'[i % 8] + (Math.floor(i / 8) + 1);

  function pieceHTML(p) {
    if (!p) return '';
    return `<span class="ch-piece ${isWhite(p) ? 'w' : 'b'}" aria-hidden="true">${GLYPH[p.toUpperCase()]}</span>`;
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return esc(endText(v));
    const who = v.colours[v.turn] === 'w' ? 'White' : 'Black';
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} (${who}) to move`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} (${who}) is thinking…`;
    if (v.check !== null) return `Your move: your king is in check`;
    return `Your move (${myColour(v) === 'w' ? 'White' : 'Black'})`;
  }

  /** The end of the game as plain text: callers escape it when they put it into the page. */
  function endText(v) {
    const reason = v.reason;
    if (v.draw) return reason === 'stalemate' ? 'A draw by stalemate' : `A draw: ${reason}`;
    const winnerName = v.winner === v.me ? 'You' : v.players[v.winner].name;
    if (reason === 'resignation') {
      if (v.winner === v.me) return 'You won: the other player resigned';
      // a spectator is not the one who resigned: name the losing seat
      if (v.me < 0) return `${winnerName} won: ${v.players[1 - v.winner].name} resigned`;
      return `${winnerName} won: you resigned`;
    }
    return v.winner === v.me ? `You won by checkmate` : `${winnerName} won by checkmate`;
  }

  function seatsHTML(v) {
    return `<div class="ch-seats">${[0, 1].map((seat) => {
      const colour = v.colours[seat];
      const p = v.players[seat];
      const turn = v.phase === 'playing' && v.turn === seat;
      const won = v.phase === 'gameOver' && v.winner === seat;
      // the pieces this seat has taken: the opposite colour's pieces, in the order they were taken
      const took = v.taken[colour].map((letter) => `<span class="ch-taken ${isWhite(letter) ? 'w' : 'b'}">${GLYPH[letter.toUpperCase()]}</span>`).join('');
      return `<div class="ch-seat ${turn ? 'turn' : ''} ${won ? 'won' : ''}">
        <span class="ch-colour ${colour}" aria-hidden="true"></span>
        <span class="ch-who"><b>${esc(p.name)}${seat === v.me ? ' (you)' : ''}</b><small>${colour === 'w' ? 'White' : 'Black'}${took ? ` · ${took}` : ''}</small></span></div>`;
    }).join('')}</div>`;
  }

  /** The 64 squares, from the top of the board down, with the board turned so that the player's side is at the bottom. */
  function boardHTML(v) {
    const flip = v.me >= 0 && myColour(v) === 'b';
    const targets = new Map();
    if (ui.sel !== null) for (const [from, to, promo] of v.legal) if (from === ui.sel) targets.set(to, (targets.get(to) || []).concat(promo));
    const check = v.check;
    const cells = [];
    for (let t = 0; t < 8; t++) {
      const rank = flip ? t : 7 - t;
      for (let c = 0; c < 8; c++) {
        const file = flip ? 7 - c : c;
        const i = rank * 8 + file;
        const p = v.board[i];
        const dark = (rank + file) % 2 === 0;
        const mine = p && v.me >= 0 && (isWhite(p) ? 'w' : 'b') === myColour(v);
        const cls = ['ch-sq', dark ? 'dark' : 'light'];
        if (v.last && (v.last.from === i || v.last.to === i)) cls.push('last');
        if (check === i) cls.push('check');
        if (ui.sel === i) cls.push('sel');
        // while the promotion picker is open every square takes a tap, so a tap elsewhere can cancel it (onSquare checks the move)
        const canTap = v.myTurn && (mine || targets.has(i) || !!ui.promo);
        if (targets.has(i)) cls.push(p ? 'capture' : 'dot');
        const label = `${squareName(i)}${p ? `, ${PIECE_NAMES[p.toUpperCase()]} (${isWhite(p) ? 'white' : 'black'})` : ''}`;
        cells.push(`<button type="button" data-no-tap class="${cls.join(' ')}" data-sq="${i}" aria-label="${esc(label)}" ${canTap ? '' : 'disabled'}>${pieceHTML(p)}</button>`);
      }
    }
    return `<div class="ch-board ${flip ? 'flip' : ''}" role="group" aria-label="Chess board">${cells.join('')}</div>`;
  }

  function promoHTML() {
    if (!ui.promo) return '';
    const choices = ['Q', 'R', 'B', 'N'].map((k) => `<button type="button" class="btn ghost ch-promo-btn" data-ch-promo="${k}" aria-label="Promote to ${PROMO_NAMES[k]}">${GLYPH[k]}<span>${PROMO_NAMES[k]}</span></button>`).join('');
    return `<div class="ch-promo" role="group" aria-label="Choose a piece for the pawn"><span class="hint">Promote to:</span><div class="row">${choices}</div>
      <button type="button" class="btn ghost small" data-ch="cancel-promo">Cancel</button></div>`;
  }

  /** The move list in pairs: White's move, then Black's, numbered as in standard notation. */
  function logHTML(v) {
    if (!v.log.length) return '<p class="hint ch-log-empty">No moves yet.</p>';
    const rows = [];
    for (let k = 0; k < v.log.length; k += 2) {
      rows.push(`<li><span class="ch-n">${k / 2 + 1}.</span><span class="ch-w">${esc(v.log[k].card)}</span><span class="ch-b">${esc(v.log[k + 1] ? v.log[k + 1].card : '')}</span></li>`);
    }
    return `<ol class="ch-log">${rows.join('')}</ol>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const title = v.draw ? 'A draw' : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} won`;
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${esc(endText(v))}.</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-ch="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-ch="leave">Leave table</button></div>
    </div></div>`;
  }

  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'move') snd.play(e.check ? 'check' : e.capture ? 'pocket' : 'place'); // a capture is a thud, a check a short double tap
    if (v.phase === 'gameOver') {
      const sound = v.draw ? 'round' : v.winner === v.me ? 'win' : v.me < 0 ? 'round' : 'lose';
      setTimeout(() => snd.play(sound), 320);
    }
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    // a move (or a new position) clears the selection and any open promotion choice
    const key = `${ctx.room ? ctx.room.code : ''}|${v.phase}|${v.log.length}|${v.turn}`;
    if (key !== ui.lastKey) { ui.lastKey = key; ui.sel = null; ui.promo = null; ui.resignArmed = false; }
    ui.v = v;
    react(v);
    const playing = v.phase === 'playing' && v.me >= 0;
    // keep keyboard focus on the square the player was using: the re-render replaces every button
    const focused = document.activeElement;
    const inRoot = !!focused && root.contains(focused);
    const focusSel = inRoot && focused.dataset.sq !== undefined ? `[data-sq="${focused.dataset.sq}"]`
      : inRoot && focused.dataset.ch ? `[data-ch="${focused.dataset.ch}"]`
      : inRoot && focused.dataset.chPromo ? `[data-ch-promo="${focused.dataset.chPromo}"]` : null;
    root.innerHTML = `<div class="wz ch" data-game="chess">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.log.length} moves</span></div>
        ${CardTable.toolbarSeed(`<button class="btn ghost small" data-ch="rules">Rules</button>${playing ? `<button class="btn ghost small" data-ch="resign">${ui.resignArmed ? 'Tap again to resign' : 'Resign'}</button>` : ''}`, 'ch')}</div>
      ${seatsHTML(v)}
      ${boardHTML(v)}
      ${promoHTML()}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <details class="ch-moves" open><summary>Moves</summary>${logHTML(v)}</details>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    // focus goes back to the control the player used (a square or Resign), or to the pawn when the picker closes
    const restore = ui.focusAfter !== null ? `[data-sq="${ui.focusAfter}"]` : focusSel;
    ui.focusAfter = null;
    if (restore) {
      const again = root.querySelector(restore);
      if (again && !again.disabled) again.focus();
    }
  }

  function onClick(e) {
    const el = e.target.closest('[data-sq],[data-ch],[data-ch-promo]'); const v = ui.v, ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    if (el.dataset.chPromo) {
      if (ui.promo) { ui.focusAfter = ui.promo.from; ctx.act({ type: 'move', from: ui.promo.from, to: ui.promo.to, promo: el.dataset.chPromo }); ui.promo = null; }
      return;
    }
    if (el.dataset.sq !== undefined) return onSquare(v, ctx, Number(el.dataset.sq));
    switch (el.dataset.ch) {
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
      case 'cancel-promo': ui.focusAfter = ui.promo ? ui.promo.from : null; ui.promo = null; ctx.rerender(); break;
      case 'resign':
        if (!ui.resignArmed) { ui.resignArmed = true; ctx.rerender(); break; }
        ui.resignArmed = false; ctx.act({ type: 'resign' }); break;
    }
  }

  function onSquare(v, ctx, i) {
    // a tap on the board leaves any open promotion choice (the picker must not submit an older move)
    ui.promo = null;
    if (!v.myTurn) return;
    const p = v.board[i];
    const mine = p && (isWhite(p) ? 'w' : 'b') === myColour(v);
    // a tap on one of your own pieces selects it (or changes the selection)
    if (mine) { ui.sel = ui.sel === i ? null : i; ctx.rerender(); return; }
    if (ui.sel === null) return;
    const options = v.legal.filter(([from, to]) => from === ui.sel && to === i);
    if (options.length === 0) { ui.sel = null; ctx.rerender(); return; }
    if (options[0][2]) { // a pawn reaching the last rank: the player chooses the piece
      ui.promo = { from: ui.sel, to: i };
      ctx.rerender();
      // move focus into the picker so keyboard players can choose a piece
      const first = document.querySelector('[data-ch-promo]');
      if (first) first.focus();
      return;
    }
    ui.sel = null;
    ctx.act({ type: 'move', from: options[0][0], to: i, promo: null });
  }

  window.CardTable.register('chess', { render });
})();
