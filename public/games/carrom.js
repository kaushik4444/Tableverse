/* Carrom (games/carrom): the board as SVG, aiming by dragging on the board, playing back each
 * shot from its keyframes, and the end of the game. Styles in carrom.css.
 *
 * Frames: the server keeps the board in the bottom side's frame. A viewer sees their own side at the bottom, so every point is
 * rotated for the viewer's side on the way to the screen (toSvg). A shot is aimed in the viewer's own frame (display), where
 * forward is up the screen and the striker sits at (u, BASE_Y). The engine rotates that shot into the bottom frame itself. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const SHADE_X = 0.004, SHADE_Y = 0.008, SHADE_ALPHA = 0.45;
  const BASE_Y = 0.12;     // a side's baseline in the bottom frame
  const MAX_DRAG = 0.45;   // a drag of this length on the board is a full-power flick
  const ANGLE_MAX = 75;
  const CORNERS_VIS = [[0, 0], [1, 0], [0, 1], [1, 1]]; // the pockets, where the physics takes a disc (games/carrom/physics.js)
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
    // a flat offset shade under the disc: no SVG filter, which Chromium can paint as black blocks over the board
    return `<circle class="cb-shade" data-shade-for="${esc(d.id)}" cx="${(X + SHADE_X).toFixed(4)}" cy="${(Y + SHADE_Y).toFixed(4)}" r="${d.r}" fill="#2a1608" opacity="${SHADE_ALPHA}"/><circle class="${cls}" data-id="${esc(d.id)}" cx="${X}" cy="${Y}" r="${d.r}"/>`;
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

  /** A ring round the striker: it pulses until the shot is aimed, then shows how far the striker can be pulled. */
  function ringHTML() {
    const [sx, sy] = dispToSvg([ui.aim.x / 100, BASE_Y]);
    return `<circle class="cb-ring${ui.aim.power > 0 ? ' set' : ''}" cx="${sx}" cy="${sy}" r="0.07"/>`;
  }

  function aimHTML() {
    const { from, to } = aimPoints();
    return `<line class="cb-aim${ui.aim.power > 0 ? '' : ' idle'}" marker-end="url(#cb-arrowhead)" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"/>`;
  }

  const fx = (n) => Math.round(n * 1000) / 1000;

  /** Fine wood grain across the playing surface: fixed wavy lines, so the board looks the same on every client. */
  const GRAIN = (() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const out = [];
    for (let i = 0; i < 26; i++) {
      const y = 0.02 + (i / 26) * 0.96 + rnd() * 0.02, w = 0.004 + rnd() * 0.012, o = 0.04 + rnd() * 0.07;
      const a = rnd() * 0.02 - 0.01, b = rnd() * 0.02 - 0.01;
      out.push(`<path d="M0 ${fx(y)} C 0.3 ${fx(y + a)}, 0.65 ${fx(y + b)}, 1 ${fx(y + a / 2)}" stroke-width="${fx(w)}" opacity="${fx(o)}"/>`);
    }
    return `<g class="cb-grain" fill="none" stroke="#8a5a2b" stroke-linecap="round">${out.join('')}</g>`;
  })();

  /** The compass in the middle of the board: eight points, the four main ones longer and red, inside two rings. It reaches past the opening coins, so it still shows around them. */
  const COMPASS = (() => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 - Math.PI / 2, r = i % 4 === 0 ? 0.175 : i % 2 === 0 ? 0.125 : 0.05;
      pts.push(`${fx(0.5 + r * Math.cos(a))},${fx(0.5 + r * Math.sin(a))}`);
    }
    return `<circle class="cb-centre" cx="0.5" cy="0.5" r="0.135"/><circle class="cb-centre-inner" cx="0.5" cy="0.5" r="0.098"/>`
      + `<polygon class="cb-star" points="${pts.join(' ')}"/><circle class="cb-hub" cx="0.5" cy="0.5" r="0.03"/>`;
  })();

  /** One corner's markings (drawn for the top-left corner, turned for the others): the diagonal from the pocket with its arrow, and,
   * further in towards the middle of the table, the curved arrow that circles its end. */
  const CORNER_ART = (() => {
    const c = 0.3, r = 0.05;                       // centre and radius of the curved arrow, on the diagonal
    const pt = (deg) => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)];
    const [x0, y0] = pt(80), [x1, y1] = pt(10);    // clockwise round the far side, leaving the gap that faces the centre
    const tx = -Math.sin((10 * Math.PI) / 180), ty = Math.cos((10 * Math.PI) / 180); // direction of travel at the end
    const nx = Math.cos((10 * Math.PI) / 180), ny = Math.sin((10 * Math.PI) / 180);
    const head = [[x1 + tx * 0.018, y1 + ty * 0.018], [x1 + nx * 0.012, y1 + ny * 0.012], [x1 - nx * 0.012, y1 - ny * 0.012]].map((p) => `${fx(p[0])},${fx(p[1])}`).join(' ');
    return `<line class="cb-diag" x1="0.09" y1="0.09" x2="${c}" y2="${c}"/>`
      + `<polygon class="cb-diag-head" points="0.075,0.075 0.115,0.09 0.09,0.115"/>`
      + `<circle class="cb-diag-ring" cx="0.19" cy="0.19" r="0.013"/>`
      + `<path class="cb-diag" fill="none" d="M${fx(x0)} ${fx(y0)} A ${r} ${r} 0 1 1 ${fx(x1)} ${fx(y1)}"/>`
      + `<polygon class="cb-diag-head" points="${head}"/>`;
  })();

  /** The cap that wraps each corner of the frame, with the pocket under it. Drawn for the top-left and turned for the others. */
  const CAP = `<path class="cb-cap" d="M-0.075 0.16 L-0.075 -0.03 Q-0.075 -0.075 -0.03 -0.075 L0.16 -0.075 L0.16 -0.012 Q0.16 0 0.148 0 L0.012 0 Q0 0 0 0.012 L0 0.148 Q0 0.16 -0.012 0.16 Z"/>`;

  /** A side's baseline: two lines with a red circle at each end, where the striker may be placed. */
  function baselineHTML(v, j) {
    const P2 = (p) => toSvg(v, rotP(p, j)).map(fx).join(' ');
    const dot = (x) => { const [X, Y] = toSvg(v, rotP([x, BASE_Y], j)); return `<circle class="cb-base-ring" cx="${fx(X)}" cy="${fx(Y)}" r="0.04"/><circle class="cb-base-dot" cx="${fx(X)}" cy="${fx(Y)}" r="0.03"/>`; };
    const line = (y) => `<path class="cb-bar-outer" d="M${P2([0.2, y])} L${P2([0.8, y])}"/>`;
    return line(BASE_Y - 0.03) + line(BASE_Y + 0.03) + dot(0.2) + dot(0.8);
  }

  /** The board. Shows the discs (from the view, or the current frame of a shot) and, on your turn, the striker and aim. */
  function boardHTML(v, frame) {
    const discs = discsFor(frame) || v.board;
    const aiming = !frame && v.myTurn && !ui.anim;
    const striker = aiming ? `<circle class="cb-striker ${colourOfMe(v) === 'w' ? 'w' : 'b'}" data-id="striker" cx="${dispToSvg([ui.aim.x / 100, BASE_Y])[0]}" cy="${dispToSvg([ui.aim.x / 100, BASE_Y])[1]}" r="0.026" tabindex="0" role="slider" aria-label="Striker position along your baseline" aria-valuemin="20" aria-valuemax="80" aria-valuenow="${ui.aim.x}"/>` : '';
    return boardSVG(v, discs, striker, aiming ? ringHTML() + aimHTML() : '');
  }

  /** The board drawn from a viewpoint `v` (only its side matters), the discs, and any extras (striker, aim, markings) on top. Used for play and for the how-to-play cards. */
  function boardSVG(v, discs, striker, over, cls = '') {
    const bars = [0, 1, 2, 3].map((j) => baselineHTML(v, j)).join('');
    const turns = [0, 90, 180, 270];
    const corners = turns.map((a) => `<g transform="rotate(${a} 0.5 0.5)">${CORNER_ART}</g>`).join('');
    const caps = turns.map((a) => `<g transform="rotate(${a} 0.5 0.5)">${CAP}</g>`).join('');
    const pockets = CORNERS_VIS.map(([x, y]) => `<circle class="cb-pocket-rim" cx="${x}" cy="${y}" r="0.057"/><circle class="cb-pocket" cx="${x}" cy="${y}" r="0.05"/><circle class="cb-pocket-mesh" cx="${x}" cy="${y}" r="0.05"/>`).join('');
    const bands = (stops) => stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
    return `<svg class="cb-svg ${cls}" viewBox="-0.09 -0.09 1.18 1.18" role="img" aria-label="Carrom board">
      <defs>
        <marker id="cb-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker>
        <linearGradient id="cb-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6e4222"/><stop offset="0.5" stop-color="#4a2a14"/><stop offset="1" stop-color="#5d3519"/></linearGradient>
        <linearGradient id="cb-surface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d9ab"/><stop offset="1" stop-color="#e2b982"/></linearGradient>
        <linearGradient id="cb-copper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8a36a"/><stop offset="0.55" stop-color="#bd6a35"/><stop offset="1" stop-color="#8a4420"/></linearGradient>
        <radialGradient id="cb-pocket-g" cx="0.4" cy="0.4" r="0.7"><stop offset="0" stop-color="#241d19"/><stop offset="1" stop-color="#030202"/></radialGradient>
        <pattern id="cb-mesh" width="0.014" height="0.014" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0 H0.014 M0 0 V0.014" stroke="#6b5a4a" stroke-width="0.0016" opacity="0.55"/></pattern>
        <radialGradient id="cb-coin-w" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.38">${bands([[0, '#fffdf6'], [0.28, '#f1e8d2'], [0.31, '#c9bb98'], [0.36, '#f6efdc'], [0.56, '#ebe0c6'], [0.6, '#c2b38f'], [0.66, '#f1e9d4'], [0.88, '#dcd0b3'], [1, '#a99870']])}</radialGradient>
        <radialGradient id="cb-coin-b" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.38">${bands([[0, '#6c625b'], [0.28, '#3a322d'], [0.31, '#0d0a09'], [0.36, '#4a403a'], [0.56, '#2b241f'], [0.6, '#0a0807'], [0.66, '#3c332d'], [0.88, '#1d1815'], [1, '#050404']])}</radialGradient>
        <radialGradient id="cb-queen-g" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.38">${bands([[0, '#ff8a6a'], [0.28, '#e0442f'], [0.31, '#8f1d12'], [0.36, '#e65a43'], [0.56, '#cc3a26'], [0.6, '#7d170e'], [0.66, '#d9482f'], [0.88, '#b52d1b'], [1, '#5e0f08']])}</radialGradient>
        <radialGradient id="cb-striker-g" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.38">${bands([[0, '#fff2b8'], [0.16, '#e2b84a'], [0.2, '#3a2a8a'], [0.5, '#5a46b8'], [0.56, '#e2b84a'], [0.62, '#44349a'], [0.86, '#2a1d6e'], [0.9, '#e2b84a'], [1, '#8a6a1c']])}</radialGradient>
      </defs>
      <rect class="cb-frame" x="-0.075" y="-0.075" width="1.15" height="1.15" rx="0.045"/>
      <rect class="cb-cushion" x="-0.006" y="-0.006" width="1.012" height="1.012"/>
      <rect class="cb-board" x="0" y="0" width="1" height="1"/>
      ${GRAIN}
      ${bars}
      ${corners}
      ${COMPASS}
      ${caps}
      ${pockets}
      <g data-shadow="1">${discs.map((d) => discHTML(v, d)).join('')}${striker}</g>
      ${over || ''}
    </svg>`;
  }

  /** Coins each team has pocketed, as two pills with the coin colour, like the scoreboard of a real match. */
  function scoreHTML(v) {
    const pill = (c) => `<div class="cb-pill ${c}${v.queenHeld === c ? ' queen' : ''}"><span class="cb-colour ${c}" aria-hidden="true"></span><b>${v.score[c]}</b><small>of 9${v.queenHeld === c ? ' · queen' : ''}</small></div>`;
    return `<div class="cb-score" aria-label="Coins pocketed">${pill('w')}${pill('b')}</div>`;
  }

  /** The striker's track under the board: drag the striker along it (or press the arrow keys) to place it on the baseline. */
  function sliderHTML(v) {
    const on = v.myTurn && !ui.anim;
    const pct = ((ui.aim.x - 20) / 60) * 100;
    return `<div class="cb-slider${on ? '' : ' off'}" data-slider role="slider" aria-label="Striker position along your baseline" aria-valuemin="20" aria-valuemax="80" aria-valuenow="${ui.aim.x}" aria-disabled="${on ? 'false' : 'true'}" tabindex="${on ? '0' : '-1'}">`
      + `<span class="cb-track"><i class="cb-end"></i><i class="cb-end r"></i></span><span class="cb-thumb ${colourOfMe(v) === 'w' ? 'w' : 'b'}" style="left:${pct}%"></span></div>`;
  }

  /** The controls under the board. They keep the same height on every turn, so the page does not jump when your turn starts. */
  function controlsHTML(v) {
    const on = v.myTurn && !ui.anim;
    const tip = on ? tipText() : 'Wait for your turn. Aim and flick when the striker is yours.';
    return `<div class="cb-controls">`
      + `<p class="hint cb-tip" aria-live="polite">${tip}</p>`
      + `<button type="button" class="btn big cb-fire" data-cb="fire" ${on ? '' : 'tabindex="-1"'} aria-disabled="${on && ui.aim.power > 0 ? 'false' : 'true'}">Fire striker</button>`
      + `</div>`;
  }

  /** What the player can do now, with the live aim and power. Short on purpose: the full keys are on the Rules sheet. */
  function tipText() {
    const { angle, power } = ui.aim;
    if (power <= 0) return 'Drag your striker along the baseline, then drag back from the board to aim and set power. Let go to flick.';
    return `Aim ${angle}° · power ${power}%. Let go to flick, or press Enter on the striker.`;
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
    ui.anim = { seq: e.seq, frames: e.keyframes, events: Array.isArray(e.events) ? e.events : [], nextEvent: 0, t0: null, end: e.keyframes.length ? e.keyframes[e.keyframes.length - 1].t : 0, setup: setupFor(e, v) };
    if (snd) snd.play('place');
    if (v.phase === 'gameOver' && snd) {
      const mine = colourOfMe(v);
      const sound = v.draw ? 'round' : v.winner === mine ? 'win' : mine === null ? 'round' : 'lose';
      // the result sound belongs to this table: it is not played once the player has left it
      setTimeout(() => { if (ui.animTable === tableKey && ui.root && ui.root.isConnected) snd.play(sound); }, 900);
    }
    play(ui.anim);
  }

  /**
   * Another seat's striker is shown first on its own bar, slid along the bar to the spot it was set on, and held there for a
   * moment, so it never appears from off the board. A seat's own shot needs no setup: it already aimed from there.
   * Bottom-frame coordinates; `move` and `ms` are in milliseconds.
   */
  function setupFor(e, v) {
    if (v.me >= 0 && e.seat === v.me) return null;
    const first = e.keyframes[0] && e.keyframes[0].d.find(([id]) => id === 'striker');
    if (!first) return null;
    return { from: rotP([0.5, BASE_Y], v.players[e.seat].side), to: [first[1], first[2]], move: 900, ms: 1250 };
  }

  /** The first frame of a shot as it is shown before playback starts: the striker still on its bar. */
  function startFrame(a) {
    const f0 = a.frames[0];
    if (!a.setup) return f0;
    return { t: 0, d: f0.d.map(([id, x, y]) => (id === 'striker' ? [id, a.setup.from[0], a.setup.from[1]] : [id, x, y])) };
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
    // the table left the page (the player went elsewhere): stop the shot instead of drawing into a detached tree
    if (!ui.root.isConnected) { ui.anim = null; return; }
    if (a.t0 === null) a.t0 = now;
    const lead = a.setup ? a.setup.ms : 0; // the set-up slide and pause come before the keyframes
    const elapsed = now - a.t0;
    const inSetup = elapsed < lead;
    const t = inSetup ? 0 : (elapsed - lead) / 1000;
    let pose;
    if (inSetup) {
      const k = Math.min(1, elapsed / a.setup.move);
      const e2 = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2; // ease in and out along the bar
      const sx = a.setup.from[0] + (a.setup.to[0] - a.setup.from[0]) * e2, sy = a.setup.from[1] + (a.setup.to[1] - a.setup.from[1]) * e2;
      pose = a.frames[0].d.map(([id, x, y]) => (id === 'striker' ? [id, sx, sy, 1] : [id, x, y, 1]));
    } else pose = poseAt(a.frames, t);
    // a sound for each impact the server reported, when playback reaches its time
    const snd = window.CardTable.sound;
    while (!inSetup && snd && a.nextEvent < a.events.length && a.events[a.nextEvent][0] <= t) {
      const [at, kind, speed] = a.events[a.nextEvent++];
      // a late frame (background tab, slow device) skips impacts it is well past instead of bursting them out at once
      if (t - at > 0.2) continue;
      snd.play(kind === 2 ? 'pocket' : kind === 1 ? 'rail' : 'clack', speed);
    }
    const svg = ui.root.querySelector('.cb-svg');
    if (svg) {
      const seen = new Set(pose.map(([id]) => id));
      for (const [id, x, y, alpha] of pose) {
        const key = CSS.escape(id);
        const [X, Y] = toSvg(ui.v, [x, y]);
        for (const el of svg.querySelectorAll(`[data-id="${key}"], [data-shade-for="${key}"]`)) {
          const shade = el.hasAttribute('data-shade-for');
          el.setAttribute('cx', X + (shade ? SHADE_X : 0));
          el.setAttribute('cy', Y + (shade ? SHADE_Y : 0));
          el.style.display = '';
          el.style.opacity = String(alpha * (shade ? SHADE_ALPHA : 1));
        }
      }
      svg.querySelectorAll('[data-id], [data-shade-for]').forEach((el) => { if (!seen.has(el.dataset.shadeFor ?? el.dataset.id)) el.style.display = 'none'; });
    }
    // the app redraws the table (with its turn timer and toolbar) from the current state
    if (!inSetup && (t >= a.end + 0.25 || t > 25)) { ui.anim = null; ui.ctx.rerender(); return; }
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
    const frame = ui.anim ? startFrame(ui.anim) : null;
    root.innerHTML = `<div class="wz carrom-game" data-game="carrom">
      <div class="wz-top"><div class="wz-round"><b>${esc(v.name)}</b><span class="label"> · ${v.shots} shots</span></div>
        ${CardTable.toolbarSeed(`<button class="btn ghost small" data-cb="rules">Rules</button>${playing ? `<button class="btn ghost small" data-cb="resign">${ui.resignArmed ? 'Tap again to resign' : 'Resign'}</button>` : ''}`, 'cb')}</div>
      ${seatsHTML(v)}
      ${scoreHTML(v)}
      <div class="cb-board-wrap">${boardHTML(v, frame)}</div>
      ${sliderHTML(v)}
      ${controlsHTML(v)}
      <div class="wz-status ${v.myTurn && !ui.anim ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <details class="cb-moves" open><summary>Shots</summary>${logHTML(v)}</details>
      ${overlayHTML(v)}</div>`;
    fitSlider();
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

  /**
   * The slider is the board's own baseline: its track runs from the viewer's baseline end dot (0.2) to the other (0.8), so a
   * striker value and the striker on the board are the same spot. Called after each draw and when the page changes size.
   */
  function fitSlider() {
    const root = ui.root;
    if (!root) return;
    const slider = root.querySelector('.cb-slider'), track = root.querySelector('.cb-track'), svg = root.querySelector('.cb-svg');
    if (!slider || !track || !svg) return;
    const dots = [...svg.querySelectorAll('.cb-base-dot')].map((d) => d.getBoundingClientRect());
    if (dots.length < 2) return;
    const lowest = Math.max(...dots.map((r) => r.top)); // the viewer's own baseline is always the bottom one
    const own = dots.filter((r) => Math.abs(r.top - lowest) < 2).map((r) => r.left + r.width / 2);
    if (own.length < 2) return;
    const s = slider.getBoundingClientRect();
    track.style.left = `${Math.min(...own) - s.left}px`;
    track.style.right = `${s.right - Math.max(...own)}px`;
    positionThumb();
  }

  /** The thumb sits on the track at the striker's value (20 to 80). */
  function positionThumb() {
    const root = ui.root;
    if (!root) return;
    const slider = root.querySelector('.cb-slider'), track = root.querySelector('.cb-track'), thumb = root.querySelector('.cb-thumb');
    if (!slider || !track || !thumb) return;
    const s = slider.getBoundingClientRect(), t = track.getBoundingClientRect();
    thumb.style.left = `${t.left - s.left + ((ui.aim.x - 20) / 60) * t.width}px`;
  }
  window.addEventListener('resize', () => { if (ui.root && ui.root.isConnected) fitSlider(); });

  function syncAim() {
    const root = ui.root;
    if (!root) return;
    const svg = root.querySelector('.cb-svg');
    const line = svg && svg.querySelector('.cb-aim');
    if (line) {
      const { from, to } = aimPoints();
      line.setAttribute('x1', from[0]); line.setAttribute('y1', from[1]);
      line.setAttribute('x2', to[0]); line.setAttribute('y2', to[1]);
      line.classList.toggle('idle', ui.aim.power <= 0);
    }
    const striker = svg && svg.querySelector('[data-id="striker"]');
    if (striker) { const [sx, sy] = dispToSvg([ui.aim.x / 100, BASE_Y]); striker.setAttribute('cx', sx); striker.setAttribute('cy', sy); striker.setAttribute('aria-valuenow', String(ui.aim.x)); }
    const ring = svg && svg.querySelector('.cb-ring');
    if (ring) { const [rx, ry] = dispToSvg([ui.aim.x / 100, BASE_Y]); ring.setAttribute('cx', rx); ring.setAttribute('cy', ry); ring.classList.toggle('set', ui.aim.power > 0); }
    const slider = root.querySelector('[data-slider]');
    positionThumb();
    if (slider) slider.setAttribute('aria-valuenow', String(ui.aim.x));
    const tip = root.querySelector('.cb-tip');
    if (tip) tip.textContent = tipText();
    const fireBtn = root.querySelector('[data-cb="fire"]');
    if (fireBtn) fireBtn.setAttribute('aria-disabled', ui.aim.power > 0 ? 'false' : 'true');
  }

  function onPointerDown(e) {
    const v = ui.v;
    const slider = e.target.closest && e.target.closest('[data-slider]');
    if (!v || !v.myTurn || ui.anim || !(slider || e.target.closest('.cb-svg'))) return;
    if (e.button !== 0) return; // a middle or right button does not flick
    if (ui.dragging) return; // a second finger does not take over the drag
    ui.dragging = true;
    ui.pointerId = e.pointerId;
    ui.dragMoved = false;
    ui.dragKey = boardKeyOf(v, ui.ctx);
    ui.downAt = [e.clientX, e.clientY];
    if (slider) {
      ui.mode = 'slide';
      if (slider.setPointerCapture) slider.setPointerCapture(e.pointerId);
      placeAt(sliderX(e));
      return;
    }
    const svg = e.target.closest('.cb-svg');
    if (svg.setPointerCapture) svg.setPointerCapture(e.pointerId);
    // the striker is set only from the slider under the board; a drag on the board pulls the aim back, never moves the striker
    ui.mode = 'aim';
    const p = pointerDisplay(e);
    if (p) aimFrom(p);
  }

  /** The striker's spot along the baseline (0.2 to 0.8) for a pointer on the slider track under the board. */
  function sliderX(e) {
    const track = ui.root && ui.root.querySelector('.cb-track');
    if (!track) return ui.aim.x / 100;
    const r = track.getBoundingClientRect();
    return 0.2 + 0.6 * Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
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
    if (ui.mode === 'slide') { placeAt(sliderX(e)); return; }
    const p = pointerDisplay(e);
    if (!p) return;
    aimFrom(p);
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
    if (!v || !v.myTurn || ui.anim || !e.target.closest) return;
    if (e.target.closest('[data-slider]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); placeAt((ui.aim.x + (e.key === 'ArrowLeft' ? -1 : 1)) / 100); return; }
    if (!e.target.closest('[data-id="striker"]')) return;
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
      case 'fire': fire(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ui.resignArmed = false; ctx.leave(); break;
      case 'resign':
        if (!ui.resignArmed) { ui.resignArmed = true; ui.armKey = armKeyOf(v, ctx); ctx.rerender(); break; }
        ui.resignArmed = false; ctx.act({ type: 'resign' }); break;
    }
  }


  // ---- how-to-play pictures: the real board, drawn with the same code as the table ----

  /** The opening layout, the same rings as games/carrom/engine.js: the queen, then six and twelve coins alternating in colour. */
  function openingCoins() {
    const sp = 2 * 0.022, cells = [];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      if (Math.abs(a + b) > 2) continue;
      const x = 0.5 + sp * (a + b / 2), y = 0.5 + sp * (b * Math.sqrt(3) / 2);
      cells.push({ x, y, ring: Math.max(Math.abs(a), Math.abs(b), Math.abs(a + b)), angle: Math.atan2(y - 0.5, x - 0.5) });
    }
    const colour = new Map();
    for (const ring of [1, 2]) cells.filter((c) => c.ring === ring).sort((p, q) => p.angle - q.angle).forEach((c, i) => colour.set(c, i % 2 === 0 ? 'w' : 'b'));
    return cells.map((c, i) => c.ring === 0 ? { id: 'q', kind: 'queen', colour: null, x: c.x, y: c.y, r: 0.022 } : { id: 'c' + i, kind: 'coin', colour: colour.get(c), x: c.x, y: c.y, r: 0.022 });
  }

  const arrowTo = (a, b, dashed) => { const [x1, y1] = dispToSvg(a), [x2, y2] = dispToSvg(b); return `<line class="cb-aim${dashed ? ' dashed' : ''}" marker-end="url(#cb-arrowhead)" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; };
  const strikerAt = (x, y) => ({ id: 'striker', kind: 'striker', colour: 'w', x, y, r: 0.026 });
  const coinAt = (id, colour, x, y) => ({ id, kind: 'coin', colour, x, y, r: 0.022 });
  const queenAt = (x, y) => ({ id: 'q', kind: 'queen', colour: null, x, y, r: 0.022 });

  /** The picture for each rule card, in the order of the rules in games/carrom/index.js. */
  const SCENES = [
    () => ({ discs: openingCoins() }),                                           // the board
    () => ({ discs: openingCoins().concat(strikerAt(0.5, BASE_Y)), over: arrowTo([0.5, BASE_Y], [0.5, 0.36]) + `<circle class="cb-ring set" cx="0.5" cy="${1 - BASE_Y}" r="0.07"/>` }), // take the shot
    () => ({ discs: [coinAt('c1', 'w', 0.3, 0.3), strikerAt(0.45, 0.18), coinAt('c2', 'b', 0.62, 0.6)], over: arrowTo([0.3, 0.3], [0.05, 0.05], true) + arrowTo([0.45, 0.18], [0.33, 0.28]) }), // pocketing
    () => ({ discs: [queenAt(0.7, 0.7), coinAt('c1', 'w', 0.62, 0.62), strikerAt(0.5, 0.35)], over: arrowTo([0.7, 0.7], [0.95, 0.95], true) + arrowTo([0.62, 0.62], [0.9, 0.98], true) }), // the queen
    () => ({ discs: [strikerAt(0.06, 0.06), coinAt('c1', 'w', 0.4, 0.4)], over: `<g class="cb-cross"><line x1="0.12" y1="0.9" x2="0.2" y2="0.98"/><line x1="0.2" y1="0.9" x2="0.12" y2="0.98"/></g>` }), // the striker
    () => ({ discs: [coinAt('c1', 'w', 0.8, 0.8), coinAt('c2', 'w', 0.3, 0.7), coinAt('c3', 'b', 0.55, 0.45)], over: arrowTo([0.8, 0.8], [0.97, 0.97], true) }), // winning
  ];
  window.CardTable.howtoArt = window.CardTable.howtoArt || {};
  window.CardTable.howtoArt.carrom = (i) => {
    const scene = SCENES[i];
    if (!scene) return '';
    const { discs, over } = scene();
    const strikerDisc = discs.find((d) => d.kind === 'striker');
    const rest = discs.filter((d) => d.kind !== 'striker');
    const sHTML = strikerDisc ? discHTML({ me: -1 }, strikerDisc).replace('data-id="striker"', '') : '';
    return boardSVG({ me: -1 }, rest, sHTML, over || '', 'cb-art-board');
  };

  window.CardTable.register('carrom', { render });
})();
