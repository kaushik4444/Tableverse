/* Sea Battle. Placing: pick a ship, tap where it goes, Rotate to turn it, Random to let the game place them, Ready when all five
 * are on the sea. Then two boards: Attack shows the other player's sea and your shots; My fleet shows your ships (drawn as hulls)
 * and their shots. On a phone you switch between them; on a wide screen both show. Pick a square, then Fire, so a stray tap
 * cannot waste a shot. Watchers see both seas' shots. Styles in seabattle.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { root: null, ctx: null, v: null, seq: null, tab: 'attack', sel: null, table: null, pick: null, vert: false };
  const SEAT_NAMES = ['Blue', 'Red'];
  const LETTERS = 'ABCDEFGHIJ';
  const square = (k, n) => `${LETTERS[k % n]}${Math.floor(k / n) + 1}`;
  const NAMES = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];

  // ------------------------------------------------------------------------------------------ placement geometry (client copy)
  const cellsOf = (len, p, N) => Array.from({ length: len }, (_, i) => (p.vertical ? (p.r + i) * N + p.c : p.r * N + p.c + i));
  const fitsOn = (len, p, N) => p.r >= 0 && p.c >= 0 && p.r < N && p.c < N && (p.vertical ? p.r + len <= N : p.c + len <= N);
  function nearOrOn(k, set, N) {
    const r = Math.floor(k / N), c = k % N;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && set.has(rr * N + cc)) return true;
    }
    return false;
  }
  /** Whether a ship can go at p, given the other placed ships (the server checks the same rule). */
  function canPlace(v, slot, p) {
    const N = v.N, len = v.lengths[slot];
    if (!fitsOn(len, p, N)) return false;
    const others = new Set();
    (v.setup || []).forEach((q, i) => { if (i !== slot && q) cellsOf(v.lengths[i], q, N).forEach((k) => others.add(k)); });
    return cellsOf(len, p, N).every((k) => !others.has(k) && !nearOrOn(k, others, N));
  }

  function guidance(v) {
    if (v.phase === 'gameOver') {
      if (v.me < 0) return `${esc(v.players[v.winner].name)} sank the last ship`;
      return v.winner === v.me ? 'You sank the whole fleet!' : `${esc(v.players[v.winner].name)} sank your fleet`;
    }
    if (v.phase === 'placing') {
      if (v.me < 0) return `Watching: ${esc(v.players.map((p) => p.name).join(' and '))} are placing their fleets`;
      const me = v.players[v.me];
      if (me.ready) return `Ready. Waiting for ${esc(v.players[1 - v.me].name)} to place their fleet…`;
      if (ui.pick !== null) return `Tap a square for your ${v.lengths[ui.pick]}-square ${NAMES[ui.pick].toLowerCase()} (${ui.vert ? 'down' : 'across'}); Rotate turns it`;
      if (v.placed && v.placed.every(Boolean)) return 'All five ships are on the sea. Ready when you are, or pick one up to move it';
      return 'Pick a ship, then tap where it goes. Tap a ship on your sea to move it';
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is aiming`;
    if (!v.myTurn) return `${esc(v.players[1 - v.me].name)} is aiming…`;
    if (ui.sel !== null) return `Fire at ${square(ui.sel, v.N)}? Tap Fire to confirm`;
    return 'Your shot: pick a square on their sea';
  }

  function seatsHTML(v) {
    return `<div class="sb-seats">${v.players.map((p, i) => `<div class="sb-seat s${i} ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}">
      <span class="sb-swatch" aria-hidden="true"></span><span class="sb-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b>
      <small>${SEAT_NAMES[i]} · ${v.phase === 'placing' ? (p.ready ? 'ready' : 'placing') : `sunk <span class="sb-sunk">${p.sunk}</span> · ${p.left} left`}</small></span></div>`).join('')}</div>`;
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

  /** A ship drawn as one hull across its squares. Positioned on the grid's own tracks, above the water. */
  function hullsHTML(v, ships) {
    return ships.map((s, i) => {
      const first = s.cells[0], len = s.cells.length, vertical = len > 1 && s.cells[1] - first === v.N;
      const r = Math.floor(first / v.N) + 1, c = (first % v.N) + 1;
      const pos = vertical ? `grid-row:${r} / span ${len};grid-column:${c}` : `grid-row:${r};grid-column:${c} / span ${len}`;
      const name = NAMES[i];
      return `<div class="sb-hull${s.sunk ? ' sunk' : ''}${vertical ? ' v' : ''}" style="${pos}" aria-hidden="true" data-ship="${esc(name)}"></div>`;
    }).join('');
  }

  /** My fleet: my ships (drawn as hulls, hit or not) and the shots the other player has taken at my sea. */
  function fleetHTML(v) {
    const N = v.N;
    const cells = v.fleet.map((st, k) => `<span class="sb-cell ${st || 'water'}" style="grid-row:${Math.floor(k / N) + 1};grid-column:${(k % N) + 1}" role="img" aria-label="${square(k, N)}, ${st || 'water'}"></span>`).join('');
    const hulls = v.ships ? hullsHTML(v, v.ships) : '';
    return `<div class="sb-board mine" role="group" aria-label="Your fleet"><div class="sb-grid" style="--n:${N}">${cells}${hulls}</div></div>`;
  }

  /** While placing: my sea, every square a button; the placed ships as hulls; the picked ship is shown dashed. */
  function placingHTML(v) {
    const N = v.N;
    const placed = [];
    (v.setup || []).forEach((p, i) => { if (p) placed.push({ slot: i, cells: cellsOf(v.lengths[i], p, N) }); });
    // a square under a ship is named by the ship and its place, so a screen reader can find the fleet
    const under = new Map();
    placed.forEach((s) => s.cells.forEach((k) => under.set(k, s)));
    const cells = [];
    for (let k = 0; k < N * N; k++) {
      const s = under.get(k);
      const label = s ? `${square(k, N)}, ${NAMES[s.slot]}, ${s.cells.length} squares, ${p2v(s.cells, N) ? 'down' : 'across'}` : square(k, N);
      cells.push(`<button type="button" class="sb-cell water" style="grid-row:${Math.floor(k / N) + 1};grid-column:${(k % N) + 1}" data-sb="cell" data-k="${k}" aria-label="${label}"${myReady(v) ? ' disabled' : ''}></button>`);
    }
    const hulls = placed.map((s) => {
      const first = s.cells[0], len = s.cells.length, vertical = p2v(s.cells, N);
      const r = Math.floor(first / N) + 1, c = (first % N) + 1;
      const pos = vertical ? `grid-row:${r} / span ${len};grid-column:${c}` : `grid-row:${r};grid-column:${c} / span ${len}`;
      return `<div class="sb-hull${vertical ? ' v' : ''}${ui.pick === s.slot ? ' picked' : ''}" style="${pos}" aria-hidden="true" data-ship="${esc(NAMES[s.slot])}"></div>`;
    }).join('');
    return `<div class="sb-board mine" role="group" aria-label="Your sea: place your ships"><div class="sb-grid" style="--n:${N}">${cells.join('')}${hulls}</div></div>`;
  }
  const p2v = (cells, N) => cells.length > 1 && cells[1] - cells[0] === N;
  /** Whether I have pressed Ready (watchers never have). */
  const myReady = (v) => v.me >= 0 && !!v.players[v.me].ready;

  /** The ship chooser and the placement buttons. */
  function placeControlsHTML(v) {
    const chips = v.lengths.map((len, i) => {
      const on = v.placed && v.placed[i];
      const picked = ui.pick === i;
      return `<button type="button" class="btn ghost small sb-chip${on ? ' on' : ''}${picked ? ' picked' : ''}" data-sb="pick" data-slot="${i}" aria-pressed="${picked}" ${myReady(v) ? 'disabled' : ''}>${NAMES[i]} · ${len}${on ? ' ✓' : ''}</button>`;
    }).join('');
    const allPlaced = v.placed && v.placed.every(Boolean);
    return `<div class="sb-chips" role="group" aria-label="Ships">${chips}</div>
      <div class="sb-controls">
        <button type="button" class="btn ghost" data-sb="rotate" ${myReady(v) ? 'disabled' : ''}>${ui.vert ? 'Down' : 'Across'} · Rotate</button>
        <button type="button" class="btn ghost" data-sb="random" ${myReady(v) ? 'disabled' : ''}>Random</button>
        <button type="button" class="btn ghost" data-sb="reset" ${myReady(v) || !(v.placed && v.placed.some(Boolean)) ? 'disabled' : ''}>Clear</button>
        <button type="button" class="btn" data-sb="ready" ${!myReady(v) && allPlaced ? '' : 'disabled'}>Ready</button></div>`;
  }

  function boardsHTML(v) {
    if (v.phase === 'placing') {
      if (v.me < 0) return seaHTML(v, 0, { interactive: false, title: 'Blue’s sea' }) + seaHTML(v, 1, { interactive: false, title: 'Red’s sea' });
      return placingHTML(v);
    }
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
    if (e.type === 'start') { snd.play('place'); return; }
    if (e.type === 'over') { snd.play('place'); setTimeout(() => snd.play(v.winner === v.me ? 'win' : v.me < 0 ? 'round' : 'lose'), 260); return; }
    if (e.type === 'sunk') { snd.play('land'); setTimeout(() => snd.play('round'), 180); return; }
    snd.play(e.type === 'hit' ? 'land' : 'place');
  }

  function render(root, v, ctx) {
    // a new server view replaces the working copy of the setup; local redraws keep it
    if (ui.setupFrom !== v) { ui.setupFrom = v; ui.setup = null; }
    // a selection belongs to one table, one turn, and a square that is still open
    // the selection, the phone tab and the placement belong to one table: a new table starts clean
    const tableKey = ctx && ctx.room ? ctx.room.code : '';
    if (ui.table !== tableKey) { ui.sel = null; ui.tab = 'attack'; ui.pick = null; ui.vert = false; ui.table = tableKey; }
    const me = v.me < 0 ? 0 : v.me;
    if (ui.sel !== null && (!v.myTurn || v.shots[1 - me][ui.sel])) ui.sel = null;
    // a placed or picked ship that is no longer in the setup (after Clear or a redraw) is put down
    if (ui.pick !== null && v.phase !== 'placing') ui.pick = null;
    ui.root = root; ui.ctx = ctx; ui.v = v; react(v);
    const active = root.ownerDocument.activeElement;
    const focus = root.contains(active) && active.dataset.sb ? { sb: active.dataset.sb, k: active.dataset.k, slot: active.dataset.slot } : null;
    const placing = v.phase === 'placing';
    root.innerHTML = `<div class="wz sb" data-game="seabattle" data-placing="${placing ? 1 : 0}" data-tab="${v.me < 0 ? 'both' : placing ? 'mine' : ui.tab}">
      <div class="wz-top"><div class="wz-round"><b>Sea Battle</b><span class="label"> · 10 × 10 seas</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-sb-act="rules">Rules</button>', 'sb')}</div>
      ${seatsHTML(v)}
      ${v.me >= 0 && !placing ? tabsHTML() : ''}
      <div class="sb-boards">${boardsHTML(v)}</div>
      ${v.me >= 0 && placing ? placeControlsHTML(v) : ''}
      ${v.me >= 0 && !placing ? controlsHTML(v) : ''}
      <div class="wz-status ${v.myTurn || (placing && v.me >= 0 && !v.players[v.me].ready) ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    if (focus) {
      const sel = `[data-sb="${focus.sb}"]${focus.k !== undefined ? `[data-k="${focus.k}"]` : ''}${focus.slot !== undefined ? `[data-slot="${focus.slot}"]` : ''}`;
      const el = root.querySelector(sel);
      (el && !el.disabled ? el : root.querySelector('[data-sb]:enabled'))?.focus({ preventScroll: true });
    }
    root.onclick = onClick;
  }

  /** Places (or moves) the picked ship with its first square on k. The whole setup is sent, so the server checks it all. */
  function placeAt(k) {
    const v = ui.v, ctx = ui.ctx;
    if (!v || !ctx || ui.pick === null) return;
    const N = v.N, r = Math.floor(k / N), c = k % N;
    const p = { r, c, vertical: ui.vert };
    // the working copy includes ships sent since the last server view, so two quick placements both stay
    const base = ui.setup || v.setup || Array(v.lengths.length).fill(null);
    if (!canPlace({ ...v, setup: base }, ui.pick, p)) {
      ui.root.querySelector('.wz-status span').textContent = 'That ship would run off the sea or touch another ship. Try another square, or Rotate.';
      return;
    }
    const setup = base.map((q, i) => (i === ui.pick ? { r, c, vertical: ui.vert } : q));
    ui.setup = setup;
    ui.pick = null;
    ctx.act({ type: 'place', ships: setup });
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
      case 'pick': {
        const slot = Number(el.dataset.slot);
        if (ui.pick === slot) { ui.pick = null; break; }
        ui.pick = slot;
        // a placed ship keeps its direction when it is picked up
        const q = v && v.setup && v.setup[slot];
        if (q) ui.vert = q.vertical;
        break;
      }
      case 'rotate': ui.vert = !ui.vert; break;
      case 'cell': {
        const k = Number(el.dataset.k);
        const N = v.N;
        if (ui.pick === null) {
          // tap a placed ship to pick it up
          const slot = (v.setup || []).findIndex((q, i) => q && cellsOf(v.lengths[i], q, N).includes(k));
          if (slot >= 0) { ui.pick = slot; ui.vert = v.setup[slot].vertical; }
          else { ui.root.querySelector('.wz-status span').textContent = 'Pick a ship first, then tap where it goes'; return; }
          break;
        }
        placeAt(k);
        return;
      }
      case 'random': ctx.act({ type: 'random' }); ui.pick = null; return;
      case 'reset': ctx.act({ type: 'place', ships: Array(v.lengths.length).fill(null) }); ui.pick = null; return;
      case 'ready': ctx.act({ type: 'ready' }); return;
      default: return;
    }
    if (ui.root && ui.v) render(ui.root, ui.v, ctx);
  }

  window.CardTable.register('seabattle', { render });
})();
