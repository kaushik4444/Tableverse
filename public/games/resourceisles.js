/* Resource Isles (4 players): the island is drawn as an SVG. Legal spots are tap targets on the board; the bottom bar has
 * the dice, the cards in hand and the moves. The engine says what is legal (view.legal), so the table only asks it. Styles in
 * resourceisles.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { root: null, ctx: null, v: null, mode: null, victim: null, cards: null, owedKey: null, trade: { give: 'clay', get: 'timber' }, seq: null, resultSeen: null };
  const RES = ['timber', 'clay', 'wool', 'grain', 'stone'];
  const RES_NAME = { timber: 'Timber', clay: 'Clay', wool: 'Wool', grain: 'Grain', stone: 'Stone' };
  const FILL = { timber: '#3f7d3a', clay: '#c4572f', wool: '#a7d26a', grain: '#e9b949', stone: '#9aa3ab', desert: '#e8d6a0' };
  const SEAT = ['Blue', 'Red', 'Orange', 'Black'];
  const SEAT_FILL = ['#2563eb', '#dc2626', '#ea580c', '#1f2937'];
  const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const COST = { road: 'timber + clay', settlement: 'timber, clay, wool, grain', city: '2 grain + 3 stone' };
  const nameOf = (v, i) => (i === v.me ? 'You' : esc(v.players[i].name));

  /** Which spots the table may tap right now, and what a tap sends. */
  function targets(v) {
    const L = v.legal;
    if (!L || !v.myTurn) return { list: [], kind: null };
    if (v.phase === 'setup') return v.setupVertex === null ? { list: L.settle, kind: 'setupSettlement' } : { list: L.road, kind: 'setupRoad' };
    if (v.phase === 'robber') return { list: L.robber.map((r) => r.hex), kind: 'robber' };
    if (v.phase === 'main' && ui.mode === 'settle') return { list: L.settle, kind: 'buildSettlement' };
    if (v.phase === 'main' && ui.mode === 'city') return { list: L.city, kind: 'buildCity' };
    if (v.phase === 'main' && ui.mode === 'road') return { list: L.road, kind: 'buildRoad' };
    return { list: [], kind: null };
  }

  function guidance(v) {
    if (v.phase === 'gameOver') {
      if (v.winner === null) return 'No winner: the board is full and the points are level';
      return v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won!' : `${esc(v.players[v.winner].name)} won`;
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is ${v.phase === 'setup' ? 'placing' : 'playing'}`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} is thinking…`;
    if (v.phase === 'setup') return v.setupVertex === null ? 'Place a settlement on a highlighted corner' : 'Now place a road from your new settlement';
    if (v.phase === 'roll') return 'Roll the dice to start your turn';
    if (v.phase === 'discard') return `A 7 was rolled: discard ${v.owed} card${v.owed === 1 ? '' : 's'}`;
    if (v.phase === 'robber') return 'Move the robber to a highlighted land';
    if (ui.mode) return `Tap a highlighted spot to build ${ui.mode === 'settle' ? 'a settlement' : ui.mode === 'city' ? 'a city' : 'a road'}`;
    return 'Build, trade, or end your turn';
  }

  function seatsHTML(v) {
    return `<div class="ri-seats">${v.players.map((p, i) => `<div class="ri-seat s${i} ${i === v.turn && v.phase !== 'gameOver' ? 'turn' : ''} ${v.winner === i ? 'won' : ''}" data-pid="${esc(p.id)}">
      <span class="ri-swatch" aria-hidden="true"></span>
      <span class="ri-who"><b>${nameOf(v, i)}</b><small>${SEAT[i]} · ${p.cards} cards${p.longest ? ' · longest road' : ''}</small></span>
      <span class="ri-vp" aria-label="${p.vp} points of ${v.target}">${p.vp}<small>/${v.target}</small></span></div>`).join('')}</div>`;
  }

  function boardHTML(v) {
    const B = v.board;
    const xs = B.verts.map((p) => p.x); const ys = B.verts.map((p) => p.y);
    const pad = 1.5;
    const x0 = Math.min(...xs) - pad; const y0 = Math.min(...ys) - pad;
    const w = Math.max(...xs) - x0 + pad; const h = Math.max(...ys) - y0 + pad;
    const P = (vi) => `${B.verts[vi].x.toFixed(3)},${B.verts[vi].y.toFixed(3)}`;
    const tgt = targets(v);
    const hexes = B.hexes.map((hx, i) => {
      const pts = hx.verts.map(P).join(' ');
      const hot = tgt.kind === 'robber' && tgt.list.includes(i);
      const label = hx.res === 'desert' ? 'Desert' : RES_NAME[hx.res];
      const tok = hx.num === null ? '' : `<circle cx="${hx.x.toFixed(3)}" cy="${hx.y.toFixed(3)}" r=".3" class="ri-token ${hx.num === 6 || hx.num === 8 ? 'hot' : ''}"/>
        <text x="${hx.x.toFixed(3)}" y="${(hx.y + 0.11).toFixed(3)}" class="ri-num">${hx.num}</text>
        <text x="${hx.x.toFixed(3)}" y="${(hx.y + 0.24).toFixed(3)}" class="ri-pips">${'•'.repeat(PIPS[hx.num] || 0)}</text>`;
      const robber = i === v.robber ? `<circle cx="${hx.x.toFixed(3)}" cy="${(hx.y - 0.42).toFixed(3)}" r=".16" class="ri-robber"/>` : '';
      const hit = hot ? `<polygon points="${pts}" class="ri-hex-hit" data-h="${i}" role="button" tabindex="0" aria-label="Move the robber to ${label}, ${hx.num || 'no number'}"/>` : '';
      return `<g class="ri-hex" data-res="${hx.res}"><polygon points="${pts}" fill="${FILL[hx.res]}" class="ri-land"/><title>${label}${hx.num ? ' ' + hx.num : ''}</title>${tok}${robber}${hit}</g>`;
    }).join('');
    const roads = B.edges.map(([a, b], e) => {
      const s = v.roads[e];
      if (s === null || s === undefined) return '';
      return `<line x1="${B.verts[a].x.toFixed(3)}" y1="${B.verts[a].y.toFixed(3)}" x2="${B.verts[b].x.toFixed(3)}" y2="${B.verts[b].y.toFixed(3)}" class="ri-road" stroke="${SEAT_FILL[s]}"><title>${SEAT[s]} road</title></line>`;
    }).join('');
    const pieces = v.buildings.map((o, i) => {
      if (!o) return '';
      const cx = B.verts[i].x.toFixed(3), cy = B.verts[i].y.toFixed(3);
      return o.city
        ? `<rect x="${(B.verts[i].x - 0.21).toFixed(3)}" y="${(B.verts[i].y - 0.21).toFixed(3)}" width=".42" height=".42" rx=".06" class="ri-city" fill="${SEAT_FILL[o.seat]}"><title>${SEAT[o.seat]} city</title></rect>`
        : `<circle cx="${cx}" cy="${cy}" r=".15" class="ri-settle" fill="${SEAT_FILL[o.seat]}"><title>${SEAT[o.seat]} settlement</title></circle>`;
    }).join('');
    const harbors = B.harbors.map((hb) => {
      const [a, b] = B.edges[hb.edge];
      const mx = (B.verts[a].x + B.verts[b].x) / 2, my = (B.verts[a].y + B.verts[b].y) / 2;
      const len = Math.hypot(mx, my) || 1;
      const lx = mx + (mx / len) * 0.55, ly = my + (my / len) * 0.55;
      const text = hb.type === 'any' ? '3:1' : '2:1';
      return `<g class="ri-harbor"><circle cx="${lx.toFixed(3)}" cy="${ly.toFixed(3)}" r=".27"/><text x="${lx.toFixed(3)}" y="${(ly + 0.1).toFixed(3)}">${text}</text><title>${hb.type === 'any' ? 'Any card, 3 for 1' : RES_NAME[hb.type] + ', 2 for 1'}</title></g>`;
    }).join('');
    const hits = tgt.kind && tgt.kind !== 'robber' ? tgt.list.map((i) => {
      const isEdge = tgt.kind === 'setupRoad' || tgt.kind === 'buildRoad';
      if (isEdge) {
        const [a, b] = B.edges[i];
        return `<line x1="${B.verts[a].x.toFixed(3)}" y1="${B.verts[a].y.toFixed(3)}" x2="${B.verts[b].x.toFixed(3)}" y2="${B.verts[b].y.toFixed(3)}" class="ri-edge-hit" data-e="${i}" role="button" tabindex="0" aria-label="Build a road here"/>`;
      }
      return `<circle cx="${B.verts[i].x.toFixed(3)}" cy="${B.verts[i].y.toFixed(3)}" r=".2" class="ri-spot" data-v="${i}" role="button" tabindex="0" aria-label="Corner ${i + 1}, ${tgt.kind === 'buildCity' ? 'build a city' : 'build a settlement'}"/>`;
    }).join('') : '';
    return `<svg class="ri-board" viewBox="${x0.toFixed(2)} ${y0.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="The island: ${v.players.length} players, ${B.hexes.length} lands">
      <rect x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" class="ri-sea"/>
      ${hexes}${roads}${pieces}${harbors}${hits}</svg>`;
  }

  function handHTML(v) {
    if (v.me < 0 || !v.hand) return '';
    const cards = RES.map((r) => `<span class="ri-card" data-res="${r}" aria-label="${RES_NAME[r]}: ${v.hand[r]}">
      <span class="ri-chip" style="background:${FILL[r]}"></span><b>${v.hand[r]}</b><small>${RES_NAME[r]}</small></span>`).join('');
    return `<div class="ri-hand" aria-label="Your cards">${cards}</div>`;
  }

  function dieHTML(v) {
    if (!v.dice) return '<div class="ri-dice" aria-label="No roll yet"><span class="ri-die ri-die-empty" aria-hidden="true">?</span><span class="ri-die ri-die-empty" aria-hidden="true">?</span></div>';
    const face = (n) => `<span class="ri-die" aria-label="${n}">${n}</span>`;
    return `<div class="ri-dice" aria-label="Dice: ${v.dice[0]} and ${v.dice[1]}">${face(v.dice[0])}${face(v.dice[1])}</div>`;
  }

  function actionsHTML(v) {
    if (v.me < 0 || !v.myTurn) return '';
    if (v.phase === 'roll') return `<div class="ri-actions"><button class="btn" data-ra="roll">Roll the dice</button></div>`;
    if (v.phase === 'discard') return discardHTML(v);
    if (v.phase === 'robber') return robberHTML(v);
    if (v.phase !== 'main') return '';
    const can = (c) => Object.entries(c).every(([r, n]) => v.hand[r] >= n);
    const mode = (m, label, cost, ok) => `<button class="btn ghost small ${ui.mode === m ? 'on' : ''}" data-mode="${m}" ${ok ? '' : 'disabled'} aria-pressed="${ui.mode === m}" title="Costs ${cost}">${label}</button>`;
    const trade = `<div class="ri-trade"><label>Give <select data-tr="give">${RES.map((r) => `<option value="${r}" ${ui.trade.give === r ? 'selected' : ''}>${RES_NAME[r]}</option>`).join('')}</select></label>
      <label>Get <select data-tr="get">${RES.map((r) => `<option value="${r}" ${ui.trade.get === r ? 'selected' : ''}>${RES_NAME[r]}</option>`).join('')}</select></label>
      <button class="btn ghost small" data-ra="trade">Trade ${v.rates[ui.trade.give]} for 1</button></div>`;
    return `<div class="ri-actions">${mode('road', 'Road', COST.road, can({ timber: 1, clay: 1 }) && v.legal.road.length)}
      ${mode('settle', 'Settlement', COST.settlement, can({ timber: 1, clay: 1, wool: 1, grain: 1 }) && v.legal.settle.length)}
      ${mode('city', 'City', COST.city, can({ grain: 2, stone: 3 }) && v.legal.city.length)}
      <button class="btn ghost small" data-ra="endTurn">End turn</button></div>${trade}`;
  }

  function discardHTML(v) {
    if (ui.owedKey !== v.owed) { ui.cards = Object.fromEntries(RES.map((r) => [r, 0])); ui.owedKey = v.owed; }
    const sum = RES.reduce((n, r) => n + ui.cards[r], 0);
    const rows = RES.filter((r) => v.hand[r] > 0).map((r) => `<span class="ri-step"><span>${RES_NAME[r]} ${ui.cards[r]}/${v.hand[r]}</span>
      <button class="btn ghost small" data-dc="${r}:-1" ${ui.cards[r] ? '' : 'disabled'} aria-label="Put back one ${RES_NAME[r]}">−</button>
      <button class="btn ghost small" data-dc="${r}:1" ${ui.cards[r] < v.hand[r] && sum < v.owed ? '' : 'disabled'} aria-label="Discard one ${RES_NAME[r]}">+</button></span>`).join('');
    return `<div class="ri-discard"><p>Choose ${v.owed} to discard: ${sum}/${v.owed}</p>${rows}
      <button class="btn" data-ra="discard" ${sum === v.owed ? '' : 'disabled'}>Discard</button></div>`;
  }

  function robberHTML(v) {
    const picked = ui.victim !== null ? ui.victim : null;
    const victims = [...new Set(v.legal.robber.flatMap((r) => r.victims))];
    if (victims.length < 2) return '<div class="ri-actions"><span class="hint">Tap the land for the robber</span></div>';
    return `<div class="ri-actions"><label>Steal from <select data-rs="victim">${victims.map((i) => `<option value="${i}" ${picked === i ? 'selected' : ''}>${nameOf(v, i)}</option>`).join('')}</select></label><span class="hint">Then tap a land</span></div>`;
  }

  function logHTML(v) {
    const lines = v.log.slice(-4).map((e) => {
      const who = e.seat === null || e.seat === undefined ? '' : nameOf(v, e.seat);
      const txt = { settle: 'built a settlement', road: 'built a road', city: 'built a city', roll: `rolled ${e.n}`, discard: `discarded ${e.n}`, robber: 'moved the robber', steal: 'took a card', trade: 'traded with the bank', end: 'ended the turn' }[e.kind] || '';
      return `<li>${who} ${txt}</li>`;
    }).join('');
    return `<ul class="ri-log" aria-label="Recent moves">${lines}</ul>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') { ui.resultSeen = null; return ''; }
    const key = v.event ? v.event.seq : null;
    const settled = ui.resultSeen === key;
    if (ui.ctx.resultVisible !== false) ui.resultSeen = key;
    const title = v.winner === null ? 'No winner' : v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    const score = v.players.map((p) => `${esc(p.name)} ${p.vp}`).join(' · ');
    return `<div class="overlay${settled ? ' settled' : ''}"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${score}</p>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-ri="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-ri="leave">Leave table</button></div></div></div>`;
  }

  /** A chime when a piece goes down, the dice clatter on a roll, a fanfare at the end. The first look plays nothing. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'roll') snd.play('place');
    else if (e.type === 'build') snd.play('land');
    else if (e.type === 'robber') snd.play('fall');
    else if (e.type === 'over') setTimeout(() => snd.play(v.winner === null ? 'round' : v.winner === v.me ? 'win' : 'lose'), 200);
  }

  function render(root, v, ctx) {
    ui.root = root; ui.ctx = ctx; ui.v = v; react(v);
    if (v.myTurn === false || v.phase === 'gameOver') ui.mode = null;
    if (ui.mode && v.phase !== 'main') ui.mode = null;
    const active = root.ownerDocument.activeElement;
    const focusKey = active && root.contains(active) && active.getAttribute ? (active.getAttribute('data-ra') || active.getAttribute('data-mode') || null) : null;
    root.innerHTML = `<div class="wz ri" data-game="resourceisles">
      <div class="wz-top"><div class="wz-round"><b>Resource Isles</b><span class="label"> · first to ${v.target}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-ri="rules">Rules</button>', 'ri')}</div>
      ${seatsHTML(v)}
      <div class="ri-main">${boardHTML(v)}</div>
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <div class="ri-bottom">${dieHTML(v)}${handHTML(v)}</div>
      ${actionsHTML(v)}${logHTML(v)}
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    root.onchange = onChange;
    root.onkeydown = onKey;
    if (focusKey) {
      const again = root.querySelector(`[data-ra="${focusKey}"],[data-mode="${focusKey}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  function send(action) { if (ui.ctx) ui.ctx.act(action); }

  function onClick(e) {
    const el = e.target.closest('[data-v],[data-e],[data-h],[data-ra],[data-mode],[data-dc],[data-ri]'); const v = ui.v;
    if (!el || !v || el.disabled) return;
    if (el.dataset.ri !== undefined) {
      if (el.dataset.ri === 'rules') ui.ctx.showRules();
      else if (el.dataset.ri === 'again') ui.ctx.rematch();
      else if (el.dataset.ri === 'leave') ui.ctx.leave();
      return;
    }
    if (el.dataset.mode !== undefined) { ui.mode = ui.mode === el.dataset.mode ? null : el.dataset.mode; rerender(); return; }
    if (el.dataset.dc !== undefined) {
      const [r, d] = el.dataset.dc.split(':');
      ui.cards[r] += Number(d); rerender(); return;
    }
    if (el.dataset.ra !== undefined) {
      switch (el.dataset.ra) {
        case 'roll': send({ type: 'roll' }); break;
        case 'endTurn': ui.mode = null; send({ type: 'endTurn' }); break;
        case 'trade': send({ type: 'trade', give: ui.trade.give, get: ui.trade.get }); break;
        case 'discard': send({ type: 'discard', cards: { ...ui.cards } }); break;
      }
      return;
    }
    const tgt = targets(v);
    if (el.dataset.v !== undefined) {
      const i = Number(el.dataset.v);
      if (tgt.kind === 'setupSettlement') send({ type: 'setupSettlement', vertex: i });
      else if (tgt.kind === 'buildSettlement' || tgt.kind === 'buildCity') { send({ type: tgt.kind, vertex: i }); ui.mode = null; }
    } else if (el.dataset.e !== undefined) {
      const i = Number(el.dataset.e);
      if (tgt.kind === 'setupRoad') send({ type: 'setupRoad', edge: i });
      else if (tgt.kind === 'buildRoad') { send({ type: 'buildRoad', edge: i }); ui.mode = null; }
    } else if (el.dataset.h !== undefined) {
      const hex = Number(el.dataset.h);
      const entry = v.legal.robber.find((r) => r.hex === hex);
      const victims = entry ? entry.victims : [];
      const victim = victims.length > 1 ? (victims.includes(ui.victim) ? ui.victim : victims[0]) : undefined;
      send({ type: 'robber', hex, victim });
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.tr !== undefined) { ui.trade[el.dataset.tr] = el.value; rerender(); }
    else if (el.dataset.rs === 'victim') ui.victim = Number(el.value);
  }

  /** Enter or Space on a focused target acts like a tap. */
  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute('role') === 'button' && !el.disabled) { e.preventDefault(); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  }

  function rerender() { if (ui.v && ui.ctx && ui.root) render(ui.root, ui.v, ui.ctx); }

  window.CardTable.register('resourceisles', { render });
})();
