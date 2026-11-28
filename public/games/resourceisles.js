/* Resource Isles (4 players). The island is one SVG drawn here (tiles, number tokens, harbours, roads, houses); the seats, dice,
 * cards in hand and moves are HTML around it. Every picture is drawn in code: nothing is loaded. The engine says what is legal
 * (view.legal), so the table only asks it. Styles are in resourceisles.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { root: null, ctx: null, v: null, mode: null, tray: null, victim: null, cards: null, owedKey: null, trade: { give: 'clay', get: 'timber' }, seq: null, glowSeq: null, rollSeq: null, logOpen: false, resultSeen: null };
  const RES = ['timber', 'clay', 'wool', 'grain', 'stone'];
  const RES_NAME = { timber: 'Timber', clay: 'Clay', wool: 'Wool', grain: 'Grain', stone: 'Stone', desert: 'Desert' };
  // light and dark end of each tile, and the same pair used for the cards in hand
  const TONE = { timber: ['#4fae52', '#2a7a35'], clay: ['#ec8445', '#c45a29'], wool: ['#bde35f', '#92c23f'], grain: ['#f8cf55', '#e1a722'], stone: ['#b5bdc4', '#8a929a'], desert: ['#f2e5b6', '#decb8c'] };
  const SEAT = ['Blue', 'Red', 'Orange', 'Black'];
  const SEAT_FILL = ['#2f6fe4', '#e0382f', '#f08224', '#2b3445'];
  const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const COSTS = { road: { timber: 1, clay: 1 }, settlement: { timber: 1, clay: 1, wool: 1, grain: 1 }, city: { grain: 2, stone: 3 } };
  const PHASE_LABEL = { setup: 'Placing', roll: 'Rolling', discard: 'Waiting', robber: 'Robber', main: 'Building' };
  const nameOf = (v, i) => (i === v.me ? 'You' : esc(v.players[i].name));

  /* ---------- little pictures, all in a 1-unit box centred on 0,0 ---------- */
  const pine = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -.5 L.2 -.18 H.1 L.26 .12 H.08 L.3 .38 H-.3 L-.08 .12 H-.26 L-.1 -.18 H-.2Z" fill="#1f7a34" stroke="#0e4220" stroke-width=".035" stroke-linejoin="round"/><rect x="-.05" y=".38" width=".1" height=".13" fill="#6d4c2f"/></g>`;
  const brick = (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height=".17" rx=".025" fill="#f6b99a" stroke="#8a3512" stroke-width=".03"/>`;
  const ICON = {
    timber: () => pine(-0.2, 0, 0.8) + pine(0.24, 0.07, 0.62),
    clay: () => [-0.3, -0.1, 0.1].map((y, r) => (r % 2 === 0
      ? brick(-0.48, y, 0.3) + brick(-0.15, y, 0.3) + brick(0.18, y, 0.3)
      : brick(-0.5, y, 0.14) + brick(-0.33, y, 0.3) + brick(0.0, y, 0.3) + brick(0.33, y, 0.17))).join(''),
    wool: () => '<g stroke="#4b5563" stroke-width=".025"><circle cx="-.16" cy=".02" r=".14" fill="#fff"/><circle cx=".0" cy="-.06" r=".19" fill="#fff"/><circle cx=".15" cy=".03" r=".15" fill="#fff"/><circle cx="-.02" cy=".08" r=".16" fill="#fff"/></g><ellipse cx=".3" cy="-.02" rx=".085" ry=".11" fill="#374151"/><rect x="-.12" y=".18" width=".05" height=".15" rx=".02" fill="#374151"/><rect x=".08" y=".18" width=".05" height=".15" rx=".02" fill="#374151"/>',
    grain: () => '<path d="M0 .46 V-.34" stroke="#8a5a12" stroke-width=".055" stroke-linecap="round"/>' + [-0.22, -0.1, 0.02, 0.14].map((y) => `<ellipse cx="-.1" cy="${y}" rx=".07" ry=".13" transform="rotate(-35 -.1 ${y})" fill="#b7791f" stroke="#7a4d0b" stroke-width=".02"/><ellipse cx=".1" cy="${y}" rx=".07" ry=".13" transform="rotate(35 .1 ${y})" fill="#b7791f" stroke="#7a4d0b" stroke-width=".02"/>`).join('') + '<ellipse cx="0" cy="-.38" rx=".065" ry=".13" fill="#b7791f" stroke="#7a4d0b" stroke-width=".02"/>',
    stone: () => '<path d="M-.46 .3 L-.34 -.02 L-.08 -.14 L.14 .02 L.2 .3Z" fill="#e4e8eb" stroke="#5f6870" stroke-width=".035" stroke-linejoin="round"/><path d="M0 .3 L.1 .04 L.3 -.04 L.48 .3Z" fill="#cdd3d8" stroke="#5f6870" stroke-width=".035" stroke-linejoin="round"/><path d="M-.22 -.1 L-.06 -.34 L.14 -.22 L.12 -.04Z" fill="#f1f4f6" stroke="#5f6870" stroke-width=".035" stroke-linejoin="round"/>',
    desert: () => '<g fill="#4f9a4a" stroke="#2b5e29" stroke-width=".03"><rect x="-.07" y="-.34" width=".14" height=".7" rx=".07"/><rect x="-.27" y="-.12" width=".22" height=".09" rx=".045"/><rect x="-.27" y="-.26" width=".09" height=".23" rx=".045"/><rect x=".05" y=".02" width=".22" height=".09" rx=".045"/><rect x=".18" y="-.12" width=".09" height=".23" rx=".045"/></g>',
  };
  const iconAt = (res, x, y, s) => `<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${s})" class="ri-icon">${ICON[res]()}</g>`;
  const miniIcon = (res, cls = '') => `<svg class="${cls}" viewBox="-.62 -.56 1.24 1.12" aria-hidden="true" focusable="false">${ICON[res]()}</svg>`;

  const GLYPH = {
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="15" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><circle cx="9" cy="15" r="1.5" fill="currentColor"/>',
    build: '<path d="M4 20 V11 L12 4 L20 11 V20 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20 V14 H14 V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    trade: '<path d="M5 8 H17 M13 4 L17 8 L13 12 M19 16 H7 M11 12 L7 16 L11 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    end: '<path d="M7 3 H17 M7 21 H17 M8 3 C8 9 16 9 16 12 C16 15 8 15 8 21 M16 3 C16 9 8 9 8 12 C8 15 16 15 16 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    road: '<path d="M4 19 L20 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    cards: '<rect x="5" y="3.5" width="11" height="15" rx="2" fill="currentColor" opacity=".55"/><rect x="8" y="6" width="11" height="15" rx="2" fill="currentColor"/>',
    cancel: '<path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  };
  const glyph = (name, cls = 'ri-glyph') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${GLYPH[name]}</svg>`;

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
      if (v.winner === null) return 'No winner: nobody can build and the points are level';
      return v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won!' : `${esc(v.players[v.winner].name)} won`;
    }
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is ${v.phase === 'setup' ? 'placing' : 'playing'}`;
    if (!v.myTurn) return v.phase === 'discard' ? 'Waiting for players to discard…' : `${esc(v.players[v.turn].name)} is thinking…`;
    if (v.phase === 'setup') return v.setupVertex === null ? 'Place a settlement on a glowing corner' : 'Now place a road from your new settlement';
    if (v.phase === 'roll') return 'Roll the dice to start your turn';
    if (v.phase === 'discard') return `A 7 was rolled: discard ${v.owed} card${v.owed === 1 ? '' : 's'}`;
    if (v.phase === 'robber') return 'Move the robber to a glowing land';
    if (ui.mode) return `Tap a glowing spot to build ${ui.mode === 'settle' ? 'a settlement' : ui.mode === 'city' ? 'a city' : 'a road'}`;
    return 'Build, trade, or end your turn';
  }

  /* ---------- seats ---------- */
  function seatLabel(v, i) {
    const p = v.players[i];
    if (v.phase === 'gameOver') return v.winner === i ? 'Winner' : '';
    if (v.phase === 'discard') return p.owed > 0 ? `Discard ${p.owed}` : '';
    if (i !== v.turn) return '';
    return i === v.me && v.myTurn ? 'Your turn' : PHASE_LABEL[v.phase] || '';
  }

  function seatsHTML(v) {
    const pt = window.CardTable.pt;
    // the one player strictly ahead on points (three or more) wears the shared crown
    const lead = pt && pt.leaderOf ? pt.leaderOf(v.players.length, (i) => v.players[i].vp, 3) : -1;
    return `<div class="ri-seats">${v.players.map((p, i) => {
      const label = seatLabel(v, i);
      const face = (pt && pt.avatarOf && pt.avatarOf(ui.ctx.room, p.id)) || ([...p.name][0] || '?').toUpperCase();
      const bg = (pt && pt.avatarColor && pt.avatarColor(p.name)) || '#555';
      // .pseat + a direct .av child: the page marks stand-in bots and speaking voice players on these
      return `<div class="pseat ri-seat s${i} ${i === v.me ? 'me' : ''} ${i === v.turn && v.phase !== 'gameOver' ? 'turn' : ''} ${v.winner === i ? 'won' : ''}" data-pid="${esc(p.id)}" role="group"
        aria-label="${esc(p.name)}, ${SEAT[i]}: ${p.vp} points, ${p.cards} cards, longest road ${p.road}${p.longest ? ' (holds the longest road)' : ''}">
        <span class="ri-vpbadge" aria-hidden="true">${p.vp}</span>
        <span class="av" style="--av:26px;--avbg:${bg}" aria-hidden="true"><span class="face">${esc(face)}</span></span>
        <span class="ri-tab">${lead === i ? '<span class="crown" aria-hidden="true">👑</span>' : ''}<b>${nameOf(v, i)}</b></span>
        <span class="ri-body">
          <span class="ri-stat" title="Cards in hand">${glyph('cards', 'ri-glyph sm')}<b>${p.cards}</b></span>
          <span class="ri-stat ${p.longest ? 'gold' : ''}" title="Longest road">${glyph('road', 'ri-glyph sm')}<b>${p.road}</b></span>
        </span>
        ${label ? `<span class="ri-pill ${i === v.me && v.myTurn ? 'mine' : ''}">${label}</span>` : ''}</div>`;
    }).join('')}</div>`;
  }

  /* ---------- the island ---------- */
  function boardHTML(v, glowSum) {
    const B = v.board;
    const tgt = targets(v);
    const P = (vi) => `${B.verts[vi].x.toFixed(3)},${B.verts[vi].y.toFixed(3)}`;
    const grow = (hx, k) => hx.verts.map((vi) => `${(hx.x + (B.verts[vi].x - hx.x) * k).toFixed(3)},${(hx.y + (B.verts[vi].y - hx.y) * k).toFixed(3)}`).join(' ');
    // harbours: a small token out at sea joined to its two corners by wooden piers
    const harbors = B.harbors.map((hb) => {
      const [a, b] = B.edges[hb.edge];
      const va = B.verts[a], vb = B.verts[b];
      const mx = (va.x + vb.x) / 2, my = (va.y + vb.y) / 2;
      const len = Math.hypot(mx, my) || 1;
      return { hb, a, b, x: mx + (mx / len) * 0.78, y: my + (my / len) * 0.78 };
    });
    const pts = [...B.verts.map((p) => [p.x, p.y]), ...harbors.flatMap((h) => [[h.x - 0.42, h.y - 0.42], [h.x + 0.42, h.y + 0.42]])];
    const x0 = Math.min(...pts.map((p) => p[0])) - 0.15, x1 = Math.max(...pts.map((p) => p[0])) + 0.15;
    const y0 = Math.min(...pts.map((p) => p[1])) - 0.15, y1 = Math.max(...pts.map((p) => p[1])) + 0.15;
    const defs = `<defs>${[...RES, 'desert'].map((r) => `<radialGradient id="ri-g-${r}" cx=".5" cy=".38" r=".78"><stop offset="0" stop-color="${TONE[r][0]}"/><stop offset="1" stop-color="${TONE[r][1]}"/></radialGradient>`).join('')}
      <filter id="ri-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy=".04" stdDeviation=".035" flood-color="#04182e" flood-opacity=".5"/></filter></defs>`;
    const water = B.hexes.map((hx) => `<polygon points="${grow(hx, 1.3)}" class="ri-shallow"/>`).join('');
    const sand = B.hexes.map((hx) => `<polygon points="${grow(hx, 1.09)}" class="ri-sand"/>`).join('');
    const lands = B.hexes.map((hx, i) => {
      const pts6 = hx.verts.map(P).join(' ');
      const hot = tgt.kind === 'robber' && tgt.list.includes(i);
      const label = RES_NAME[hx.res];
      const cx = hx.x.toFixed(3);
      const tokenY = hx.y + 0.2;
      const token = hx.num === null ? '' : `<g class="ri-tok ${hx.num === 6 || hx.num === 8 ? 'hot' : ''}"><circle cx="${cx}" cy="${tokenY.toFixed(3)}" r=".33" class="ri-token"/>
        <text x="${cx}" y="${(tokenY + 0.1).toFixed(3)}" class="ri-num">${hx.num}</text>
        ${Array.from({ length: PIPS[hx.num] || 0 }, (_, k, all) => `<circle cx="${(hx.x + (k - (PIPS[hx.num] - 1) / 2) * 0.075).toFixed(3)}" cy="${(tokenY + 0.22).toFixed(3)}" r=".027" class="ri-pip"/>`).join('')}</g>`;
      const glow = glowSum !== null && hx.num === glowSum && i !== v.robber ? `<polygon points="${pts6}" class="ri-glow"/>` : '';
      const robber = i === v.robber ? `<g class="ri-robber" transform="translate(${(hx.x - 0.4).toFixed(3)} ${(hx.y + 0.12).toFixed(3)}) scale(.78)"><ellipse cx="0" cy=".36" rx=".2" ry=".07" fill="#04182e" opacity=".35"/><path d="M-.17 .34 Q-.2 -.06 0 -.24 Q.2 -.06 .17 .34Z" fill="#7b8491" stroke="#3b4350" stroke-width=".04"/><circle cx="0" cy="-.34" r=".14" fill="#8e97a3" stroke="#3b4350" stroke-width=".04"/></g>` : '';
      const hit = hot ? `<polygon points="${pts6}" class="ri-hex-hit" data-h="${i}" role="button" tabindex="0" aria-label="Move the robber to ${label}${hx.num ? ', ' + hx.num : ''}"/>` : '';
      return `<g class="ri-hex" data-res="${hx.res}"><polygon points="${pts6}" fill="url(#ri-g-${hx.res})" class="ri-land"/><title>${label}${hx.num ? ' ' + hx.num : ''}</title>
        ${iconAt(hx.res, hx.x, hx.y - 0.4, 0.62)}${token}${glow}${robber}${hit}</g>`;
    }).join('');
    const harborsHTML = harbors.map(({ hb, a, b, x, y }) => {
      const isAny = hb.type === 'any';
      const ring = isAny ? '#e8f1ff' : TONE[hb.type][0];
      const text = isAny ? '3:1' : '2:1';
      return `<g class="ri-harbor"><line x1="${B.verts[a].x.toFixed(3)}" y1="${B.verts[a].y.toFixed(3)}" x2="${x.toFixed(3)}" y2="${y.toFixed(3)}" class="ri-pier"/><line x1="${B.verts[b].x.toFixed(3)}" y1="${B.verts[b].y.toFixed(3)}" x2="${x.toFixed(3)}" y2="${y.toFixed(3)}" class="ri-pier"/>
        <circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r=".37" class="ri-port" stroke="${ring}"/>
        ${isAny ? `<text x="${x.toFixed(3)}" y="${(y - 0.02).toFixed(3)}" class="ri-port-q">?</text>` : iconAt(hb.type, x, y - 0.1, 0.36)}
        <text x="${x.toFixed(3)}" y="${(y + 0.2).toFixed(3)}" class="ri-port-t">${text}</text><title>${isAny ? 'Any card, 3 for 1' : RES_NAME[hb.type] + ', 2 for 1'}</title></g>`;
    }).join('');
    const roads = B.edges.map(([a, b], e) => {
      const s = v.roads[e];
      if (s === null || s === undefined) return '';
      const [ax, ay, bx, by] = [B.verts[a].x, B.verts[a].y, B.verts[b].x, B.verts[b].y].map((n) => n.toFixed(3));
      return `<g class="ri-roadg"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="ri-road-edge"/><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="ri-road" stroke="${SEAT_FILL[s]}"/><title>${SEAT[s]} road</title></g>`;
    }).join('');
    const pieces = v.buildings.map((o, i) => {
      if (!o) return '';
      const c = SEAT_FILL[o.seat];
      const at = `translate(${B.verts[i].x.toFixed(3)} ${B.verts[i].y.toFixed(3)})`;
      return o.city
        ? `<g transform="${at}" class="ri-piece" filter="url(#ri-shadow)"><path d="M-.3 .2 V-.16 L-.15 -.3 L0 -.16 V-.04 H.3 V.2Z" fill="${c}" stroke="#0b1220" stroke-width=".045" stroke-linejoin="round"/><path d="M-.3 -.02 L-.15 -.16 L0 -.02" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".03"/><title>${SEAT[o.seat]} city</title></g>`
        : `<g transform="${at}" class="ri-piece" filter="url(#ri-shadow)"><path d="M-.2 .17 V-.04 L0 -.24 L.2 -.04 V.17Z" fill="${c}" stroke="#0b1220" stroke-width=".045" stroke-linejoin="round"/><path d="M-.2 -.04 L0 -.24 L.2 -.04" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".03"/><title>${SEAT[o.seat]} settlement</title></g>`;
    }).join('');
    const isEdge = tgt.kind === 'setupRoad' || tgt.kind === 'buildRoad';
    const hits = tgt.kind && tgt.kind !== 'robber' ? tgt.list.map((i) => {
      if (isEdge) {
        const [a, b] = B.edges[i];
        const g = `x1="${B.verts[a].x.toFixed(3)}" y1="${B.verts[a].y.toFixed(3)}" x2="${B.verts[b].x.toFixed(3)}" y2="${B.verts[b].y.toFixed(3)}"`;
        return `<g class="ri-spotg"><line ${g} class="ri-edge-hit" data-e="${i}" role="button" tabindex="0" aria-label="Build a road here"/><line ${g} class="ri-edge-glow"/></g>`;
      }
      const cx = B.verts[i].x.toFixed(3), cy = B.verts[i].y.toFixed(3);
      return `<g class="ri-spotg"><circle cx="${cx}" cy="${cy}" r=".42" class="ri-spot-hit" data-v="${i}" role="button" tabindex="0" aria-label="Corner ${i + 1}, ${tgt.kind === 'buildCity' ? 'build a city' : 'build a settlement'}"/><circle cx="${cx}" cy="${cy}" r=".2" class="ri-spot-dot"/></g>`;
    }).join('') : '';
    return `<svg class="ri-board" viewBox="${x0.toFixed(2)} ${y0.toFixed(2)} ${(x1 - x0).toFixed(2)} ${(y1 - y0).toFixed(2)}" role="img" aria-label="The island: ${B.hexes.length} lands and ${B.harbors.length} harbours">
      ${defs}${water}${sand}${harborsHTML}${lands}${roads}${pieces}${hits}</svg>`;
  }

  /* ---------- dice, hand, moves ---------- */
  const DOTS = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.27, .27], [.5, .5], [.73, .73]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]], 6: [[.27, .22], [.27, .5], [.27, .78], [.73, .22], [.73, .5], [.73, .78]] };
  const die = (n, spin) => `<svg class="ri-die ${spin ? 'spin' : ''}" viewBox="0 0 1 1" aria-hidden="true"><rect x=".03" y=".03" width=".94" height=".94" rx=".2" class="ri-die-face"/>${DOTS[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".085" class="ri-die-dot"/>`).join('')}</svg>`;

  function diceHTML(v, spin) {
    if (!v.dice) return '<div class="ri-dice nodice" aria-label="No roll yet"><span class="ri-die-empty" aria-hidden="true">?</span><span class="ri-die-empty" aria-hidden="true">?</span></div>';
    return `<div class="ri-dice" role="img" aria-label="Dice: ${v.dice[0]} and ${v.dice[1]}, total ${v.dice[0] + v.dice[1]}">${die(v.dice[0], spin)}${die(v.dice[1], spin)}</div>`;
  }

  function handHTML(v) {
    if (v.me < 0 || !v.hand) return '';
    const held = RES.filter((r) => v.hand[r] > 0);
    if (!held.length) return '<div class="ri-hand none" aria-label="Your cards">No cards yet</div>';
    return `<div class="ri-hand" aria-label="Your cards">${held.map((r) => `<span class="ri-hcard" aria-label="${RES_NAME[r]}: ${v.hand[r]}" style="--a:${TONE[r][0]};--b:${TONE[r][1]}">
      ${miniIcon(r, 'ri-hart')}<span class="ri-cnt">${v.hand[r]}</span><small>${RES_NAME[r]}</small></span>`).join('')}</div>`;
  }

  const costChips = (cost) => Object.entries(cost).map(([r, n]) => `<span class="ri-cost" title="${RES_NAME[r]}"><span class="ri-mini" style="--a:${TONE[r][0]};--b:${TONE[r][1]}">${miniIcon(r)}</span>×${n}</span>`).join('');
  const afford = (v, cost) => Object.entries(cost).every(([r, n]) => v.hand[r] >= n);

  function buildTray(v) {
    const L = v.legal;
    const rows = [
      ['road', 'Road', 'road', L.road.length],
      ['settle', 'Settlement', 'settlement', L.settle.length],
      ['city', 'City', 'city', L.city.length],
    ];
    return `<div class="ri-tray" role="group" aria-label="Build">${rows.map(([mode, label, key, spots]) => {
      const ok = afford(v, COSTS[key]) && spots > 0;
      const why = !afford(v, COSTS[key]) ? 'Not enough cards' : spots === 0 ? 'No place to build' : '';
      return `<button class="ri-opt ${ok ? '' : 'off'}" data-mode="${mode}" ${ok ? '' : 'disabled'} aria-label="${label}: ${why || 'ready'}"><span class="ri-opt-name">${label}</span><span class="ri-costs">${costChips(COSTS[key])}</span><small>${why}</small></button>`;
    }).join('')}</div>`;
  }

  function tradeTray(v) {
    const rate = v.rates[ui.trade.give];
    const can = ui.trade.give !== ui.trade.get && v.hand[ui.trade.give] >= rate;
    const chip = (kind, r) => {
      const on = ui.trade[kind] === r;
      return `<button class="ri-chip ${on ? 'on' : ''}" data-tr="${kind}:${r}" aria-pressed="${on}" style="--a:${TONE[r][0]};--b:${TONE[r][1]}" aria-label="${kind === 'give' ? `Give ${RES_NAME[r]}, ${v.rates[r]} for 1` : `Get ${RES_NAME[r]}`}">${miniIcon(r, 'ri-chip-art')}${kind === 'give' ? `<b>${v.rates[r]}:1</b><small>×${v.hand[r]}</small>` : `<small>${RES_NAME[r]}</small>`}</button>`;
    };
    return `<div class="ri-tray trade" role="group" aria-label="Trade with the bank">
      <p class="ri-tray-h">Give <b>${rate}</b> ${RES_NAME[ui.trade.give]} for 1</p><div class="ri-chips">${RES.map((r) => chip('give', r)).join('')}</div>
      <p class="ri-tray-h">Get</p><div class="ri-chips">${RES.map((r) => chip('get', r)).join('')}</div>
      <button class="btn ri-go" data-ra="trade" ${can ? '' : 'disabled'}>Trade ${rate} ${RES_NAME[ui.trade.give]} for 1 ${RES_NAME[ui.trade.get]}</button></div>`;
  }

  function discardHTML(v) {
    if (ui.owedKey !== v.owed) { ui.cards = Object.fromEntries(RES.map((r) => [r, 0])); ui.owedKey = v.owed; }
    const sum = RES.reduce((n, r) => n + ui.cards[r], 0);
    const rows = RES.filter((r) => v.hand[r] > 0).map((r) => `<span class="ri-step"><span class="ri-step-name">${miniIcon(r, 'ri-chip-art')}${RES_NAME[r]} <b>${ui.cards[r]}</b>/${v.hand[r]}</span>
      <button class="btn ghost small" data-dc="${r}:-1" ${ui.cards[r] ? '' : 'disabled'} aria-label="Put back one ${RES_NAME[r]}">−</button>
      <button class="btn ghost small" data-dc="${r}:1" ${ui.cards[r] < v.hand[r] && sum < v.owed ? '' : 'disabled'} aria-label="Discard one ${RES_NAME[r]}">+</button></span>`).join('');
    return `<div class="ri-tray discard"><p class="ri-tray-h">Choose ${v.owed} to discard: <b>${sum}</b>/${v.owed}</p>${rows}
      <button class="btn ri-go" data-ra="discard" ${sum === v.owed ? '' : 'disabled'}>Discard</button></div>`;
  }

  function robberHTML(v) {
    const victims = [...new Set(v.legal.robber.flatMap((r) => r.victims))];
    if (victims.length < 2) return '';
    return `<div class="ri-tray"><label class="ri-victim">Steal from <select data-rs="victim">${victims.map((i) => `<option value="${i}" ${ui.victim === i ? 'selected' : ''}>${nameOf(v, i)}</option>`).join('')}</select></label></div>`;
  }

  function dockHTML(v) {
    if (v.me < 0 || !v.myTurn || v.phase === 'gameOver') return '';
    if (v.phase === 'roll') return `<div class="ri-acts one"><button class="ri-act primary" data-ra="roll">${glyph('dice')}<span>Roll the dice</span></button></div>`;
    if (v.phase === 'discard') return discardHTML(v);
    if (v.phase === 'robber') return robberHTML(v);
    if (v.phase !== 'main') return '';
    if (ui.mode) return `<div class="ri-acts one"><button class="ri-act" data-ra="cancel">${glyph('cancel')}<span>Cancel building</span></button></div>`;
    const tray = ui.tray === 'build' ? buildTray(v) : ui.tray === 'trade' ? tradeTray(v) : '';
    return `${tray}<div class="ri-acts">
      <button class="ri-act ${ui.tray === 'build' ? 'on' : ''}" data-ra="tray-build" aria-expanded="${ui.tray === 'build'}">${glyph('build')}<span>Build</span></button>
      <button class="ri-act ${ui.tray === 'trade' ? 'on' : ''}" data-ra="tray-trade" aria-expanded="${ui.tray === 'trade'}">${glyph('trade')}<span>Trade</span></button>
      <button class="ri-act" data-ra="endTurn">${glyph('end')}<span>End turn</span></button></div>`;
  }

  function logHTML(v) {
    const txt = (e) => ({ settle: 'built a settlement', road: 'built a road', city: 'built a city', roll: `rolled ${e.n}`, discard: `discarded ${e.n}`, robber: 'moved the robber', steal: 'took a card', trade: 'traded with the bank', end: 'ended the turn' }[e.kind] || '');
    const line = (e) => `<li><span class="ri-dot" style="background:${SEAT_FILL[e.seat] || '#999'}"></span>${nameOf(v, e.seat)} ${txt(e)}</li>`;
    const recent = v.log.filter((e) => e.seat !== null && e.seat !== undefined);
    const last = recent.at(-1);
    return `<div class="ri-logbar"><span class="ri-last">${last ? `<span class="ri-dot" style="background:${SEAT_FILL[last.seat]}"></span>${nameOf(v, last.seat)} ${txt(last)}` : ''}</span>
      <button class="btn ghost small" data-ri="log" aria-expanded="${ui.logOpen}">${ui.logOpen ? 'Hide log' : 'Log'}</button></div>
      ${ui.logOpen ? `<ul class="ri-log" aria-label="Recent moves">${recent.slice(-10).reverse().map(line).join('')}</ul>` : ''}`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') { ui.resultSeen = null; return ''; }
    const key = v.event ? v.event.seq : null;
    const settled = ui.resultSeen === key;
    if (ui.ctx.resultVisible !== false) ui.resultSeen = key;
    const title = v.winner === null ? 'No winner' : v.me < 0 ? `${esc(v.players[v.winner].name)} wins` : v.winner === v.me ? 'You won! 🎉' : `${esc(v.players[v.winner].name)} wins`;
    const score = v.players.map((p, i) => `<li class="${v.winner === i ? 'win' : ''}"><span class="ri-dot" style="background:${SEAT_FILL[i]}"></span><span>${esc(p.name)}</span><b>${p.vp}</b></li>`).join('');
    return `<div class="overlay${settled ? ' settled' : ''}"><div class="sheet"><h2>${title}</h2>
      <ul class="ri-final">${score}</ul>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-ri="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-ri="leave">Leave table</button></div></div></div>`;
  }

  /** What is new since the last look: 'roll' for fresh dice, and sounds. The very first look plays nothing. */
  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return null; }
    if (!e || e.seq === ui.seq) return null;
    ui.seq = e.seq;
    if (snd) {
      if (e.type === 'roll') snd.play('place');
      else if (e.type === 'build') snd.play('land');
      else if (e.type === 'robber') snd.play('fall');
      else if (e.type === 'over') setTimeout(() => snd.play(v.winner === null ? 'round' : v.winner === v.me ? 'win' : 'lose'), 200);
    }
    return e;
  }

  function render(root, v, ctx) {
    const room = ctx && ctx.room && ctx.room.code;
    // another room, or a new game in this one (the event counter starts over): forget picks and notices from the last game
    if ((ui.room && room && ui.room !== room) || (ui.seq !== null && v.event && v.event.seq < ui.seq)) {
      Object.assign(ui, { mode: null, tray: null, victim: null, cards: null, owedKey: null, seq: null, glowSeq: null, rollSeq: null, logOpen: false, resultSeen: null });
    }
    ui.room = room || ui.room;
    ui.root = root; ui.ctx = ctx; ui.v = v;
    const fresh = react(v);
    // the dice tumble, and the lands that paid out glow, once per roll (a re-render for a tap must not replay it)
    const rolled = fresh && fresh.type === 'roll' ? fresh : null;
    if (rolled) ui.rollSeq = rolled.seq;
    const glowSum = rolled && rolled.sum !== 7 ? rolled.sum : null;
    if (!v.myTurn || v.phase !== 'main') { ui.mode = null; ui.tray = null; }
    if (v.phase !== 'robber') ui.victim = null;
    const active = root.ownerDocument.activeElement;
    const focusKey = active && root.contains(active) && active.getAttribute ? (active.getAttribute('data-ra') || active.getAttribute('data-mode') || active.getAttribute('data-tr') || null) : null;
    root.innerHTML = `<div class="wz ri" data-game="resourceisles">
      <div class="wz-top"><div class="wz-round"><b>Resource Isles</b><span class="label"> · first to ${v.target}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-ri="rules">Rules</button>', 'ri')}</div>
      ${seatsHTML(v)}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      <div class="ri-main">${boardHTML(v, glowSum)}</div>
      <div class="ri-dock"><div class="ri-dockrow">${logHTML(v)}${diceHTML(v, !!rolled)}</div>
        ${dockHTML(v)}${handHTML(v)}</div>
      ${overlayHTML(v)}</div>`;
    root.onclick = onClick;
    root.onchange = onChange;
    root.onkeydown = onKey;
    if (focusKey) {
      const again = root.querySelector(`[data-ra="${focusKey}"],[data-mode="${focusKey}"],[data-tr="${focusKey}"]`);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  let lastSend = 0;
  /** A fast double tap must not send the same move twice. */
  function send(action) {
    const now = Date.now();
    if (now - lastSend < 250) return;
    lastSend = now;
    if (ui.ctx) ui.ctx.act(action);
  }

  function onClick(e) {
    const el = e.target.closest('[data-v],[data-e],[data-h],[data-ra],[data-mode],[data-tr],[data-dc],[data-ri]'); const v = ui.v;
    if (!el || !v || el.disabled) return;
    if (el.dataset.ri !== undefined) {
      if (el.dataset.ri === 'rules') ui.ctx.showRules();
      else if (el.dataset.ri === 'again') ui.ctx.rematch();
      else if (el.dataset.ri === 'leave') ui.ctx.leave();
      else if (el.dataset.ri === 'log') { ui.logOpen = !ui.logOpen; rerender(); }
      return;
    }
    if (el.dataset.mode !== undefined) { ui.mode = el.dataset.mode; ui.tray = null; rerender(); return; }
    if (el.dataset.tr !== undefined) { const [k, r] = el.dataset.tr.split(':'); ui.trade[k] = r; rerender(); return; }
    if (el.dataset.dc !== undefined) {
      const [r, d] = el.dataset.dc.split(':');
      ui.cards[r] += Number(d); rerender(); return;
    }
    if (el.dataset.ra !== undefined) {
      switch (el.dataset.ra) {
        case 'roll': send({ type: 'roll' }); break;
        case 'endTurn': ui.mode = null; ui.tray = null; send({ type: 'endTurn' }); break;
        case 'trade': send({ type: 'trade', give: ui.trade.give, get: ui.trade.get }); break;
        case 'discard': send({ type: 'discard', cards: { ...ui.cards } }); break;
        case 'cancel': ui.mode = null; rerender(); break;
        case 'tray-build': ui.tray = ui.tray === 'build' ? null : 'build'; rerender(); break;
        case 'tray-trade': ui.tray = ui.tray === 'trade' ? null : 'trade'; rerender(); break;
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
    if (el.dataset.rs === 'victim') ui.victim = Number(el.value);
  }

  /** Enter or Space on a focused target acts like a tap. */
  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute('role') === 'button' && !el.disabled) { e.preventDefault(); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  }

  function rerender() { if (ui.ctx && ui.ctx.rerender) ui.ctx.rerender(); else if (ui.v && ui.ctx && ui.root) render(ui.root, ui.v, ui.ctx); }

  window.CardTable.register('resourceisles', { render });
})();
