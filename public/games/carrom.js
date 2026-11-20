/* Carrom (games/carrom): the board as SVG, aiming with sliders, playing back each shot from its keyframes, and the end of
 * the game. Styles in carrom.css. The board is drawn in server coordinates and turned for the far player, so the striker
 * always sits at the bottom of the screen on your side, and your left and right are the screen's. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, v: null, root: null, seq: null, aim: { x: 50, angle: 0, power: 60 }, anim: null, known: new Map() };
  const BASE_Y = [0.12, 0.88];
  const POCKETS = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const POCKET_R = 0.05;

  const myColour = (v) => (v.me < 0 ? null : v.colours[v.me]);
  const nameOf = (v, seat) => (seat === v.me ? 'You' : esc(v.players[seat].name));
  const toServerX = (me, x) => (me === 1 ? 1 - x : x);
  const colourLabel = (c) => (c === 'w' ? 'White' : 'Black');

  function remember(v) {
    // colours and sizes of every disc seen, so an animation can draw discs that have just left the board
    for (const d of v.board) ui.known.set(d.id, { kind: d.kind, colour: d.colour, r: d.r });
    if (v.shot) ui.known.set('striker', { kind: 'striker', colour: v.colours[v.shot.seat], r: 0.026 });
  }

  function discHTML(d) {
    const cls = d.kind === 'queen' ? 'cb-queen' : d.kind === 'striker' ? `cb-striker ${d.colour === 'w' ? 'w' : 'b'}` : `cb-coin ${d.colour === 'w' ? 'w' : 'b'}`;
    return `<circle class="${cls}" data-id="${esc(d.id)}" cx="${d.x}" cy="${d.y}" r="${d.r}"/>`;
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return esc(endText(v));
    if (ui.anim) return 'Shot in play…';
    const turnName = esc(v.players[v.turn].name);
    if (v.me < 0) return `Watching: ${turnName} to play`;
    if (!v.myTurn) return `${turnName} is aiming…`;
    return `Your turn: set the striker and flick`;
  }

  function endText(v) {
    if (v.draw) return 'A draw: the table was not finished in time';
    if (v.reason === 'resignation') return v.winner === v.me ? 'You won: the other player resigned' : 'You resigned';
    return v.winner === v.me ? 'You pocketed all nine coins' : `${esc(v.players[v.winner].name)} pocketed all nine coins`;
  }

  function seatsHTML(v) {
    return `<div class="cb-seats">${[0, 1].map((seat) => {
      const colour = v.colours[seat];
      const p = v.players[seat];
      const turn = v.phase === 'playing' && v.turn === seat;
      const won = v.phase === 'gameOver' && v.winner === seat;
      const queen = v.queenHeld === seat ? ' · queen' : '';
      return `<div class="cb-seat ${turn ? 'turn' : ''} ${won ? 'won' : ''}">
        <span class="cb-colour ${colour}" aria-hidden="true"></span>
        <span class="cb-who"><b>${esc(p.name)}${seat === v.me ? ' (you)' : ''}</b><small>${colourLabel(colour)} · ${v.score[seat]} of 9${queen}</small></span></div>`;
    }).join('')}</div>`;
  }

  /** The board in server coordinates. Discs come from the view, or from the animation's current frame. */
  function boardHTML(v, frame) {
    const me = v.me < 0 ? 0 : v.me;
    // SVG applies a transform list right to left: these map server (x, y) to the screen, with the near baseline at the bottom.
    const turned = me === 1 ? 'translate(1 0) scale(-1 1)' : 'scale(1 -1) translate(0 -1)';
    const discs = frame
      ? frame.d.map(([id, x, y]) => { const k = ui.known.get(id) || { kind: 'coin', colour: 'w', r: 0.022 }; return { id, kind: k.kind, colour: k.colour, x, y, r: k.r }; })
      : v.board.slice();
    if (!frame && v.myTurn && !ui.anim) {
      const sx = toServerX(me, ui.aim.x / 100);
      discs.push({ id: 'striker', kind: 'striker', colour: myColour(v), x: sx, y: BASE_Y[me], r: 0.026 });
    }
    const aimLine = (!frame && v.myTurn && !ui.anim) ? aimHTML(me) : '';
    const pockets = POCKETS.map(([x, y]) => `<circle class="cb-pocket" cx="${x}" cy="${y}" r="${POCKET_R}"/>`).join('');
    return `<svg class="cb-svg" viewBox="-0.07 -0.07 1.14 1.14" role="img" aria-label="Carrom board">
      <g transform="${turned}">
        <rect class="cb-board" x="0" y="0" width="1" height="1" rx="0.02"/>
        <rect class="cb-inner" x="0.06" y="0.06" width="0.88" height="0.88"/>
        <line class="cb-line" x1="0.2" x2="0.8" y1="${BASE_Y[0]}" y2="${BASE_Y[0]}"/>
        <line class="cb-line" x1="0.2" x2="0.8" y1="${BASE_Y[1]}" y2="${BASE_Y[1]}"/>
        <circle class="cb-centre" cx="0.5" cy="0.5" r="0.09"/>
        ${pockets}
        ${discs.map(discHTML).join('')}
        ${aimLine}
      </g></svg>`;
  }

  /** The aim line in server coordinates: the same direction the physics uses for the flick (negated for the far player). */
  function aimHTML(me) {
    const { angle, power } = ui.aim;
    const sx = toServerX(me, ui.aim.x / 100), sy = BASE_Y[me];
    const a = (angle * Math.PI) / 180;
    const f = me === 0 ? 1 : -1;
    const len = (power / 100) * 0.35;
    return `<line class="cb-aim" x1="${sx}" y1="${sy}" x2="${sx + f * len * Math.sin(a)}" y2="${sy + f * len * Math.cos(a)}"/>`;
  }

  function controlsHTML(v) {
    if (!v.myTurn || ui.anim) return '';
    const { x, angle, power } = ui.aim;
    return `<div class="cb-controls">
      <label>Striker <output data-out="x">${x}</output>
        <input type="range" data-aim="x" min="20" max="80" step="1" value="${x}" aria-label="Striker position along your baseline"></label>
      <label>Angle <output data-out="angle">${angle}°</output>
        <input type="range" data-aim="angle" min="-75" max="75" step="1" value="${angle}" aria-label="Aim angle"></label>
      <label>Power <output data-out="power">${power}%</output>
        <input type="range" data-aim="power" min="5" max="100" step="1" value="${power}" aria-label="Flick power"></label>
      <button type="button" class="btn cb-flick" data-cb="flick">Flick</button>
    </div>`;
  }

  function logHTML(v) {
    if (!v.log.length) return '<p class="hint">No shots yet.</p>';
    return `<ol class="cb-log">${v.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const title = v.draw ? 'A draw' : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} won`;
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
      const sound = v.draw ? 'round' : v.winner === v.me ? 'win' : v.me < 0 ? 'round' : 'lose';
      setTimeout(() => snd.play(sound), 900);
    }
    requestAnimationFrame(tick);
  }

  /** Plays the shot's keyframes on the board in the DOM, then redraws from the final view. */
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
        if (el) { el.setAttribute('cx', x); el.setAttribute('cy', y); el.style.display = ''; }
      }
      svg.querySelectorAll('[data-id]').forEach((el) => { if (!seen.has(el.dataset.id)) el.style.display = 'none'; });
    }
    if (t >= a.end + 0.25 || t > 25) { ui.anim = null; render(ui.root, ui.v, ui.ctx); return; }
    requestAnimationFrame(tick);
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.root = root;
    ui.v = v;
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
  }

  function onInput(e) {
    const el = e.target.closest('[data-aim]');
    if (!el || !ui.v) return;
    const key = el.dataset.aim;
    ui.aim[key] = Number(el.value);
    const wrap = el.closest('.wz');
    const out = wrap && wrap.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = key === 'angle' ? `${ui.aim.angle}°` : key === 'power' ? `${ui.aim.power}%` : String(ui.aim.x);
    // move the striker and the aim line in place, without rebuilding the board
    const svg = wrap && wrap.querySelector('.cb-svg');
    if (svg) {
      const me = ui.v.me < 0 ? 0 : ui.v.me;
      const g = svg.querySelector('g');
      const oldAim = svg.querySelector('.cb-aim'); const oldStriker = svg.querySelector('.cb-striker');
      const tmp = document.createElement('div');
      tmp.innerHTML = `<svg>${discHTML({ id: 'striker', kind: 'striker', colour: myColour(ui.v), x: toServerX(me, ui.aim.x / 100), y: BASE_Y[me], r: 0.026 })}${aimHTML(me)}</svg>`;
      const [striker, aim] = [...tmp.querySelector('svg').children]; // copied out first: moving a node changes a live list
      if (oldStriker) oldStriker.replaceWith(striker); else g.appendChild(striker);
      if (oldAim) oldAim.replaceWith(aim); else g.appendChild(aim);
    }
  }

  function onClick(e) {
    const el = e.target.closest('[data-cb]');
    const v = ui.v, ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    switch (el.dataset.cb) {
      case 'flick':
        if (!v.myTurn || ui.anim) return;
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
