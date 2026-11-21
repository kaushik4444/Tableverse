/* Carrom (games/carrom): the board as SVG, aiming by dragging on the board, playing back each
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
  const TAP_PX = 8;       // a pointer that moves less than this from where it went down is a tap, not a flick
  const ui = { ctx: null, v: null, root: null, seq: null, anim: null, known: new Map(), dragging: false, dragMoved: false, resignArmed: false,
    aim: { x: 50, angle: 0, power: 0 } }; // no aim until the player sets one

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

  /** The end of the table as plain text: callers escape it once when they put it into the page. */
  function endText(v) {
    if (v.draw) return 'A draw: the table was not finished in time';
    if (v.reason === 'resignation') {
      const me = colourOfMe(v);
      if (me === null) return `${colourLabel(v.winner)} won: ${colourLabel(v.winner === 'w' ? 'b' : 'w')} resigned`; // a spectator names the sides
      return v.winner === me ? 'Your team won: the other team resigned' : 'Your team resigned';
    }
    const who = v.winnerNames || 'A team';
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
    const striker = aiming ? `<circle class="cb-striker ${colourOfMe(v) === 'w' ? 'w' : 'b'}" data-id="striker" cx="${sx}" cy="${sy}" r="0.026" tabindex="0" role="slider" aria-label="Striker position along your baseline" aria-valuemin="20" aria-valuemax="80" aria-valuenow="${ui.aim.x}"/>` : '';
    const pockets = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => `<circle class="cb-pocket" cx="${x}" cy="${y}" r="0.05"/>`).join('');
    return `<svg class="cb-svg" viewBox="-0.08 -0.08 1.16 1.16" role="img" aria-label="Carrom board">
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
    return `<p class="hint cb-tip" aria-live="polite">${tipText()}</p>`;
  }

  /** What the player can do now, with the live aim and power (there are no sliders). */
  function tipText() {
    const { angle, power } = ui.aim;
    if (power <= 0) return 'Drag your striker along the baseline to place it (or use ← and → when it is focused). Then press on the board and drag back to set the aim and power.';
    return `Aim ${angle}° · power ${power}%. Let go to flick, or press Enter on the striker. Keyboard: ← → move, Shift+← → turn, ↑ ↓ power.`;
  }

  function logHTML(v) {
    if (!v.log.length) return '<p class="hint">No shots yet.</p>';
    return `<ol class="cb-log">${v.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  }

  function overlayHTML(v) {
    // shown once the last shot has finished playing (playback redraws the board when it ends)
    if (v.phase !== 'gameOver' || ui.anim) return '';
    const title = v.draw ? 'A draw' : v.winner === colourOfMe(v) ? 'You won! 🎉' : `${v.winnerNames ? esc(v.winnerNames) : 'A team'} won`;
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${esc(endText(v))}.</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-cb="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-cb="leave">Leave table</button></div>
    </div></div>`;
  }

  function react(v, ctx) {
    // playback belongs to one table: another table (or a fresh join) starts from its own state, never from this table's frames
    const tableKey = ctx && ctx.room ? ctx.room.code : '';
    if (ui.animTable !== tableKey) { ui.animTable = tableKey; ui.anim = null; ui.seq = null; }
    const e = v.shot, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e) { ui.anim = null; ui.seq = 0; return; } // a fresh match (Play again) has no shot yet: drop the old playback
    if (e.seq === ui.seq) return;
    ui.seq = e.seq;
    ui.anim = { seq: e.seq, frames: e.keyframes, t0: null, end: e.keyframes.length ? e.keyframes[e.keyframes.length - 1].t : 0 };
    if (snd) snd.play('place');
    if (v.phase === 'gameOver' && snd) {
      const mine = colourOfMe(v);
      const sound = v.draw ? 'round' : v.winner === mine ? 'win' : mine === null ? 'round' : 'lose';
      // the result sound belongs to this table: it is not played once the player has left it
      setTimeout(() => { if (ui.animTable === tableKey && ui.root && ui.root.isConnected) snd.play(sound); }, 900);
    }
    play(ui.anim);
  }

  /** Plays one shot's keyframes on the board, then redraws from the final view. Stops if a newer state has replaced it. */
  function play(a) {
    const step = (now) => {
      if (ui.anim !== a) return; // superseded by a newer shot or a fresh match, which has already redrawn
      if (!ui.root || !ui.v) { ui.anim = null; return; }
      if (ui.v.shot?.seq !== a.seq) { ui.anim = null; ui.ctx.rerender(); return; }
      drawFrame(now, a);
    };
    requestAnimationFrame(step);
  }

  /**
   * Where each disc is at time t of a shot. Keyframes come about 30 times a second, so the discs move between the two
   * keyframes either side of t (a straight line), not in steps. A disc that is gone by the next keyframe (pocketed) fades
   * out over the interval. Returns [[id, x, y, alpha]]: alpha is 0..1 and only falls for a disc that is leaving.
   */
  function poseAt(frames, t) {
    if (!frames.length) return [];
    let i = 0;
    while (i + 1 < frames.length && frames[i + 1].t <= t) i += 1;
    const f0 = frames[i]; const f1 = frames[i + 1];
    if (!f1) return f0.d.map(([id, x, y]) => [id, x, y, 1]);
    const span = f1.t - f0.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - f0.t) / span)) : 1;
    const next = new Map(f1.d.map(([id, x, y]) => [id, [x, y]]));
    const pose = f0.d.map(([id, x, y]) => {
      const n = next.get(id);
      return n ? [id, x + (n[0] - x) * k, y + (n[1] - y) * k, 1] : [id, x, y, 1 - k];
    });
    for (const [id, x, y] of f1.d) if (!f0.d.some(([other]) => other === id)) pose.push([id, x, y, k]); // a disc that comes into view
    return pose;
  }
  if (typeof window !== 'undefined') window.CarromPlayback = { poseAt }; // for the browser tests

  function drawFrame(now, a) {
    if (a.t0 === null) a.t0 = now;
    const t = (now - a.t0) / 1000;
    const pose = poseAt(a.frames, t);
    const svg = ui.root.querySelector('.cb-svg');
    if (svg) {
      const seen = new Set(pose.map(([id]) => id));
      for (const [id, x, y, alpha] of pose) {
        const el = svg.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (el) {
          const [X, Y] = toSvg(ui.v, [x, y]);
          el.setAttribute('cx', X); el.setAttribute('cy', Y); el.style.display = ''; el.style.opacity = String(alpha);
        }
      }
      svg.querySelectorAll('[data-id]').forEach((el) => { if (!seen.has(el.dataset.id)) el.style.display = 'none'; });
    }
    // the app redraws the table (with its turn timer and toolbar) from the current state
    if (t >= a.end + 0.25 || t > 25) { ui.anim = null; ui.ctx.rerender(); return; }
    requestAnimationFrame((next) => { if (ui.anim === a) drawFrame(next, a); });
  }

  /** Identifies the board a drag was started on: the table, the phase, the shot count and whose turn it is. */
  const boardKeyOf = (v, ctx) => `${ctx && ctx.room ? ctx.room.code : ''}|${v.phase}|${v.shots}|${v.turn}`;

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.root = root; ui.v = v;
    // a drag survives a redraw that leaves its board as it was: the redraw waits for the pointer to let go. Any other change cancels it.
    if (ui.dragging && ui.dragKey === boardKeyOf(v, ctx)) { ui.deferred = { root, v, ctx }; return; }
    ui.dragging = false; ui.dragMoved = false; ui.dragKey = null; ui.deferred = null;
    remember(v);
    react(v, ctx);
    const playing = v.phase === 'playing' && v.me >= 0;
    // a resignation confirmation belongs to one match at one table: a new shot, a finished game or another table clears it
    if (ui.resignArmed && ui.armKey !== armKeyOf(v, ctx)) ui.resignArmed = false;
    const frame = ui.anim ? ui.anim.frames[0] : null;
    root.innerHTML = `<div class="wz carrom-game" data-game="carrom">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.shots} shots</span></div>
        ${CardTable.toolbarSeed(`<button class="btn ghost small" data-cb="rules">Rules</button>${playing ? `<button class="btn ghost small" data-cb="resign">${ui.resignArmed ? 'Tap again to resign' : 'Resign'}</button>` : ''}`, 'cb')}</div>
      ${seatsHTML(v)}
      <div class="cb-board-wrap">${boardHTML(v, frame)}</div>
      ${controlsHTML(v)}
      <div class="wz-status ${v.myTurn && !ui.anim ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <details class="cb-moves" open><summary>Shots</summary>${logHTML(v)}</details>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    root.onkeydown = onKey;
    root.onpointerdown = onPointerDown;
    root.onpointermove = onPointerMove;
    root.onpointerup = onPointerUp;
    root.onpointercancel = onPointerCancel;
    root.onlostpointercapture = onPointerCancel;
  }

  function armKeyOf(v, ctx) { return `${ctx.room ? ctx.room.code : ''}|${v.phase}|${v.shots}`; }

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

  /** The striker is grabbed within this distance of its spot on the board (display units). */
  const STRIKER_GRAB = 0.06;

  /** Sets the aim from a pointer: the flick goes from the pointer towards the striker (pull back, let go). */
  function aimFrom([X, Y]) {
    const u = ui.aim.x / 100;
    const dx = u - X, dy = BASE_Y - Y;
    const len = Math.hypot(dx, dy);
    ui.aim.power = dy <= 0.01 ? 0 : Math.round(Math.min(1, len / MAX_DRAG) * 100);
    ui.aim.angle = Math.round(Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, (Math.atan2(dx, dy) * 180) / Math.PI)));
    syncAim();
  }

  /** Updates the arrow and tip text without rebuilding the board. */
  function syncAim() {
    const root = ui.root;
    if (!root) return;
    const svg = root.querySelector('.cb-svg');
    const line = svg && svg.querySelector('.cb-aim');
    if (line) {
      const { from, to } = aimPoints();
      line.setAttribute('x1', from[0]); line.setAttribute('y1', from[1]);
      line.setAttribute('x2', to[0]); line.setAttribute('y2', to[1]);
    }
    const striker = svg && svg.querySelector('[data-id="striker"]');
    if (striker) { const [sx, sy] = dispToSvg([ui.aim.x / 100, BASE_Y]); striker.setAttribute('cx', sx); striker.setAttribute('cy', sy); striker.setAttribute('aria-valuenow', String(ui.aim.x)); }
    const tip = root.querySelector('.cb-tip');
    if (tip) tip.textContent = tipText();
  }

  function onPointerDown(e) {
    const v = ui.v;
    if (!v || !v.myTurn || ui.anim || !e.target.closest('.cb-svg')) return;
    if (e.button !== 0) return; // a middle or right button does not flick
    if (ui.dragging) return; // a second finger does not take over the drag
    ui.dragging = true;
    ui.pointerId = e.pointerId;
    ui.dragMoved = false;
    ui.dragKey = boardKeyOf(v, ui.ctx);
    ui.downAt = [e.clientX, e.clientY];
    const svg = e.target.closest('.cb-svg');
    if (svg.setPointerCapture) svg.setPointerCapture(e.pointerId);
    const p = pointerDisplay(e);
    ui.mode = p && onStriker(p) ? 'place' : 'aim';
    if (ui.mode === 'aim' && p) aimFrom(p);
  }

  /** The striker is grabbed when the pointer is on it (display coordinates). */
  function onStriker([X, Y]) {
    return Math.hypot(X - ui.aim.x / 100, Y - BASE_Y) <= STRIKER_GRAB;
  }

  /** Moves the striker along the baseline. A new spot needs a new aim, so the aim is cleared when it moves. */
  function placeAt(x) {
    const next = Math.round(Math.max(20, Math.min(80, x * 100)));
    if (next === ui.aim.x) return;
    ui.aim.x = next; ui.aim.angle = 0; ui.aim.power = 0;
    syncAim();
  }

  function onPointerMove(e) {
    if (!ui.dragging || e.pointerId !== ui.pointerId) return;
    // a drag counts once the pointer is TAP_PX away from where it went down: a tap, or a pixel of jitter, only aims
    if (!ui.dragMoved && Math.hypot(e.clientX - ui.downAt[0], e.clientY - ui.downAt[1]) > TAP_PX) ui.dragMoved = true;
    const p = pointerDisplay(e);
    if (!p) return;
    if (ui.mode === 'place') placeAt(p[0]); else aimFrom(p);
  }

  /** Releasing an aim drag flicks with the aim it ends on. Placing the striker never flicks. A tap only sets the aim, and a cancelled pointer never flicks. */
  function onPointerUp(e) {
    if (!ui.dragging || e.pointerId !== ui.pointerId) return;
    const moved = ui.dragMoved;
    ui.dragging = false;
    if (moved && ui.mode === 'aim') {
      const p = pointerDisplay(e);
      if (p) aimFrom(p);
      fire();
    }
    flushDeferred();
  }

  /** Applies the redraw that waited for a drag. */
  function flushDeferred() {
    const d = ui.deferred;
    // the host renderer sets up the toolbar, voice, settings and timer after every redraw
    if (d) { ui.deferred = null; d.ctx.rerender(); }
  }

  /** A cancelled pointer, or one that lost its capture, ends its drag without a flick. Other pointers are ignored. */
  function onPointerCancel(e) {
    if (!ui.dragging || (e && e.pointerId !== ui.pointerId)) return;
    ui.dragging = false; ui.dragMoved = false;
    flushDeferred();
  }

  /** Sends the current aim as a flick, if it is my turn, nothing is playing and the power is set. */
  function fire() {
    const v = ui.v, ctx = ui.ctx;
    if (!v || !ctx || !v.myTurn || ui.anim || ui.aim.power <= 0) return;
    // the flick names the board it was aimed at, so a duplicate sent after a shot is rejected by the server
    ctx.act({ type: 'flick', x: ui.aim.x / 100, angle: (ui.aim.angle * Math.PI) / 180, power: ui.aim.power / 100, seq: v.seq });
  }

  /** The striker from the keyboard: Left/Right place it, Shift+Left/Right turn it, Up/Down set the power. */
  function onKey(e) {
    const v = ui.v;
    if (!v || !v.myTurn || ui.anim || !e.target.closest || !e.target.closest('[data-id="striker"]')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') ui.aim.power = Math.max(0, Math.min(100, ui.aim.power + 5 * step));
    else if (e.shiftKey) ui.aim.angle = Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, ui.aim.angle + 2 * step));
    else placeAt((ui.aim.x + step) / 100);
    syncAim();
  }

  function onClick(e) {
    const el = e.target.closest('[data-cb]');
    const v = ui.v, ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    switch (el.dataset.cb) {
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ui.resignArmed = false; ctx.leave(); break;
      case 'resign':
        if (!ui.resignArmed) { ui.resignArmed = true; ui.armKey = armKeyOf(v, ctx); ctx.rerender(); break; }
        ui.resignArmed = false; ctx.act({ type: 'resign' }); break;
    }
  }

  window.CardTable.register('carrom', { render });
})();
