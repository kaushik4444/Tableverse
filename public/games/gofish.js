/* Go Fish table renderer: seats round the table with their books, the stock in the middle, your hand, and a two-step ask
 * (pick a rank, pick a player). Shares table.css and the seat/table helpers with the other card games. Styles in gofish.css. */
(() => {
  'use strict';
  const { esc, pt } = window.CardTable;

  // Same 4-colour suits as the other card games (the suit-R/Y/G/B classes live in table.css).
  const SUITS = {
    S: { sym: '♠', name: 'Spades', cls: 'suit-B' },
    H: { sym: '♥', name: 'Hearts', cls: 'suit-R' },
    D: { sym: '♦', name: 'Diamonds', cls: 'suit-Y' },
    C: { sym: '♣', name: 'Clubs', cls: 'suit-G' },
  };
  const WORDS = { A: 'Aces', J: 'Jacks', Q: 'Queens', K: 'Kings' };
  const word = (r) => WORDS[r] || r + 's';
  const ui = { ctx: null, latest: null, rank: null, target: null, seq: null, prevHand: null, scores: false, turnKey: '' };

  function cardHTML(c, cls = '', attrs = '', tag = 'div') {
    const s = SUITS[c.suit];
    return `<${tag} class="card ${s.cls} ${cls}" aria-label="${esc(c.rank + ' of ' + s.name)}" ${attrs}><span class="rk">${esc(c.rank)}<i>${s.sym}</i></span><span class="pip">${s.sym}</span><span class="rk br">${esc(c.rank)}<i>${s.sym}</i></span></${tag}>`;
  }
  const backHTML = (cls = '') => `<div class="card back ${cls}" aria-hidden="true"><span class="pip">🐟</span></div>`;
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));

  /** What just happened, in words. Only public facts (and, for the player who fished, the card they drew). */
  function eventText(v) {
    const e = v.event;
    if (!e) return '';
    if (e.type === 'over') return 'All the books are down.'; // the closing event names nobody
    const by = nameOf(v, e.by);
    const you = e.by === v.me;
    const to = e.target !== undefined ? (e.target === v.me ? 'you' : nameOf(v, e.target)) : '';
    const bookText = e.books && e.books.length ? ` 📚 ${e.books.map(word).join(', ')} complete!` : '';
    switch (e.type) {
      case 'take': return `${by} asked ${to} for ${word(e.rank)} and got <b>${e.count}</b>.${bookText}`;
      case 'fish': {
        const drew = you && v.myDraw ? ` You drew ${cardHTML(v.myDraw.card, 'tiny', '', 'span')}` : e.wish ? ' and drew the very card!' : '';
        return `${by} asked ${to} for ${word(e.rank)}: <b>Go Fish!</b>${e.empty ? ' (the stock is empty)' : drew}${bookText}`;
      }
      case 'empty': return `${by} had no cards and drew one.`;
      case 'draw': return `${by} drew a card.${bookText}`;
      case 'over': return 'All the books are down.';
      default: return '';
    }
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return `Watching: ${esc(v.players[v.turn].name)} is choosing`;
    if (!v.myTurn) return `${esc(v.players[v.turn].name)} is choosing…`;
    if (v.canDraw) return 'Nobody has cards to ask: draw from the stock';
    if (!ui.rank) return 'Your turn: pick a rank from your hand';
    if (!ui.target) return `Ask for ${word(ui.rank)}: pick a player`;
    return `Ask ${esc(v.players.find((p) => p.id === ui.target).name)} for ${word(ui.rank)}`;
  }

  function seatHTML(v, ctx, i) {
    const p = v.players[i];
    const askable = v.myTurn && v.targets.includes(p.id);
    const backs = Array.from({ length: Math.min(p.cards, 5) }, () => '<i></i>').join('');
    const books = p.books.length ? `<div class="gf-books" title="${p.books.length} book${p.books.length === 1 ? '' : 's'}">${p.books.map((r) => `<span>${esc(r)}</span>`).join('')}</div>` : '';
    const lead = pt.leaderOf(v.players.length, (k) => v.players[k].bookCount) === i && v.phase === 'playing';
    const sub = `${p.cards} card${p.cards === 1 ? '' : 's'} · 📚 ${p.bookCount}`;
    const html = pt.seatHTML({ pid: p.id, name: p.name, avatar: pt.avatarOf(ctx.room, p.id), sub, turn: i === v.turn && v.phase === 'playing', me: i === v.me, extra: `<div class="gf-backs">${backs}</div>`, under: books, badges: lead ? '<span class="bdg l" title="Most books so far">👑 Lead</span>' : '' });
    return askable ? html.replace('class="pseat', `data-gf-seat="${esc(p.id)}" class="pseat gf-askable ${ui.target === p.id ? 'gf-picked' : ''}`) : html;
  }

  function tableHTML(v, ctx) {
    const text = eventText(v);
    const center = `<div class="gf-stock" title="Stock"><div class="gf-pile">${v.stock ? backHTML() : '<div class="card slot"></div>'}</div><b>${v.stock}</b><small>in the stock</small></div>
      ${text ? `<p class="cap gf-event" role="status">${text}</p>` : ''}`;
    return pt.tableHTML({ n: v.players.length, me: v.me, seat: (i) => seatHTML(v, ctx, i), center, card: () => null });
  }

  function sizes(v) {
    const w = window.innerWidth;
    let cw = w < 480 ? 58 : w < 900 ? 72 : 84;
    if (innerHeight <= 700) cw = Math.min(cw, 48); // short phones: the table, the ask and the hand share one screen
    const n = v.hand.length;
    const avail = Math.min(w, 980) - 20;
    let overlap = -6;
    if (n > 1 && n * cw + (n - 1) * 6 > avail) overlap = Math.round(cw - Math.max((avail - cw) / (n - 1), cw * 0.36));
    return { cw, overlap };
  }

  function handHTML(v, z) {
    if (v.me < 0) return '';
    if (!v.hand.length) return '<div class="gf-empty">You have no cards. You draw one on your turn.</div>';
    const fresh = ui.prevHand;
    const can = new Set(v.askRanks);
    return `<div class="hand"><div class="hand-in" style="--cw:${z.cw}px">${v.hand.map((c, i) => {
      const cls = ['hc', v.myTurn && can.has(c.rank) ? 'playable' : '', v.myTurn && !can.has(c.rank) ? 'dim' : '', ui.rank === c.rank ? 'sel' : '', fresh && !fresh.has(c.id) ? 'pop' : ''].join(' ');
      return cardHTML(c, cls, `data-gf="rank" data-rank="${esc(c.rank)}" aria-pressed="${ui.rank === c.rank}" style="${i ? `margin-left:${-z.overlap}px` : ''}"`, 'button');
    }).join('')}</div></div>`;
  }

  function controlsHTML(v) {
    if (v.phase !== 'playing' || v.me < 0 || !v.myTurn) return '';
    if (v.canDraw) return '<div class="gf-ask"><button class="btn big" data-gf="draw">Draw a card</button></div>';
    const count = (r) => v.hand.filter((c) => c.rank === r).length;
    const ranks = v.askRanks.map((r) => `<button type="button" class="gf-chip ${ui.rank === r ? 'on' : ''}" data-gf="rank" data-rank="${esc(r)}" aria-pressed="${ui.rank === r}">${esc(r)}<small>×${count(r)}</small></button>`).join('');
    const targets = v.targets.map((id) => { const p = v.players.find((x) => x.id === id); return `<button type="button" class="gf-chip wide ${ui.target === id ? 'on' : ''}" data-gf="target" data-id="${esc(id)}" aria-pressed="${ui.target === id}">${esc(p.name)}<small>${p.cards} card${p.cards === 1 ? '' : 's'}</small></button>`; }).join('');
    const ready = ui.rank && ui.target;
    const label = ready ? `Ask ${esc(v.players.find((p) => p.id === ui.target).name)} for ${word(ui.rank)}` : 'Pick a rank and a player';
    return `<div class="gf-ask panel"><div class="gf-row"><span class="label">1 · Rank</span><div class="gf-chips">${ranks}</div></div>
      <div class="gf-row"><span class="label">2 · Player</span><div class="gf-chips">${targets}</div></div>
      <button class="btn big" data-gf="ask" ${ready ? '' : 'disabled'}>${label}</button></div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.bookCount - a.p.bookCount)
      .map(({ p, i }) => `<li class="${v.winners.includes(i) ? 'win' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${p.bookCount} book${p.bookCount === 1 ? '' : 's'}</span></li>`).join('');
    const title = v.me >= 0 ? (v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over') : 'Game over';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2>
      <p class="hint" style="text-align:left">${v.winners.length > 1 ? 'Equal books share the win.' : `${esc(v.players[v.winners[0]].name)} made the most books.`}</p>
      <ul class="gf-final">${rows}</ul>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-gf="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-gf="leave">Leave table</button></div></div></div>`;
  }

  function react(v) {
    const e = v.event;
    const snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; } // first render (page load or reconnect): do not replay an old event
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.books && e.books.length) snd.play('collect');
    else if (e.type === 'take' || e.type === 'fish' || e.type === 'draw') snd.play('card');
    else if (e.type === 'over') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    react(v);
    // a new turn or a rank we no longer hold clears the pending choice
    const key = `${v.turn}:${v.event ? v.event.seq : 0}`;
    if (key !== ui.turnKey) { ui.turnKey = key; ui.target = null; if (!v.askRanks.includes(ui.rank)) ui.rank = v.askRanks.length === 1 ? v.askRanks[0] : null; }
    if (!v.myTurn) { ui.rank = null; ui.target = null; }
    if (v.myTurn && ui.rank && !v.askRanks.includes(ui.rank)) ui.rank = null;
    if (v.myTurn && ui.target && !v.targets.includes(ui.target)) ui.target = null;
    if (v.myTurn && !ui.target && v.targets.length === 1) ui.target = v.targets[0]; // only one player to ask
    const z = sizes(v);
    const totalBooks = v.players.reduce((s, p) => s + p.bookCount, 0);
    const handEl = root.querySelector('.hand');
    const scroll = handEl ? handEl.scrollLeft : 0;
    root.innerHTML = `
    <div class="wz gf" style="--cw:${z.cw}px;--cw0:${z.cw}px">
      <div class="wz-top">
        <div class="wz-round"><b>Go Fish</b><span class="label"> · ${totalBooks}/13 books</span></div>
        <div class="row" style="gap:6px">${CardTable.sound.button()}${CardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button><button class="btn ghost small" data-gf="rules">Rules</button><button class="btn ghost small" data-gf="leave" aria-label="Leave table">✕</button></div>
      </div>
      ${tableHTML(v, ctx)}
      <div class="wz-status ${v.myTurn && v.phase === 'playing' ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${controlsHTML(v)}
      ${handHTML(v, z)}
      ${overlayHTML(v)}
    </div>`;
    ui.prevHand = new Set(v.hand.map((c) => c.id));
    const h2 = root.querySelector('.hand');
    if (h2) h2.scrollLeft = scroll;
    root.onclick = onClick;
  }

  function onClick(e) {
    const seat = e.target.closest('[data-gf-seat]');
    const el = e.target.closest('[data-gf]');
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!v || !ctx) return;
    if (seat && !el) { // tap a player at the table to pick them
      if (v.myTurn && v.targets.includes(seat.dataset.gfSeat)) { ui.target = seat.dataset.gfSeat; ctx.rerender(); }
      return;
    }
    if (!el) return;
    switch (el.dataset.gf) {
      case 'rank': if (v.myTurn && v.askRanks.includes(el.dataset.rank)) { ui.rank = ui.rank === el.dataset.rank ? null : el.dataset.rank; ctx.rerender(); } break;
      case 'target': if (v.myTurn && v.targets.includes(el.dataset.id)) { ui.target = el.dataset.id; ctx.rerender(); } break;
      case 'ask':
        if (v.myTurn && ui.rank && ui.target) { const a = { type: 'ask', target: ui.target, rank: ui.rank }; ui.rank = null; ui.target = null; ctx.act(a); }
        break;
      case 'draw': if (v.canDraw) ctx.act({ type: 'draw' }); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('gofish', { render });
})();
