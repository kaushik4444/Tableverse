/* Penalty Rows table renderer: four rows of numbered cards, a scoreboard, your hand to pick from, and a "take a row"
 * choice when your card fits nowhere. Everyone picks at once, so tapping a card sends the pick and you may change it until
 * all are in. Styles in penaltyrows.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, latest: null, seq: null, anim: null, table: null };
  const STEP_MS = 900; // the server holds each placement this long, scaled by the pace option (matches engine STEP_MS)

  /** The table rebuilt one event at a time from the start of the last turn: each step is a card landing, or a row being taken.
   * Returns null when there is nothing to step through, or when the rebuild does not match the table (then the table is shown as it is). */
  function replaySteps(v) {
    if (!v.before || !v.before.length || !v.lastTurn.length) return null;
    const rows = v.before.map((r) => r.map((c) => ({ n: c.n, p: c.p })));
    const steps = [rows.map((r) => r.slice())];
    for (const e of v.lastTurn) {
      if (e.kind === 'place') rows[e.row].push({ n: e.n, p: e.p });
      else rows[e.row] = [{ n: e.n, p: e.p }]; // a row taken: the card starts it again
      steps.push(rows.map((r) => r.slice()));
    }
    const last = steps[steps.length - 1];
    if (!v.after) return null;
    const same = last.length === v.after.length && last.every((r, k) => r.length === v.after[k].length && r.every((c, s) => c.n === v.after[k][s].n)); // compare with the completed table: at a round's end the rows are already the next deal
    return same && steps.length > 1 ? steps : null;
  }

  /** The table this renderer is showing (the room code), so playback for one table never plays on another. */
  const tableOf = () => (ui.ctx && ui.ctx.room ? ui.ctx.room.code : null);

  /** Advances one replay, one step per interval. Each timeout is bound to the animation it was scheduled for, so a timeout
   * left from another table or turn does nothing. The last step is the completed table: it is held for one interval, then
   * the replay ends and the rows as they stand (at a round's end, the new deal) are shown. */
  function scheduleStep(anim, paceK) {
    setTimeout(() => {
      if (ui.anim !== anim || !ui.ctx || anim.table !== tableOf()) return;
      if (anim.i < anim.steps.length - 1) {
        anim.i += 1;
        ui.ctx.rerender();
        scheduleStep(anim, paceK);
        return;
      }
      ui.anim = null;
      ui.ctx.rerender();
    }, STEP_MS * (paceK || 1));
  }

  const penWord = (p) => `${p} penalty point${p === 1 ? '' : 's'}`;
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));

  function cardHTML(c, { cls = '', attrs = '', tag = 'div' } = {}) {
    return `<${tag} class="pr-card pen${Math.min(c.p, 7)} ${cls}" aria-label="${esc(`Number ${c.n}, ${penWord(c.p)}`)}" ${attrs}><b>${c.n}</b><i>${c.p}</i></${tag}>`;
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return v.phase === 'takeRow' ? `Watching: ${nameOf(v, v.pending.by)} must take a row` : `Watching: turn ${v.turn} of ${v.handSize}`;
    if (v.phase === 'takeRow') return v.pending.by === v.me ? `Your ${v.pending.n} fits no row: take one` : `${nameOf(v, v.pending.by)} must take a row…`;
    if (v.myPick === null) return 'Pick a card to play';
    const waiting = v.players.filter((p) => !p.picked).length;
    return waiting ? `You picked ${v.myPick}. Waiting for ${waiting} more… (tap another card to change)` : 'Playing the cards…';
  }

  function rowsHTML(v) {
    const taking = v.phase === 'takeRow' && v.pending && v.pending.by === v.me;
    const rows = ui.anim && ui.anim.seq === v.seq ? ui.anim.steps[ui.anim.i] : v.rows;
    return `<div class="pr-rows">${rows.map((row, k) => {
      const slots = Array.from({ length: v.rowLimit }, (_, s) => (row[s] ? cardHTML(row[s]) : '<div class="pr-slot" aria-hidden="true"></div>')).join('');
      const full = row.length >= v.rowLimit;
      const points = row.reduce((s, c) => s + c.p, 0); // from the row as shown, so a step mid-turn counts only the cards on it
      const label = `Row ${k + 1}: ${row.length} card${row.length === 1 ? '' : 's'}, ${penWord(points)}`;
      const inner = `<span class="pr-rowhead"><span class="label">Row ${k + 1}</span><small>${points} pts${full ? ' · full' : ''}</small></span><div class="pr-cards">${slots}</div>`;
      return taking
        ? `<button type="button" class="pr-row take" data-pr="take" data-row="${k}" aria-label="${esc('Take ' + label)}">${inner}</button>`
        : `<div class="pr-row ${full ? 'full' : ''}" role="group" aria-label="${esc(label)}">${inner}</div>`;
    }).join('')}</div>`;
  }

  function scoreHTML(v) {
    return `<ul class="pr-score" aria-label="Scores">${v.players.map((p, i) => {
      const state = v.phase === 'takeRow' && v.pending && v.pending.by === i ? '⚠' : (p.picked ? '✓' : '…');
      return `<li data-pid="${esc(p.id)}" class="${i === v.me ? 'me' : ''}"><span class="pr-name">${esc(p.name)}${i === v.me ? ' (you)' : ''}</span>`
        + `<span class="pr-tot" title="Total penalty points">${p.total}<small>/${v.target}</small></span>`
        + `<span class="pr-rnd" title="Taken this round">+${p.penalty}</span><span class="pr-state" aria-label="${state === '⚠' ? 'must take a row' : p.picked ? 'has picked' : 'still choosing'}">${state}</span></li>`;
    }).join('')}</ul>`;
  }

  /** What the last turn did, in words (public facts only). */
  function lastTurnHTML(v) {
    if (!v.lastTurn.length) return '';
    const parts = v.lastTurn.map((e) => {
      const who = nameOf(v, e.by);
      if (e.kind === 'place') return `${who} ${e.by === v.me ? 'played' : 'played'} ${e.n} on row ${e.row + 1}`;
      return `<b>${who} took ${e.took} pt${e.took === 1 ? '' : 's'}</b> (${e.n}, row ${e.row + 1})`;
    });
    return `<p class="pr-last" role="status"><span class="label">Last turn</span> ${parts.join(' · ')}</p>`;
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
    if (v.phase === 'takeRow') ui.anim = null; // a row choice must show the rows as they stand, not a replay
    if (v.seq === ui.seq) return;
    ui.seq = v.seq;
    const steps = replaySteps(v);
    ui.anim = steps ? { seq: v.seq, steps, i: 0, table: tableOf() } : null;
    if (ui.anim) scheduleStep(ui.anim, v.paceK);
    if (!snd) return;
    if (v.phase === 'gameOver') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    else if (v.lastTurn.some((e) => e.by === v.me && e.took)) snd.play('lose');
    else snd.play('card');
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    if (ui.table !== tableOf()) { ui.table = tableOf(); ui.anim = null; ui.seq = null; } // a different table: start afresh, with no replay
    react(v);
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.n : null; // keep keyboard focus on the same card across redraws
    const mine = v.me >= 0 && (v.phase === 'choose' ? v.myPick === null : v.pending && v.pending.by === v.me);
    root.innerHTML = `
    <div class="wz prt">
      <div class="wz-top">
        <div class="wz-round"><b>Penalty Rows</b><span class="label"> · round ${v.round} · turn ${v.turn}/${v.handSize}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-pr="rules">Rules</button>', 'pr')}
      </div>
      ${rowsHTML(v)}
      ${v.pending ? `<p class="pr-pending" role="status">Waiting card: ${cardHTML({ n: v.pending.n, p: v.pending.p }, { cls: 'tiny' })} from ${nameOf(v, v.pending.by)}</p>` : ''}
      <div class="wz-status ${mine ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${scoreHTML(v)}
      ${lastTurnHTML(v)}
      ${handHTML(v)}
      ${overlayHTML(v)}
    </div>`;
    root.onclick = onClick;
    if (focused) { const el = root.querySelector(`.pr-hand [data-n="${focused}"]`); if (el && !el.disabled) el.focus({ preventScroll: true }); }
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
