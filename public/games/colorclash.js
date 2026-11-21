/* Color Clash table renderer: seats round the table, the stock and the discard in the middle with the colour in play, your hand,
 * a draw / keep control, a colour picker for Wilds and a round summary. Shares table.css and the seat/table helpers with the
 * other card games. Styles in colorclash.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;

  // A shape beside every colour, so the cards can be told apart without colour.
  const COLOURS = {
    R: { name: 'Ruby', shape: '▲' },
    Y: { name: 'Sun', shape: '●' },
    G: { name: 'Leaf', shape: '■' },
    B: { name: 'Sea', shape: '◆' },
  };
  const ORDER = ['R', 'Y', 'G', 'B'];
  const ACTION = { stop: { name: 'Stop', face: '⊘' }, flip: { name: 'Flip', face: '⇄' }, take2: { name: 'Take 2', face: '+2' }, wild: { name: 'Wild', face: '★' }, take4: { name: 'Wild Take 4', face: '+4' } };
  const ui = { ctx: null, latest: null, seq: null, shown: null, pending: null, seenRound: null, turnKey: '', feeds: new Map() };

  const label = (c) => (c.k === 'n' ? `${COLOURS[c.c].name} ${c.v}` : c.c === 'W' ? ACTION[c.k].name : `${COLOURS[c.c].name} ${ACTION[c.k].name}`);
  const corner = (c) => (c.k === 'n' ? String(c.v) : ACTION[c.k].face);

  function cardHTML(c, cls = '', attrs = '', tag = 'div') {
    const shape = c.c === 'W' ? '' : `<i>${COLOURS[c.c].shape}</i>`;
    return `<${tag} class="card cc cc-${c.c} cc-k-${c.k} ${cls}" aria-label="${esc(label(c))}" ${attrs}><span class="rk">${esc(corner(c))}${shape}</span><span class="pip">${esc(corner(c))}</span><span class="rk br">${esc(corner(c))}${shape}</span></${tag}>`;
  }
  const backHTML = (cls = '') => '<div class="card back cc-back ' + cls + '" aria-hidden="true"><span class="pip">CC</span></div>';
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));
  const colourChip = (col) => `<span class="cc-chip cc-chip-${col}">${COLOURS[col].shape} ${COLOURS[col].name}</span>`;

  /** What just happened, in words. Only public facts (and, for the player who drew, the card they drew). */
  function eventText(v) {
    const e = v.event;
    if (!e) return '';
    const by = nameOf(v, e.by);
    switch (e.type) {
      case 'play': {
        let t = `${by} played <b>${esc(label(e.card))}</b>`;
        if (e.card.c === 'W') t += ` and chose ${colourChip(e.colour)}`;
        if (e.penalised) t += `: ${nameOf(v, e.penalised.target)} draw${e.penalised.target === v.me ? '' : 's'} ${e.penalised.count} and miss${e.penalised.target === v.me ? '' : 'es'} a turn`;
        if (e.skipped !== undefined) t += `: ${nameOf(v, e.skipped)} ${e.skipped === v.me ? 'are' : 'is'} skipped`;
        if (e.card.k === 'flip') t += ': the direction turns round';
        if (e.last) t += '. <b>One card left!</b>';
        return t;
      }
      case 'draw': return e.by === v.me && v.myDraw ? `You drew ${cardHTML(v.myDraw.card, 'tiny', '', 'span')}` : e.count ? `${by} drew a card.` : `${by} could not draw: no cards left.`;
      case 'pass': return `${by} kept the card.`;
      case 'roundEnd': return `${by} went out and scored <b>${e.total}</b>. A new round starts.`;
      case 'over': return `${by} went out. The match is over.`;
      default: return '';
    }
  }

  const feedKey = () => (ui.ctx && ui.ctx.room ? ui.ctx.room.code : null);
  /** Each new event goes into the shared feed (the last lines float over the table) and an action card played by someone else is
   * held in the middle of the screen for a moment, so nobody misses a Stop, a Take 2 or a colour change. The first look at a
   * table only records where it is, and a new match (the sequence going back) starts a new epoch so IDs never collide. */
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
    const tone = e.type === 'over' || e.type === 'roundEnd' ? 'round' : e.penalised ? 'take' : e.skipped !== undefined || (e.card && e.card.k === 'flip') ? 'skip' : 'play';
    window.GameFeed.add(key, [{ id: `cc-${key}-${st.epoch}-${e.seq}`, tone, html: text }]);
    const notable = e.type === 'play' && e.card && (e.card.k !== 'n');
    if (notable && (e.by !== v.me || (e.penalised && e.penalised.target === v.me))) {
      window.GameFeed.spotlight({ card: cardHTML(e.card, '', 'style="--cw:56px"', 'span'), caption: text, tone, ms: 1300 });
    }
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is playing`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} is playing…`;
    if (ui.pending) return 'Choose the colour for your Wild';
    if (v.drawn) return 'You drew a card that fits: play it or keep it';
    if (v.hand.some((c) => c.ok)) return 'Your turn: play a card that matches, or draw';
    return 'Nothing fits: draw a card';
  }

  function seatHTML(v, ctx, i) {
    const p = v.players[i];
    const backs = Array.from({ length: Math.min(p.cards, 6) }, () => '<i></i>').join('');
    const lead = pt.leaderOf(v.players.length, (k) => v.players[k].score) === i && v.phase === 'playing';
    const badges = [p.cards === 1 ? '<span class="bdg cc-last" title="One card left">1 card</span>' : '', lead ? '<span class="bdg l" title="Leading">★</span>' : ''].join('');
    const sub = `${p.cards} card${p.cards === 1 ? '' : 's'}${v.target ? ` · ${p.score} pts` : ''}`;
    return pt.seatHTML({ pid: p.id, name: p.name, avatar: pt.avatarOf(ctx.room, p.id), sub, turn: i === v.turn && v.phase === 'playing', me: i === v.me, extra: `<div class="cc-backs">${backs}</div>`, badges });
  }

  function tableHTML(v, ctx) {
    const text = eventText(v);
    const e = v.event;
    const fresh = e && e.type === 'play' && ui.shown !== e.seq; // the new top card lands once, a later redraw shows it at rest
    const stock = `<button type="button" class="cc-stock ${v.canDraw ? 'ready' : ''}" data-cc="draw" ${v.canDraw ? '' : 'disabled'} aria-label="Draw a card (${v.stock} left in the stock)">${v.stock ? backHTML() : '<div class="card slot"></div>'}<b>${v.stock}</b><small>stock</small></button>`;
    const center = `<div class="cc-mid">${stock}<div class="cc-discard">${cardHTML(v.top, fresh ? 'cc-land' : '')}<span class="cc-dir" title="Direction of play" aria-label="${v.dir > 0 ? 'Clockwise' : 'Anticlockwise'}">${v.dir > 0 ? '↻' : '↺'}</span></div></div>`;
    const feed = window.GameFeed && feedKey() ? window.GameFeed.html(feedKey(), 'gf-float') : '';
    return `<div class="cc-tablewrap">${pt.tableHTML({ n: v.players.length, me: v.me, seat: (i) => seatHTML(v, ctx, i), center, card: () => null })}${feed}</div><div class="cc-colour">Colour in play ${colourChip(v.colour)}</div>`
      + (text ? `<p class="cc-event cc-event-bar" role="status">${text}</p>` : '');
  }

  function sizes(v) {
    const w = window.innerWidth;
    let cw = w < 480 ? 62 : w < 900 ? 72 : 84;
    if (innerHeight <= 620) cw = Math.min(cw, 46);
    else if (innerHeight <= 700) cw = Math.min(cw, 56);
    const n = v.hand.length;
    const avail = Math.min(w, 980) - 20;
    let overlap = -6;
    if (n > 1 && n * cw + (n - 1) * 6 > avail) overlap = Math.round(cw - Math.max((avail - cw) / (n - 1), cw * 0.36));
    return { cw, overlap };
  }

  function handHTML(v, z) {
    if (v.me < 0) return '';
    const sort = v.hand;
    return `<div class="hand"><div class="hand-in" style="--cw:${z.cw}px">${sort.map((c, i) => {
      const cls = ['hc', v.myTurn && c.ok ? 'playable' : '', v.myTurn && !c.ok ? 'dim' : '', ui.pending === c.id ? 'sel' : '', v.drawn === c.id ? 'cc-drawn' : ''].join(' ');
      return cardHTML(c, cls, `data-cc="play" data-id="${esc(c.id)}" ${v.myTurn && c.ok ? '' : 'aria-disabled="true"'} style="${i ? `margin-left:${-z.overlap}px` : ''}"`, 'button');
    }).join('')}</div></div>`;
  }

  function controlsHTML(v) {
    if (v.phase !== 'playing' || v.me < 0 || !v.myTurn) return '';
    if (ui.pending) {
      const picks = ORDER.map((col) => `<button type="button" class="cc-pick cc-pick-${col}" data-cc="colour" data-colour="${col}"><span aria-hidden="true">${COLOURS[col].shape}</span>${COLOURS[col].name}</button>`).join('');
      return `<div class="cc-controls panel"><span class="label">Choose a colour</span><div class="cc-picks">${picks}</div><button class="btn ghost small" data-cc="cancel">Cancel</button></div>`;
    }
    if (v.drawn) return '<div class="cc-controls panel"><span class="label">Play the card you drew, or</span><button class="btn" data-cc="keep">Keep it and pass</button></div>';
    return '';
  }

  /** Drawing is small and sits in the status bar: the stock pile on the table is the big target. */
  function drawInline(v) {
    if (v.phase !== 'playing' || v.me < 0 || !v.myTurn || ui.pending || v.drawn) return '';
    return `<span class="cc-controls"><button class="btn small" data-cc="draw" ${v.canDraw ? '' : 'disabled'}>Draw</button></span>`;
  }

  function overlayHTML(v) {
    const r = v.roundResult;
    const rows = (list) => list.map(({ p, i }) => `<li class="${v.winners.includes(i) ? 'win' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${r && r.gains[i] ? `+${r.gains[i]} · ` : ''}${p.score} pts</span></li>`).join('');
    const sorted = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    if (v.phase === 'gameOver') {
      ui.seenRound = null; // the next match starts with no dismissed round, so its first summary shows
      const title = v.me >= 0 ? (v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over') : 'Game over';
      const who = v.winners.map((i) => esc(v.players[i].name)).join(' and ');
      return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
        <p class="hint" style="text-align:left">${who} ${v.winners.length > 1 ? 'share' : 'has'} the highest score.</p>
        <ul class="cc-final">${rows(sorted)}</ul>
        <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-cc="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-cc="leave">Leave table</button></div></div></div>`;
    }
    if (r && ui.seenRound !== r.round) {
      return `<div class="overlay"><div class="sheet"><h2>${nameOf(v, r.winner)} went out!</h2>
        <p class="hint" style="text-align:left">${r.total} points for round ${r.round}. First to ${v.target}.</p>
        <ul class="cc-final">${rows(sorted)}</ul>
        <div class="row" style="margin-top:12px"><button class="btn" data-cc="next">Next round</button></div></div></div>`;
    }
    return '';
  }

  function react(v) {
    const e = v.event;
    const snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; ui.shown = ui.seq; ui.seenRound = v.roundResult ? v.roundResult.round : null; return; } // first render: do not replay an old event
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'over') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    else if (e.type === 'roundEnd') snd.play('round');
    else if (e.type === 'play') { snd.play(e.penalised ? 'collect' : 'card'); if (e.last) setTimeout(() => snd.play('tick'), 180); }
    else if (e.type === 'draw') snd.play('deal');
    else if (e.type === 'pass') snd.play('fold');
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    // table-local state belongs to one table: another table starts from its own first render (no replay, no dismissed round)
    const tableKey = ctx && ctx.room ? ctx.room.code : '';
    if (ui.table !== tableKey) { ui.table = tableKey; ui.seq = null; ui.shown = null; ui.seenRound = null; ui.pending = null; ui.turnKey = ''; }
    react(v);
    feedSync(v);
    const key = `${v.turn}:${v.event ? v.event.seq : 0}`;
    if (key !== ui.turnKey) { ui.turnKey = key; ui.pending = null; }
    if (!v.myTurn || (ui.pending && !v.hand.some((c) => c.id === ui.pending && c.ok))) ui.pending = null;
    const z = sizes(v);
    const handEl = root.querySelector('.hand');
    const scroll = handEl ? handEl.scrollLeft : 0;
    root.innerHTML = `
    <div class="wz cc-game" style="--cw:${z.cw}px;--cw0:${z.cw}px">
      <div class="wz-top">
        <div class="wz-round"><b>Color Clash</b><span class="label"> · round ${v.round}${v.target ? ` · to ${v.target}` : ''}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-cc="rules">Rules</button>', 'cc')}
      </div>
      ${tableHTML(v, ctx)}
      <div class="wz-status ${v.myTurn && v.phase === 'playing' ? 'mine' : ''}"><span>${guidance(v)}</span>${drawInline(v)}</div>
      ${controlsHTML(v)}
      ${handHTML(v, z)}
      ${overlayHTML(v)}
    </div>`;
    if (v.event) ui.shown = v.event.seq;
    const h2 = root.querySelector('.hand');
    if (h2) h2.scrollLeft = scroll;
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-cc]');
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!v || !ctx || !el) return;
    switch (el.dataset.cc) {
      case 'play': {
        const c = v.hand.find((x) => x.id === el.dataset.id);
        if (!v.myTurn || !c || !c.ok) return;
        if (c.c === 'W') { ui.pending = ui.pending === c.id ? null : c.id; ctx.rerender(); } else ctx.act({ type: 'play', card: c.id });
        break;
      }
      case 'colour': if (v.myTurn && ui.pending) { const a = { type: 'play', card: ui.pending, colour: el.dataset.colour }; ui.pending = null; ctx.act(a); } break;
      case 'cancel': ui.pending = null; ctx.rerender(); break;
      case 'draw': if (v.canDraw) ctx.act({ type: 'draw' }); break;
      case 'keep': if (v.myTurn && v.drawn) ctx.act({ type: 'pass' }); break;
      case 'next': ui.seenRound = v.roundResult ? v.roundResult.round : null; ctx.rerender(); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('colorclash', { render });
})();
