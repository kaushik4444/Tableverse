/* Carrom (games/carrom): the board as SVG, aiming by dragging on the board (with sliders for fine control), playing back each
 * shot from its keyframes, and the end of the game. Styles in carrom.css.
 *
 * Frames: the server keeps the board in the bottom side's frame. A viewer sees their own side at the bottom, so every point is
 * rotated for the viewer's side on the way to the screen (toSvg). A shot is aimed in the viewer's own frame (display), where
 * forward is up the screen and the striker sits at (u, BASE_Y). The engine rotates that shot into the bottom frame itself. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const BASE_Y = 0.12;     // a side's baseline in the bottom frame
  const MAX_DRAG = 0.45;   // a drag of this length on the board is a full-power flick
  const ANGLE_MAX = 75;
  const ui = { ctx: null, v: null, root: null, seq: null, anim: null, known: new Map(), dragging: false, resignArmed: false,
    aim: { x: 50, angle: 0, power: 60 } };

  /** Rotates a point about the centre by k quarter turns, counter-clockwise (the same rotation the server uses). */
  const rotP = ([x, y], k) => { let p = [x, y]; for (let i = 0; i < ((k % 4) + 4) % 4; i++) p = [1 - p[1], p[0]]; return p; };
  const viewSide = (v) => (v.me < 0 ? 0 : v.mySide || 0);
  /** A bottom-frame point to SVG coordinates for this viewer. */
  const toSvg = (v, p) => { const [X, Y] = rotP(p, (4 - viewSide(v)) % 4); return [X, 1 - Y]; };
  /** The display frame (the viewer's own bottom) to SVG coordinates, and back. */
  const dispToSvg = ([X, Y]) => [X, 1 - Y];
  const svgToDisp = (X, Y) => [X, 1 - Y];

  const colourLabel = (c) => (c === 'w' ? 'White' : 'Black');
  const seatOf = (v, seat) => v.players[seat];

  function remember(v) {
    for (const d of v.board) ui.known.set(d.id, { kind: d.kind, colour: d.colour, r: d.r });
    if (v.shot) ui.known.set('striker', { kind: 'striker', colour: v.shot.colour, r: 0.026 });
  }

  function discHTML(v, d) {
    const [X, Y] = toSvg(v, [d.x, d.y]);
    const cls = d.kind === 'queen' ? 'cb-queen' : d.kind === 'striker' ? `cb-striker ${d.colour === 'w' ? 'w' : 'b'}` : `cb-coin ${d.colour === 'w' ? 'w' : 'b'}`;
    return `<circle class="${cls}" data-id="${esc(d.id)}" cx="${X}" cy="${Y}" r="${d.r}"/>`;
  }

  function discsFor(frame) {
    if (!frame) return null;
    return frame.d.map(([id, x, y]) => {
      const k = ui.known.get(id) || { kind: 'coin', colour: 'w', r: 0.022 };
      return { id, kind: k.kind, colour: k.colour, x, y, r: k.r };
    });
  }

  function teamScore(v, seat) {
    const colour = v.colours[seat];
    return v.score[colour];
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return esc(endText(v));
    if (ui.anim) return 'Shot in play…';
    const turnName = esc(v.players[v.turn].name);
    if (v.me < 0) return `Watching: ${turnName} to play`;
    if (!v.myTurn) return `${turnName} is aiming…`;
    return 'Your turn: set the striker, then drag on the board to flick';
  }

  function endText(v) {
    if (v.draw) return 'A draw: the table was not finished in time';
    if (v.reason === 'resignation') return v.winner === colourOfMe(v) ? 'Your team won: the other team resigned' : 'Your team resigned';
    const who = v.winnerNames ? esc(v.winnerNames) : 'A team';
    return v.winner === colourOfMe(v) ? `You pocketed all nine coins with the queen (${who})` : `${who} pocketed all nine coins with the queen`;
  }
  const colourOfMe = (v) => (v.me < 0 ? null : v.colours[v.me]);

  function seatsHTML(v) {
    return `<div class="cb-seats">${v.players.map((p, seat) => {
      const turn = v.phase === 'playing' && v.turn === seat;
      const won = v.phase === 'gameOver' && v.winner === p.colour;
      const mine = seat === v.me ? ' (you)' : '';
      return `<div class="cb-seat ${turn ? 'turn' : ''} ${won ? 'won' : ''}">
        <span class="cb-colour ${p.colour}" aria-hidden="true"></span>
        <span class="cb-who"><b>${esc(p.name)}${mine}</b><small>${colourLabel(p.colour)} · ${teamScore(v, seat)} of 9${v.queenHeld === p.colour ? ' · queen' : ''}</small></span></div>`;
    }).join('')}</div>`;
  }

  /** The aim arrow in display coordinates: from the striker in the direction of the flick, as long as the power. */
  function aimPoints() {
    const { x, angle, power } = ui.aim;
    const u = x / 100, a = (angle * Math.PI) / 180, len = (power / 100) * 0.35;
    const from = dispToSvg([u, BASE_Y]);
    const to = dispToSvg([u + len * Math.sin(a), BASE_Y + len * Math.cos(a)]);
    return { from, to };
  }

  function aimHTML() {
    const { from, to } = aimPoints();
    return `<line class="cb-aim" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"/>`;
  }

  /** The board. Shows the discs (from the view, or the current frame of a shot) and, on your turn, the striker and aim. */
  function boardHTML(v, frame) {
    const discs = discsFor(frame) || v.board;
    const aiming = !frame && v.myTurn && !ui.anim;
    // the baselines of all four sides, each seen from this viewer's side
    const lines = [0, 1, 2, 3].map((j) => {
      const [x1, y1] = toSvg(v, rotP([0.2, BASE_Y], j));
      const [x2, y2] = toSvg(v, rotP([0.8, BASE_Y], j));
      return `<line class="cb-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }).join('');
    const [sx, sy] = dispToSvg([ui.aim.x / 100, BASE_Y]);
    const striker = aiming ? `<circle class="cb-striker ${colourOfMe(v) === 'w' ? 'w' : 'b'}" data-id="striker" cx="${sx}" cy="${sy}" r="0.026"/>` : '';
    const pockets = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => `<circle class="cb-pocket" cx="${x}" cy="${y}" r="0.05"/>`).join('');
    return `<svg class="cb-svg" viewBox="-0.07 -0.07 1.14 1.14" role="img" aria-label="Carrom board">
      <rect class="cb-board" x="0" y="0" width="1" height="1" rx="0.02"/>
      <rect class="cb-inner" x="0.06" y="0.06" width="0.88" height="0.88"/>
      ${lines}
      <circle class="cb-centre" cx="0.5" cy="0.5" r="0.09"/>
      ${pockets}
      ${discs.map((d) => discHTML(v, d)).join('')}
      ${striker}
      ${aiming ? aimHTML() : ''}
    </svg>`;
  }

  function controlsHTML(v) {
    if (!v.myTurn || ui.anim) return '';
    const { x, angle, power } = ui.aim;
    return `<div class="cb-controls">
      <label>Striker <output data-out="x">${x}%</output>
        <input type="range" data-aim="x" min="20" max="80" step="1" value="${x}" aria-label="Striker position along your baseline"></label>
      <label>Angle <output data-out="angle">${angle}°</output>
        <input type="range" data-aim="angle" min="-${ANGLE_MAX}" max="${ANGLE_MAX}" step="1" value="${angle}" aria-label="Aim angle"></label>
      <label>Power <output data-out="power">${power}%</output>
        <input type="range" data-aim="power" min="0" max="100" step="1" value="${power}" aria-label="Flick power"></label>
      <button type="button" class="btn cb-flick" data-cb="flick" ${power > 0 ? '' : 'disabled'}>Flick</button>
    </div>
    <p class="hint cb-tip">${power > 0 ? 'Drag on the board, back from the striker, to change the aim and power.' : 'Drag back from the striker on the board to set the power.'}</p>`;
  }

  function logHTML(v) {
    if (!v.log.length) return '<p class="hint">No shots yet.</p>';
    return `<ol class="cb-log">${v.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const title = v.draw ? 'A draw' : v.winner === colourOfMe(v) ? 'You won! 🎉' : `${v.winnerNames ? esc(v.winnerNames) : 'A team'} won`;
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${endText(v)}.</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-cb="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-cb="leave">Leave table</button></div>
    </div></div>`;
  }

  function react(v) {
    const e = v.shot, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    ui.anim = { seq: e.seq, frames: e.keyframes, t0: null, end: e.keyframes.length ? e.keyframes[e.keyframes.length - 1].t : 0 };
    if (snd) snd.play('place');
    if (v.phase === 'gameOver' && snd) {
      const mine = colourOfMe(v);
      const sound = v.draw ? 'round' : v.winner === mine ? 'win' : mine === null ? 'round' : 'lose';
      setTimeout(() => snd.play(sound), 900);
    }
    requestAnimationFrame(tick);
  }

  /** Plays the shot's keyframes on the board, then redraws from the final view. */
  function tick(now) {
    const a = ui.anim;
    if (!a || !ui.root || !ui.v || ui.v.shot?.seq !== a.seq) { ui.anim = null; return; }
    if (a.t0 === null) a.t0 = now;
    const t = (now - a.t0) / 1000;
    let frame = a.frames[0];
    for (const f of a.frames) if (f.t <= t) frame = f;
    const svg = ui.root.querySelector('.cb-svg');
    if (svg) {
      const seen = new Set(frame.d.map(([id]) => id));
      for (const [id, x, y] of frame.d) {
        const el = svg.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (el) {
          const [X, Y] = toSvg(ui.v, [x, y]);
          el.setAttribute('cx', X); el.setAttribute('cy', Y); el.style.display = '';
        }
      }
      svg.querySelectorAll('[data-id]').forEach((el) => { if (!seen.has(el.dataset.id)) el.style.display = 'none'; });
    }
    if (t >= a.end + 0.25 || t > 25) { ui.anim = null; render(ui.root, ui.v, ui.ctx); return; }
    requestAnimationFrame(tick);
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.root = root; ui.v = v;
    remember(v);
    react(v);
    const playing = v.phase === 'playing' && v.me >= 0;
    const frame = ui.anim ? ui.anim.frames[0] : null;
    root.innerHTML = `<div class="wz carrom-game" data-game="carrom">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.shots} shots</span></div>
        ${CardTable.toolbarSeed(`<button class="btn ghost small" data-cb="rules">Rules</button>${playing ? `<button class="btn ghost small" data-cb="resign">${ui.resignArmed ? 'Tap again to resign' : 'Resign'}</button>` : ''}`, 'carrom')}</div>
      ${seatsHTML(v)}
      <div class="cb-board-wrap">${boardHTML(v, frame)}</div>
      ${controlsHTML(v)}
      <div class="wz-status ${v.myTurn && !ui.anim ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <details class="cb-moves" open><summary>Shots</summary>${logHTML(v)}</details>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    root.oninput = onInput;
    root.onpointerdown = onPointerDown;
    root.onpointermove = onPointerMove;
    root.onpointerup = endDrag;
    root.onpointercancel = endDrag;
  }

  // ---- aiming ----

  /** The pointer, in display coordinates (the viewer's own bottom), from a pointer event on the board. */
  function pointerDisplay(e) {
    const svg = e.target.closest('.cb-svg');
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return svgToDisp(q.x, q.y);
  }

  /** Sets the aim from a pointer: the flick goes from the pointer towards the striker (pull back, let go). */
  function aimFrom([X, Y]) {
    const u = ui.aim.x / 100;
    const dx = u - X, dy = BASE_Y - Y;
    const len = Math.hypot(dx, dy);
    ui.aim.power = dy <= 0.01 ? 0 : Math.round(Math.min(1, len / MAX_DRAG) * 100);
    ui.aim.angle = Math.round(Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, (Math.atan2(dx, dy) * 180) / Math.PI)));
    syncAim();
  }

  /** Updates the sliders, readouts, arrow and Flick button without rebuilding the board. */
  function syncAim() {
    const root = ui.root;
    if (!root) return;
    for (const key of ['x', 'angle', 'power']) {
      const input = root.querySelector(`[data-aim="${key}"]`);
      if (input) input.value = String(ui.aim[key]);
      const out = root.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = key === 'angle' ? `${ui.aim.angle}°` : key === 'power' ? `${ui.aim.power}%` : `${ui.aim.x}%`;
    }
    const svg = root.querySelector('.cb-svg');
    const line = svg && svg.querySelector('.cb-aim');
    if (line) {
      const { from, to } = aimPoints();
      line.setAttribute('x1', from[0]); line.setAttribute('y1', from[1]);
      line.setAttribute('x2', to[0]); line.setAttribute('y2', to[1]);
    }
    const striker = svg && svg.querySelector('[data-id="striker"]');
    if (striker) { const [sx, sy] = dispToSvg([ui.aim.x / 100, BASE_Y]); striker.setAttribute('cx', sx); striker.setAttribute('cy', sy); }
    const fire = root.querySelector('[data-cb="flick"]');
    if (fire) fire.disabled = ui.aim.power <= 0;
    const tip = root.querySelector('.cb-tip');
    if (tip) tip.textContent = ui.aim.power > 0 ? 'Drag on the board, back from the striker, to change the aim and power.' : 'Drag back from the striker on the board to set the power.';
  }

  function onPointerDown(e) {
    const v = ui.v;
    if (!v || !v.myTurn || ui.anim || !e.target.closest('.cb-svg')) return;
    ui.dragging = true;
    const svg = e.target.closest('.cb-svg');
    if (svg.setPointerCapture) svg.setPointerCapture(e.pointerId);
    const p = pointerDisplay(e);
    if (p) aimFrom(p);
  }

  function onPointerMove(e) {
    if (!ui.dragging) return;
    const p = pointerDisplay(e);
    if (p) aimFrom(p);
  }

  function endDrag() { ui.dragging = false; }

  function onInput(e) {
    const el = e.target.closest('[data-aim]');
    if (!el || !ui.v) return;
    const key = el.dataset.aim;
    ui.aim[key] = Number(el.value);
    syncAim();
  }

  function onClick(e) {
    const el = e.target.closest('[data-cb]');
    const v = ui.v, ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    switch (el.dataset.cb) {
      case 'flick':
        if (!v.myTurn || ui.anim || ui.aim.power <= 0) return;
        ctx.act({ type: 'flick', x: ui.aim.x / 100, angle: (ui.aim.angle * Math.PI) / 180, power: ui.aim.power / 100 });
        break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
      case 'resign':
        if (!ui.resignArmed) { ui.resignArmed = true; ctx.rerender(); break; }
        ui.resignArmed = false; ctx.act({ type: 'resign' }); break;
    }
  }

  window.CardTable.register('carrom', { render });
})();
