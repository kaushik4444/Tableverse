/* Penalty Rows table renderer: the shared felt, seats around it with each player's total and state, the four rows
 * in the centre, your hand to pick from, and a "take a row" choice when your card fits nowhere. Everyone picks at once,
 * so tapping a card sends the pick and you may change it until all are in. Floating messages say what just happened.
 * Styles in penaltyrows.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const FLOAT_MS = 2600;
  const ui = { ctx: null, latest: null, seq: null, floatText: '', floatAt: 0, fresh: new Set() };

  const penWord = (p) => `${p} penalty point${p === 1 ? '' : 's'}`;
  const pts = (n) => `${n} pt${n === 1 ? '' : 's'}`;
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));

  function cardHTML(c, { cls = '', attrs = '', tag = 'div' } = {}) {
    return `<${tag} class="pr-card pen${Math.min(c.p, 7)} ${cls}" aria-label="${esc(`Number ${c.n}, ${penWord(c.p)}`)}" ${attrs}><b>${c.n}</b><i>${c.p}</i></${tag}>`;
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return v.phase === 'takeRow' ? `Watching: ${nameOf(v, v.pending.by)} must take a row` : `Watching: card ${v.turn} of ${v.handSize}`;
    if (v.phase === 'takeRow') return v.pending.by === v.me ? `Your ${v.pending.n} fits no row. Tap a row to take it.` : `${nameOf(v, v.pending.by)} must take a row…`;
    if (v.myPick === null) return 'Pick a card from your hand to play this turn';
    const waiting = v.players.filter((p) => !p.picked).length;
    return waiting ? `You picked ${v.myPick}. Waiting for ${waiting} more… (tap another card to change it)` : 'Everyone has picked. Playing the cards…';
  }

  /** The four rows, as lanes of full cards: each lane holds up to the row limit, and the card that would go past it takes the lane. */
  function rowsHTML(v) {
    const taking = v.phase === 'takeRow' && v.pending && v.pending.by === v.me;
    const limit = v.rowLimit;
    return `<div class="pr-rows" role="group" aria-label="The four rows">${v.rows.map((row, k) => {
      const slots = Array.from({ length: limit }, (_, s) => {
        const c = row[s];
        if (!c) return '<span class="pr-slot" aria-hidden="true"></span>';
        return cardHTML(c, { cls: ui.fresh.has(`${k}:${c.n}`) ? 'fresh' : '' });
      }).join('');
      const full = row.length >= limit;
      const label = `Row ${k + 1}: ${row.length} of ${limit} cards, ${penWord(v.rowPenalty[k])}`;
      const inner = `<span class="pr-rowhead"><span class="label">Row ${k + 1}</span><small>${pts(v.rowPenalty[k])}${full ? ' · full' : ''}</small></span>`
        + `<span class="pr-cards" style="grid-template-columns:repeat(${limit},var(--prc))">${slots}</span>`;
      return taking
        ? `<button type="button" class="pr-row take ${full ? 'full' : ''}" data-pr="take" data-row="${k}" aria-label="${esc('Take ' + label)}">${inner}</button>`
        : `<div class="pr-row ${full ? 'full' : ''}" role="group" aria-label="${esc(label)}">${inner}</div>`;
    }).join('')}</div>`;
  }

  /** The seat's line under the name: picked, still choosing, or must take a row. */
  function underHTML(v, i) {
    const p = v.players[i];
    if (v.phase === 'gameOver') return '';
    if (v.phase === 'takeRow' && v.pending && v.pending.by === i) return '<div class="pr-under warn">Must take a row</div>';
    if (v.phase === 'takeRow') return '';
    if (p.picked) return '<div class="pr-under ok">✓ Picked</div>';
    return '<div class="pr-under">Choosing…</div>';
  }

  function seatHTML(v, ctx, i) {
    const p = v.players[i];
    const sub = `${p.total}/${v.target} pts${p.penalty ? ` · +${p.penalty} this round` : ''}`;
    return window.CardTable.pt.seatHTML({
      pid: p.id,
      name: p.name + (i === v.me ? ' (you)' : ''),
      avatar: window.CardTable.pt.avatarOf(ctx.room, p.id),
      turn: v.phase === 'takeRow' && v.pending && v.pending.by === i,
      me: i === v.me,
      sub,
      under: underHTML(v, i),
    });
  }

  /** The middle of the felt: the rows, the waiting card if one is held, and the latest floating message. */
  function centreHTML(v) {
    const elapsed = Date.now() - ui.floatAt;
    const float = ui.floatText && elapsed < FLOAT_MS && v.phase !== 'gameOver'
      ? `<div class="pr-float" style="animation-delay:-${Math.max(0, elapsed)}ms" role="status">${ui.floatText}</div>`
      : '';
    const pending = v.pending && v.phase === 'takeRow'
      ? `<p class="pr-pending">Waiting card ${cardHTML({ n: v.pending.n, p: v.pending.p }, { cls: 'tiny' })} from ${nameOf(v, v.pending.by)}</p>`
      : '';
    return `${float}${rowsHTML(v)}${pending}`;
  }

  /** What the last turn did, in words: the readable log under the table. */
  function lastTurnHTML(v) {
    if (!v.lastTurn.length) return '';
    const parts = v.lastTurn.map((e) => {
      const who = nameOf(v, e.by);
      if (e.kind === 'place') return `${who} played ${e.n} on row ${e.row + 1}`;
      return `<b>${who} took ${pts(e.took)}</b> (${e.n}, row ${e.row + 1})`;
    });
    return `<p class="pr-last" role="status"><span class="label">Last turn</span> ${parts.join(' · ')}</p>`;
  }

  /** The message that floats over the table when something happened to you or at the table. */
  function floaterText(v) {
    const taken = v.lastTurn.find((e) => e.kind === 'take');
    if (taken) return taken.by === v.me ? `You took ${pts(taken.took)}` : `${esc(v.players[taken.by].name)} took ${pts(taken.took)}`;
    if (v.phase === 'takeRow' && v.pending && v.pending.by === v.me) return `Your ${v.pending.n} fits no row`;
    return '';
  }

  function handHTML(v) {
    if (v.me < 0) return '';
    if (!v.hand.length) return '<div class="pr-empty">You have no cards left this round.</div>';
    const can = v.phase === 'choose';
    return `<div class="pr-hand" role="group" aria-label="Your hand">${v.hand.map((c) => cardHTML(c, {
      tag: 'button', cls: `${v.myPick === c.n ? 'sel' : ''} ${can ? '' : 'dim'}`,
      attrs: `type="button" data-pr="pick" data-n="${c.n}" aria-pressed="${v.myPick === c.n}" ${can ? '' : 'disabled'}`,
    })).join('')}</div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => a.p.total - b.p.total)
      .map(({ p, i }) => `<li class="${v.winners.includes(i) ? 'win' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${p.total} pts</span></li>`).join('');
    const title = v.me >= 0 && v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over';
    const note = v.winners.length > 1 ? 'Equal totals share the win.' : `${esc(v.players[v.winners[0]].name)} took the fewest penalty points.`;
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2><p class="hint" style="text-align:left">${note}</p>
      <ul class="pr-final">${rows}</ul>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-pr="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-pr="leave">Leave table</button></div></div></div>`;
  }

  function react(v) {
    const snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = v.seq; return; } // first render (load or reconnect): do not replay
    if (v.seq === ui.seq) return;
    ui.seq = v.seq;
    ui.fresh = new Set(v.lastTurn.filter((e) => e.kind === 'place').map((e) => `${e.row}:${e.n}`)); // cards that landed this turn glow briefly
    ui.floatText = floaterText(v);
    ui.floatAt = Date.now();
    if (!snd) return;
    if (v.phase === 'gameOver') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    else if (v.lastTurn.some((e) => e.by === v.me && e.took)) snd.play('lose');
    else snd.play('card');
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    react(v);
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.n : null; // keep keyboard focus on the same card across redraws
    const table = window.CardTable.pt.tableHTML({
      n: v.players.length,
      me: v.me,
      seat: (i) => seatHTML(v, ctx, i),
      card: () => null,
      center: centreHTML(v),
    });
    root.innerHTML = `
    <div class="wz prt">
      <div class="wz-top">
        <div class="wz-round"><b>Penalty Rows</b><span class="label"> · round ${v.round} · card ${v.turn}/${v.handSize}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-pr="rules">How to play</button>', 'pr')}
      </div>
      <div class="wz-status ${v.me >= 0 && (v.phase === 'choose' ? v.myPick === null : v.pending && v.pending.by === v.me) ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <div class="pr-table">${table}</div>
      ${lastTurnHTML(v)}
      ${handHTML(v)}
      ${overlayHTML(v)}
    </div>`;
    root.onclick = onClick;
    if (focused) { const el = root.querySelector(`.pr-hand [data-n="${focused}"]`); if (el && !el.disabled) el.focus({ preventScroll: true }); }
    // the floating message fades on its own: redraw once it has gone so it does not linger
    if (ui.floatText && Date.now() - ui.floatAt < FLOAT_MS) setTimeout(() => { if (ui.latest === v && root.isConnected) ctx.rerender(); }, FLOAT_MS - (Date.now() - ui.floatAt) + 50);
  }

  function onClick(e) {
    const el = e.target.closest('[data-pr]');
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    switch (el.dataset.pr) {
      case 'pick': if (v.me >= 0 && v.phase === 'choose') ctx.act({ type: 'pick', card: Number(el.dataset.n) }); break;
      case 'take': if (v.phase === 'takeRow' && v.pending && v.pending.by === v.me) ctx.act({ type: 'takeRow', row: Number(el.dataset.row) }); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('penaltyrows', { render });
})();
