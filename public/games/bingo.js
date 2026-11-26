/* Bingo table renderer. Players sit in a grid like Stage 10's seats; each seat shows that player's progress as a small matrix
 * (blank until a square is marked, then filled) so everyone can follow the race without seeing the numbers. Above the seats the
 * number just called; below them your card with the Bingo button and the board of called numbers. Shares the seat helpers and
 * the Go Fish frame (top bar, status line, panel, feed, sounds, results overlay); styles in bingo.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;
  const LETTERS = ['B', 'I', 'N', 'G', 'O'];
  const PATTERN = { line: 'a full line across, down or diagonal', full: 'every square of the card' };
  const ui = { ctx: null, latest: null, seq: null, feeds: new Map(), called: null, over: false, prevSq: new Map() };

  const letterOf = (n) => LETTERS[Math.floor((n - 1) / 15)];
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));

  /** What just happened, in words. Only the closing event carries text: each call is shown on the number itself. */
  function eventText(v) {
    const e = v.event;
    if (!e || e.type !== 'over') return '';
    if (!e.winners.length) return 'Every number was called and nobody called Bingo.';
    const who = e.winners.map((i) => nameOf(v, i)).join(' and ');
    return `${who} called Bingo after ${e.calls} numbers!`;
  }

  const feedKey = () => (ui.ctx && ui.ctx.room ? ui.ctx.room.code : null);
  /** The closing Bingo joins the shared feed and is held in the middle of the screen. The first look at a table only records where it is. */
  function feedSync(v) {
    const key = feedKey();
    if (!key || !window.GameFeed) return;
    const e = v.event;
    const st = ui.feeds.get(key);
    const seq = e ? e.seq : 0;
    if (!st) { ui.feeds.set(key, { seq, epoch: 0 }); return; }
    if (!e || e.type !== 'over' || e.seq <= st.seq) { if (seq < st.seq) { st.epoch += 1; st.seq = seq; } return; }
    st.seq = e.seq;
    const text = eventText(v);
    const won = e.winners.length > 0;
    window.GameFeed.add(key, [{ id: `bg-${key}-${st.epoch}-${e.seq}`, tone: won ? 'win' : 'round', html: text }]);
    if (won) window.GameFeed.spotlight({ card: '<span class="bg-spot-ico">🎱</span>', caption: text, tone: 'win', ms: 1800 });
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You called Bingo!' : (v.winners.length ? 'Game over' : 'Game over: nobody called Bingo');
    if (v.me < 0) return 'Watching the game';
    if (v.canClaim) return 'You have a Bingo: shout it now!';
    return 'Mark each called number on your card';
  }

  function seatHTML(v, ctx, i) {
    const p = v.players[i];
    const won = v.phase === 'gameOver' && v.winners.includes(i);
    // the player with the most squares marked leads, as the leader does in Wizard, Snakes and Ladders and Poker (at least 3 marks)
    const lead = v.phase === 'playing' && pt.leaderOf(v.players.length, (k) => v.players[k].marked, 3) === i;
    const badge = won ? '<span class="bdg l" title="Called Bingo">🏆 Bingo</span>' : lead ? '<span class="bdg l" title="Most squares marked">👑 Lead</span>' : '';
    return pt.seatHTML({
      pid: p.id, name: p.name + (i === v.me ? ' (you)' : ''), avatar: pt.avatarOf(ctx.room, p.id), sub: `${p.marked} marked${p.bot ? ' · bot' : ''}`, turn: false, me: i === v.me,
      badges: badge, under: miniHTML(p),
    });
  }

  /** The last number called, in the middle of the table, with how many are still to come (like the Go Fish stock). */
  function callHTML(v) {
    const ball = v.lastCall
      ? `<span class="bg-ball" aria-label="Last number called: ${letterOf(v.lastCall)} ${v.lastCall}"><small>${letterOf(v.lastCall)}</small>${v.lastCall}</span>`
      : '<span class="bg-ball slot" aria-label="No number called yet"></span>';
    return `<section class="bg-call"><div class="bg-pile">${ball}</div><div class="bg-count"><b>${v.toGo}</b><small>still to call</small></div></section>`;
  }

  /** Each player's matrix: 25 squares, blank until marked, then filled. Positions only: no numbers are shown to anyone but the card's owner. */
  function miniHTML(p) {
    // squares marked since the last render flash once; the first render is silent
    const prev = ui.prevSq.get(p.id);
    const fresh = (k) => !!prev && !prev[k] && !!p.squares[k];
    ui.prevSq.set(p.id, p.squares.slice());
    // positions only: marked squares go black, the free centre gets a gold dot, squares of a finished line glow gold,
    // and the open square of a line with four marks is outlined dashed (so others feel the tension without any number)
    const full = new Set(p.full || []);
    const near = new Set(p.near || []);
    const cells = p.squares.map((on, k) => {
      const cls = [on ? 'on' : '', k === 12 ? 'free' : '', full.has(k) ? 'full' : '', near.has(k) ? 'near' : '', fresh(k) ? 'fresh' : ''].filter(Boolean).join(' ');
      return `<i class="${cls}"></i>`;
    }).join('');
    const label = full.size ? `${p.marked} squares marked, a line is complete` : `${p.marked} squares marked`;
    return `<div class="bg-mini${full.size ? ' has-line' : ''}" aria-label="${label}">${cells}</div>`;
  }

  function seatsHTML(v, ctx) {
    const order = v.players.map((_, i) => i).sort((a, b) => (a === v.me ? -1 : b === v.me ? 1 : a - b));
    return `<div class="bg-seats ${v.players.length > 4 ? 'many' : ''}" role="region" aria-label="Every player's card progress">${order.map((i) => seatHTML(v, ctx, i)).join('')}</div>`;
  }


  /** Your card: the header letters, then the squares. A called number you have not marked is tappable (unless Mark for me is on). */
  function cardHTML(v) {
    const manual = !v.options.autoMark;
    const head = LETTERS.map((l) => `<span class="bg-h" aria-hidden="true">${l}</span>`).join('');
    // your own card knows its numbers, so it can show a line that is complete or one square away (positions only)
    const me = v.players && v.players[v.me];
    const full = new Set(me ? me.full || [] : []);
    const near = new Set(me ? me.near || [] : []);
    const squares = v.card.map((c, k) => {
      if (c.free) return `<span class="bg-sq free on${full.has(k) ? ' line' : ''}" aria-label="Free square">★</span>`;
      const called = v.called.includes(c.n);
      const tappable = manual && called && !c.marked && v.phase === 'playing';
      const cls = `bg-sq${called ? ' called' : ''}${c.marked ? ' on' : ''}${full.has(k) ? ' line' : ''}${near.has(k) && !c.marked ? ' near' : ''}${tappable ? ' ready' : ''}`;
      if (tappable) return `<button type="button" class="${cls}" data-bg="mark" data-n="${c.n}" aria-label="${c.n}, tap to mark">${c.n}</button>`;
      return `<span class="${cls}" aria-label="${c.n}${c.marked ? ', marked' : ''}">${c.n}</span>`;
    }).join('');
    return `<div class="bg-head">${head}</div><div class="bg-card">${squares}</div>`;
  }

  /** The card and the Bingo button, in the same panel style as the Go Fish controls. */
  function controlsHTML(v) {
    if (v.me < 0 || v.phase !== 'playing') return '';
    const hint = `A Bingo is ${PATTERN[v.options.pattern] || PATTERN.line}.`;
    // the button comes straight after the header so it is in view on a phone, above the card
    return `<div class="bg-ask panel">
      <div class="bg-row"><span class="label">Your card</span><span class="hint">${hint}</span></div>
      <button class="btn big" data-bg="claim" ${v.canClaim ? '' : 'disabled'}>Bingo!</button>
      ${cardHTML(v)}
    </div>`;
  }

  /** Every number called so far, one row per letter, so the board reads like a bingo caller's sheet. */
  function boardHTML(v) {
    const called = new Set(v.called);
    const rows = LETTERS.map((l, r) => {
      const cells = Array.from({ length: 15 }, (_, k) => {
        const n = 15 * r + k + 1;
        return `<span class="bg-n${called.has(n) ? ' on' : ''}${n === v.lastCall ? ' last' : ''}">${n}</span>`;
      }).join('');
      return `<div class="bg-line"><b aria-hidden="true">${l}</b>${cells}</div>`;
    }).join('');
    return `<section class="panel bg-board" aria-label="Numbers called">
      <div class="bg-row"><span class="label">Called so far</span><span class="hint">${v.called.length} of 75</span></div>${rows}</section>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const won = v.winners.includes(v.me);
    const title = v.me >= 0 && won ? 'You called Bingo! 🎉' : 'Game over';
    const hint = !v.winners.length ? 'Every number was called and nobody called Bingo.'
      : v.winners.length > 1 ? `${v.winners.length} players called Bingo on the same number.`
      : `${esc(v.players[v.winners[0]].name)} called Bingo first.`;
    const order = v.players.map((p, i) => i).sort((a, b) => (v.winners.includes(b) ? 1 : 0) - (v.winners.includes(a) ? 1 : 0));
    const rows = order.map((i) => {
      const p = v.players[i];
      const win = v.winners.includes(i);
      return `<li class="${win ? 'win' : ''}"><span>${win ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${win ? `after ${v.called.length} numbers` : 'no Bingo'}</span></li>`;
    }).join('');
    const again = ui.ctx.isHost ? '<button class="btn" data-bg="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${hint}</p>
      <ul class="bg-final">${rows}</ul>
      <div class="row" style="margin-top:12px">${again}<button class="btn ghost" data-bg="leave">Leave table</button></div></div></div>`;
  }

  /** A chime for each new number, and win or lose when the game ends. The first render plays nothing (no replay on reconnect). */
  function react(v) {
    const snd = window.CardTable.sound;
    const over = v.phase === 'gameOver';
    if (ui.called === null) { ui.called = v.called.length; ui.over = over; return; }
    if (snd) {
      if (v.called.length > ui.called) snd.play('card');
      if (over && !ui.over) snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    }
    // screen-reader players hear each new number once (the ball is only read on navigation)
    if (v.called.length > ui.called && v.lastCall && window.CardTable.announceStatus) {
      window.CardTable.announceStatus(`${letterOf(v.lastCall)} ${v.lastCall} called`);
    }
    ui.called = v.called.length;
    ui.over = over;
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    feedSync(v);
    react(v);
    const pattern = v.options.pattern === 'full' ? 'Full card' : 'Any line';
    // the page is rebuilt on every update: keep the control the person was using, so keyboard focus is not lost
    const had = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = had ? (had.getAttribute('data-n') ? `n:${had.getAttribute('data-n')}` : had.getAttribute('data-bg') ? `bg:${had.getAttribute('data-bg')}` : null) : null;
    root.innerHTML = `
    <div class="wz bg">
      <div class="wz-top">
        <div class="wz-round"><b>Bingo</b><span class="label"> · ${v.called.length} called · ${pattern}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-bg="rules">Rules</button>', 'bg')}
      </div>
      ${callHTML(v)}
      ${seatsHTML(v, ctx)}
      ${eventText(v) ? `<p class="bg-event" role="status">${eventText(v)}</p>` : ''}
      <div class="wz-status ${v.canClaim && v.phase === 'playing' ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${controlsHTML(v)}
      ${boardHTML(v)}
      ${overlayHTML(v)}
    </div>`;
    if (focusKey) { // the same control again, if it is still there and can take focus
      const again = root.querySelector(focusKey.startsWith('n:') ? `[data-n="${focusKey.slice(2)}"]` : `[data-bg="${focusKey.slice(3)}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
      else { // the control is gone or disabled: move focus to the enabled Bingo button, or to a remaining mark
        const next = root.querySelector('[data-bg="claim"]:not([disabled])') || root.querySelector('[data-bg="mark"]');
        if (next) next.focus({ preventScroll: true });
      }
    }
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-bg]');
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    switch (el.dataset.bg) {
      case 'mark': ctx.act({ type: 'mark', n: Number(el.dataset.n) }); break;
      case 'claim': if (v.canClaim && v.phase === 'playing') ctx.act({ type: 'claim' }); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('bingo', { render });
})();
