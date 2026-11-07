/* Ludo table renderer: a classic cross board drawn as one SVG, glossy tokens on top, and a single compact turn bar.
 * Rules and server state live in games/ludo/engine.js; this file only draws a view and sends { roll | ready | move }.
 *
 * Geometry (cell units on a 15 x 15 board, a cell's centre is +0.5): seat 0 is the top-left yard and the other seats
 * follow clockwise. Everything for seat 0 is defined once and rotated by 90 degrees per seat. */
(() => {
  'use strict';
  const { esc } = window.CardTable;

  const LAP = 51; // ring squares a token walks (internal positions 0..50), then 51..55 = home column, 56 = home
  const FINISHED = 56;
  const SEAT = [
    { name: 'red', hex: '#ef4444', dark: '#b91c1c', light: '#fecaca' },
    { name: 'green', hex: '#22c55e', dark: '#15803d', light: '#bbf7d0' },
    { name: 'yellow', hex: '#f5b301', dark: '#b45309', light: '#fde68a' },
    { name: 'blue', hex: '#3b82f6', dark: '#1d4ed8', light: '#bfdbfe' },
  ];
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // ring squares that protect from capture
  const seatsFor = (n) => (n === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, n));

  // rotate a point (cell units) a quarter turn clockwise, k times
  const rot = ([x, y], k) => { for (let i = 0; i < k; i++) [x, y] = [15 - y, x]; return [x, y]; };
  const center = ([c, r]) => [c + 0.5, r + 0.5];

  // Ring: 13 squares for seat 0 (start square first), rotated for the next three seats.
  const RING0 = [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0]];
  const RING = [];
  for (let k = 0; k < 4; k++) for (const cell of RING0) RING.push(rot(center(cell), k).map((v) => v - 0.5));
  // Home column for seat 0: five squares leading to the centre; position 56 sits in the centre triangle.
  const LANE0 = [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]];
  const lane = (seat) => LANE0.map((cell) => rot(center(cell), seat).map((v) => v - 0.5));
  const YARD0 = [[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]]; // token slots in the top-left yard
  const HOME0 = [[6.45, 7.05], [6.45, 7.5], [6.45, 7.95], [6.85, 7.5]]; // finished tokens in the seat's centre triangle

  /** Centre of the square a token stands on, in cell units. */
  function where(seat, pos, t) {
    if (pos === -1) return rot(YARD0[t], seat);
    if (pos === FINISHED) return rot(HOME0[t % 4], seat);
    if (pos >= LAP) return center(lane(seat)[pos - LAP]);
    return center(RING[(seat * 13 + pos) % 52]);
  }
  const ringKey = (seat, pos) => (pos >= 0 && pos < LAP ? 'r' + ((seat * 13 + pos) % 52) : null);

  const ui = { ctx: null, latest: null, root: null, rollSeq: null, positions: new Map(), seq: null, myTurnWas: false,
    key: null, disp: new Map(), plans: new Map(), snaps: new Map(), timer: null, holdUntil: 0 };
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

  function boardSVG(n) {
    const seats = seatsFor(n);
    const cells = [];
    const rect = (c, r, fill, extra = '') => `<rect x="${c + 0.04}" y="${r + 0.04}" width="0.92" height="0.92" rx="0.14" fill="${fill}" ${extra}/>`;
    RING.forEach(([c, r], i) => {
      const startSeat = i % 13 === 0 ? i / 13 : -1;
      const used = startSeat >= 0 && seats.includes(startSeat);
      cells.push(rect(c, r, startSeat >= 0 ? SEAT[startSeat].hex : '#f1f5f9'));
      if (startSeat >= 0 && !used) cells[cells.length - 1] = rect(c, r, SEAT[startSeat].light);
      if (SAFE.has(i) && startSeat < 0) cells.push(`<text x="${c + 0.5}" y="${r + 0.72}" text-anchor="middle" font-size="0.62" fill="#94a3b8">★</text>`);
      if (startSeat >= 0) cells.push(`<text x="${c + 0.5}" y="${r + 0.72}" text-anchor="middle" font-size="0.62" fill="#fff">★</text>`);
    });
    for (let k = 0; k < 4; k++) lane(k).forEach(([c, r]) => cells.push(rect(c, r, seats.includes(k) ? SEAT[k].light : '#f1f5f9')));
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

  function tokensHTML(v) {
    const seats = v.players.map((p, i) => (Number.isInteger(p.seat) ? p.seat : seatsFor(v.n)[i]));
    // tokens that share a ring square are fanned out so each stays visible and tappable
    const groups = new Map();
    const shownTokens = v.players.map((p, i) => p.tokens.map((pos, t) => shownPos(`${i}-${t}`, pos)));
    v.players.forEach((p, i) => p.tokens.forEach((realPos, t) => {
      const pos = shownTokens[i][t];
      const key = ringKey(seats[i], pos);
      if (key) groups.set(key, (groups.get(key) || 0) + 1);
    }));
    const seen = new Map();
    const FAN = { 2: [[-0.2, 0], [0.2, 0]], 3: [[-0.2, -0.16], [0.2, -0.16], [0, 0.2]], 4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] };
    const out = [];
    const last = v.lastMove;
    v.players.forEach((p, i) => p.tokens.forEach((realPos, t) => {
      const pos = shownTokens[i][t];
      const seat = seats[i];
      let [x, y] = where(seat, pos, t);
      const key = ringKey(seat, pos);
      let stack = 1;
      if (key && groups.get(key) > 1) {
        stack = Math.min(groups.get(key), 4);
        const idx = seen.get(key) || 0; seen.set(key, idx + 1);
        const off = (FAN[stack] || FAN[4])[idx % stack];
        x += off[0]; y += off[1];
      }
      const legal = !busy() && i === v.me && v.canMove && (v.legalTokens || []).includes(t);
      const home = pos === FINISHED;
      const label = pos === -1 ? `Bring token ${t + 1} out` : pos >= LAP && !home ? `Move home-column token ${t + 1}` : `Move token ${t + 1}`;
      const moved = ui.plans.has(`${i}-${t}`);
      const pid = `${i}-${t}`;
      out.push(`<button type="button" class="ludo-token ${SEAT[seat].name} ${legal ? 'legal' : ''} ${stack > 1 ? 'stacked' : ''} ${home ? 'done' : ''} ${moved ? 'moved' : ''}" data-pid="${pid}" ${legal ? `data-lt="tok:${t}" aria-label="${label}"` : `disabled tabindex="-1" aria-label="${esc(p.name)} token ${t + 1}"`} style="left:${(x / 15) * 100}%;top:${(y / 15) * 100}%"><i></i></button>`);
    }));
    return out.join('');
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
    const lead = (window.CardTable.pt ? window.CardTable.pt.leaderOf : () => -1)(v.players.length, (k) => v.players[k].tokens.reduce((s, x) => s + (x === FINISHED ? 100 : Math.max(x, 0)), 0), 1);
    return `<ul class="ludo-players" aria-label="Players">${v.players.map((p, i) => {
      const seat = SEAT[Number.isInteger(p.seat) ? p.seat : seatsFor(v.n)[i]];
      const home = p.tokens.filter((x) => x === FINISHED).length;
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
    react(v); planMoves(v);
    // remember where tokens were so moves glide instead of jumping
    const before = new Map();
    root.querySelectorAll('.ludo-token[data-pid]').forEach((el) => before.set(el.dataset.pid, [el.style.left, el.style.top]));
    root.innerHTML = `<section class="ludo ${v.phase === 'gameOver' ? 'over' : ''}">
      <div class="wz-top"><div class="wz-round"><b>Ludo</b><span class="label"> · ${v.players.length} players</span></div>${CardTable.toolbarSeed('<button class="btn ghost small" data-act="activityLog" aria-label="Open game log">📜 Log</button>', 'lt', 'ludo-tools')}</div>
      <div class="ludo-layout">
        <div class="ludo-main">${barHTML(v)}<div class="ludo-board" style="--n:${v.n}">${boardSVG(v.n)}<div class="ludo-tokens">${tokensHTML(v)}</div></div></div>
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
