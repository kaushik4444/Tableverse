/* Penalty Rows table renderer. The table is a wooden table with the rows laid out as lanes: the cards played this turn
 * sit in a strip above (lowest first, one name under each card), then each one drops into its row in turn, slowly. A row
 * that is taken shows an inline callout on the lane. A row's badge is its penalty points, shown as a bull's head.
 * Tabs: Table (the play) and Scores. Everyone picks at once, so tapping a card sends the pick and you may change it until
 * all are in. Styles in penaltyrows.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, latest: null, seq: null, anim: null, table: null, tab: 'table' };
  const STEP_MS = 900; // the server holds each placement this long, scaled by the pace option (matches engine STEP_MS)
  const BULL = '<svg class="pr-bull" viewBox="0 0 24 14" aria-hidden="true"><path d="M1 1c3.5 1.2 5.6 5.4 11 5.4S19.5 2.2 23 1c-.7 4.6-3 12.2-11 12.2S1.7 5.6 1 1z"/></svg>';

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
  /** The event of the replay step on screen (the card that has just landed or taken a row), or null. */
  const currentEvent = (v) => (ui.anim && ui.anim.seq === v.seq && ui.anim.i > 0 ? v.lastTurn[ui.anim.i - 1] : null);

  function cardHTML(c, { cls = '', attrs = '', tag = 'div' } = {}) {
    return `<${tag} class="pr-card pen${Math.min(c.p, 7)} ${cls}" aria-label="${esc(`Number ${c.n}, ${penWord(c.p)}`)}" ${attrs}>${BULL}<b>${c.n}</b><i>${c.p}</i></${tag}>`;
  }
  const backHTML = (cls = '') => `<div class="pr-card back tiny ${cls}" aria-hidden="true"></div>`;
  /** A card on the strip, with the player's name under it. */
  const playedHTML = (v, by, n, p, cls = '') => `<span class="pr-played ${cls}">${cardHTML({ n, p }, { cls: 'tiny' })}<small>${nameOf(v, by)}</small></span>`;

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : (v.losers.includes(v.me) ? 'You reached 0 and lose' : 'Game over');
    if (v.me < 0) return v.phase === 'takeRow' ? `Watching: ${nameOf(v, v.pending.by)} must take a row` : `Watching: turn ${v.turn} of ${v.handSize}`;
    if (v.phase === 'takeRow') return v.pending.by === v.me ? `Your ${v.pending.n} fits no row: take one` : `${nameOf(v, v.pending.by)} must take a row…`;
    if (v.myPick === null) return 'Pick a card to play';
    const waiting = v.players.filter((p) => !p.picked).length;
    return waiting ? `You picked ${v.myPick}. Waiting for ${waiting} more… (tap another card to change)` : 'Playing the cards…';
  }

  /** The strip above the rows: the cards still to land this turn (lowest first), the cards picked but hidden, or the card
   * that fits no row and waits for its player. */
  function stripHTML(v) {
    let items = '';
    if (ui.anim && ui.anim.seq === v.seq) {
      items = v.lastTurn.slice(ui.anim.i).map((e) => playedHTML(v, e.by, e.n, e.p)).join('');
    } else if (v.phase === 'takeRow' && v.pending) {
      items = playedHTML(v, v.pending.by, v.pending.n, v.pending.p, 'waiting');
    } else if (v.phase === 'choose') {
      items = v.players.map((p, i) => {
        if (!p.picked) return '';
        if (i === v.me && v.myPick !== null) {
          const c = v.hand.find((x) => x.n === v.myPick);
          return c ? playedHTML(v, i, c.n, c.p, 'mine') : '';
        }
        return `<span class="pr-played">${backHTML()}<small>${nameOf(v, i)}</small></span>`;
      }).join('');
    }
    const label = v.phase === 'takeRow' ? 'Waiting card' : 'Cards on the table this turn, lowest first';
    return `<div class="pr-strip" aria-label="${esc(label)}">${items || `<span class="pr-hint">${v.phase === 'choose' ? 'Cards appear here once everyone has picked' : ''}</span>`}</div>`;
  }

  /** One lane: its row label, the card slots, and the penalty badge. A row that was just taken shows a callout. */
  function laneHTML(v, k, row, ev, taking) {
    const full = row.length >= v.rowLimit;
    const points = row.reduce((s, c) => s + c.p, 0); // from the row as shown, so a step mid-turn counts only the cards on it
    const label = `Row ${k + 1}: ${row.length} card${row.length === 1 ? '' : 's'}, ${penWord(points)}`;
    const here = ev && ev.row === k;
    const slots = Array.from({ length: v.rowLimit }, (_, s) => (row[s]
      ? cardHTML(row[s], { cls: here && s === (ev.kind === 'place' ? row.length - 1 : 0) ? 'new' : '' })
      : '<div class="pr-slot" aria-hidden="true"></div>')).join('');
    const callout = here && ev.kind !== 'place' ? `<span class="pr-callout">${nameOf(v, ev.by)} took ${ev.took}</span>` : '';
    const inner = `<span class="pr-rowhead"><span class="label">Row ${k + 1}</span></span><span class="pr-cards" style="--cols:${v.rowLimit}">${slots}</span>`
      + `<span class="pr-pile" title="Penalty points on this row"><span class="pr-pile-n">${points}</span>${BULL}</span>${callout}`;
    return taking
      ? `<button type="button" class="pr-row take" data-pr="take" data-row="${k}" aria-label="${esc('Take ' + label)}">${inner}</button>`
      : `<div class="pr-row ${full ? 'full' : ''}" role="group" aria-label="${esc(label)}">${inner}</div>`;
  }

  function rowsHTML(v) {
    const taking = v.phase === 'takeRow' && v.pending && v.pending.by === v.me;
    const rows = ui.anim && ui.anim.seq === v.seq ? ui.anim.steps[ui.anim.i] : v.rows;
    const ev = currentEvent(v);
    return `<div class="pr-rows">${rows.map((row, k) => laneHTML(v, k, row, ev, taking)).join('')}</div>`;
  }

  /** Who has how much left (countdown) or how many penalty points in total (race). */
  function scoreHTML(v) {
    return `<ul class="pr-score" aria-label="Scores">${v.players.map((p, i) => {
      const state = v.phase === 'takeRow' && v.pending && v.pending.by === i ? '⚠' : (p.picked ? '✓' : '…');
      const main = v.countdown
        ? `${p.left}<small> of ${v.target} left</small>`
        : `${p.total}<small>/${v.target}</small>`;
      const out = v.losers && v.losers.includes(i) ? ' out' : '';
      return `<li data-pid="${esc(p.id)}" class="${i === v.me ? 'me' : ''}${out}"><span class="pr-name">${esc(p.name)}${i === v.me ? ' (you)' : ''}</span>`
        + `<span class="pr-tot" title="${v.countdown ? 'Points left' : 'Total penalty points'}">${main}</span>`
        + `<span class="pr-rnd" title="Taken this round">+${p.penalty}</span><span class="pr-state" aria-label="${state === '⚠' ? 'must take a row' : p.picked ? 'has picked' : 'still choosing'}">${state}</span></li>`;
    }).join('')}</ul>`;
  }

  /** The last rounds, newest first, so the scores tab shows how the game got here. */
  function historyHTML(v) {
    if (!v.history.length) return '';
    const rows = v.history.slice(-5).reverse().map((h) => `<li><span>Round ${h.round}</span><span>${v.players.map((p, i) => `${esc(p.name)} +${h.penalties[i]}`).join(' · ')}</span></li>`).join('');
    return `<section class="pr-hist"><h3 class="label">Rounds</h3><ol>${rows}</ol></section>`;
  }

  /** What the last turn did, in words (public facts only). */
  function lastTurnHTML(v) {
    if (!v.lastTurn.length) return '';
    const parts = v.lastTurn.map((e) => {
      const who = nameOf(v, e.by);
      if (e.kind === 'place') return `${who} played ${e.n} on row ${e.row + 1}`;
      return `<b>${who} took ${e.took} pt${e.took === 1 ? '' : 's'}</b> (${e.n}, row ${e.row + 1})`;
    });
    return `<p class="pr-last" role="status"><span class="label">Last turn</span> ${parts.join(' · ')}</p>`;
  }

  function handHTML(v) {
    if (v.me < 0) return '';
    if (!v.hand.length) return '<div class="pr-empty">You have no cards left this round.</div>';
    const can = v.phase === 'choose';
    return `<div class="pr-handlabel label">My hand</div><div class="pr-hand" role="group" aria-label="Your hand">${v.hand.map((c) => cardHTML(c, {
      tag: 'button', cls: `${v.myPick === c.n ? 'sel' : ''} ${can ? '' : 'dim'}`,
      attrs: `type="button" data-pr="pick" data-n="${c.n}" aria-pressed="${v.myPick === c.n}" ${can ? '' : 'disabled'}`,
    })).join('')}</div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const rows = v.players.map((p, i) => ({ p, i }))
      .sort((a, b) => (v.countdown ? b.p.left - a.p.left : a.p.total - b.p.total))
      .map(({ p, i }) => {
        const tag = v.countdown && v.losers.includes(i) ? 'reached 0 · loses' : (v.countdown ? `${p.left} left` : `${p.total} pts`);
        return `<li class="${v.winners.includes(i) ? 'win' : ''} ${v.losers.includes(i) ? 'out' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${tag}</span></li>`;
      }).join('');
    const title = v.me >= 0 && v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over';
    let note;
    if (v.countdown) {
      const names = v.losers.map((i) => esc(v.players[i].name)).join(' & ');
      note = v.winners.length === 0 ? `Everyone reached 0: ${names} lose.` : `${names} reached 0 and lose. ${v.winners.length > 1 ? 'Equal points left share the win.' : `${esc(v.players[v.winners[0]].name)} has the most points left.`}`;
    } else {
      note = v.winners.length > 1 ? 'Equal totals share the win.' : `${esc(v.players[v.winners[0]].name)} took the fewest penalty points.`;
    }
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
    const tab = ui.tab === 'scores' ? 'scores' : 'table';
    const tabs = `<nav class="pr-tabs" role="tablist" aria-label="Penalty Rows views">
        <button type="button" role="tab" class="btn ghost small" data-pr="tab" data-tab="table" aria-selected="${tab === 'table'}">Table</button>
        <button type="button" role="tab" class="btn ghost small" data-pr="tab" data-tab="scores" aria-selected="${tab === 'scores'}">Scores</button></nav>`;
    const body = tab === 'scores'
      ? `${scoreHTML(v)}${historyHTML(v)}${lastTurnHTML(v)}`
      : `<section class="pr-table" aria-label="Table">${stripHTML(v)}${rowsHTML(v)}</section>${lastTurnHTML(v)}`;
    root.innerHTML = `
    <div class="wz prt">
      <div class="wz-top">
        <div class="wz-round"><b>Penalty Rows</b><span class="label"> · round ${v.round} · turn ${v.turn}/${v.handSize}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-pr="rules">Rules</button>', 'pr')}
      </div>
      ${tabs}
      ${body}
      <div class="wz-status ${mine ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${tab === 'table' ? handHTML(v) : ''}
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
      case 'tab': ui.tab = el.dataset.tab === 'scores' ? 'scores' : 'table'; ctx.rerender(); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('penaltyrows', { render });
})();
