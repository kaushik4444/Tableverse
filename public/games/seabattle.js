/* Sea Battle. Placing: the fleet starts placed at random. Tap a ship to select it, then tap a square or drag it to move it;
 * Rotate turns the selected ship, Random places the fleet again, Ready when all five are on the sea. Then two boards: Attack shows the other player's sea and your shots; My fleet shows your ships (drawn as hulls)
 * and their shots. On a phone you switch between them; on a wide screen both show. Tap a square to fire: a bomb falls on it,
 * a hit bursts and a miss shows an X. Drag a placed ship to move it. Watchers see both seas' shots. Styles in seabattle.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { root: null, ctx: null, v: null, seq: null, tab: 'attack', table: null, pick: null, vert: false, drag: null, fx: undefined, freshNow: null };
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
      if (ui.pick !== null) return `${NAMES[ui.pick]} selected (${v.lengths[ui.pick]} squares, ${ui.vert ? 'down' : 'across'}): tap a square or drag it to move it, or Rotate to turn it`;
      return 'Tap a ship to select it, then tap a square or drag it to move it. Rotate turns it, Random places the fleet again';
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is aiming`;
    if (!v.myTurn) return `${esc(v.players[1 - v.me].name)} is aiming…`;
    return 'Your shot: tap a square on their sea to fire';
  }

  function seatsHTML(v) {
    return `<div class="sb-seats">${v.players.map((p, i) => `<div class="sb-seat s${i} ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${v.phase === 'gameOver' && v.winner === i ? 'won' : ''}">
      <span class="sb-swatch" aria-hidden="true"></span><span class="sb-who"><b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b>
      <small>${SEAT_NAMES[i]} · ${v.phase === 'placing' ? (p.ready ? 'ready' : 'placing') : `sunk <span class="sb-sunk">${p.sunk}</span> · ${p.left} left`}</small></span></div>`).join('')}</div>`;
  }

  /** The class that makes a new shot animate: a bomb falls on the square, once, when the shot first arrives. */
  function freshCls(v, target, k) {
    const e = ui.freshNow;
    return e && e.k === k && e.by === 1 - target && ['hit', 'miss', 'sunk'].includes(e.type) ? ' fresh' : '';
  }

  /** A sea with the shots fired at it. For a player's attack board the open squares are buttons on their turn. */
  function seaHTML(v, target, { interactive, title }) {
    const sea = v.shots[target];
    const cells = [];
    for (let k = 0; k < v.N * v.N; k++) {
      const st = sea[k];
      const label = `${square(k, v.N)}, ${st || 'not fired at'}`;
      if (st || !interactive) {
        cells.push(`<span class="sb-cell ${st || 'open'}${freshCls(v, target, k)}" role="img" aria-label="${label}"></span>`);
      } else {
        cells.push(`<button type="button" class="sb-cell open" data-sb="sq" data-k="${k}" aria-label="${label}" ${v.myTurn ? '' : 'disabled'}></button>`);
      }
    }
    return `<div class="sb-board attack" role="group" aria-label="${title}"><div class="sb-grid" style="--n:${v.N}">${cells.join('')}</div></div>`;
  }

  /**
   * Top-down art for each ship, drawn bow to the right in units of one square (x along the ship, y across it).
   * A vertical ship reuses the same drawing, turned by a reflection matrix, so the art is written once.
   */
  const STEEL = { hull: '#8b98a8', deck: '#b7c2cf', edge: '#334155', gun: '#1e293b', glass: '#0f172a' };
  const turret = (x, y) => `<g class="gun"><circle cx="${x}" cy="${y - 0.14}" r="0.17" fill="${STEEL.gun}"/><circle cx="${x}" cy="${y + 0.14}" r="0.17" fill="${STEEL.gun}"/><rect x="${x}" y="${y - 0.2}" width="0.5" height="0.07" fill="${STEEL.gun}"/><rect x="${x}" y="${y + 0.13}" width="0.5" height="0.07" fill="${STEEL.gun}"/></g>`;
  const single = (x, y) => `<g class="gun"><circle cx="${x}" cy="${y}" r="0.2" fill="${STEEL.gun}"/><rect x="${x}" y="${y - 0.04}" width="0.45" height="0.08" fill="${STEEL.gun}"/></g>`;
  const jet = (x) => `<path class="jet" d="M${x + 0.36} 0.5 L${x + 0.05} 0.44 L${x - 0.24} 0.1 L${x - 0.14} 0.1 L${x - 0.04} 0.42 L${x - 0.36} 0.42 L${x - 0.36} 0.58 L${x - 0.04} 0.58 L${x - 0.14} 0.9 L${x - 0.24} 0.9 L${x + 0.05} 0.56 Z" fill="#e2e8f0" stroke="${STEEL.edge}" stroke-width="0.03" stroke-linejoin="round"/>`;
  const SHIP_ART = {
    Carrier: (L) => `<path d="M0.1 0.2 L${L - 0.5} 0.16 L${L} 0.5 L${L - 0.5} 0.84 L0.1 0.8 Q0 0.5 0.1 0.2 Z" fill="${STEEL.hull}" stroke="${STEEL.edge}" stroke-width="0.04"/>
      <path d="M0.3 0.3 L${L - 0.6} 0.28 L${L - 0.6} 0.72 L0.3 0.7 Z" fill="${STEEL.deck}"/>
      <path d="M0.4 0.5 H${L - 0.8}" stroke="#fde68a" stroke-width="0.03" stroke-dasharray="0.18 0.14" opacity=".8"/>
      ${jet(1.1)}${jet(2.2)}${jet(3.3)}
      <rect class="island" x="${L - 1.3}" y="0.6" width="0.55" height="0.2" rx="0.04" fill="${STEEL.edge}"/>`,
    Battleship: (L) => `<path d="M0.1 0.22 L${L - 0.45} 0.2 L${L} 0.5 L${L - 0.45} 0.8 L0.1 0.78 Q0 0.5 0.1 0.22 Z" fill="${STEEL.hull}" stroke="${STEEL.edge}" stroke-width="0.04"/>
      <rect x="1.45" y="0.4" width="0.7" height="0.2" rx="0.05" fill="${STEEL.deck}"/>
      ${turret(0.6, 0.5)}${turret(L - 1.05, 0.5)}`,
    Cruiser: (L) => `<path d="M0.1 0.24 L${L - 0.4} 0.22 L${L} 0.5 L${L - 0.4} 0.78 L0.1 0.76 Q0 0.5 0.1 0.24 Z" fill="${STEEL.hull}" stroke="${STEEL.edge}" stroke-width="0.04"/>
      <rect x="1.0" y="0.42" width="0.6" height="0.16" rx="0.04" fill="${STEEL.deck}"/>
      ${single(0.55, 0.5)}${turret(L - 0.95, 0.5)}`,
    Submarine: (L) => `<path d="M0.15 0.34 L${L - 0.35} 0.34 Q${L} 0.5 ${L - 0.35} 0.66 L0.15 0.66 Q0 0.5 0.15 0.34 Z" fill="${STEEL.hull}" stroke="${STEEL.edge}" stroke-width="0.04"/>
      <rect x="1.0" y="0.4" width="0.55" height="0.2" rx="0.1" fill="${STEEL.deck}" stroke="${STEEL.edge}" stroke-width="0.03"/>
      <path d="M1.3 0.4 V0.18 M1.42 0.4 V0.2" stroke="${STEEL.edge}" stroke-width="0.05"/>`,
    Destroyer: (L) => `<path d="M0.1 0.3 L${L - 0.35} 0.28 L${L} 0.5 L${L - 0.35} 0.72 L0.1 0.7 Q0 0.5 0.1 0.3 Z" fill="${STEEL.hull}" stroke="${STEEL.edge}" stroke-width="0.04"/>
      <rect x="0.45" y="0.42" width="0.4" height="0.16" rx="0.04" fill="${STEEL.deck}"/>
      ${single(L - 0.75, 0.5)}`,
  };
  /** The hull markup for one ship: positioned on the grid, drawn as its top-down art. */
  function hullHTML({ name, len, vertical, pos, cls = '', slot }) {
    const art = (SHIP_ART[name] || SHIP_ART.Destroyer)(len);
    const view = vertical ? `0 0 1 ${len}` : `0 0 ${len} 1`;
    const turn = vertical ? ` transform="matrix(0 -1 -1 0 1 ${len})"` : '';
    const slotAttr = slot !== undefined ? ` data-slot="${slot}"` : '';
    return `<div class="sb-hull${cls}${vertical ? ' v' : ''}" style="${pos}" aria-hidden="true" data-ship="${esc(name)}"${slotAttr}><svg viewBox="${view}" preserveAspectRatio="none"><g${turn}>${art}</g></svg></div>`;
  }

  /** A ship drawn as one hull across its squares. Positioned on the grid's own tracks, above the water. */
  function hullsHTML(v, ships) {
    return ships.map((s, i) => {
      const first = s.cells[0], len = s.cells.length, vertical = len > 1 && s.cells[1] - first === v.N;
      const r = Math.floor(first / v.N) + 1, c = (first % v.N) + 1;
      const pos = vertical ? `grid-row:${r} / span ${len};grid-column:${c}` : `grid-row:${r};grid-column:${c} / span ${len}`;
      return hullHTML({ name: NAMES[i], len, vertical, pos, cls: s.sunk ? ' sunk' : '' });
    }).join('');
  }

  /** My fleet: my ships (drawn as hulls, hit or not) and the shots the other player has taken at my sea. */
  function fleetHTML(v) {
    const N = v.N;
    const cells = v.fleet.map((st, k) => `<span class="sb-cell ${st || 'water'}${freshCls(v, v.me, k)}" style="grid-row:${Math.floor(k / N) + 1};grid-column:${(k % N) + 1}" role="img" aria-label="${square(k, N)}, ${st || 'water'}"></span>`).join('');
    const hulls = v.ships ? hullsHTML(v, v.ships) : '';
    return `<div class="sb-board mine" role="group" aria-label="Your fleet"><div class="sb-grid" style="--n:${N}">${cells}${hulls}</div></div>`;
  }

  /** While placing: my sea, every square a button; the placed ships as hulls; the picked ship is shown dashed. */
  function placingHTML(v) {
    const N = v.N;
    const placed = [];
    // the working setup (a Rotate or a move not yet confirmed by the server) is what the sea shows
    (ui.setup || v.setup || []).forEach((p, i) => { if (p) placed.push({ slot: i, cells: cellsOf(v.lengths[i], p, N) }); });
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
      return hullHTML({ name: NAMES[s.slot], len, vertical, pos, cls: ui.pick === s.slot ? ' picked' : '', slot: s.slot });
    }).join('');
    return `<div class="sb-board mine" role="group" aria-label="Your sea: place your ships"><div class="sb-grid placing" style="--n:${N}">${cells.join('')}${hulls}</div></div>`;
  }
  const p2v = (cells, N) => cells.length > 1 && cells[1] - cells[0] === N;
  /** Whether I have pressed Ready (watchers never have). */
  const myReady = (v) => v.me >= 0 && !!v.players[v.me].ready;

  /** The placement buttons: Rotate turns the selected ship, Random places the fleet again, Ready starts the battle. */
  function placeControlsHTML(v) {
    const allPlaced = v.placed && v.placed.every(Boolean);
    return `<div class="sb-controls">
        <button type="button" class="btn ghost" data-sb="rotate" ${myReady(v) ? 'disabled' : ''}>${ui.vert ? 'Down' : 'Across'} · Rotate</button>
        <button type="button" class="btn ghost" data-sb="random" ${myReady(v) ? 'disabled' : ''}>Random</button>
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

  /** A splash for a miss, a boom for a hit, a sinking sound and a chime for a sunk ship. The first look plays nothing. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'start') { snd.play('place'); return; }
    if (e.type === 'over') { snd.play('place'); setTimeout(() => snd.play(v.winner === v.me ? 'win' : v.me < 0 ? 'round' : 'lose'), 260); return; }
    if (e.type === 'sunk') { snd.play('sink'); setTimeout(() => snd.play('round'), 420); return; }
    snd.play(e.type === 'hit' ? 'boom' : 'splash');
  }

  function render(root, v, ctx) {
    // a new server view replaces the working copy of the setup; local redraws keep it
    if (ui.setupFrom !== v) { ui.setupFrom = v; ui.setup = null; }
    // a selection belongs to one table, one turn, and a square that is still open
    // the selection, the phone tab and the placement belong to one table: a new table starts clean
    const tableKey = ctx && ctx.room ? ctx.room.code : '';
    if (ui.table !== tableKey) { ui.tab = 'attack'; ui.pick = null; ui.vert = false; ui.drag = null; ui.table = tableKey; }
    // a shot animates once: the first render that sees its event; the first render of a table does not replay the last shot
    const ev = v.event && v.event.seq !== undefined ? v.event : null;
    if (ui.fx === undefined) ui.fx = ev ? ev.seq : -1;
    ui.freshNow = ev && ev.seq !== ui.fx ? ev : null;
    if (ev) ui.fx = ev.seq;
    // a picked ship that is no longer in the setup (after a redraw) is put down
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
      <div class="wz-status ${v.myTurn || (placing && v.me >= 0 && !v.players[v.me].ready) ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${overlayHTML(v)}</div>`;
    if (focus) {
      const sel = `[data-sb="${focus.sb}"]${focus.k !== undefined ? `[data-k="${focus.k}"]` : ''}${focus.slot !== undefined ? `[data-slot="${focus.slot}"]` : ''}`;
      const el = root.querySelector(sel);
      (el && !el.disabled ? el : root.querySelector('[data-sb]:enabled'))?.focus({ preventScroll: true });
    }
    root.onclick = onClick;
    root.onpointerdown = onDown;
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

  /** The square under a pointer on the placing sea, or -1 when it is off the sea. */
  function gridK(grid, e, N) {
    const rect = grid.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return -1;
    const c = Math.min(N - 1, Math.floor(x / (rect.width / N)));
    const r = Math.min(N - 1, Math.floor(y / (rect.height / N)));
    return r * N + c;
  }

  /** Pressing a placed ship picks it up: it is then dragged, or tapped and the next square is where it goes. */
  function onDown(e) {
    const v = ui.v;
    const hull = e.target.closest && e.target.closest('.sb-grid.placing .sb-hull[data-slot]');
    if (!hull || !v || v.phase !== 'placing' || myReady(v) || e.button > 0 || ui.drag) return; // one drag at a time
    const N = v.N, slot = Number(hull.dataset.slot);
    const p = (ui.setup || v.setup || [])[slot];
    if (!p) return;
    const k = gridK(hull.closest('.sb-grid'), e, N);
    const j = cellsOf(v.lengths[slot], p, N).indexOf(k);
    // a press on a ship that is already picked up is the tap that says where it goes (see onUp)
    const pointerId = e.pointerId;
    ui.drag = { slot, j: Math.max(0, j), x: e.clientX, y: e.clientY, wasPicked: ui.pick === slot, pointerId };
    ui.pick = slot;
    ui.vert = p.vertical;
    render(ui.root, v, ui.ctx);
    // the release is listened for on the window: the re-render above replaces the pressed hull, so it cannot hold the pointer
    // only the pointer that pressed the ship can release or cancel it: another finger never places or cancels this drag
    const up = (ev) => { if (ev.pointerId !== pointerId) return; window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); onUp(ev); };
    const cancel = (ev) => { if (ev.pointerId !== pointerId) return; window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); ui.drag = null; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  /** Releasing a dragged ship puts it where the grabbed square is; a tap leaves it picked up for the next square. */
  function onUp(e) {
    const d = ui.drag;
    ui.drag = null;
    const v = ui.v, ctx = ui.ctx;
    if (!d || !v || !ctx) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) <= 6) {
      // a tap on a square covered by the picked ship: the ship goes there, as a tap on any other square would
      if (d.wasPicked) {
        const grid = ui.root.querySelector('.sb-grid.placing');
        const k = grid ? gridK(grid, e, v.N) : -1;
        if (k >= 0) placeAt(k);
      }
      return;
    }
    const grid = ui.root.querySelector('.sb-grid.placing');
    const k = grid ? gridK(grid, e, v.N) : -1;
    if (k < 0) return; // dropped off the sea: it stays picked up
    const N = v.N, vertical = ui.vert;
    const r = Math.floor(k / N) - (vertical ? d.j : 0), c = (k % N) - (vertical ? 0 : d.j);
    const base = ui.setup || v.setup || Array(v.lengths.length).fill(null);
    const p = { r, c, vertical };
    if (!canPlace({ ...v, setup: base }, d.slot, p)) {
      ui.root.querySelector('.wz-status span').textContent = 'That ship would run off the sea or touch another ship. Try another square, or Rotate.';
      return;
    }
    ui.setup = base.map((q, i) => (i === d.slot ? p : q));
    ui.pick = null;
    ctx.act({ type: 'place', ships: ui.setup });
  }

  function onClick(e) {
    const el = e.target.closest('[data-sb], [data-sb-act]');
    const ctx = ui.ctx, v = ui.v;
    if (!el || !ctx || el.disabled) return;
    if (ui.drag) return; // a ship is being dragged by another pointer: its clicks do not place anything
    if (el.dataset.sbAct) {
      if (el.dataset.sbAct === 'again') ctx.rematch();
      else if (el.dataset.sbAct === 'leave') ctx.leave();
      else if (el.dataset.sbAct === 'rules') ctx.showRules();
      return;
    }
    switch (el.dataset.sb) {
      case 'tab-attack': ui.tab = 'attack'; break;
      case 'tab-mine': ui.tab = 'mine'; break;
      case 'sq': {
        const k = Number(el.dataset.k);
        if (v && v.myTurn && !v.shots[1 - v.me][k]) ctx.act({ type: 'fire', r: Math.floor(k / v.N), c: k % v.N });
        return;
      }
      case 'rotate': {
        // the working setup, so a second Rotate before the next server view turns the ship back
        const base = ui.setup || (v && v.setup);
        const placed = ui.pick !== null && base && base[ui.pick];
        if (!placed) {
          ui.root.querySelector('.wz-status span').textContent = 'Tap a ship to select it, then Rotate it';
          return;
        }
        // a placed ship turns where it is: the new direction is sent if it fits, and the ship stays picked up to move
        const turned = { r: placed.r, c: placed.c, vertical: !placed.vertical };
        if (!canPlace({ ...v, setup: base }, ui.pick, turned)) {
          ui.root.querySelector('.wz-status span').textContent = 'No room to turn it here. Move it to a square with space, then Rotate.';
          return;
        }
        ui.vert = turned.vertical;
        ui.setup = base.map((q, i) => (i === ui.pick ? turned : q));
        render(ui.root, ui.v, ui.ctx); // show the turn now, before the server's view arrives
        ctx.act({ type: 'place', ships: ui.setup });
        return;
      }
      case 'cell': {
        const k = Number(el.dataset.k);
        const N = v.N;
        if (ui.pick === null) {
          // tap a placed ship to pick it up
          const working = ui.setup || v.setup || [];
          const slot = working.findIndex((q, i) => q && cellsOf(v.lengths[i], q, N).includes(k));
          if (slot >= 0) { ui.pick = slot; ui.vert = working[slot].vertical; }
          else { ui.root.querySelector('.wz-status span').textContent = 'Tap a ship to select it first, then tap a square'; return; }
          break;
        }
        placeAt(k);
        return;
      }
      case 'random': ctx.act({ type: 'random' }); ui.pick = null; return;
      case 'ready': ctx.act({ type: 'ready' }); return;
      default: return;
    }
    if (ui.root && ui.v) render(ui.root, ui.v, ctx);
  }

  window.CardTable.register('seabattle', { render });
})();
