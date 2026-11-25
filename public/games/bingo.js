/* Bingo table renderer: the number just called, the board of every number called so far, your own card and the Bingo button.
 * Shares table.css and the card helpers; styles in bingo.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const LETTERS = ['B', 'I', 'N', 'G', 'O'];
  const ui = { ctx: null, latest: null, called: null, over: false };
  const letterOf = (n) => LETTERS[Math.floor((n - 1) / 15)];
  const nameOf = (v, i) => (v.players[i] ? esc(v.players[i].name) : 'Someone');

  /** The board of every number called so far: one row per letter, so a called number is easy to spot. */
  function boardHTML(v) {
    const called = new Set(v.called);
    return LETTERS.map((l, r) => {
      const cells = Array.from({ length: 15 }, (_, k) => {
        const n = 15 * r + k + 1;
        const cls = `bg-n${called.has(n) ? ' on' : ''}${n === v.lastCall ? ' last' : ''}`;
        return `<span class="${cls}" aria-label="${n}${called.has(n) ? ', called' : ''}">${n}</span>`;
      }).join('');
      return `<div class="bg-row"><b aria-hidden="true">${l}</b>${cells}</div>`;
    }).join('');
  }

  /** Your card. A called number you have not marked is tappable (unless Mark for me is on). */
  function cardHTML(v) {
    const manual = !v.options.autoMark;
    const head = LETTERS.map((l) => `<span class="bg-h" aria-hidden="true">${l}</span>`).join('');
    const squares = v.card.map((c) => {
      if (c.free) return '<span class="bg-sq free on" aria-label="Free square">★</span>';
      const called = v.called.includes(c.n);
      const tappable = manual && called && !c.marked && v.phase === 'playing';
      const cls = `bg-sq${called ? ' called' : ''}${c.marked ? ' on' : ''}`;
      if (tappable) return `<button class="${cls}" data-bg="mark" data-n="${c.n}" aria-label="${c.n}, tap to mark">${c.n}</button>`;
      return `<span class="${cls}" aria-label="${c.n}${c.marked ? ', marked' : ''}">${c.n}</span>`;
    }).join('');
    return `<div class="bg-head">${head}</div><div class="bg-card">${squares}</div>`;
  }

  function resultHTML(v, ctx) {
    const who = v.winners.map((i) => nameOf(v, i));
    const text = who.length ? `<b>${who.join(' and ')}</b> called Bingo!` : 'Every number was called and nobody called Bingo.';
    const again = ctx.isHost ? '<button class="btn" data-bg="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>';
    return `<section class="bg-result" role="status"><p>${text}</p><div class="row">${again}</div></section>`;
  }

  /** A chime for each new number, and win or lose when the game ends. The first render plays nothing (no replay on reconnect). */
  function react(v) {
    const snd = window.CardTable.sound;
    const over = v.phase === 'gameOver';
    if (ui.called === null) { ui.called = v.called.length; ui.over = over; return; }
    if (!snd) return;
    if (v.called.length > ui.called) snd.play('turn');
    if (over && !ui.over) snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    ui.called = v.called.length;
    ui.over = over;
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    react(v);
    const over = v.phase === 'gameOver';
    const pattern = v.options.pattern === 'full' ? 'Full card' : 'Any line';
    const watching = v.me < 0;
    const status = over ? 'The game is over.' : watching ? 'Watching the game.' : v.canClaim ? 'You have a Bingo: shout it now!' : 'Mark each called number on your card.';
    root.innerHTML = `<div class="bg">
      <div class="wz-top"><div class="wz-round"><b>Bingo</b><span class="label"> · ${v.called.length} called</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-bg="rules">Rules</button>', 'bg')}
      </div>
      <section class="bg-call" aria-live="polite">
        <div class="bg-ball">${v.lastCall ? `<span class="bg-l">${letterOf(v.lastCall)}</span>${v.lastCall}` : 'Ready'}</div>
        <p class="bg-meta">${v.called.length} called · ${v.toGo} to go · ${pattern}</p>
      </section>
      ${over ? resultHTML(v, ctx) : ''}
      ${watching ? '<p class="hint">You are watching this game.</p>' : `<section class="bg-mine" aria-label="Your card">${cardHTML(v)}
        <button class="btn bg-claim" data-bg="claim" ${v.canClaim && !over ? '' : 'disabled'}>Bingo!</button>
      </section>`}
      <section class="bg-board" aria-label="Numbers called">${boardHTML(v)}</section>
      <div class="bg-players">${v.players.map((p, i) => `<span class="bg-chip${i === v.me ? ' me' : ''}">${i === v.me ? 'You' : esc(p.name)}${p.bot ? ' 🤖' : ''}</span>`).join('')}</div>
      <div class="wz-status"><span>${status}</span></div>
    </div>`;
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
