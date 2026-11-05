/* Snakes and Ladders table renderer. The rules and the board layout come from games/snakesladders/engine.js (the view carries them). */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const STEP_MS = 340, JUMP_MS = 900;
  /** shown[i] is where player i's token is drawn right now; it walks square by square towards the real position. */
  const ui = { ctx: null, latest: null, root: null, seq: null, rollSeq: null, tumble: false, shown: [], timer: null, animating: false };
  const shownPos = (v, i) => (ui.shown[i] === undefined ? v.players[i].pos : ui.shown[i]);
  const HEX = { red: '#e5484d', blue: '#3b82f6', green: '#22a35a', yellow: '#e8b923' };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  /** Centre of square n (1..100) in percent of the board; 0 is the start area below the bottom-left corner. Rows alternate direction. */
  function centre(n, slot = 0, count = 1) {
    if (n <= 0) return { x: 8 + slot * 9, y: 106 };
    const r = Math.floor((n - 1) / 10);
    const c0 = (n - 1) % 10;
    const c = r % 2 ? 9 - c0 : c0;
    return { x: c * 10 + 5, y: (9 - r) * 10 + 5 };
  }
  /** Tokens sharing a square are spread in a small ring so none is hidden. */
  function offset(slot, count) {
    if (count <= 1) return [0, 0];
    const a = (slot / count) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(a) * 2.6, Math.sin(a) * 2.6];
  }

  function squares() {
    let out = '';
    for (let n = 100; n >= 1; n--) {
      const r = Math.floor((n - 1) / 10), c0 = (n - 1) % 10, c = r % 2 ? 9 - c0 : c0;
      out += `<div class="sl-sq ${(r + c) % 2 ? 'alt' : ''} ${n === 100 ? 'goal' : ''}" style="grid-row:${10 - r};grid-column:${c + 1}"><i>${n === 100 ? '🏁' : n}</i></div>`;
    }
    return out;
  }

  function ladderSVG(a, b) {
    const p = centre(a), q = centre(b);
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 1.5, ny = (dx / len) * 1.5;
    const rungs = Math.max(2, Math.round(len / 6));
    let d = `M${p.x + nx},${p.y + ny}L${q.x + nx},${q.y + ny}M${p.x - nx},${p.y - ny}L${q.x - nx},${q.y - ny}`;
    for (let i = 1; i < rungs; i++) { const t = i / rungs; const x = p.x + dx * t, y = p.y + dy * t; d += `M${x + nx},${y + ny}L${x - nx},${y - ny}`; }
    return `<path class="sl-ladder" d="${d}"/>`;
  }
  function snakeSVG(head, tail, i) {
    const p = centre(head), q = centre(tail);
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const waves = Math.max(2, Math.round(len / 14)), amp = 3.2;
    let d = `M${p.x},${p.y}`;
    for (let k = 1; k <= waves * 2; k++) {
      const t = k / (waves * 2), tm = (k - 0.5) / (waves * 2);
      const sign = k % 2 ? 1 : -1;
      d += `Q${p.x + dx * tm + nx * amp * sign},${p.y + dy * tm + ny * amp * sign} ${p.x + dx * t},${p.y + dy * t}`;
    }
    const hue = ['sl-s1', 'sl-s2', 'sl-s3'][i % 3];
    return `<g class="sl-snake ${hue}"><path d="${d}"/><circle cx="${p.x}" cy="${p.y}" r="2.3"/><circle class="eye" cx="${p.x - 0.8}" cy="${p.y - 0.7}" r=".5"/><circle class="eye" cx="${p.x + 0.8}" cy="${p.y - 0.7}" r=".5"/></g>`;
  }

  function board(v) {
    const lad = Object.entries(v.ladders).map(([a, b]) => ladderSVG(+a, +b)).join('');
    const snk = Object.entries(v.snakes).map(([a, b], i) => snakeSVG(+a, +b, i)).join('');
    const pos = (i) => shownPos(v, i);
    const at = new Map();
    v.players.forEach((p, i) => at.set(pos(i), [...(at.get(pos(i)) || []), i]));
    const tokens = v.players.map((p, i) => {
      const group = at.get(pos(i));
      const slot = group.indexOf(i);
      const c = centre(pos(i), i);
      const [ox, oy] = pos(i) > 0 ? offset(slot, group.length) : [0, 0];
      const turn = i === v.turn && v.phase !== 'gameOver';
      return `<span data-i="${i}" class="sl-token ${p.color} ${i === v.me ? 'me' : ''} ${turn ? 'turn' : ''}" style="left:${c.x + ox}%;top:${c.y + oy}%" role="img" aria-label="${esc(p.name)} on ${pos(i) ? 'square ' + pos(i) : 'the start'}"></span>`;
    }).join('');
    return `<div class="sl-board-wrap"><div class="sl-board" role="group" aria-label="Board, 100 squares"><div class="sl-grid">${squares()}</div>
      <svg class="sl-art" viewBox="0 0 100 100" aria-hidden="true">${lad}${snk}</svg>${tokens}<span class="sl-start-label">Start</span></div></div>`;
  }

  function die(v, tumble) {
    const d = v.lastRoll ? v.lastRoll.dice : 0;
    const pips = d ? PIPS[d].map((k) => `<i style="grid-area:${Math.floor(k / 3) + 1}/${(k % 3) + 1}"></i>`).join('') : '<b>?</b>';
    return `<div class="sl-die ${tumble ? 'tumble' : ''} ${d ? '' : 'blank'}" aria-hidden="true">${pips}</div>`;
  }

  function guidance(v) {
    if (ui.animating && v.lastRoll) return `${esc(v.players[v.lastRoll.by].name)} rolled a ${v.lastRoll.dice}`;
    if (v.phase === 'gameOver') return v.winner >= 0 ? `${esc(v.players[v.winner].name)} reached 100` : 'Game over';
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is rolling`;
    return v.myTurn ? 'Your turn: roll the dice' : `${esc(v.players[v.turn].name)} is rolling`;
  }

  function feedback(v) {
    const last = (v.log || []).slice(-1)[0];
    if (ui.animating && v.lastRoll) return `<div class="sl-feedback" role="status"><span>🎲</span><b>${esc(v.players[v.lastRoll.by].name)} rolled a ${v.lastRoll.dice}…</b></div>`;
    if (!last) return '<div class="sl-feedback start"><span>🎲</span><b>Roll to start. First to square 100 wins.</b></div>';
    const icon = { ladder: '🪜', snake: '🐍', miss: '↪️', win: '🏆' }[last.kind] || '🎲';
    return `<div class="sl-feedback ${esc(last.kind || '')}" role="status"><span>${icon}</span><b>${esc(last.by)} ${esc(last.card)}</b></div>`;
  }

  function players(v) {
    const lead = window.CardTable.pt.leaderOf(v.players.length, (k) => shownPos(v, k)) ;
    return `<ol class="sl-players">${v.players.map((p, i) => `<li data-vid="${esc(p.id)}" data-pid="${esc(p.id)}" class="${i === v.turn && v.phase !== 'gameOver' ? 'on' : ''} ${i === v.me ? 'you' : ''}"><span class="sl-dot ${p.color}" aria-hidden="true"></span><span class="sl-pname">${i === lead && v.phase !== 'gameOver' ? '<span class="crown" title="In the lead">👑</span> ' : ''}${esc(p.name)}${i === v.me ? ' <small>(you)</small>' : ''}</span><span class="sl-pos">${p.pos ? 'Square ' + p.pos : 'Start'}</span></li>`).join('')}</ol>`;
  }

  function panel(v, tumble) {
    const roll = v.me >= 0 && v.phase !== 'gameOver'
      ? `<button type="button" class="btn big sl-roll" data-sl="roll" ${v.canRoll && !ui.animating ? '' : 'disabled'}>${v.canRoll ? (ui.animating ? 'Moving…' : 'Roll the dice') : 'Waiting for ' + esc(v.players[v.turn].name)}</button>` : '';
    return `<div class="sl-panel">${die(v, tumble)}<div class="sl-panel-copy">${v.lastRoll ? `<b>${esc(v.players[v.lastRoll.by].name)} rolled a ${v.lastRoll.dice}</b>` : '<b>No rolls yet</b>'}<small>${v.options.sixAgain ? 'A six rolls again.' : 'One roll per turn.'}${v.options.exactFinish ? ' Land on 100 exactly.' : ''}</small></div>${roll}</div>`;
  }

  function overlay(v) {
    if (v.phase !== 'gameOver' || ui.animating) return '';
    const rows = (v.placings || []).map((i, k) => `<li class="${i === v.winner ? 'win' : ''}"><span>${k === 0 ? '🏆 ' : (k + 1) + '. '}<b>${esc(v.players[i].name)}${i === v.me ? ' (you)' : ''}</b></span><span>${v.players[i].pos === 100 ? 'Finished' : 'Square ' + (v.players[i].pos || 'start')}</span></li>`).join('');
    const title = v.me >= 0 ? (v.winner === v.me ? 'You won! 🎉' : 'Game over') : 'Game over';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2><p class="hint" style="text-align:left">${esc(v.players[v.winner].name)} reached square 100 first.</p>
      <ol class="sl-final">${rows}</ol>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-sl="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-sl="leave">Leave table</button></div></div></div>`;
  }

  /** Move the existing token elements (no rebuild) so the CSS transition glides them one square at a time. */
  function placeTokens() {
    const v = ui.latest;
    if (!v || !ui.root) return;
    const at = new Map();
    v.players.forEach((p, i) => at.set(shownPos(v, i), [...(at.get(shownPos(v, i)) || []), i]));
    ui.root.querySelectorAll('.sl-token').forEach((el) => {
      const i = Number(el.dataset.i), n = shownPos(v, i), group = at.get(n);
      const c = centre(n, i);
      const [ox, oy] = n > 0 ? offset(group.indexOf(i), group.length) : [0, 0];
      el.style.left = (c.x + ox) + '%'; el.style.top = (c.y + oy) + '%';
    });
  }
  function stopAnimation() { clearTimeout(ui.timer); ui.timer = null; ui.animating = false; ui.shown = []; }
  /** Walk the token from where it was to where the dice sent it, then slide any ladder or snake. */
  function animate(e) {
    const path = [];
    for (let n = e.from + 1; n <= (e.landed || e.from); n++) path.push({ n, ms: STEP_MS });
    if (e.landed !== undefined && e.to !== e.landed) path.push({ n: e.to, ms: JUMP_MS });
    stopAnimation();
    if (!path.length) return;
    ui.animating = true; ui.shown[e.by] = e.from;
    const snd = window.CardTable.sound;
    const next = () => {
      const step = path.shift();
      if (!step) { stopAnimation(); if (ui.root && ui.latest) render(ui.root, ui.latest, ui.ctx); return; }
      if (ui.root) ui.root.querySelector('.sl').classList.toggle('sl-jumping', step.ms === JUMP_MS);
      ui.shown[e.by] = step.n; placeTokens();
      if (snd && step.ms === STEP_MS) snd.play('card');
      ui.timer = setTimeout(next, step.ms + (path.length ? 0 : 500)); // a beat after the last square before the turn moves on
    };
    ui.timer = setTimeout(next, 450); // let the die tumble first
  }

  function react(v) {
    const e = v.event;
    const snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; ui.rollSeq = v.lastRoll ? v.lastRoll.seq : 0; return; } // first render (page load or reconnect): no replay
    ui.tumble = Boolean(v.lastRoll && v.lastRoll.seq !== ui.rollSeq);
    ui.rollSeq = v.lastRoll ? v.lastRoll.seq : 0;
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if ((e.type === 'rolled' || e.type === 'won') && e.from !== undefined && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) animate(e);
    if (!snd) return;
    const last = (v.log || []).slice(-1)[0];
    if (v.phase === 'gameOver') snd.play(v.winner === v.me ? 'win' : 'lose');
    else if (last && last.kind === 'ladder') snd.play('collect');
    else snd.play('card');
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v; ui.root = root;
    react(v);
    root.innerHTML = `
    <div class="wz sl">
      <div class="wz-top">
        <div class="wz-round"><b>Snakes and Ladders</b></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-sl="rules">Rules</button>', 'sl')}
      </div>
      <div class="wz-status ${v.myTurn && v.phase !== 'gameOver' ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${feedback(v)}
      <div class="sl-layout"><main class="sl-play">${board(v)}</main><aside class="sl-side">${panel(v, ui.tumble)}${players(v)}</aside></div>
      ${overlay(v)}
    </div>`;
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-sl]');
    const v = ui.latest, ctx = ui.ctx;
    if (!el || !v || !ctx || el.disabled) return;
    switch (el.dataset.sl) {
      case 'roll': if (v.canRoll && !ui.animating) ctx.act({ type: 'roll' }); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('snakesladders', { render });
})();
