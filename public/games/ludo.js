/* Ludo table renderer: a cross board for 2-4 players, or a six-arm board for 5-6, drawn as one SVG, glossy tokens on top,
 * and a single compact turn bar.
 * Rules and server state live in games/ludo/engine.js; this file only draws a view and sends { roll | ready | move }.
 *
 * Two boards share one interface (see geometry below): where(seat, pos, t) gives the centre of the square a token
 * stands on, and ringKey tells tokens that share a square apart. Board coordinates: the cross is 15 x 15 cells, the
 * six-arm board is 100 x 100 units. The square board is unchanged from before 5-6 player support. */
(() => {
  'use strict';
  const { esc } = window.CardTable;

  const SEAT = [
    { name: 'red', hex: '#ef4444', dark: '#b91c1c', light: '#fecaca' },
    { name: 'green', hex: '#22c55e', dark: '#15803d', light: '#bbf7d0' },
    { name: 'yellow', hex: '#f5b301', dark: '#b45309', light: '#fde68a' },
    { name: 'blue', hex: '#3b82f6', dark: '#1d4ed8', light: '#bfdbfe' },
    { name: 'orange', hex: '#f97316', dark: '#c2410c', light: '#fed7aa' },
    { name: 'purple', hex: '#a855f7', dark: '#7e22ce', light: '#e9d5ff' },
  ];
  // Seats used for n players. Two players sit opposite each other on the cross, as on a real board.
  const seatsFor = (n) => (n === 2 ? [0, 2] : Array.from({ length: n }, (_, i) => i));

  // rotate a point (cell units) a quarter turn clockwise, k times
  const rot = ([x, y], k) => { for (let i = 0; i < k; i++) [x, y] = [15 - y, x]; return [x, y]; };
  const center = ([c, r]) => [c + 0.5, r + 0.5];

  // ---- Cross board (2-4 players), cell units on 15 x 15 ----
  // Ring: 13 squares for seat 0 (start square first), rotated for the next three seats.
  const RING0 = [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0]];
  const CROSS_RING = [];
  for (let k = 0; k < 4; k++) for (const cell of RING0) CROSS_RING.push(rot(center(cell), k).map((v) => v - 0.5));
  // Home column for seat 0: five squares leading to the centre; the finished position sits in the centre triangle.
  const LANE0 = [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]];
  const crossLane = (seat) => LANE0.map((cell) => rot(center(cell), seat).map((v) => v - 0.5));
  const YARD0 = [[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]]; // token slots in the top-left yard
  const HOME0 = [[6.45, 7.05], [6.45, 7.5], [6.45, 7.95], [6.85, 7.5]]; // finished tokens in the seat's centre triangle
  const CROSS = {
    S: 15, fan: 1, track: 52, lap: 51, finished: 56, starts: [0, 13, 26, 39],
    safe: new Set([0, 8, 13, 21, 26, 34, 39, 47]), // ring squares that protect from capture
    where(seat, pos, t) {
      if (pos === -1) return rot(YARD0[t], seat);
      if (pos === this.finished) return rot(HOME0[t % 4], seat);
      if (pos >= this.lap) return center(crossLane(seat)[pos - this.lap]);
      return center(CROSS_RING[(this.starts[seat] + pos) % this.track]);
    },
  };

  // ---- Six-arm board (5-6 players). The server sends the board (games/ludo/board.js): the track squares in order,
  // each seat's start, its five home-lane squares, the hexagon, the home triangles and the yards, all in 100 x 100
  // units. Here it is only drawn; the same data drives the rules, so the two cannot disagree.
  const hexGeo = (b) => ({
    S: 100, fan: 100 / 15, track: b.track.length, lap: b.track.length - 1, finished: b.track.length + 4,
    starts: b.starts, safe: new Set(b.safe),
    where(seat, pos, t) {
      if (pos === -1) return b.yards[seat].slots[t];
      if (pos === this.finished) return b.finished[seat];
      if (pos >= this.lap) return b.lanes[seat][pos - this.lap].p;
      return b.track[(this.starts[seat] + pos) % this.track].p;
    },
  });
  const CROSS_GEO = CROSS;
  const ringKey = (geo, seat, pos) => (pos >= 0 && pos < geo.lap ? 'r' + ((geo.starts[seat] + pos) % geo.track) : null);

  const ui = { ctx: null, latest: null, root: null, rollSeq: null, positions: new Map(), seq: null, myTurnWas: false, isHex: false,
    key: null, disp: new Map(), plans: new Map(), snaps: new Map(), timer: null, holdUntil: 0, geo: CROSS };
  const STEP_MS = 400; // one square per step, so every square of the walk can be followed (the server waits for this too)
  const SNAP_MS = 800; // a captured token stays visible a moment before it goes back to its yard
  const busy = () => ui.plans.size > 0 || ui.snaps.size > 0 || Date.now() < ui.holdUntil;
  const shownPos = (id, pos) => (ui.disp.has(id) ? ui.disp.get(id) : pos);

  /** Decide, per token, whether it walks forward square by square (a move), waits and then drops home (a capture) or just appears. */
  function planMoves(v) {
    const key = (ui.ctx && ui.ctx.room && ui.ctx.room.code) + ':' + v.players.map((p) => p.id).join();
    const fresh = ui.key !== key || v.phase === 'ready';
    ui.key = key;
    if (fresh) {
      if (ui.timer) clearInterval(ui.timer);
      ui.timer = null;
      ui.disp.clear(); ui.plans.clear(); ui.snaps.clear();
      ui.holdUntil = 0;
    }
    v.players.forEach((p, i) => p.tokens.forEach((pos, t) => {
      const id = `${i}-${t}`;
      if (fresh || !ui.disp.has(id)) { ui.disp.set(id, pos); ui.plans.delete(id); ui.snaps.delete(id); return; }
      const cur = ui.disp.get(id);
      if (cur === pos) { ui.plans.delete(id); ui.snaps.delete(id); return; }
      if (pos > cur && pos - cur <= 12 && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { ui.plans.set(id, pos); ui.snaps.delete(id); }
      else if (pos === -1 && !ui.plans.size) { ui.snaps.set(id, pos); } // captured: drops back once the capturing token has arrived
      else if (pos === -1) ui.snaps.set(id, pos);
      else { ui.disp.set(id, pos); ui.plans.delete(id); } // anything else (a rewind after a reconnect): no walking
    }));
    if (busy() && !ui.timer) ui.timer = setInterval(tick, STEP_MS);
  }
  function tick() {
    if (!ui.root || !ui.root.isConnected || !ui.latest) { clearInterval(ui.timer); ui.timer = null; ui.plans.clear(); ui.snaps.clear(); return; }
    if (ui.plans.size) {
      for (const [id, to] of [...ui.plans]) {
        ui.disp.set(id, ui.disp.get(id) + 1);
        if (ui.disp.get(id) >= to) { ui.disp.set(id, to); ui.plans.delete(id); }
      }
      if (!ui.plans.size) ui.holdUntil = Date.now() + (ui.snaps.size ? SNAP_MS : STEP_MS); // keep controls gated through the final landing transition
    } else if (ui.snaps.size && Date.now() >= ui.holdUntil) {
      for (const [id, to] of ui.snaps) ui.disp.set(id, to);
      ui.snaps.clear(); ui.holdUntil = Date.now() + SNAP_MS;
    } else if (Date.now() >= ui.holdUntil) { clearInterval(ui.timer); ui.timer = null; }
    // The app's renderer draws whatever screen is current (this table, or the lobby / home after leaving it). Drawing the board
    // directly would paint it over the home screen, because the root element stays in the page.
    if (ui.ctx && ui.ctx.rerender) ui.ctx.rerender();
    else render(ui.root, ui.latest, ui.ctx);
  }

  /** Sounds for dice, moves, captures and the finish, from the shared soft palette other games already use. */
  function react(v) {
    const snd = window.CardTable.sound;
    if (!snd) return;
    const e = v.event;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; ui.myTurnWas = v.myTurn; return; } // first render (page load or reconnect): no replay
    if (e && e.seq !== ui.seq) {
      ui.seq = e.seq;
      if (v.phase === 'gameOver') snd.play(v.me === v.winner ? 'fanfare' : 'lose');
      else {
        const last = (v.log || []).slice(-1)[0];
        if (last && last.kind === 'capture') snd.play('fold'); // a sharp swish: someone is sent home
        else if (last && last.kind === 'home') snd.play('collect'); // a token reaches the centre
        else if (last && last.kind === 'roll') snd.play('tick');
        else snd.play('card');
      }
    }
    if (v.myTurn && !ui.myTurnWas && v.phase !== 'gameOver') setTimeout(() => snd.play('turn'), 150);
    ui.myTurnWas = v.myTurn;
  }

  function crossSVG(seats) {
    const G = CROSS;
    const cells = [];
    const rect = (c, r, fill) => `<rect x="${c + 0.04}" y="${r + 0.04}" width="0.92" height="0.92" rx="0.14" fill="${fill}" stroke="#94a3b8" stroke-width="0.05"/>`;
    CROSS_RING.forEach(([c, r], i) => {
      const startSeat = G.starts.indexOf(i);
      const used = startSeat >= 0 && seats.includes(startSeat);
      cells.push(rect(c, r, startSeat >= 0 ? (used ? SEAT[startSeat].hex : SEAT[startSeat].light) : '#f1f5f9'));
      if (G.safe.has(i) && startSeat < 0) cells.push(`<text x="${c + 0.5}" y="${r + 0.72}" text-anchor="middle" font-size="0.62" fill="#94a3b8">★</text>`);
      if (startSeat >= 0) cells.push(`<text x="${c + 0.5}" y="${r + 0.72}" text-anchor="middle" font-size="0.62" fill="#fff">★</text>`);
    });
    for (let k = 0; k < 4; k++) crossLane(k).forEach(([c, r]) => cells.push(rect(c, r, seats.includes(k) ? SEAT[k].light : '#f1f5f9')));
    const yards = [0, 1, 2, 3].map((k) => {
      const active = seats.includes(k);
      const [x, y] = rot([3, 3], k);
      const slots = YARD0.map((p) => rot(p, k)).map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="0.78" fill="${active ? SEAT[k].dark : '#cbd5e1'}" opacity="${active ? 0.22 : 0.5}"/>`).join('');
      return `<g><rect x="${x - 3}" y="${y - 3}" width="6" height="6" rx="0.5" fill="${active ? SEAT[k].hex : '#cbd5e1'}"/><rect x="${x - 2.4}" y="${y - 2.4}" width="4.8" height="4.8" rx="0.45" fill="#fff" opacity="${active ? 0.92 : 0.6}"/>${slots}</g>`;
    }).join('');
    const tri = (pts, k) => `<polygon points="${pts}" fill="${seats.includes(k) ? SEAT[k].hex : '#cbd5e1'}"/>`;
    const centre = `${tri('6,6 6,9 7.5,7.5', 0)}${tri('6,6 9,6 7.5,7.5', 1)}${tri('9,6 9,9 7.5,7.5', 2)}${tri('6,9 9,9 7.5,7.5', 3)}`;
    return `<svg class="ludo-svg" viewBox="0 0 15 15" aria-hidden="true" focusable="false"><rect width="15" height="15" rx="0.7" fill="#fff"/>${yards}${cells.join('')}${centre}<circle cx="7.5" cy="7.5" r="0.28" fill="#fff" opacity=".9"/></svg>`;
  }

  function hexSVG(b, seats) {
    const used = (k) => seats.includes(k);
    const f = (n) => n.toFixed(2);
    const h = b.size * 0.47; // half a square, leaving a thin gap
    // a square lined up with its arm: `ang` is the arm's direction, so the corners turn with it
    const sq = ({ p, ang }, fill, stroke = '#94a3b8') => {
      const a = (ang * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => `${f(p[0] + x * c - y * s)},${f(p[1] + x * s + y * c)}`).join(' ');
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="0.3" stroke-linejoin="round"/>`;
    };
    const mark = (p, ch, fill, size, rot = 0) => `<text x="${f(p[0])}" y="${f(p[1] + size * 0.36)}" text-anchor="middle" font-size="${size}" fill="${fill}" transform="rotate(${rot} ${f(p[0])} ${f(p[1])})">${ch}</text>`;
    const startSeat = (i) => b.starts.indexOf(i);
    const yards = b.yards.map((y, k) => {
      const on = used(k);
      const holes = y.slots.map((q) => `<circle cx="${f(q[0])}" cy="${f(q[1])}" r="${f(b.size * 0.4)}" fill="${on ? SEAT[k].dark : '#94a3b8'}" opacity="${on ? 0.3 : 0.4}"/>`).join('');
      return `<g><polygon points="${y.tri.map((q) => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="${on ? SEAT[k].hex : '#cbd5e1'}" stroke="#fff" stroke-width="0.4" stroke-linejoin="round"/><circle cx="${f(y.c[0])}" cy="${f(y.c[1])}" r="${f(y.r)}" fill="#fff" opacity="${on ? 0.92 : 0.6}"/>${holes}</g>`;
    }).join('');
    const track = b.track.map((t, i) => {
      const k = startSeat(i);
      const exit = b.starts.indexOf((i + 2) % b.track.length); // the arm's tip is two squares before its start
      let out = sq(t, k >= 0 ? (used(k) ? SEAT[k].hex : '#cbd5e1') : '#ffffff');
      // the arrow at the tip of each arm points in along the home lane, towards the centre of the hexagon
      if (exit >= 0) out += mark(t.p, '▲', used(exit) ? SEAT[exit].hex : '#94a3b8', b.size * 0.8, t.ang + 180 + 90);
      else if (b.safe.includes(i)) out += mark(t.p, '★', k >= 0 ? '#fff' : '#94a3b8', b.size * 0.7);
      return out;
    }).join('');
    const lanes = b.lanes.map((lane, k) => lane.map((t) => sq(t, used(k) ? SEAT[k].hex : '#e2e8f0', '#fff')).join('')).join('');
    const homes = b.homes.map((tri, k) => `<polygon points="${tri.map((q) => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="${used(k) ? SEAT[k].hex : '#cbd5e1'}" stroke="#fff" stroke-width="0.3" stroke-linejoin="round"/>`).join('');
    const hex = `<polygon points="${b.hexagon.map((q) => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="#fff" stroke="#64748b" stroke-width="0.4" stroke-linejoin="round"/>`;
    return `<svg class="ludo-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><rect width="100" height="100" rx="2" fill="#fff"/>${yards}${track}${lanes}${hex}${homes}<circle cx="50" cy="50" r="${f(b.size * 0.35)}" fill="#fff" opacity=".9"/></svg>`;
  }

  function boardSVG(v) {
    const seats = seatsFor(v.n);
    return v.board ? hexSVG(v.board, seats) : crossSVG(seats);
  }

  function tokensHTML(v) {
    const G = ui.geo;
    const seats = v.players.map((p, i) => (Number.isInteger(p.seat) ? p.seat : seatsFor(v.n)[i]));
    // tokens that share a ring square are fanned out so each stays visible and tappable
    const groups = new Map();
    const shownTokens = v.players.map((p, i) => p.tokens.map((pos, t) => shownPos(`${i}-${t}`, pos)));
    v.players.forEach((p, i) => p.tokens.forEach((realPos, t) => {
      const pos = shownTokens[i][t];
      const key = ringKey(G, seats[i], pos);
      if (key) groups.set(key, (groups.get(key) || 0) + 1);
    }));
    const seen = new Map();
    const FAN = { 2: [[-0.2, 0], [0.2, 0]], 3: [[-0.2, -0.16], [0.2, -0.16], [0, 0.2]], 4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] };
    const out = [];
    v.players.forEach((p, i) => p.tokens.forEach((realPos, t) => {
      const pos = shownTokens[i][t];
      const seat = seats[i];
      let [x, y] = G.where(seat, pos, t);
      const key = ringKey(G, seat, pos);
      let stack = 1;
      if (key && groups.get(key) > 1) {
        stack = Math.min(groups.get(key), 4);
        const idx = seen.get(key) || 0; seen.set(key, idx + 1);
        const off = (FAN[stack] || FAN[4])[idx % stack];
        x += off[0] * G.fan; y += off[1] * G.fan;
      }
      const home = pos === G.finished;
      // on the six-arm board finished tokens are counted in a badge in the centre, not stacked on top of each other
      if (home && ui.isHex) return;
      const legal = !busy() && i === v.me && v.canMove && (v.legalTokens || []).includes(t);
      const label = pos === -1 ? `Bring token ${t + 1} out` : pos >= G.lap && !home ? `Move home-column token ${t + 1}` : `Move token ${t + 1}`;
      const moved = ui.plans.has(`${i}-${t}`);
      const pid = `${i}-${t}`;
      out.push(`<button type="button" class="ludo-token ${SEAT[seat].name} ${legal ? 'legal' : ''} ${stack > 1 ? 'stacked' : ''} ${home ? 'done' : ''} ${moved ? 'moved' : ''}" data-pid="${pid}" ${legal ? `data-lt="tok:${t}" aria-label="${label}"` : `disabled tabindex="-1" aria-label="${esc(p.name)} token ${t + 1}"`} style="left:${(x / G.S) * 100}%;top:${(y / G.S) * 100}%"><i></i></button>`);
    }));
    if (ui.isHex) {
      v.players.forEach((p, i) => {
        const done = shownTokens[i].filter((x) => x === G.finished).length; // counted when the walk ends, not before
        if (!done) return;
        const c = G.where(seats[i], G.finished, 0);
        out.push(`<span class="ludo-home-count" style="left:${c[0]}%;top:${c[1]}%;--c:${SEAT[seats[i]].hex};--d:${SEAT[seats[i]].dark}" aria-label="${esc(p.name)}: ${done} of 4 home">${done}/4</span>`);
      });
    }
    return out.join('');
  }

  /* On the hexagon the squares are close together, so the tokens cannot each have a large touch target on the board.
   * These buttons list the legal moves with full-size targets. */
  function pickHTML(v) {
    if (!ui.isHex || !v.canMove) return '';
    const me = v.players[v.me];
    // each button says where its token stands, so it can be matched with a piece on the board
    const where = (pos) => (pos === -1 ? 'in the yard' : pos >= ui.geo.lap ? `${ui.geo.finished - pos} steps from home` : `${pos + 1} squares along the track`);
    return `<div class="ludo-picks" role="group" aria-label="Legal moves">${(v.legalTokens || []).map((t) => `<button type="button" class="btn ludo-pick" data-lt="tok:${t}" ${busy() ? 'disabled' : ''}>Token ${t + 1}: ${where(me.tokens[t])}</button>`).join('')}</div>`;
  }

  function dieHTML(d, rolling) {
    const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    const on = new Set(PIPS[d] || []);
    return `<div class="ludo-die ${rolling ? 'rolling' : ''} ${d ? '' : 'blank'}" role="img" aria-label="${d ? 'Dice shows ' + d : 'Dice not rolled yet'}">${d ? Array.from({ length: 9 }, (_, k) => `<span class="${on.has(k) ? 'on' : ''}"></span>`).join('') : '<b>?</b>'}</div>`;
  }

  function statusLine(v) {
    const nm = (i) => (v.players[i] ? esc(v.players[i].name) : 'A player');
    if (v.phase === 'gameOver') return v.winner >= 0 ? `${nm(v.winner)} wins!` : 'Game over';
    if (v.phase === 'ready') return v.me >= 0 && !v.players[v.me].ready ? 'Ready to start?' : 'Waiting for the others…';
    if (busy() && v.phase !== 'gameOver') return `${nm(v.lastMove ? v.lastMove.player : v.turn)} is moving…`;
    if (v.phase === 'rolling') return v.canRoll ? 'Your turn — roll the dice' : `${nm(v.turn)} is rolling…`;
    if (v.phase === 'moving') return v.canMove ? (v.autoPlay ? 'Only one move: playing it' : 'Pick a glowing token') : `${nm(v.turn)} is moving…`;
    return 'Ludo';
  }
  function lastEvent(v) {
    const e = (v.log || []).slice(-1)[0];
    if (!e || v.phase === 'ready') return '';
    const icon = e.kind === 'capture' ? '⚔️' : e.kind === 'home' ? '🏁' : e.kind === 'miss' ? '↪️' : e.kind === 'roll' ? '🎲' : '•';
    return `${icon} ${esc(e.by)} ${esc(e.card)}`;
  }

  function barHTML(v) {
    const turnSeat = v.players[v.turn] ? SEAT[Number.isInteger(v.players[v.turn].seat) ? v.players[v.turn].seat : seatsFor(v.n)[v.turn]] : SEAT[0];
    const rolling = v.dice !== null && v.dice !== undefined && ui.rollSeq !== null && v.event && v.event.seq !== ui.rollSeq;
    let action = '';
    if (v.me >= 0) {
      if (v.phase === 'ready') action = `<button class="btn big ludo-roll" data-lt="ready" ${v.players[v.me].ready ? 'disabled' : ''}>${v.players[v.me].ready ? 'Waiting…' : 'I’m ready'}</button>`;
      else if (v.phase === 'rolling') action = `<button class="btn big ludo-roll" data-lt="roll" ${v.canRoll && !busy() ? '' : 'disabled'}>${v.canRoll ? (busy() ? 'Moving…' : 'Roll dice') : 'Waiting…'}</button>`;
    }
    const sixes = v.sixes ? `<small>${v.sixes === 1 ? 'A six — roll again after moving' : 'Two sixes in a row — a third ends your turn'}</small>` : '';
    return `<div class="ludo-dice-panel ludo-status ${v.myTurn ? 'mine' : ''}" style="--turn:${turnSeat.hex}">
      ${dieHTML(v.dice, rolling)}
      <div class="ludo-dice-copy"><b>${statusLine(v)}</b>${sixes || (lastEvent(v) ? `<small>${lastEvent(v)}</small>` : '')}</div>
      ${action}
    </div>`;
  }

  function playersHTML(v) {
    const lead = (window.CardTable.pt ? window.CardTable.pt.leaderOf : () => -1)(v.players.length, (k) => v.players[k].tokens.reduce((s, x) => s + (x === ui.geo.finished ? 100 : Math.max(x, 0)), 0), 1);
    return `<ul class="ludo-players" aria-label="Players">${v.players.map((p, i) => {
      const seat = SEAT[Number.isInteger(p.seat) ? p.seat : seatsFor(v.n)[i]];
      const home = p.tokens.filter((x) => x === ui.geo.finished).length;
      const active = i === v.turn && v.phase !== 'gameOver' && v.phase !== 'ready';
      const pips = [0, 1, 2, 3].map((k) => `<i class="${k < home ? 'on' : ''}"></i>`).join('');
      return `<li data-vid="${esc(p.id)}" data-pid="${esc(p.id)}" class="ludo-player ${active ? 'active' : ''} ${i === v.me ? 'you' : ''}" style="--c:${seat.hex}"><span class="player-dot"></span><b>${i === lead && (v.phase === 'rolling' || v.phase === 'moving') ? '<span class="crown" title="In the lead">👑</span> ' : ''}${esc(p.name)}${i === v.me ? ' <small>you</small>' : ''}</b><span class="pips" title="${home} of 4 home">${pips}</span></li>`;
    }).join('')}</ul>`;
  }

  function endHTML(v, ctx) {
    if (v.phase !== 'gameOver') return '';
    const w = v.winner >= 0 ? esc(v.players[v.winner].name) : 'Nobody';
    const order = (v.finishedOrder || []).map((i, k) => `<li><span>${k + 1}</span>${esc(v.players[i].name)}</li>`).join('');
    return `<div class="ludo-end"><b>${v.me === v.winner ? 'You won! 🎉' : `${w} won`}</b><ol>${order}</ol><div class="row">${ctx && ctx.isHost ? '<button class="btn" data-lt="again">Play again</button>' : '<small>The host can start a rematch.</small>'}<button class="btn ghost" data-lt="leave">Leave table</button></div></div>`;
  }

  function render(root, v, ctx) {
    ui.latest = v; ui.ctx = ctx; ui.root = root;
    ui.isHex = !!v.board;
    ui.geo = v.board ? hexGeo(v.board) : CROSS_GEO;
    react(v); planMoves(v);
    // remember where tokens were so moves glide instead of jumping
    const before = new Map();
    root.querySelectorAll('.ludo-token[data-pid]').forEach((el) => before.set(el.dataset.pid, [el.style.left, el.style.top]));
    root.innerHTML = `<section class="ludo ${v.phase === 'gameOver' ? 'over' : ''}">
      <div class="wz-top"><div class="wz-round"><b>Ludo</b><span class="label"> · ${v.players.length} players</span></div>${CardTable.toolbarSeed('<button class="btn ghost small" data-act="activityLog" aria-label="Open game log">📜 Log</button>', 'lt', 'ludo-tools')}</div>
      <div class="ludo-layout">
        <div class="ludo-main">${barHTML(v)}<div class="ludo-board ${ui.isHex ? 'hex' : ''}" style="--n:${v.n}">${boardSVG(v)}<div class="ludo-tokens">${tokensHTML(v)}</div></div>${pickHTML(v)}</div>
        <aside class="ludo-side">${playersHTML(v)}${endHTML(v, ctx)}</aside>
      </div>
    </section>`;
    ui.rollSeq = v.event ? v.event.seq : null;
    if (before.size) {
      const moving = [];
      root.querySelectorAll('.ludo-token[data-pid]').forEach((el) => {
        const old = before.get(el.dataset.pid);
        if (old && (old[0] !== el.style.left || old[1] !== el.style.top)) moving.push([el, el.style.left, el.style.top, old]);
      });
      moving.forEach(([el, , , old]) => { el.style.transition = 'none'; el.style.left = old[0]; el.style.top = old[1]; });
      if (moving.length) {
        void root.offsetWidth; // commit the old positions, then animate to the new ones
        moving.forEach(([el, l, t]) => { el.style.transition = ''; el.style.left = l; el.style.top = t; });
      }
    }
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-lt]');
    if (!el || el.disabled) return;
    const v = ui.latest; const ctx = ui.ctx;
    if (!v || !ctx) return;
    const a = el.dataset.lt;
    if (a === 'roll') { if (!busy()) ctx.act({ type: 'roll' }); }
    else if (a === 'ready') ctx.act({ type: 'ready' });
    else if (a === 'rules') ctx.showRules();
    else if (a === 'again') ctx.rematch();
    else if (a === 'leave') ctx.leave();
    else if (a.startsWith('tok:')) {
      const token = Number(a.slice(4));
      if (!busy() && Number.isInteger(token) && v.canMove && (v.legalTokens || []).includes(token)) ctx.act({ type: 'move', token });
    }
  }

  window.CardTable.register('ludo', { render });
})();
