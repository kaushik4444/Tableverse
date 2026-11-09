/* Property Rivals table renderer: an 11x11 board ring, tokens, dice, and phase-specific panels (buy, auction, debt, trade,
 * property manager). The server view carries the static board (v.squares / v.groups). Styles in propertyrivals.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, v: null, root: null, seq: null, mgr: false, trade: null, bid: 0, scores: false,
    disp: {}, plans: {}, stepTimer: null, card: null };
  const STEP_MS = 480; // one square per step: slow enough to follow every tile (the server waits for the same time: games/propertyrivals/board.js)
  const FAST_MS = 320; // very long advances (over 14 squares) a little quicker
  const DWELL_MS = 800; // the token rests on the square it lands on before the text and buttons follow
  const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const ICON = { start: '➡️', fund: '💰', surprise: '❓', tax: '💸', lockup: '🔒', rest: '☕', golockup: '👮', port: '⚓', utility: '💡' };

  /** Grid cell (1-based row, col) of square i on the 11x11 ring: 0 bottom-right, then clockwise. */
  function cell(i) {
    if (i <= 10) return [11, 11 - i];
    if (i <= 20) return [11 - (i - 10), 1];
    if (i <= 30) return [1, 1 + (i - 20)];
    return [1 + (i - 30), 11];
  }
  const colour = (v, i) => ['p-a', 'p-b', 'p-c', 'p-d', 'p-e', 'p-f'][i % 6];
  const name = (v, i) => (i === v.me ? 'You' : esc(v.players[i].name));
  const coins = (n) => `🪙${n}`;

  const shown = (p) => (ui.disp[p.id] === undefined ? p.pos : ui.disp[p.id]);

  /** Decide how a token gets from where it is shown to where the server says it is: walk square by square, or jump. */
  function planMoves(v) {
    const fresh = v.round === 1 && v.dice && v.dice[0] === 0; // a new game: nobody has rolled yet
    v.players.forEach((p, i) => {
      if (ui.disp[p.id] === undefined || fresh) { ui.disp[p.id] = p.pos; delete ui.plans[p.id]; return; }
      const from = ui.disp[p.id], to = p.pos;
      const current = ui.plans[p.id];
      if (current && current.to === to) return;
      if (from === to) { delete ui.plans[p.id]; return; }
      const fwd = (to - from + 40) % 40, bwd = 40 - fwd;
      const card = v.lastCard && v.lastCard.by === i ? v.lastCard.text : '';
      if (p.inLockup && to === 10) { ui.disp[p.id] = to; delete ui.plans[p.id]; return; } // sent to the lockup: no walking there
      const back = /back/i.test(card) && bwd <= 4;
      ui.plans[p.id] = { to, dir: back ? -1 : 1, ms: (back ? bwd : fwd) > 14 ? FAST_MS : STEP_MS, last: Date.now() };
    });
    if (Object.keys(ui.plans).length && !ui.stepTimer) ui.stepTimer = setInterval(stepTokens, 60);
  }
  let tickAt = 0;
  function stepTokens() {
    if (!ui.root || !ui.root.isConnected) { clearInterval(ui.stepTimer); ui.stepTimer = null; ui.plans = {}; return; }
    const now = Date.now(); let changed = false;
    for (const id of Object.keys(ui.plans)) {
      const pl = ui.plans[id];
      if (ui.disp[id] === pl.to) { if (now >= pl.hold) { delete ui.plans[id]; changed = true; } continue; } // resting on the landing square
      if (now - (pl.last || 0) < pl.ms - 10) continue;
      pl.last = now; ui.disp[id] = (ui.disp[id] + pl.dir + 40) % 40; changed = true;
      if (ui.disp[id] === pl.to) pl.hold = now + DWELL_MS;
    }
    if (!Object.keys(ui.plans).length) { clearInterval(ui.stepTimer); ui.stepTimer = null; }
    if (changed) ui.ctx.rerender();
  }

  function squareHTML(v, i) {
    const s = v.squares[i], l = v.land[i], [r, c] = cell(i);
    const band = s.group ? `<i class="pr-band" style="background:${v.groups[s.group].color}"></i>` : `<i class="pr-ico">${ICON[s.type] || ''}</i>`;
    const price = s.price ? `<small>${s.price}</small>` : s.amount ? `<small>-${s.amount}</small>` : '';
    const own = l && l.owner >= 0 ? ` owned ${colour(v, l.owner)}${l.mortgaged ? ' mort' : ''}` : '';
    const badge = l && l.owner >= 0 && v.players[l.owner] ? `<span class="pr-owner" aria-hidden="true">${v.players[l.owner].token}</span>` : '';
    const houses = l && l.houses ? `<span class="pr-houses">${l.houses === 5 ? '🏨' : '🏠'.repeat(l.houses)}</span>` : '';
    const here = v.players.map((p, k) => (!p.bankrupt && shown(p) === i ? `<span class="pr-tok ${colour(v, k)} ${k === v.turn ? 'now' : ''} ${ui.plans[p.id] && ui.disp[p.id] !== ui.plans[p.id].to ? 'walk' : ''}" title="${esc(p.name)}">${p.token}</span>` : '')).join('');
    const corner = [0, 10, 20, 30].includes(i) ? ' corner' : '';
    return `<div class="pr-sq${own}${corner}" style="grid-row:${r};grid-column:${c}" data-sq="${i}" title="${esc(s.name)}">${band}${badge}<b>${esc(s.name)}</b>${price}${houses}<div class="pr-here">${here}</div></div>`;
  }

  /** One line says what just happened. It replaces itself (nothing stacks or floats): the roll while the token walks, the outcome once it arrives. */
  function newsHTML(v, walking, cardShown) {
    const log = v.log || [];
    const skip = (e) => e.kind === 'info' || (e.kind === 'auction' && /^(bid|passed)/.test(e.card)) || (cardShown && e.kind === 'card');
    const e = walking ? [...log].reverse().find((x) => x.kind === 'roll' || x.kind === 'lockup') : [...log].reverse().find((x) => !skip(x));
    if (!e) return '';
    const text = e.by === 'System' || e.by === 'Table' ? e.card : `${e.by} ${e.card}`;
    return `<p class="pr-news k-${esc(e.kind)}" role="status">${esc(text)}</p>`;
  }

  function centerHTML(v) {
    const d = v.dice;
    const dice = d && d[0] ? `<div class="pr-dice" aria-label="Dice ${d[0]} and ${d[1]}"><span>${DIE[d[0]]}</span><span>${DIE[d[1]]}</span></div>` : '<div class="pr-dice"><span>🎲</span></div>';
    const walking = Object.keys(ui.plans).length > 0;
    const cardFresh = !walking && v.lastCard && v.event && v.event.seq - v.lastCard.seq <= 4;
    const card = cardFresh ? `<p class="pr-card ${v.lastCard.deck}"><b>${v.lastCard.deck === 'fund' ? 'Community Fund' : 'Surprise'}</b> ${esc(v.lastCard.text)}</p>` : '';
    const jack = v.options.jackpot ? `<small>Rest Stop jackpot ${coins(v.jackpot)}</small>` : '';
    const cur = v.players[v.turn];
    const turn = v.phase !== 'gameOver' && cur ? `<div class="pr-turn ${colour(v, v.turn)}"><span class="pr-turntok">${cur.token}</span><b>${v.turn === v.me ? 'Your turn' : esc(cur.name) + '’s turn'}</b></div>` : '';
    return `<div class="pr-mid">${turn}${dice}${newsHTML(v, walking, cardFresh)}<small>Round ${v.round}${v.options.rounds !== 'off' ? ' / ' + v.options.rounds : ''}</small>${jack}${card}</div>`;
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winner === v.me ? 'You won!' : 'Game over';
    const who = esc(v.players[v.turn].name);
    if (v.me < 0) return `Watching: ${who}`;
    switch (v.phase) {
      case 'roll': return v.myTurn ? (v.players[v.me].inLockup ? 'You are in the lockup: roll doubles, pay, or use a card' : 'Your turn: roll the dice') : `${who} is rolling…`;
      case 'buy': return v.myTurn ? `Buy ${esc(v.squares[v.players[v.me].pos].name)}?` : `${who} is deciding whether to buy…`;
      case 'manage': return v.myTurn ? 'Build, trade, or end your turn' : `${who} is finishing the turn…`;
      case 'debt': return v.myTurn ? `You owe ${coins(v.debt.amount)}: raise cash or go bankrupt` : `${who} must raise ${coins(v.debt.amount)}`;
      case 'auction': return v.myTurn ? `Auction: bid on ${esc(v.squares[v.auction.sq].name)} or pass` : `Auction for ${esc(v.squares[v.auction.sq].name)}`;
      case 'trade': return v.myTurn ? 'Answer the trade offer' : 'A trade is on the table';
      default: return '';
    }
  }

  /** The card for one square: owner, buildings, rents and costs. Opened by tapping a city in the rivals list. */
  function cardHTML(v) {
    const k = ui.card; const s = k == null ? null : v.squares[k];
    if (!s) return '';
    const l = v.land[k]; const info = v.info[k] || {};
    const owner = !l || l.owner < 0 ? 'Unowned (the bank)' : `${esc(v.players[l.owner].name)}${l.owner === v.me ? ' (you)' : ''}`;
    const swatch = s.group ? `<span class="pr-swatch" style="background:${v.groups[s.group].color}"></span>` : '';
    const kind = s.type === 'city' ? `${esc(v.groups[s.group].name)} colour group` : s.type === 'port' ? 'Port' : s.type === 'utility' ? 'Utility' : 'Square';
    const rows = [
      ['Owner', owner],
      ['Price to buy', coins(s.price)],
      ['Mortgage value (received when mortgaged)', coins(info.mortgage)],
      ['Unmortgage cost (mortgage plus 10%)', coins(info.unmortgage)],
    ];
    if (s.type === 'city') {
      const built = !l ? 'none' : l.houses === 0 ? 'none' : l.houses >= 5 ? '🏨 hotel' : `🏠 ${l.houses} house${l.houses === 1 ? '' : 's'}`;
      rows.splice(1, 0, ['Buildings', built], ['Mortgaged', l && l.mortgaged ? 'yes (no rent)' : 'no']);
      rows.push(['Rent right now', coins(info.rentNow)], ['Each house or hotel costs', coins(info.house)]);
    }
    const table = s.type === 'city' ? `<h3>Rent</h3><table class="pr-rent"><tbody>
        ${[['No buildings', s.rents[0]], ['1 house', s.rents[1]], ['2 houses', s.rents[2]], ['3 houses', s.rents[3]], ['4 houses', s.rents[4]], ['Hotel', s.rents[5]]]
          .map(([a, b]) => `<tr><th scope="row">${a}</th><td>${coins(b)}</td></tr>`).join('')}
      </tbody></table>
      <p class="hint">With no buildings the rent doubles when the owner holds the whole colour group. Building needs the whole group, an even spread of houses, and no mortgages in the group.</p>` : '';
    return `<div class="overlay pr-card-ov"><div class="sheet pr-card" role="dialog" aria-modal="true" aria-labelledby="pr-card-title">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px"><h2 id="pr-card-title">${swatch}${esc(s.name)}</h2>
      <button type="button" class="btn ghost small" data-pr="closeCard" aria-label="Close card">✕</button></div>
      <p class="hint" style="text-align:left;margin-top:0">${kind}</p>
      <dl class="pr-kv">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      ${table}
    </div></div>`;
  }

  function playersHTML(v, ctx) {
    const lead = v.phase !== 'gameOver' ? window.CardTable.pt.leaderOf(v.players.length, (k) => (v.players[k].bankrupt ? -Infinity : v.players[k].netWorth), 1) : -1; // most net worth
    return `<ul class="pr-players">${v.players.map((p, i) => {
      const owned = v.land.reduce((n, l) => n + (l && l.owner === i ? 1 : 0), 0);
      const st = p.bankrupt ? '💀 bankrupt' : p.inLockup ? '🔒 lockup' : '';
      const mine = v.land.map((l, k) => (l && l.owner === i ? k : -1)).filter((k) => k >= 0);
      const holdings = mine.length ? `<span class="pr-hold" aria-hidden="true">${mine.map((k) => { const s = v.squares[k]; const m = v.land[k].mortgaged ? ' mort' : ''; return `<button type="button" class="pr-hold-b" data-pr="card" data-sq="${k}" aria-label="${esc(s.name)}: open card" title="${esc(s.name)}"><i class="${s.group ? '' : 'plain'}${m}" style="${s.group ? 'background:' + v.groups[s.group].color : ''}"></i></button>`; }).join('')}</span>` : '';
      const keep = p.keeps ? ` · 🎟️${p.keeps}` : '';
      return `<li data-vid="${esc(p.id)}" data-pid="${esc(p.id)}" class="${i === v.turn && v.phase !== 'gameOver' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}"><span class="pr-chip ${colour(v, i)}">${p.token}</span><span class="pr-pn"><b>${i === lead ? '<span class="crown" title="Most net worth">👑</span> ' : ''}${esc(p.name)}${i === v.me ? ' (you)' : ''}</b><small>net worth ${coins(p.netWorth)} · ${owned} propert${owned === 1 ? 'y' : 'ies'}${keep} ${st}</small>${holdings}</span><span class="pr-cash" title="Cash: coins in hand">${coins(p.cash)}</span></li>`;
    }).join('')}</ul>`;
  }

  function mgrRow(v, k) {
    const s = v.squares[k], l = v.land[k], can = v.can;
    const btn = (kind, label, on) => `<button class="btn small ghost" data-pr="${kind}" data-sq="${k}" ${on ? '' : 'disabled'}>${label}</button>`;
    const grp = s.group ? `<i class="pr-band sm" style="background:${v.groups[s.group].color}"></i>` : '<i class="pr-band sm"></i>';
    const h = l.houses ? (l.houses === 5 ? ' 🏨' : ' ' + '🏠'.repeat(l.houses)) : '';
    return `<li>${grp}<span class="pr-mn">${esc(s.name)}${h}${l.mortgaged ? ' <em>mortgaged</em>' : ''}</span>
      ${s.type === 'city' ? btn('build', 'Build', can.build.includes(k)) + btn('sell', 'Sell', can.sell.includes(k)) : ''}
      ${l.mortgaged ? btn('unmortgage', 'Redeem', can.unmortgage.includes(k)) : btn('mortgage', 'Mortgage', can.mortgage.includes(k))}</li>`;
  }

  function actionsHTML(v) {
    if (v.me < 0 || v.phase === 'gameOver') return '';
    if (Object.keys(ui.plans).length) return '<div class="pr-actions"><span class="hint">Moving…</span></div>'; // wait for the token to arrive
    const c = v.can, B = [];
    if (c.roll) B.push('<button class="btn big" data-pr="roll">🎲 Roll dice</button>');
    if (c.payLockup) B.push('<button class="btn" data-pr="payLockup">Pay 50 to leave</button>');
    if (c.useCard) B.push('<button class="btn" data-pr="useCard">Use free card</button>');
    if (v.phase === 'buy' && v.myTurn) { const s = v.squares[v.players[v.me].pos]; B.push(`<button class="btn big" data-pr="buy" ${c.buy ? '' : 'disabled'}>Buy ${esc(s.name)} ${coins(s.price)}</button><button class="btn ghost" data-pr="decline">${v.options.auction ? 'Auction it' : 'Pass'}</button>`); }
    if (c.endTurn) B.push(`<button class="btn big" data-pr="endTurn">${v.again ? 'Roll again' : 'End turn'}</button>`);
    if (v.phase === 'debt' && v.myTurn) B.push(`<button class="btn big" data-pr="pay" ${c.pay ? '' : 'disabled'}>Pay ${coins(v.debt.amount)}</button><button class="btn danger" data-pr="bankrupt">Go bankrupt</button>`);
    if (c.propose) B.push('<button class="btn ghost" data-pr="tradeOpen">🤝 Trade</button>');
    const myProps = v.land.map((l, k) => (l && l.owner === v.me ? k : -1)).filter((k) => k >= 0);
    if (myProps.length) B.push(`<button class="btn ghost" data-pr="mgr" aria-expanded="${ui.mgr}">🏘️ My properties (${myProps.length})</button>`);
    return `<div class="pr-actions">${B.join('')}</div>${ui.mgr ? `<ul class="pr-mgr panel">${myProps.map((k) => mgrRow(v, k)).join('')}</ul>` : ''}`;
  }

  function auctionHTML(v) {
    const a = v.auction; if (!a) return '';
    const s = v.squares[a.sq];
    const mine = v.myTurn && v.phase === 'auction';
    const min = a.high + 1;
    if (ui.bid < min) ui.bid = min;
    const cash = v.me >= 0 ? v.players[v.me].cash : 0;
    return `<div class="pr-panel panel"><h3>Auction · ${esc(s.name)} <small>list ${coins(s.price)}</small></h3>
      <p>${a.highBy >= 0 ? `High bid ${coins(a.high)} by ${name(v, a.highBy)}` : 'No bids yet'}</p>
      ${mine ? `<div class="pr-bid"><button class="btn small ghost" data-pr="bid-" aria-label="Lower bid">−10</button><input type="number" inputmode="numeric" min="${min}" max="${cash}" value="${ui.bid}" data-pr="bidv" aria-label="Your bid"><button class="btn small ghost" data-pr="bid+" aria-label="Raise bid">+10</button>
        <button class="btn" data-pr="bid" ${ui.bid >= min && ui.bid <= cash ? '' : 'disabled'}>Bid ${coins(ui.bid)}</button><button class="btn ghost" data-pr="passBid">Pass</button></div>` : '<p class="hint">Waiting for the next bidder…</p>'}</div>`;
  }

  function tradeOfferHTML(v) {
    const t = v.trade; if (!t) return '';
    const list = (ks) => ks.length ? ks.map((k) => esc(v.squares[k].name)).join(', ') : '—';
    const body = `<p><b>${name(v, t.from)}</b> offers ${list(t.give)}${t.giveCash ? ` + ${coins(t.giveCash)}` : ''}</p><p>for ${list(t.get)}${t.getCash ? ` + ${coins(t.getCash)}` : ''} from <b>${name(v, t.to)}</b></p>`;
    let btns = '';
    if (v.me === t.to) btns = '<button class="btn" data-pr="acceptTrade">Accept</button><button class="btn ghost" data-pr="declineTrade">Decline</button>';
    else if (v.me === t.from) btns = '<button class="btn ghost" data-pr="cancelTrade">Withdraw</button>';
    return `<div class="pr-panel panel"><h3>Trade offer</h3>${body}<div class="pr-actions">${btns}</div></div>`;
  }

  function tradeComposerHTML(v) {
    const t = ui.trade; if (!t || !v.can.propose) return '';
    const others = v.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== v.me && !p.bankrupt);
    const pick = (owner, set, kind) => v.land.map((l, k) => (l && l.owner === owner && !l.houses ? k : -1)).filter((k) => k >= 0)
      .map((k) => `<button type="button" class="pr-pick ${set.has(k) ? 'on' : ''}" data-pr="${kind}" data-sq="${k}" aria-pressed="${set.has(k)}">${esc(v.squares[k].name)}</button>`).join('') || '<small>nothing to offer</small>';
    return `<div class="pr-panel panel"><h3>Propose a trade</h3>
      <div class="pr-chips">${others.map(({ p, i }) => `<button type="button" class="pr-pick ${t.target === i ? 'on' : ''}" data-pr="tTarget" data-i="${i}">${p.token} ${esc(p.name)}</button>`).join('')}</div>
      ${t.target >= 0 ? `<p class="label">You give</p><div class="pr-chips">${pick(v.me, t.give, 'tGive')}</div><label class="pr-cashin">+ coins <input type="number" min="0" max="${v.players[v.me].cash}" value="${t.giveCash}" data-pr="tGiveCash"></label>
        <p class="label">You get</p><div class="pr-chips">${pick(t.target, t.get, 'tGet')}</div><label class="pr-cashin">+ coins <input type="number" min="0" max="${v.players[t.target].cash}" value="${t.getCash}" data-pr="tGetCash"></label>` : '<p class="hint">Pick a player to trade with</p>'}
      <div class="pr-actions"><button class="btn" data-pr="tSend" ${t.target >= 0 && (t.give.size || t.get.size || t.giveCash || t.getCash) ? '' : 'disabled'}>Send offer</button><button class="btn ghost" data-pr="tClose">Close</button></div></div>`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => (b.i === v.winner) - (a.i === v.winner) || b.p.netWorth - a.p.netWorth)
      .map(({ p, i }) => `<li class="${i === v.winner ? 'win' : ''}"><span>${i === v.winner ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>${p.bankrupt ? 'bankrupt' : coins(p.netWorth)}</span></li>`).join('');
    const title = v.me >= 0 ? (v.winner === v.me ? 'You won! 🎉' : 'Game over') : 'Game over';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2><p class="hint" style="text-align:left">${esc(v.players[v.winner].name)} wins. Net worth counts cash, properties and buildings.</p>
      <ul class="pr-final">${rows}</ul><div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-pr="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-pr="leave">Leave table</button></div></div></div>`;
  }

  function react(v) {
    const e = v.event, snd = window.CardTable.sound;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    if (!snd) return;
    if (e.type === 'roll') snd.play('card');
    else if (e.type === 'rent' || e.type === 'debt' || e.type === 'bankrupt') snd.play('lose');
    else if (e.type === 'over') snd.play(v.winner === v.me ? 'win' : 'lose');
    else if (e.type === 'traded' || e.type === 'bought' || e.type === 'sold') snd.play('collect');
  }

  function render(root, v, ctx) {
    const key = (ctx.room && ctx.room.code) + ':' + v.players.map((p) => p.id).join();
    if (ui.key !== key) { ui.key = key; ui.disp = {}; ui.plans = {}; ui.seq = null; ui.card = null; } // another table: start clean
    ui.ctx = ctx; ui.v = v; ui.root = root; react(v); planMoves(v);
    if (!v.can.propose) ui.trade = null;
    if (v.phase !== 'auction') ui.bid = 0;
    const board = `<div class="pr-board" role="group" aria-label="Game board">${v.squares.map((_, i) => squareHTML(v, i)).join('')}<div class="pr-center">${centerHTML(v)}</div></div>`;
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.pr : null;
    root.innerHTML = `<div class="wz pr" data-game="propertyrivals">
      <div class="wz-top"><div class="wz-round"><b>Property Rivals</b><span class="label"> · round ${v.round}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-pr="rules">Rules</button>', 'pr')}</div>
      ${board}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${actionsHTML(v)}${auctionHTML(v)}${tradeOfferHTML(v)}${tradeComposerHTML(v)}${playersHTML(v, ctx)}${overlayHTML(v)}${cardHTML(v)}</div>`;
    if (focus === 'bidv') { const el = root.querySelector('[data-pr="bidv"]'); if (el) el.focus(); }
    root.onclick = onClick; root.onchange = onChange;
  }

  function onChange(e) {
    const el = e.target.closest('[data-pr]'); if (!el) return;
    const n = Math.max(0, Math.floor(Number(el.value) || 0));
    const t = ui.trade;
    if (el.dataset.pr === 'bidv') { ui.bid = n; ui.ctx.rerender(); }
    else if (t && el.dataset.pr === 'tGiveCash') { t.giveCash = n; ui.ctx.rerender(); }
    else if (t && el.dataset.pr === 'tGetCash') { t.getCash = n; ui.ctx.rerender(); }
  }

  function onClick(e) {
    const el = e.target.closest('[data-pr]'); const v = ui.v, ctx = ui.ctx;
    if (!el || !v || el.tagName === 'INPUT') return;
    const sqi = Number(el.dataset.sq); const act = (a) => ctx.act(a);
    const toggle = (set) => { if (set.has(sqi)) set.delete(sqi); else set.add(sqi); ctx.rerender(); };
    switch (el.dataset.pr) {
      case 'roll': case 'payLockup': case 'useCard': case 'buy': case 'decline': case 'endTurn': case 'pay': case 'bankrupt':
      case 'acceptTrade': case 'declineTrade': case 'cancelTrade': case 'passBid': act({ type: el.dataset.pr }); break;
      case 'build': case 'sell': case 'mortgage': case 'unmortgage': act({ type: el.dataset.pr, square: sqi }); break;
      case 'mgr': ui.mgr = !ui.mgr; ctx.rerender(); break;
      case 'bid-': ui.bid = Math.max(v.auction.high + 1, ui.bid - 10); ctx.rerender(); break;
      case 'bid+': ui.bid += 10; ctx.rerender(); break;
      case 'bid': act({ type: 'bid', amount: ui.bid }); break;
      case 'tradeOpen': ui.trade = ui.trade ? null : { target: -1, give: new Set(), get: new Set(), giveCash: 0, getCash: 0 }; ctx.rerender(); break;
      case 'tClose': ui.trade = null; ctx.rerender(); break;
      case 'tTarget': ui.trade.target = Number(el.dataset.i); ui.trade.get = new Set(); ui.trade.getCash = 0; ctx.rerender(); break;
      case 'tGive': toggle(ui.trade.give); break;
      case 'tGet': toggle(ui.trade.get); break;
      case 'tSend': { const t = ui.trade; ui.trade = null; act({ type: 'propose', target: v.players[t.target].id, give: [...t.give], get: [...t.get], giveCash: t.giveCash, getCash: t.getCash }); break; }
      case 'card': ui.card = sqi; ctx.rerender(); break;
      case 'closeCard': ui.card = null; ctx.rerender(); break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('propertyrivals', { render });
})();
