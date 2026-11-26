/* Sudoku table renderer. Everybody has the same puzzle on their own 9x9 grid. Tap a square and then a number (or type it).
 * A wrong number shows red until it is changed. Above the grid, one line per player with a bar and a count of right squares, so
 * everyone can follow the race without seeing any numbers but their own. Shares the Go Fish frame (top bar, status line, panel,
 * feed, sounds, results overlay); styles in sudoku.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;
  const ui = { ctx: null, latest: null, root: null, sel: -1, refocus: false, feeds: new Map(), prev: null };
  const DIFFICULTY = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const feedKey = () => (ui.ctx && ui.ctx.room ? ui.ctx.room.code : null);
  /** The first grid filled in joins the shared feed and is held in the middle of the screen. The first look at a table only records where it is. */
  function feedSync(v) {
    const key = feedKey();
    if (!key || !window.GameFeed) return;
    const e = v.event;
    const st = ui.feeds.get(key);
    const seq = e ? e.seq : 0;
    if (!st) { ui.feeds.set(key, { seq, epoch: 0 }); return; }
    if (!e || e.seq <= st.seq) { if (seq < st.seq) { st.epoch += 1; st.seq = seq; } return; }
    st.seq = e.seq;
    const text = `${nameOf(v, e.winner)} filled the grid in ${plural(e.seconds, 'second')}!`;
    window.GameFeed.add(key, [{ id: `su-${key}-${st.epoch}-${e.seq}`, tone: 'win', html: text }]);
    window.GameFeed.spotlight({ card: '<span class="su-spot-ico">🔢</span>', caption: text, tone: 'win', ms: 1800 });
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winner === v.me ? 'You filled the grid first!' : `${nameOf(v, v.winner)} filled the grid first`;
    if (v.me < 0) return 'Watching the game';
    if (v.wrong.length) return `Fix the ${plural(v.wrong.length, 'red number')}`;
    return 'Tap an empty square, then a number';
  }

  /** One line per player: how far through their grid they are. Counts and bars only, never their numbers. */
  function progressHTML(v) {
    const lead = v.phase === 'playing' ? pt.leaderOf(v.players.length, (k) => v.players[k].right, 1) : -1;
    return `<ul class="su-prog" aria-label="Right squares in each grid">${v.players.map((p, i) => {
      const pct = p.total ? Math.round((p.right / p.total) * 100) : 0;
      const tag = p.done ? '<span class="su-tag" title="Filled the grid" aria-label="Filled the grid">🏆</span>'
        : i === lead ? '<span class="su-tag" title="Furthest ahead" aria-label="Furthest ahead">👑</span>' : '';
      return `<li class="${i === v.me ? 'me' : ''}${p.done ? ' done' : ''}"><span class="su-who">${tag}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b>${p.bot ? '<small> · bot</small>' : ''}</span>`
        + `<span class="su-bar" role="img" aria-label="${p.right} of ${p.total} right"><i style="width:${pct}%"></i></span><span class="su-count">${p.right}/${p.total}</span></li>`;
    }).join('')}</ul>`;
  }

  /** Your grid. Given numbers cannot be tapped; empty squares you can tap; wrong numbers are red; the answer appears once the game is over. */
  function boardHTML(v) {
    const playing = v.phase === 'playing' && v.me >= 0;
    const wrong = new Set(v.wrong);
    const cells = [];
    for (let k = 0; k < 81; k++) {
      const r = Math.floor(k / 9);
      const c = k % 9;
      const clue = !!v.puzzle[k];
      const mine = v.board ? v.board[k] : 0;
      const isWrong = wrong.has(k);
      const right = !clue && mine && !isWrong;
      const answer = v.solution && !clue && !mine ? v.solution[k] : 0;
      const value = clue ? v.puzzle[k] : mine || answer;
      const cls = ['su-c', clue ? 'su-clue' : '', right ? 'su-ok' : '', isWrong ? 'su-bad' : '', answer ? 'su-answer' : '', k === ui.sel ? 'su-sel' : '',
        r === 2 || r === 5 ? 'su-rb' : '', c === 2 || c === 5 ? 'su-cb' : ''].filter(Boolean).join(' ');
      const label = `Row ${r + 1}, column ${c + 1}${clue ? `, given ${value}` : value ? `, ${value}${isWrong ? ', wrong' : ''}` : ', empty'}`;
      if (playing && !clue && !right) cells.push(`<button type="button" class="${cls}" data-su="cell" data-k="${k}" aria-label="${label}">${value || ''}</button>`);
      else cells.push(`<span class="${cls}" aria-label="${label}">${value || ''}</span>`);
    }
    return `<div class="su-board" role="group" aria-label="Your grid">${cells.join('')}</div>`;
  }

  /** Whether the selected square can take a number: it is empty or holds a wrong number, and it is not a given one. */
  function editable(v) {
    const k = ui.sel;
    return k >= 0 && !v.puzzle[k] && !(v.board && v.board[k] && !v.wrong.includes(k));
  }

  function padHTML(v) {
    if (v.me < 0 || v.phase !== 'playing') return '';
    const dis = editable(v) ? '' : 'disabled';
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="btn su-n" data-su="num" data-v="${n}" ${dis} aria-label="Number ${n}">${n}</button>`).join('');
    return `<div class="su-pad" role="group" aria-label="Numbers">${nums}<button type="button" class="btn ghost su-n" data-su="erase" ${dis} aria-label="Erase the square">⌫</button></div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const won = v.winner === v.me;
    const title = won ? 'You filled the grid first!' : `${nameOf(v, v.winner)} filled the grid first`;
    const hint = `The first grid with every number right wins. It took ${plural(v.event ? v.event.seconds : 0, 'second')}.`;
    const order = v.players.map((p, i) => ({ p, i })).sort((a, b) => (b.i === v.winner) - (a.i === v.winner) || b.p.right - a.p.right);
    const rows = order.map(({ p, i }) => `<li class="${i === v.winner ? 'win' : ''}"><span>${i === v.winner ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${p.right}/${p.total} right</span></li>`).join('');
    const again = ui.ctx.isHost ? '<button class="btn" data-su="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${hint}</p>
      <ul class="su-final">${rows}</ul>
      <div class="row" style="margin-top:12px">${again}<button class="btn ghost" data-su="leave">Leave table</button></div></div></div>`;
  }

  /** A chime for each right number, a low note for each mistake, and win or lose when the game ends. The first render plays nothing. */
  function react(v) {
    const snd = window.CardTable.sound;
    const me = v.players[v.me];
    const now = { right: me ? me.right : 0, wrong: v.mistakes, over: v.phase === 'gameOver' };
    if (!ui.prev) { ui.prev = now; return; }
    if (snd) {
      if (now.right > ui.prev.right) snd.play('place');
      if (now.wrong > ui.prev.wrong) snd.play('fall');
      if (now.over && !ui.prev.over) snd.play(v.winner === v.me ? 'win' : 'lose');
    }
    ui.prev = now;
  }

  function draw() {
    if (ui.root && ui.latest && ui.ctx) render(ui.root, ui.latest, ui.ctx);
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    ui.root = root;
    feedSync(v);
    react(v);
    const status = v.phase === 'playing' && v.me >= 0 && !v.wrong.length ? 'mine' : '';
    root.innerHTML = `
    <div class="wz su">
      <div class="wz-top">
        <div class="wz-round"><b>Sudoku</b><span class="label"> · ${DIFFICULTY[v.options.difficulty] || ''} · ${v.empties} to fill</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-su="rules">Rules</button>', 'su')}
      </div>
      ${progressHTML(v)}
      <div class="wz-status ${status}"><span>${guidance(v)}</span></div>
      ${boardHTML(v)}
      ${padHTML(v)}
      ${overlayHTML(v)}
    </div>`;
    root.onclick = onClick;
    root.onkeydown = onKey;
    // a redraw replaces the grid, so keep keyboard focus on the square the player picked
    if (ui.refocus) {
      ui.refocus = false;
      const cell = root.querySelector(`.su-c.su-sel`);
      if (cell && typeof cell.focus === 'function') cell.focus({ preventScroll: true });
    }
  }

  function onClick(e) {
    const el = e.target.closest('[data-su]');
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    const k = ui.sel;
    switch (el.dataset.su) {
      case 'cell': ui.sel = Number(el.dataset.k); ui.refocus = true; draw(); break;
      case 'num': if (editable(v)) ctx.act({ type: 'place', r: Math.floor(k / 9), c: k % 9, v: Number(el.dataset.v) }); break;
      case 'erase': if (editable(v)) ctx.act({ type: 'erase', r: Math.floor(k / 9), c: k % 9 }); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  /** Typing works too: 1 to 9 for a number, Backspace or Delete to erase, once a square is selected. */
  function onKey(e) {
    const v = ui.latest;
    if (!v || v.phase !== 'playing' || ui.sel < 0 || !editable(v)) return;
    const r = Math.floor(ui.sel / 9);
    const c = ui.sel % 9;
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); ui.ctx.act({ type: 'place', r, c, v: Number(e.key) }); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); ui.ctx.act({ type: 'erase', r, c }); }
  }

  window.CardTable.register('sudoku', { render });
})();
