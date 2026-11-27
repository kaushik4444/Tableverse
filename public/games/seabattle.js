/* Sea Battle: two boards. Attack shows the other player's sea and your shots; My fleet shows your ships and their shots. On a
 * phone you switch between them; on a wide screen both show. Pick a square, then Fire, so a stray tap cannot waste a shot.
 * Watchers see both seas' shots. Styles in seabattle.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { root: null, ctx: null, v: null, seq: null, tab: 'attack', sel: null, table: null };
  const SEAT_NAMES = ['Blue', 'Red'];
  const LETTERS = 'ABCDEFGHIJ';
  const square = (k, n) => `${LETTERS[k % n]}${Math.floor(k / n) + 1}`;

  function guidance(v) {
    if (v.phase === 'gameOver') {
      if (v.me < 0) return `${esc(v.players[v.winner].name)} sank the last ship`;
      return v.winner === v.me ? 'You sank the whole fleet!' : `${esc(v.players[v.winner].name)} sank your fleet`;
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is aiming`;
    if (!v.myTurn) return `${esc(v.players[1 - v.me].name)} is aiming…`;
    if (ui.sel !== null) return `Fire at ${square(ui.sel, v.N)}? Tap Fire to confirm`;
    return 'Your shot: pick a square on their sea';
  }

  function seatsHTML(v) {
    return `<div class="sb-seats">${v.players.map((p, i) => `<div class="sb-seat s${i} ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}">
      <span class="sb-swatch" aria-hidden="true"></span><span class="sb-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b>
      <small>${SEAT_NAMES[i]} · sunk <span class="sb-sunk">${p.sunk}</span> · ${p.left} left</small></span></div>`).join('')}</div>`;
  }

  /** A sea with the shots fired at it. For a player's attack board the open squares are buttons on their turn. */
  function seaHTML(v, target, { interactive, title }) {
    const sea = v.shots[target];
    const cells = [];
    for (let k = 0; k < v.N * v.N; k++) {
      const st = sea[k];
      const label = `${square(k, v.N)}, ${st || 'not fired at'}`;
      if (st || !interactive) {
        cells.push(`<span class="sb-cell ${st || 'open'}" role="img" aria-label="${label}"></span>`);
      } else {
        cells.push(`<button type="button" class="sb-cell open${ui.sel === k ? ' sel' : ''}" data-sb="sq" data-k="${k}" aria-label="${label}" ${v.myTurn ? '' : 'disabled'}></button>`);
      }
    }
    return `<div class="sb-board attack" role="group" aria-label="${title}"><div class="sb-grid" style="--n:${v.N}">${cells.join('')}</div></div>`;
  }

  /** My fleet: my ships (hit or not) and the shots the other player has taken at my sea. */
  function fleetHTML(v) {
    const cells = v.fleet.map((st, k) => `<span class="sb-cell ${st || 'water'}" role="img" aria-label="${square(k, v.N)}, ${st || 'water'}"></span>`).join('');
    return `<div class="sb-board mine" role="group" aria-label="Your fleet"><div class="sb-grid" style="--n:${v.N}">${cells}</div></div>`;
  }

  function boardsHTML(v) {
    if (v.me < 0) {
      // a watcher sees both seas' shots, and no fleet
      return seaHTML(v, 0, { interactive: false, title: 'Blue’s sea' }) + seaHTML(v, 1, { interactive: false, title: 'Red’s sea' });
    }
    return seaHTML(v, 1 - v.me, { interactive: true, title: 'Their sea: your shots' }) + fleetHTML(v);
  }

  function controlsHTML(v) {
    const can = v.myTurn && ui.sel !== null && !v.shots[1 - v.me][ui.sel];
    return `<div class="sb-controls">
      <button type="button" class="btn ghost" data-sb="clear" ${ui.sel === null ? 'disabled' : ''}>Clear</button>
      <button type="button" class="btn" data-sb="fire" ${can ? '' : 'disabled'}>Fire</button></div>`;
  }

  function tabsHTML() {
    return `<div class="sb-tabs" role="tablist">
      <button type="button" role="tab" class="btn ghost small ${ui.tab === 'attack' ? 'on' : ''}" data-sb="tab-attack" aria-selected="${ui.tab === 'attack'}">Attack</button>
      <button type="button" role="tab" class="btn ghost small ${ui.tab === 'mine' ? 'on' : ''}" data-sb="tab-mine" aria-selected="${ui.tab === 'mine'}">My fleet</button></div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const title = v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    const score = v.players.map((p) => `${esc(p.name)} sank ${p.sunk}`).join(' · ');
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${score}</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-sb-act="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-sb-act="leave">Leave table</button></div></div></div>`;
  }

  /** A splash for a miss, a bang for a hit, and a longer one for a sunk ship. The first look plays nothing. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'over') { snd.play('place'); setTimeout(() => snd.play(v.winner === v.me ? 'win' : v.me < 0 ? 'round' : 'lose'), 260); return; }
    if (e.type === 'sunk') { snd.play('land'); setTimeout(() => snd.play('round'), 180); return; }
    snd.play(e.type === 'hit' ? 'land' : 'place');
  }

  function render(root, v, ctx) {
    // a selection belongs to one table, one turn, and a square that is still open
    const tableKey = ctx && ctx.room ? ctx.room.code : '';
    if (ui.table !== tableKey) { ui.sel = null; ui.table = tableKey; }
    const me = v.me < 0 ? 0 : v.me;
    if (ui.sel !== null && (!v.myTurn || v.shots[1 - me][ui.sel])) ui.sel = null;
    // the selection and the phone tab belong to one table: a new table starts clean
    const table = ctx && ctx.room ? ctx.room.code : null;
    if (table !== ui.table) { ui.table = table; ui.sel = null; ui.tab = 'attack'; }
    ui.root = root; ui.ctx = ctx; ui.v = v; react(v);
    const active = root.ownerDocument.activeElement;
    const focus = root.contains(active) && active.dataset.sb ? { sb: active.dataset.sb, k: active.dataset.k } : null;
    root.innerHTML = `<div class="wz sb" data-game="seabattle" data-tab="${v.me < 0 ? 'both' : ui.tab}">
      <div class="wz-top"><div class="wz-round"><b>Sea Battle</b><span class="label"> · 10 × 10 seas</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-sb-act="rules">Rules</button>', 'sb')}</div>
      ${seatsHTML(v)}
      ${v.me >= 0 ? tabsHTML() : ''}
      <div class="sb-boards">${boardsHTML(v)}</div>
      ${v.me >= 0 ? controlsHTML(v) : ''}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    if (focus) {
      const sel = `[data-sb="${focus.sb}"]${focus.k !== undefined ? `[data-k="${focus.k}"]` : ''}`;
      const el = root.querySelector(sel);
      (el && !el.disabled ? el : root.querySelector('[data-sb]:enabled'))?.focus({ preventScroll: true });
    }
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-sb], [data-sb-act]');
    const ctx = ui.ctx, v = ui.v;
    if (!el || !ctx || el.disabled) return;
    if (el.dataset.sbAct) {
      if (el.dataset.sbAct === 'again') ctx.rematch();
      else if (el.dataset.sbAct === 'leave') ctx.leave();
      else if (el.dataset.sbAct === 'rules') ctx.showRules();
      return;
    }
    if (el.dataset.sb === 'fire') {
      if (v && v.myTurn && ui.sel !== null) {
        const k = ui.sel;
        ui.sel = null;
        ctx.act({ type: 'fire', r: Math.floor(k / v.N), c: k % v.N });
      }
      return;
    }
    switch (el.dataset.sb) {
      case 'tab-attack': ui.tab = 'attack'; break;
      case 'tab-mine': ui.tab = 'mine'; break;
      case 'sq': if (v && v.myTurn) ui.sel = Number(el.dataset.k); break;
      case 'clear': ui.sel = null; break;
      default: return;
    }
    if (ui.root && ui.v) render(ui.root, ui.v, ctx);
  }

  window.CardTable.register('seabattle', { render });
})();
