/* Hidden Miners renderer: the miners with their tools, the 9 x 5 tunnel board, your cards and a round summary that shows every
 * role. Pick a card, then pick where it goes (a glowing cell, miner, tool or chamber). Styles in hiddenminers.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const TOOLS = { lamp: { name: 'Lamp', icon: '🔦' }, pick: { name: 'Pick', icon: '⛏️' }, cart: { name: 'Cart', icon: '🛒' } };
  const ui = { ctx: null, latest: null, seq: null, seenRound: null, sel: null, flip: false, turnKey: '', feeds: new Map() };
  const flipMask = (m) => ((m << 2) | (m >> 2)) & 15;
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));
  const roleName = (r) => (r === 'saboteur' ? 'Saboteur' : 'Digger');

  /** One tunnel piece, drawn as rock with tunnels cut to the open sides. A dead end has a rock plug in the middle. */
  // A tile: rock with flecks, and each open side a curved passage cut into it that meets the centre. A dead end stops short
  // and is closed off. Some passages have a little fallen rock on the floor; which ones is fixed by the tile itself.
  function tileSVG(mask, cut, cls = '') {
    const C = 50;
    const E = { 1: [50, 0], 2: [100, 50], 4: [50, 100], 8: [0, 50] }; // where each passage meets the tile edge
    const bits = [1, 2, 4, 8].filter((b) => mask & b);
    const frac = cut ? 0.4 : 0; // a dead end stops 40% of the way in from the edge
    const geom = (b) => {
      const [ex, ey] = E[b];
      const tx = C + (ex - C) * frac, ty = C + (ey - C) * frac;
      const len = Math.hypot(tx - ex, ty - ey) || 1;
      return { ex, ey, tx, ty, mx: (ex + tx) / 2, my: (ey + ty) / 2, nx: -(ty - ey) / len, ny: (tx - ex) / len };
    };
    const arms = bits.map((b) => {
      const g = geom(b), bend = (cut ? 6 : 9) * (b === 1 || b === 4 ? 1 : -1); // alternate the curve so passages wind
      return `M${g.ex} ${g.ey}Q${(g.mx + g.nx * bend).toFixed(2)} ${(g.my + g.ny * bend).toFixed(2)} ${g.tx.toFixed(2)} ${g.ty.toFixed(2)}`;
    }).join('');
    const rubble = bits.map((b) => {
      if ((mask * 13 + b * 5 + (cut ? 7 : 0)) % 4 !== 0) return ''; // only some passages have fallen rock
      const g = geom(b), x = g.mx + g.nx * 6, y = g.my + g.ny * 6;
      return `<g class="debris"><ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.6" ry="2"/><ellipse cx="${(x + 3.4).toFixed(1)}" cy="${(y + 1.4).toFixed(1)}" rx="1.5" ry="1.2"/><ellipse cx="${(x - 2.4).toFixed(1)}" cy="${(y + 2).toFixed(1)}" rx="1.2" ry="1"/></g>`;
    }).join('');
    const hub = cut ? '' : '<circle class="hub-rim" cx="50" cy="50" r="13.5"/><circle class="hub-bore" cx="50" cy="50" r="11.5"/>';
    const specks = [[12, 14], [84, 10], [22, 80], [78, 86], [8, 52], [92, 46], [46, 8], [58, 92], [70, 24]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" class="speck"/>`).join('');
        const plug = cut ? '<path class="plug" d="M30 30 L70 70 M70 30 L30 70"/>' : '';
    return `<svg class="hm-tile ${cls}" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" class="rock"/>${specks}<g class="way"><path class="rim" d="${arms}"/>${hub}<path class="bore" d="${arms}"/>${rubble}<path class="deep" d="${arms}"/></g>${plug}</svg>`;
  }

  const describeTile = (mask, cut) => {
    const open = [[1, 'north'], [2, 'east'], [4, 'south'], [8, 'west']].filter(([b]) => mask & b).map(([, n]) => n).join(', ');
    return `${cut ? 'Dead-end tunnel' : 'Tunnel'} open ${open}`;
  };

  function cardFace(c) {
    if (c.k === 'tile') return `<span class="hm-face">${tileSVG(ui.sel === c.id && ui.flip ? flipMask(c.mask) : c.mask, c.cut)}</span>`;
    if (c.k === 'break') return `<span class="hm-face hm-bad"><b>${TOOLS[c.tool].icon}</b><i>✖</i></span>`;
    if (c.k === 'repair') return `<span class="hm-face hm-good"><b>${c.tools.map((t) => TOOLS[t].icon).join('')}</b><i>🔧</i></span>`;
    if (c.k === 'scout') return '<span class="hm-face hm-util"><b>🔭</b></span>';
    return '<span class="hm-face hm-bad"><b>💥</b></span>';
  }
  const cardName = (c) => (c.k === 'tile' ? describeTile(ui.sel === c.id && ui.flip ? flipMask(c.mask) : c.mask, c.cut) : c.k === 'break' ? `Break ${TOOLS[c.tool].name}` : c.k === 'repair' ? `Repair ${c.tools.map((t) => TOOLS[t].name).join(' or ')}` : c.k === 'scout' ? 'Scout a chamber' : 'Collapse a tunnel piece');
  const cardLabel = (c) => (c.k === 'tile' ? (c.cut ? 'Dead end' : 'Tunnel') : c.k === 'break' ? 'Break' : c.k === 'repair' ? 'Repair' : c.k === 'scout' ? 'Scout' : 'Collapse');

  function selected(v) { return ui.sel ? v.hand.find((c) => c.id === ui.sel && c.ok) || null : null; }

  /** One public move, in words with its card: "🔧 Circe repaired your 🔦 Lamp". Used by the floater and the move log alike. */
  function moveLine(v, h) {
    const by = h.by !== undefined ? nameOf(v, h.by) : '';
    const poss = (seat) => (seat === v.me ? 'your' : `${nameOf(v, seat)}’s`);
    switch (h.kind) {
      case 'tile': return `⛏️ ${by} dug ${h.cut ? 'a dead end 🕳️' : 'a tunnel'}${h.opened && h.opened.length ? `, opening ${h.opened.map((gold) => (gold ? '<b>the gold chamber</b>' : 'a chamber of plain rock')).join(' and ')}` : ''}`;
      case 'break': return `✖ ${by} broke ${poss(h.target)} ${TOOLS[h.tool].icon} ${TOOLS[h.tool].name}`;
      case 'repair': return `🔧 ${by} repaired ${poss(h.target)} ${TOOLS[h.tool].icon} ${TOOLS[h.tool].name}`;
      case 'scout': return `🔭 ${by} scouted chamber ${h.goal + 1}`;
      case 'collapse': return `💥 ${by} collapsed a tunnel piece`;
      case 'discard': return `${by} threw a card away`;
      default: return '';
    }
  }

  function eventText(v) {
    const e = v.event;
    if (!e) return '';
    switch (e.type) {
      // a live move reads its chambers from this round's view (they are open now); the history keeps their outcomes
      case 'tile': return moveLine(v, { ...e, kind: e.type, opened: (e.revealed || []).map((i) => Boolean(v.goals[i] && v.goals[i].gold)) });
      case 'break': case 'repair': case 'scout': case 'collapse': case 'discard': return moveLine(v, { ...e, kind: e.type });
      case 'roundEnd': return e.side === 'diggers' ? 'The Diggers found the gold. A new round starts.' : 'The deck ran out: the Saboteurs win the round. A new round starts.';
      case 'over': return 'The match is over.';
      default: return '';
    }
  }

  /** The move log: the last few public moves, newest at the bottom, with a fixed height so the board below never jumps. */
  function logHTML(v) {
    const rows = (v.history || []).slice(-4);
    // The text is already escaped HTML, so it is safe as an attribute once its tags are removed. The title shows the whole line
    // where the narrow log clips it (hover, or a long press on touch screens that offer it).
    const items = rows.map((h, i) => `<li class="${i === rows.length - 1 ? 'hm-last' : ''}" title="${moveLine(v, h).replace(/<[^>]+>/g, '')}"><span class="hm-r">R${h.round}</span> ${moveLine(v, h)}</li>`).join('');
    return `<ol class="hm-log" role="log" aria-live="polite" aria-label="Moves this game">${items || '<li class="hm-empty">Moves appear here as the miners dig.</li>'}</ol>`;
  }

  const feedKey = () => (ui.ctx && ui.ctx.room ? ui.ctx.room.code : null);
  /** New events go into the shared feed (the last lines float over the board); a chamber being opened, a collapse and a break
   * or repair aimed at you are also held in the middle of the screen for a moment. The first look at a table only records
   * where it is, and a sequence that goes back (a new match) starts a new epoch so IDs never collide. */
  function feedSync(v) {
    const key = feedKey();
    const e = v.event;
    if (!key || !window.GameFeed) return;
    const st = ui.feeds.get(key);
    if (!st) { ui.feeds.set(key, { seq: e ? e.seq : 0, epoch: 0 }); return; }
    if (e && e.seq < st.seq) { st.epoch += 1; st.seq = 0; }
    if (!e || e.seq <= st.seq) return;
    st.seq = e.seq;
    const text = eventText(v);
    if (!text) return;
    const opened = e.revealed && e.revealed.length ? e.revealed : [];
    const gold = e.goldIndex !== undefined && e.goldIndex >= 0;
    const tone = e.type === 'over' || e.type === 'roundEnd' || gold ? 'win' : e.type === 'break' || e.type === 'collapse' ? 'take' : e.type === 'repair' ? 'lay' : 'play';
    const big = (face) => `<span style="font-size:44px;line-height:1" aria-hidden="true">${face}</span>`;
    if (opened.length) window.GameFeed.spotlight({ card: big(gold ? '🪙' : '🪨'), caption: gold ? 'The gold chamber is open!' : 'That chamber holds only rock', tone: gold ? 'win' : 'skip', ms: 2300 });
    else if (e.type === 'collapse') window.GameFeed.spotlight({ card: big('💥'), caption: text, tone: 'take', ms: 2200 });
    else if ((e.type === 'break' || e.type === 'repair') && e.target === v.me && e.by !== v.me) window.GameFeed.spotlight({ card: big(TOOLS[e.tool].icon), caption: text, tone: e.type === 'break' ? 'take' : 'lay', ms: 2200 });
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is playing`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} is playing…`;
    const c = selected(v);
    if (!c) {
      if (ui.sel) return 'That card cannot be played now: throw it away, or pick another';
      if (v.players[v.me].broken.length) return 'A tool of yours is broken: repair it to dig, or play another card';
      return 'Your turn: pick a card to play, or throw one away';
    }
    if (c.k === 'tile') return 'Tap a glowing place on the board';
    if (c.k === 'break') return 'Tap the miner whose tool you will break';
    if (c.k === 'repair') return 'Tap the broken tool you will repair';
    if (c.k === 'scout') return 'Tap a chamber to peek at it';
    return 'Tap the tunnel piece to collapse';
  }

  function playersHTML(v) {
    const c = selected(v);
    const hit = c && c.k === 'break' ? new Set((v.targets[c.id] || []).map((s) => s)) : new Set();
    const fix = c && c.k === 'repair' ? v.targets[c.id] || [] : [];
    // the most points leads; no crown while everyone is level (the start) or after the game
    const lead = v.phase !== 'gameOver' ? window.CardTable.pt.leaderOf(v.players.length, (k) => v.players[k].score, -Infinity) : -1;
    return `<ul class="hm-players">${v.players.map((p, i) => {
      const tools = Object.keys(TOOLS).map((t) => {
        const broken = p.broken.includes(t);
        const fixable = fix.some((f) => f.seat === i && f.tool === t);
        const label = `${TOOLS[t].name}${broken ? ' (broken)' : ''}`;
        return fixable
          ? `<button type="button" class="hm-tool broken fixable" data-hm="fix" data-seat="${i}" data-tool="${t}" aria-label="Repair ${esc(p.name)}’s ${label}">${TOOLS[t].icon}</button>`
          : `<span class="hm-tool ${broken ? 'broken' : ''}" title="${label}" role="img" aria-label="${label}">${TOOLS[t].icon}</span>`;
      }).join('');
      const attack = hit.has(i);
      const tag = attack ? 'button' : 'div';
      const t = (v.tally && v.tally[i]) || { tunnels: 0, deadEnds: 0, breaks: 0, repairs: 0 };
      const tallyTip = `This round: ${t.tunnels} tunnel${t.tunnels === 1 ? '' : 's'} dug, ${t.deadEnds} dead end${t.deadEnds === 1 ? '' : 's'}, ${t.breaks} tool${t.breaks === 1 ? '' : 's'} broken, ${t.repairs} repaired`;
      const tally = `<span class="hm-tally" title="${tallyTip}" aria-label="${tallyTip}">⛏️${t.tunnels} 🕳️${t.deadEnds} ✖${t.breaks} 🔧${t.repairs}</span>`;
      return `<li><${tag} ${attack ? `type="button" data-hm="hit" data-seat="${i}"` : ''} class="hm-p ${i === v.turn && v.phase === 'playing' ? 'turn' : ''} ${i === v.me ? 'me' : ''} ${attack ? 'target' : ''}" ${attack ? `aria-label="Break a tool of ${esc(p.name)}"` : ''}><span class="hm-nm">${i === lead ? '<span class="bdg l" title="Leading: most points">👑 Lead</span> ' : ''}${esc(p.name)}${i === v.me ? ' (you)' : ''}</span><span class="hm-meta">${p.cards} card${p.cards === 1 ? '' : 's'} · ${p.score} pts</span>${tally}</${tag}><span class="hm-tools">${tools}</span></li>`;
    }).join('')}</ul><p class="hm-legend">This round: ⛏️ tunnels dug · 🕳️ dead ends · ✖ tools broken · 🔧 tools repaired</p>`;
  }

  function boardHTML(v) {
    const c = selected(v);
    const cells = new Map(v.board.map((t) => [`${t.x},${t.y}`, t]));
    const goals = new Map(v.goals.map((q, i) => [`${q.x},${q.y}`, { ...q, i }]));
    const spots = new Set(c && c.k === 'tile' ? (v.spots[c.id] || []).filter((s) => Boolean(s[2]) === ui.flip).map((s) => `${s[0]},${s[1]}`) : []);
    const caves = new Set(c && c.k === 'collapse' ? (v.targets[c.id] || []).map((s) => `${s[0]},${s[1]}`) : []);
    const scoutable = c && c.k === 'scout';
    let html = '';
    for (let y = 0; y < v.H; y++) for (let x = 0; x < v.W; x++) {
      const k = `${x},${y}`;
      const t = cells.get(k);
      const q = goals.get(k);
      if (t) {
        const cave = caves.has(k);
        html += `<${cave ? 'button type="button" data-hm="cave" data-x="' + x + '" data-y="' + y + '"' : 'div role="img"'} class="hm-cell ${t.start ? 'start' : ''} ${cave ? 'cave' : ''}" aria-label="Column ${x + 1}, row ${y + 1}: ${t.start ? 'Start of the tunnel' : esc(describeTile(t.mask, t.cut))}${cave ? '. Collapse this piece' : ''}">${tileSVG(t.mask, t.cut)}${t.start ? '<span class="hm-flag">⛏️</span>' : ''}</${cave ? 'button' : 'div'}>`;
      } else if (q) {
        const seen = v.scouts.find((s) => s.goal === q.i);
        const face = q.revealed ? (q.gold ? '<span class="hm-gold">🪙</span>' : '<span class="hm-rock">🪨</span>') : '<span class="hm-q">?</span>';
        const hint = !q.revealed && seen ? `<span class="hm-seen" title="You scouted this chamber">${seen.gold ? '🪙' : '🪨'}</span>` : '';
        const word = q.revealed ? (q.gold ? 'gold' : 'plain rock') : seen ? `unopened, you scouted ${seen.gold ? 'gold' : 'plain rock'}` : 'unopened';
        html += `<${scoutable ? 'button type="button" data-hm="goal" data-i="' + q.i + '"' : 'div role="img"'} class="hm-cell goal ${q.revealed ? (q.gold ? 'is-gold' : 'is-rock') : ''} ${scoutable ? 'cave' : ''}" aria-label="Chamber ${q.i + 1}: ${word}">${face}${hint}</${scoutable ? 'button' : 'div'}>`;
      } else if (spots.has(k)) {
        const preview = tileSVG(ui.flip ? flipMask(c.mask) : c.mask, c.cut, 'ghost');
        html += `<button type="button" class="hm-cell spot" data-hm="spot" data-x="${x}" data-y="${y}" aria-label="Place the piece in column ${x + 1}, row ${y + 1}">${preview}</button>`;
      } else html += '<div class="hm-cell empty"></div>';
    }
    return `<div class="hm-board-wrap"><div class="hm-board" style="--cols:${v.W}">${html}</div></div>`;
  }

  function handHTML(v) {
    if (v.me < 0) return '';
    return `<div class="hm-hand" role="group" aria-label="Your cards">${v.hand.map((c) => `<button type="button" class="hm-card ${v.myTurn && c.ok ? 'playable' : ''} ${v.myTurn && !c.ok ? 'dim' : ''} ${ui.sel === c.id ? 'sel' : ''}" data-hm="card" data-id="${esc(c.id)}" aria-label="${esc(cardName(c))}${v.myTurn && !c.ok ? ' (cannot be played now)' : ''}" aria-pressed="${ui.sel === c.id}" ${v.myTurn ? '' : 'aria-disabled="true"'}>${cardFace(c)}<small>${cardLabel(c)}</small></button>`).join('')}</div>`;
  }

  function controlsHTML(v) {
    if (v.phase !== 'playing' || v.me < 0 || !v.myTurn) return '';
    const c = selected(v);
    const buttons = [];
    if (c && c.k === 'tile' && c.mask !== flipMask(c.mask)) buttons.push('<button class="btn" data-hm="turn">Turn upside down</button>');
    if (ui.sel && v.hand.some((x) => x.id === ui.sel)) buttons.push('<button class="btn ghost" data-hm="discard">Throw away</button>');
    if (c) buttons.push('<button class="btn ghost small" data-hm="cancel">Cancel</button>');
    return buttons.length ? `<div class="hm-controls">${buttons.join('')}</div>` : '';
  }

  function overlayHTML(v) {
    const r = v.roundResult;
    const list = (sorted) => sorted.map(({ p, i }) => `<li class="${v.winners.includes(i) ? 'win' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b> <em class="hm-role ${r ? r.roles[i] : ''}">${r ? roleName(r.roles[i]) : ''}</em></span><span>${r && r.gains[i] ? `+${r.gains[i]} · ` : ''}${p.score} pts</span></li>`).join('');
    const sorted = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    if (v.phase === 'gameOver' && r) {
      ui.seenRound = null;
      const title = v.me >= 0 ? (v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over') : 'Game over';
      const who = v.winners.map((i) => esc(v.players[i].name)).join(' and ');
      return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
        <p class="hint" style="text-align:left">${r.side === 'diggers' ? 'The Diggers found the gold in the last round.' : 'The Saboteurs won the last round.'} ${who} ${v.winners.length > 1 ? 'share' : 'has'} the highest score.</p>
        <ul class="hm-final">${list(sorted)}</ul>
        <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-hm="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-hm="leave">Leave table</button></div></div></div>`;
    }
    if (r && v.phase === 'roundEnd') {
      return `<div class="overlay"><div class="sheet"><h2>${r.side === 'diggers' ? '⛏️ The Diggers found the gold!' : '🕳️ The Saboteurs win the round'}</h2>
        ${window.CardTable.readyBox(ui.ctx, { title: 'Ready for the next round?', cls: 'in-sheet' })}
        <p class="hint" style="text-align:left">Round ${r.round}: the roles were:</p>
        <ul class="hm-final">${list(sorted)}</ul></div></div>`;
    }
    return '';
  }

  function react(v) {
    const e = v.event;
    const snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; ui.seenRound = v.roundResult ? v.roundResult.round : null; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'over') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    else if (e.type === 'roundEnd') snd.play(e.goldIndex >= 0 ? 'fanfare' : 'round');
    else if (e.type === 'tile') { snd.play('place'); if (e.goldIndex >= 0) setTimeout(() => snd.play('fanfare'), 150); }
    else if (e.type === 'break' || e.type === 'collapse') snd.play('fall');
    else if (e.type === 'repair') snd.play('land');
    else if (e.type === 'scout') snd.play('tick');
    else if (e.type === 'discard') snd.play('fold');
  }

  /** The control that has keyboard focus, as a selector, so a redraw does not drop a keyboard player back to the top of the page. */
  function focusKey(root) {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.dataset || !a.dataset.hm) return null;
    return ['hm', 'id', 'x', 'y', 'seat', 'tool', 'i'].filter((k) => a.dataset[k] !== undefined).map((k) => `[data-${k}="${CSS.escape(a.dataset[k])}"]`).join('');
  }
  function restoreFocus(root, sel) {
    if (!sel) return;
    const el = root.querySelector(sel) || root.querySelector('.hm-card');
    if (el && el.focus) el.focus({ preventScroll: true });
  }

  /** The fade on the hand's right edge shows only while cards are still off screen to the right; it follows scrolling. */
  function bindHandFade(h) {
    const fade = () => h.classList.toggle('more', h.scrollLeft + h.clientWidth < h.scrollWidth - 2);
    if (!h.dataset.fadeBound) { h.dataset.fadeBound = '1'; h.addEventListener('scroll', fade, { passive: true }); }
    fade();
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    // table-local state belongs to one table: another table starts from its own first render (no replay, no dismissed round)
    const tableKey = ctx && ctx.room ? ctx.room.code : '';
    if (ui.table !== tableKey) { ui.table = tableKey; ui.seq = null; ui.seenRound = null; ui.sel = null; ui.flip = false; ui.turnKey = ''; ui.summaryKey = null; }
    react(v);
    feedSync(v);
    const key = `${v.round}:${v.turn}:${v.event ? v.event.seq : 0}`;
    if (key !== ui.turnKey) { ui.turnKey = key; ui.sel = null; ui.flip = false; }
    if (!v.myTurn || (ui.sel && !v.hand.some((c) => c.id === ui.sel))) ui.sel = null; // a card that cannot be played stays chosen so it can be thrown away
    const role = v.role ? `<span class="hm-youare ${v.role}" title="Only you can see this">You are a ${roleName(v.role)}</span>` : '';
    const handEl = root.querySelector('.hm-hand');
    const scroll = handEl ? handEl.scrollLeft : 0;
    const focus = focusKey(root);
    root.innerHTML = `
    <div class="wz hm-game">
      <div class="wz-top">
        <div class="wz-round"><b>Hidden Miners</b><span class="label"> · round ${v.round} of ${v.rounds} · ${v.deck} in the deck</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-hm="rules">Rules</button>', 'hm')}
      </div>
      ${role ? `<div class="hm-role-row">${role}</div>` : ''}
      ${playersHTML(v)}
      <div class="hm-boardwrap">${boardHTML(v)}</div>
      ${logHTML(v)}
      <div class="wz-status ${v.myTurn && v.phase === 'playing' ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${controlsHTML(v)}
      ${handHTML(v)}
      ${overlayHTML(v)}
    </div>`;
    const h2 = root.querySelector('.hm-hand');
    if (h2) { h2.scrollLeft = scroll; bindHandFade(h2); }
    restoreFocus(root, focus);
    // a round or game summary takes the keyboard: its button gets focus, and the game behind it is inert until it is dismissed
    const game = root.querySelector('.hm-game');
    const sheet = game ? game.querySelector(':scope > .overlay') : null;
    if (game) [...game.children].forEach((el) => { if (el !== sheet) el.inert = Boolean(sheet); });
    // focus the sheet whenever its summary changes (a round sheet can be replaced by the game-over sheet)
    const summaryKey = sheet ? (v.phase === 'gameOver' ? 'over' : `round${v.roundResult.round}`) : null;
    if (sheet && summaryKey !== ui.summaryKey) { const first = sheet.querySelector('button'); if (first) first.focus({ preventScroll: true }); }
    ui.summaryKey = summaryKey;
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-hm]');
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!v || !ctx || !el) return;
    const n = (k) => Number(el.dataset[k]);
    const c = selected(v);
    switch (el.dataset.hm) {
      case 'card': {
        const card = v.hand.find((x) => x.id === el.dataset.id);
        if (!v.myTurn || !card) return;
        if (!card.ok) { ui.sel = card.id; ui.flip = false; ctx.rerender(); return; } // lets a card you cannot play be thrown away
        ui.sel = ui.sel === card.id ? null : card.id;
        ui.flip = false;
        if (ui.sel && card.k === 'tile') {
          const s = v.spots[card.id] || [];
          if (s.length && !s.some((p) => !p[2])) ui.flip = true; // only the turned piece fits somewhere
        }
        ctx.rerender();
        break;
      }
      case 'turn': ui.flip = !ui.flip; ctx.rerender(); break;
      case 'cancel': ui.sel = null; ui.flip = false; ctx.rerender(); break;
      case 'discard': if (v.myTurn && ui.sel) ctx.act({ type: 'discard', card: ui.sel }); break;
      case 'spot': if (c && c.k === 'tile') ctx.act({ type: 'tile', card: c.id, x: n('x'), y: n('y'), flip: ui.flip }); break;
      case 'hit': if (c && c.k === 'break') ctx.act({ type: 'break', card: c.id, target: n('seat') }); break;
      case 'fix': if (c && c.k === 'repair') ctx.act({ type: 'repair', card: c.id, target: n('seat'), tool: el.dataset.tool }); break;
      case 'goal': if (c && c.k === 'scout') ctx.act({ type: 'scout', card: c.id, goal: n('i') }); break;
      case 'cave': if (c && c.k === 'collapse') ctx.act({ type: 'collapse', card: c.id, x: n('x'), y: n('y') }); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('hiddenminers', { render });
})();
