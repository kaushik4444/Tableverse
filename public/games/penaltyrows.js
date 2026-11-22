/* Take 5 table renderer. The table is a wooden table with the rows laid out as lanes: the cards played this turn
 * sit in a strip above (lowest first, one name under each card), then each one drops into its row in turn, slowly. A row
 * that is taken shows an inline callout on the lane. A row's badge is its penalty points.
 * Tabs: Table (the play) and Scores. Everyone picks at once, so tapping a card sends the pick and you may change it until
 * all are in. Styles in penaltyrows.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, latest: null, seq: null, anim: null, table: null, tab: 'table', tables: new Map(), cur: null };
  /** Restart tracking for one table: its sequence is compared only with its own last value, and its match count rises when it restarts. */
  const tableState = (key) => { let st = ui.tables.get(key); if (!st) { st = { lastSeen: null, match: 0, round: null }; ui.tables.set(key, st); } return st; };
  /** Feed IDs carry the table's match, so a rematch at the same table cannot reuse an ID the feed still holds. */
  const fid = (s) => `m${ui.cur ? ui.cur.match : 0}:${s}`;
  const STEP_MS = 900; // the server holds each placement this long, scaled by the pace option (matches engine STEP_MS)
  const SWEEP_MS = 500; // a row collected lingers this much longer (matches engine SWEEP_MS)

  /** The table rebuilt one event at a time from the start of the last turn: each step is a card landing, or a row being taken.
   * Returns null when there is nothing to step through, or when the rebuild does not match the table (then the table is shown as it is). */
  function replaySteps(v) {
    if (!v.before || !v.before.length || !v.lastTurn.length) return null;
    const rows = v.before.map((r) => r.map((c) => ({ n: c.n, p: c.p })));
    const steps = [rows.map((r) => r.slice())];
    const marks = [null]; // what each step shows: the event (index into lastTurn) and which part of it
    const durs = [STEP_MS]; // how long each step stays up (before the pace factor); the engine holds the same time per event
    const firstStep = []; // the step on which each event first shows, so its card leaves the strip there
    v.lastTurn.forEach((e, j) => {
      const card = { n: e.n, p: e.p };
      const push = (phase, ms) => {
        if (firstStep[j] === undefined) firstStep[j] = steps.length;
        steps.push(rows.map((r) => r.slice())); marks.push({ j, phase }); durs.push(ms);
      };
      if (e.kind === 'place') { rows[e.row].push(card); push('place', STEP_MS); return; }
      if (e.kind === 'sweep') {
        rows[e.row].push(card); push('add', STEP_MS); // the sixth card lands in the row
        push('collect', STEP_MS + SWEEP_MS); // the row is collected, the cards still on it
        rows[e.row] = [card]; push('restart', STEP_MS); // the played card starts the row again
        return;
      }
      push('collect', STEP_MS + SWEEP_MS); // a card that fits no row: its player collects the row first
      rows[e.row] = [card]; push('restart', STEP_MS);
    });
    const last = steps[steps.length - 1];
    if (!v.after) return null;
    const same = last.length === v.after.length && last.every((r, k) => r.length === v.after[k].length && r.every((c, s) => c.n === v.after[k][s].n)); // compare with the completed table: at a round's end the rows are already the next deal
    return same && steps.length > 1 ? { steps, marks, durs, firstStep } : null;
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
        announce(anim, anim.i);
        const from = captureStrip();
        ui.ctx.rerender();
        glide(from);
        const mark = anim.marks[anim.i];
        if (mark && mark.phase === 'collect') stashRow(anim, mark, paceK);
        scheduleStep(anim, paceK);
        return;
      }
      ui.anim = null;
      // the round and pick lines that were held behind the replay now follow its moves
      const held = ui.heldFeed; ui.heldFeed = null;
      if (held) feedPicksAndRounds(held);
      ui.ctx.rerender();
    }, anim.durs[anim.i] * (paceK || 1));
  }

  const penWord = (p) => `${p} penalty point${p === 1 ? '' : 's'}`;
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));
  const rowName = (e) => `row ${e.row + 1}`;

  /** The feed line for one event of the last turn: who played which card, and who took which row. */
  function feedItem(v, e, id) {
    const who = nameOf(v, e.by);
    if (e.kind === 'place') return { id, tone: 'play', html: `<b>${who}</b> played ${e.n} on ${rowName(e)}` };
    if (e.kind === 'sweep') return { id, tone: 'take', html: `<b>${who}</b> played the ${v.rowLimit + 1}th card and took ${rowName(e)} · ${penWord(e.took)}` };
    return { id, tone: 'take', html: `<b>${who}</b> played ${e.n}, which fits no row, and took ${rowName(e)} · ${penWord(e.took)}` };
  }
  /** The feed and spotlight line for one step of the replay. A card landing needs only the feed; a row being collected
   * also gets the spotlight, so the taking is never missed. */
  function stepItem(v, e, phase) {
    const who = nameOf(v, e.by);
    if (phase === 'place') return { tone: 'play', html: `<b>${who}</b> played ${e.n} on ${rowName(e)}` };
    if (phase === 'add') return { tone: 'play', html: `<b>${who}</b> played the ${v.rowLimit + 1}th card on ${rowName(e)}` };
    if (phase === 'collect') return { tone: 'take', html: `<b>${who}</b> collected ${rowName(e)} · ${penWord(e.took)}` };
    return { tone: 'play', html: `${e.n} starts ${rowName(e)}` }; // restart
  }
  /** The spotlight for a row being collected: its taker and the points. Other steps need none. */
  function spotFor(v, e, phase) {
    if (phase !== 'collect') return null;
    return { card: cardHTML({ n: e.n, p: e.p }, { cls: 'tiny' }), caption: `${nameOf(v, e.by)} collected ${rowName(e)} · ${penWord(e.took)}`, tone: 'take', ms: 2300 };
  }
  /** Shows one replayed step in the feed (and the spotlight, for a row collected). */
  function announce(anim, k) {
    const mark = anim.marks[k];
    const v = ui.latest;
    if (!mark || !v || !window.GameFeed || anim.table !== tableOf()) return; // no feed: the replay still moves on
    const e = anim.events[mark.j];
    window.GameFeed.add(anim.table, [{ id: fid(`t${anim.seq}-${k}`), ...stepItem(v, e, mark.phase) }]);
    const sp = spotFor(v, e, mark.phase);
    if (sp) window.GameFeed.spotlight(sp);
  }
  /** Where each card on the strip sits now, by its number, so the same card can glide from there into its row. */
  function captureStrip() {
    const at = new Map();
    if (reducedMotion()) return at;
    for (const el of document.querySelectorAll('.prt .pr-strip [data-cn]')) {
      const r = el.getBoundingClientRect();
      at.set(el.dataset.cn, { x: r.left, y: r.top });
    }
    return at;
  }
  /** Each card that was on the strip glides from its old place to its new one in the rows (Web Animations, short, once). */
  function glide(from) {
    if (!from || !from.size || reducedMotion() || !document.querySelector('.prt')) return;
    for (const el of document.querySelectorAll('.prt .pr-rows [data-cn]')) {
      const old = from.get(el.dataset.cn);
      if (!old) continue;
      el.classList.remove('new'); // the glide is the landing: the drop animation would move the card before it is measured
      const r = el.getBoundingClientRect();
      const dx = old.x - r.left; const dy = old.y - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }
  const reducedMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** A collected row: its cards slide, one after another, into the taker's score chip, the pile they are kept in.
   * Slow enough to follow, and it ends inside the collect step, so the next card is not drawn over it. */
  function stashRow(anim, mark, paceK) {
    const e = anim.events[mark.j];
    const v = ui.latest;
    const k = paceK || 1;
    if (!v || !e || reducedMotion()) return;
    const pid = v.players[e.by] && v.players[e.by].id;
    const chip = pid ? document.querySelector(`.prt .pr-chips li[data-pid="${CSS.escape(pid)}"]`) : null;
    const lane = document.querySelector(`.prt .pr-rows > .pr-row:nth-child(${e.row + 1})`);
    if (!chip || !lane) return;
    const to = chip.getBoundingClientRect();
    const tx = to.left + to.width / 2; const ty = to.top + to.height / 2;
    // a sweep takes the cards already on the row; the card just played (e.n) is not collected: it starts the row again
    const cards = [...lane.querySelectorAll('[data-cn]')].filter((el) => !(e.kind === 'sweep' && el.dataset.cn === String(e.n)));
    cards.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = tx - (r.left + r.width / 2); const dy = ty - (r.top + r.height / 2);
      el.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0.25 },
      ], { duration: 750 * k, delay: i * 120 * k, fill: 'forwards', easing: 'cubic-bezier(.4, 0, .2, 1)' });
    });
  }

  /** The replay step on screen, or null: which event it shows and which part of it. */
  const currentMark = (v) => (ui.anim && ui.anim.seq === v.seq ? ui.anim.marks[ui.anim.i] : null);

  /** A card: the number big in the middle and small in the top corner, and one dot per penalty point along the bottom. */
  /** Penalty points as bombs: one bomb a point, so the count reads at a glance and the cost looks negative. Past 12 the count follows. */
  const starsOf = (n) => (n <= 0 ? '' : '💣'.repeat(Math.min(n, 12)) + (n > 12 ? `×${n}` : ''));

  function cardHTML(c, { cls = '', attrs = '', tag = 'div' } = {}) {
    const dots = `<span class="pr-pips" aria-hidden="true">${starsOf(c.p)}</span>`;
    return `<${tag} class="pr-card pen${Math.min(c.p, 7)} ${cls}" data-cn="${c.n}" aria-label="${esc(`Number ${c.n}, ${penWord(c.p)}`)}" ${attrs}><em class="pr-tl" aria-hidden="true">${c.n}</em><b>${c.n}</b>${dots}</${tag}>`;
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
      items = v.lastTurn.filter((_, j) => ui.anim.firstStep[j] > ui.anim.i).map((e) => playedHTML(v, e.by, e.n, e.p)).join('');
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
  function laneHTML(v, k, row, mark, taking) {
    const full = row.length >= v.rowLimit;
    const points = row.reduce((s, c) => s + c.p, 0); // from the row as shown, so a step mid-turn counts only the cards on it
    const label = `Row ${k + 1}: ${row.length} card${row.length === 1 ? '' : 's'}, ${penWord(points)}`;
    const e = mark ? v.lastTurn[mark.j] : null;
    const here = e && e.row === k;
    const newAt = here && (mark.phase === 'place' || mark.phase === 'add') ? row.length - 1 : here && mark.phase === 'restart' ? 0 : -1;
    const cols = Math.max(v.rowLimit, row.length); // the sixth card needs a sixth slot for the moment it lands
    const slots = Array.from({ length: cols }, (_, s) => (row[s]
      ? cardHTML(row[s], { cls: s === newAt ? 'new' : '' })
      : '<div class="pr-slot" aria-hidden="true"></div>')).join('');
    const collected = here && mark.phase === 'collect';
    const calloutText = here && mark.phase === 'add' ? `${v.rowLimit + 1}th card placed`
      : collected ? `${nameOf(v, e.by)} took ${e.took}` : '';
    const callout = calloutText ? `<span class="pr-callout">${calloutText}</span>` : '';
    const inner = `<span class="pr-rowhead"><span class="label">Row ${k + 1}</span></span><span class="pr-cards" style="--cols:${cols}">${slots}</span>`
      + `<span class="pr-pile" role="img" aria-label="${points} penalty point${points === 1 ? '' : 's'}" title="Penalty points on this row"><span class="pr-pile-n" aria-hidden="true">${points <= 5 ? (starsOf(points) || '0') : `💣×${points}`}</span></span>${callout}`;
    return taking
      ? `<button type="button" class="pr-row take" data-pr="take" data-row="${k}" aria-label="${esc('Take ' + label)}">${inner}</button>`
      : `<div class="pr-row ${full ? 'full' : ''}${collected ? ' collected' : ''}" role="group" aria-label="${esc(label)}">${inner}</div>`;
  }

  function rowsHTML(v) {
    const taking = v.phase === 'takeRow' && v.pending && v.pending.by === v.me;
    const rows = ui.anim && ui.anim.seq === v.seq ? ui.anim.steps[ui.anim.i] : v.rows;
    const mark = currentMark(v);
    return `<div class="pr-rows">${rows.map((row, k) => laneHTML(v, k, row, mark, taking)).join('')}</div>`;
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
        + `<span class="pr-rnd" title="Taken this round">−${p.penalty}</span><span class="pr-state" aria-label="${state === '⚠' ? 'must take a row' : p.picked ? 'has picked' : 'still choosing'}">${state}</span></li>`;
    }).join('')}</ul>`;
  }

  /** Each player's score under their name, always in view: points left out of the target (countdown) or penalty points out of
   * the target (race), so there is a reference without going to the Scores tab. */
  function chipsHTML(v) {
    const what = v.countdown ? 'points left' : 'penalty points';
    return `<ul class="pr-chips" aria-label="Scores, ${what} out of ${v.target}">${v.players.map((p, i) => {
      const num = v.countdown ? p.left : p.total;
      const out = v.losers && v.losers.includes(i) ? ' out' : '';
      return `<li class="${i === v.me ? 'me' : ''}${out}" data-pid="${esc(p.id)}"><span class="pr-chip-name">${esc(p.name)}${i === v.me ? ' (you)' : ''}</span><b class="pr-chip-n" title="${what}">${num}<small>/${v.target}</small></b></li>`;
    }).join('')}</ul>`;
  }

  /** The last rounds, newest first, so the scores tab shows how the game got here. */
  function historyHTML(v) {
    if (!v.history.length) return '';
    const rows = v.history.slice(-5).reverse().map((h) => `<li><span>Round ${h.round}</span><span>${v.players.map((p, i) => `${esc(p.name)} \u2212${h.penalties[i]}`).join(' · ')}</span></li>`).join('');
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
    if (v.phase === 'roundEnd' && v.lastRound && !ui.anim) {
      const r = v.lastRound;
      const least = Math.min(...r.penalties);
      const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => r.penalties[a.i] - r.penalties[b.i]).map(({ p, i }) => {
        const total = v.countdown ? `${p.left} left` : `${p.total} pts`;
        return `<li class="${r.penalties[i] === least ? 'win' : ''}"><span><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${r.penalties[i] ? `+${r.penalties[i]} penalty` : 'no penalty'} · ${total}</span></li>`;
      }).join('');
      return `<div class="overlay"><div class="sheet"><h2>Round ${r.round} complete</h2>
        ${window.CardTable.readyBox(ui.ctx, { title: 'Ready for the next round?', cls: 'in-sheet' })}<p class="hint" style="text-align:left">${v.countdown ? 'Penalty points come off everyone\'s 66. Whoever reaches 0 first loses.' : 'The fewest penalty points is best.'}</p>
        <ul class="pr-final">${rows}</ul></div></div>`;
    }
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
    ui.anim = steps ? { seq: v.seq, ...steps, i: 0, table: tableOf(), events: v.lastTurn } : null;
    if (ui.anim) scheduleStep(ui.anim, v.paceK);
    else if (window.GameFeed) window.GameFeed.add(tableOf(), v.lastTurn.map((e, idx) => feedItem(v, e, fid(`t${v.seq}-${idx}`)))); // no replay: the feed still gets the turn
    if (!snd) return;
    if (v.phase === 'gameOver') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    else if (v.lastTurn.some((e) => e.by === v.me && e.took)) snd.play('lose');
    else snd.play('card');
  }

  /** Public events that are not a card on the table: who has locked in a card, and a new round. */
  function feedPicksAndRounds(v) {
    const key = tableOf();
    if (!key || !window.GameFeed || ui.seq === null) { ui.cur.round = v.round; return; }
    if (ui.anim && ui.anim.table === key) { ui.heldFeed = v; return; } // the replayed moves come first
    ui.heldFeed = null;
    // announced per table and per match: each table says its round once, and a one-round rematch says it again
    if (ui.cur.round !== v.round) { window.GameFeed.add(key, [{ id: fid(`round-${v.round}`), tone: 'round', html: `Round ${v.round} begins` }]); ui.cur.round = v.round; }
    if (v.phase === 'choose') {
      v.players.forEach((p, i) => {
        if (p.picked && i !== v.me) window.GameFeed.add(key, [{ id: fid(`pick-${v.round}-${v.turn}-${i}`), tone: 'info', html: `<b>${esc(p.name)}</b> has locked in a card` }]);
      });
    }
    if (v.phase === 'gameOver' && v.winners.length) {
      const names = v.winners.map((i) => esc(v.players[i].name)).join(' & ');
      window.GameFeed.add(key, [{ id: fid(`end-${v.round}`), tone: 'win', html: `Game over · <b>${names}</b> ${v.winners.length > 1 ? 'share the win' : 'wins'}` }]);
    }
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    ui.cur = tableState(tableOf());
    if (ui.cur.lastSeen !== null && v.seq < ui.cur.lastSeen) { ui.cur.match += 1; ui.cur.round = null; } // this table's sequence restarted: a new match there, with no round announced yet
    ui.cur.lastSeen = v.seq;
    if (ui.table !== tableOf()) { ui.table = tableOf(); ui.anim = null; ui.seq = null; } // a different table: start afresh, with no replay
    react(v);
    feedPicksAndRounds(v);
    const focusedTab = root.contains(document.activeElement) && document.activeElement.matches('[data-pr="tab"]') ? document.activeElement.dataset.tab : null;
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.n : null; // keep keyboard focus on the same card across redraws
    const mine = v.me >= 0 && (v.phase === 'choose' ? v.myPick === null : v.pending && v.pending.by === v.me);
    const tab = ui.tab === 'scores' ? 'scores' : 'table';
    const tabs = `<nav class="pr-tabs" role="tablist" aria-label="Take 5 views">
        <button type="button" role="tab" class="btn ghost small" data-pr="tab" data-tab="table" aria-selected="${tab === 'table'}">Table</button>
        <button type="button" role="tab" class="btn ghost small" data-pr="tab" data-tab="scores" aria-selected="${tab === 'scores'}">Scores</button></nav>`;
    const body = tab === 'scores'
      ? `${scoreHTML(v)}${historyHTML(v)}${lastTurnHTML(v)}`
      : `<section class="pr-table" aria-label="Table">${chipsHTML(v)}${stripHTML(v)}${rowsHTML(v)}</section>${window.GameFeed ? window.GameFeed.html(tableOf(), 'pr-feed') : ''}${lastTurnHTML(v)}`;
    root.innerHTML = `
    <div class="wz prt">
      <div class="wz-top">
        <div class="wz-round"><b>Take 5</b><span class="label"> · round ${v.round} · turn ${v.turn}/${v.handSize}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-pr="rules">Rules</button>', 'pr')}
      </div>
      ${tabs}
      ${body}
      <div class="wz-status ${mine ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${tab === 'table' ? handHTML(v) : ''}
      ${overlayHTML(v)}
    </div>`;
    root.onclick = onClick;
    if (focusedTab) { const el = root.querySelector(`[data-pr="tab"][data-tab="${focusedTab}"]`); if (el) el.focus({ preventScroll: true }); }
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
