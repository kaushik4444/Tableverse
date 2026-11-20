/* Stage 10 table renderer. The table is the shared felt: each player sits around it with the groups they have laid
 * in front of them, the two piles are in the middle, and a short message floats over the table when something happens.
 * You: the goal of your stage, your hand, and the groups you build before laying down.
 * Select cards, then: put them into the goal's groups and lay down, tap a laid group to add a selected card, or discard one.
 * Styles in stagerummy.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, latest: null, sel: new Set(), groups: [], key: '', seq: null, floatText: '', floatAt: 0, phases: false, feeds: new Map() };
  const FLOAT_MS = 2600;

  const COL = { R: { name: 'Red', sym: '●' }, B: { name: 'Blue', sym: '■' }, G: { name: 'Green', sym: '▲' }, Y: { name: 'Yellow', sym: '◆' } };
  const groupName = (r) => (r.kind === 'colour' ? `${r.size} of one colour` : `${r.kind} of ${r.size}`);
  const goalText = (g) => g.map(groupName).join(' + ');
  const cardName = (c) => (c.k === 'w' ? 'Wild card' : c.k === 's' ? 'Skip card' : `${COL[c.c].name} ${c.v}`);
  const stageName = (v, stage) => (v.stageNames && v.stageNames[stage - 1]) || `Stage ${stage}`;

  function cardHTML(c, { cls = '', attrs = '', tag = 'div' } = {}) {
    const face = c.k === 'w' ? '★' : c.k === 's' ? '⊘' : c.v;
    const sym = c.k === 'n' ? COL[c.c].sym : '';
    const as = c.as ? `<u>${c.as}</u>` : '';
    return `<${tag} class="sr-card ${c.k === 'n' ? 'c' + c.c : c.k === 'w' ? 'wild' : 'skip'} ${cls}" aria-label="${esc(cardName(c) + (c.as ? ' as ' + c.as : ''))}" ${attrs}><b>${face}</b><i>${sym}</i>${as}</${tag}>`;
  }
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));

  /** The line under the table: what just happened, in plain words. Kept for screen readers and the event log. */
  function eventText(v) {
    const e = v.event;
    if (!e) return '';
    const by = nameOf(v, e.by);
    switch (e.type) {
      case 'draw': return e.from === 'discard' ? `${by} took the top discard.` : `${by} drew from the stock.`;
      case 'lay': return `<b>${by} laid down stage ${e.stage}: ${esc(stageName(v, e.stage))}!</b>`;
      case 'hit': return `${by} added a card to a group.`;
      case 'discard': return `${by} discarded a card.`;
      case 'skip': return `${nameOf(v, e.who)} loses a turn (a skip card was discarded).`;
      case 'roundEnd': return `<b>${by} went out. The round is over.</b>`;
      default: return '';
    }
  }

  /** The short message that floats over the table for the moments worth noticing (a stage laid, a turn lost, a round over). */
  function floaterText(v) {
    const e = v.event;
    if (!e) return '';
    if (e.type === 'lay') return `${nameOf(v, e.by)} laid down ${esc(stageName(v, e.stage))}!`;
    if (e.type === 'skip') return `${nameOf(v, e.who)} loses a turn`;
    if (e.type === 'roundEnd') return `${nameOf(v, e.by)} went out!`;
    return '';
  }

  /** One line for the feed, from the game log. Only public facts are named: a stock draw says nothing about the card. */
  function logItem(v, e, id) {
    const by = nameOf(v, e.by);
    switch (e.type) {
      case 'draw': return e.from === 'discard'
        ? { id, tone: 'take', html: `<b>${by}</b> took the ${esc(e.label)} from the discard pile` }
        : { id, tone: 'info', html: `<b>${by}</b> drew from the stock` };
      case 'hit': return { id, tone: 'play', html: `<b>${by}</b> added ${esc(e.label)} to a group on the table` };
      case 'discard': return { id, tone: 'play', html: `<b>${by}</b> discarded ${esc(e.label)}` };
      case 'lay': return { id, tone: 'win', html: `<b>${by} laid down stage ${e.stage}: ${esc(stageName(v, e.stage))}!</b>` };
      case 'skip': return { id, tone: 'skip', html: `<b>${by}</b> played a Skip card · <b>${nameOf(v, e.who)}</b> lost a turn` };
      case 'roundEnd': return { id, tone: 'round', html: `<b>${by} went out. The round is over.</b>` };
      default: return null;
    }
  }
  /** The big moment for the spotlight: a skip (the Skip card shown large), a stage laid, a round over. Other moves need none. */
  function spotFor(v, e) {
    if (e.type === 'skip') return { card: cardHTML({ k: 's' }, { cls: 'tiny' }), caption: `${nameOf(v, e.by)} played Skip · ${nameOf(v, e.who)} loses a turn`, tone: 'skip', ms: 1300 };
    if (e.type === 'lay') return { caption: `${nameOf(v, e.by)} laid down stage ${e.stage}: ${esc(stageName(v, e.stage))}!`, tone: 'win', ms: 1300 };
    if (e.type === 'roundEnd') return { caption: `${nameOf(v, e.by)} went out. The round is over.`, tone: 'round', ms: 1300 };
    return null;
  }
  const feedKey = () => (ui.ctx && ui.ctx.room ? ui.ctx.room.code : null);
  /** Feeds the log into the shared feed and fires the spotlight for a new moment. Each table keeps its own position, so
   * coming back to a table compares its log with where it was left. The first visit records the position and shows no
   * history. A new game restarts the sequence, which starts a new epoch so its IDs cannot collide with the old ones. */
  function feedSync(v) {
    const key = feedKey();
    if (!key || !window.GameFeed) return;
    const last = v.log.length ? v.log[v.log.length - 1].seq : 0;
    const st = ui.feeds.get(key);
    if (!st) { ui.feeds.set(key, { lastSeq: last, epoch: 0, matchId: v.matchId }); return; }
    // a new match (by its id, or a sequence that went back) starts a new epoch: nothing of the old match is kept as the position
    const newMatch = v.matchId !== st.matchId || last < st.lastSeq;
    if (newMatch) st.epoch += 1;
    st.matchId = v.matchId;
    const prev = newMatch ? 0 : st.lastSeq;
    window.GameFeed.add(key, v.log.filter((e) => e.seq > prev).map((e) => logItem(v, e, `${st.epoch}-${e.seq}`)).filter(Boolean));
    if (v.event && v.event.seq > prev) { const sp = spotFor(v, v.event); if (sp) window.GameFeed.spotlight(sp); }
    st.lastSeq = last;
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return `Watching. ${nameOf(v, v.turn)} is ${v.myTurn ? 'to play' : 'taking a turn'}.`;
    if (!v.myTurn) return `${nameOf(v, v.turn)} is taking a turn…`;
    if (v.phase === 'draw') return 'Your turn. Draw from the stock, or take the top discard.';
    const me = v.players[v.me];
    if (!me.laid) return 'Build the goal in the trays below, then lay it down. Or discard one card to end your turn.';
    return ui.sel.size === 1 ? 'Tap a group on the table to add the card, or discard it to end your turn.' : 'You are down. Select a card to add it to a group, or discard one.';
  }

  function groupHTML(v, owner, k, grp) {
    const label = grp.kind === 'set' ? `Set of ${grp.num}s` : grp.kind === 'colour' ? `${COL[grp.colour].name} cards` : `Run ${grp.lo}–${grp.hi}`;
    const me = v.players[v.me];
    const canHit = v.myTurn && v.phase === 'play' && me && me.laid && ui.sel.size === 1;
    const inner = `<span class="sr-glabel">${esc(label)}</span><span class="sr-gcards">${grp.cards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</span>`;
    // A wild card on a run can go to either end, so the player picks the end. Other cards go where their value fits.
    const selected = canHit && grp.kind === 'run' ? v.hand.find((c) => c.id === [...ui.sel][0]) : null;
    if (selected && selected.k === 'w') {
      const ends = [];
      if (grp.lo > 1) ends.push(`<button type="button" class="btn small ghost" data-sr="hit" data-act="gameControl" data-owner="${owner}" data-group="${k}" data-end="low">Wild to low end (${grp.lo - 1})</button>`);
      if (grp.hi < 12) ends.push(`<button type="button" class="btn small ghost" data-sr="hit" data-act="gameControl" data-owner="${owner}" data-group="${k}" data-end="high">Wild to high end (${grp.hi + 1})</button>`);
      return `<div class="sr-group" role="group" aria-label="${esc(label)}">${inner}<div class="sr-ends">${ends.join('')}</div></div>`;
    }
    return canHit
      ? `<button type="button" class="sr-group hit" data-sr="hit" data-act="gameControl" data-owner="${owner}" data-group="${k}" aria-label="${esc('Add the selected card to ' + label)}">${inner}</button>`
      : `<div class="sr-group" role="group" aria-label="${esc(label)}">${inner}</div>`;
  }

  /** Whether a player has completed their stage. At game over the stage has already moved on, so the last round's record decides. */
  function stageDone(v, i, p) { return v.phase === 'gameOver' ? !!(v.lastRound && v.lastRound.laid[i]) : !!p.laid; }

  /** One player's seat: name, stage, cards in hand, points, and the groups they have laid down. */
  // the stage a player is shown on: at game over, the one the last round ended on (the same one the completed mark describes)
  function shownStage(v, i) {
    const st = v.phase === 'gameOver' && v.lastRound ? v.lastRound.stages[i] : v.players[i].stage;
    return Math.min(st, v.stageCount);
  }
  function seatHTML(v, ctx, i) {
    const p = v.players[i];
    const stage = shownStage(v, i);
    const sub = `Stage ${stage}/${v.stageCount}`; // short, so it fits a phone seat; the card count is under the seat
    const count = `<div class="sr-nolay">${p.cards} cards · ${p.score} pts</div>`; // points stay on the seat: fewer is better
    const under = p.laid ? `<div class="sr-laid">${p.laid.map((grp, k) => groupHTML(v, i, k, grp)).join('')}</div>${count}` : (v.phase === 'gameOver' ? '' : `<div class="sr-laid sr-nolay">Not down · ${p.cards} cards · ${p.score} pts</div>`);
    return window.CardTable.pt.seatHTML({
      pid: p.id,
      name: p.name + (i === v.me ? ' (you)' : ''),
      avatar: window.CardTable.pt.avatarOf(ctx.room, p.id),
      turn: i === v.turn && v.phase !== 'gameOver',
      me: i === v.me,
      sub,
      under,
    });
  }

  /** The middle of the table: the piles, and the floating message for the latest moment. */
  function centreHTML(v) {
    const mine = v.myTurn && v.phase === 'draw';
    const top = v.discardTop;
    const canTake = mine && top && top.k !== 's';
    const elapsed = Date.now() - ui.floatAt;
    const float = ui.floatText && elapsed < FLOAT_MS && v.phase !== 'gameOver'
      ? `<div class="sr-float" style="animation-delay:-${Math.max(0, elapsed)}ms" role="status">${ui.floatText}</div>`
      : '';
    return `${float}<div class="sr-piles">
      <button type="button" class="sr-pile" data-sr="draw" data-from="stock" ${mine && v.stockCount + v.discardCount > 1 ? '' : 'disabled'} aria-label="Draw from the stock, ${v.stockCount} cards"><span class="sr-back">🪜</span><small>Stock · ${v.stockCount}</small></button>
      <button type="button" class="sr-pile" data-sr="draw" data-from="discard" ${canTake ? '' : 'disabled'} aria-label="${top && top.k === 's' ? 'The top discard is a skip card and cannot be taken' : 'Take the top discard'}">${top ? cardHTML(top) : '<span class="sr-empty"></span>'}<small>${top && top.k === 's' ? 'Skip (can’t take)' : 'Discard'}</small></button>
    </div>`;
  }

  /** The goal's groups as trays; cards are assigned to them from the selection. */
  function traysHTML(v) {
    const me = v.players[v.me];
    if (!(v.myTurn && v.phase === 'play' && me && !me.laid)) return '';
    const goal = v.goals[Math.min(me.stage, v.stageCount) - 1];
    const full = goal.every((r, k) => ui.groups[k].length === r.size);
    const trays = goal.map((r, k) => {
      const cards = ui.groups[k].map((id) => v.hand.find((c) => c.id === id)).filter(Boolean);
      return `<div class="sr-tray ${cards.length === r.size ? 'done' : ''}"><button type="button" class="btn small" data-sr="assign" data-group="${k}" ${ui.sel.size ? '' : 'disabled'}>Put selected cards in group ${k + 1}</button>
        <span class="sr-tlabel">${esc(groupName(r))} · ${cards.length} of ${r.size}</span>
        <span class="sr-tcards">${cards.map((c) => cardHTML(c, { tag: 'button', cls: 'mini', attrs: `type="button" data-sr="unassign" data-id="${c.id}"` })).join('')}</span></div>`;
    }).join('');
    return `<div class="sr-trays panel"><p class="sr-tip">Select cards in your hand, then put them in a group. Every group must be complete before you can lay down.</p>${trays}<button class="btn big" data-sr="lay" ${full ? '' : 'disabled'}>${full ? `Lay down stage ${me.stage}` : `Lay down stage ${me.stage} (finish the groups first)`}</button></div>`;
  }

  function handHTML(v) {
    if (v.me < 0) return '';
    const assigned = new Set(ui.groups.flat());
    const can = v.myTurn && v.phase === 'play';
    const cards = v.hand.filter((c) => !assigned.has(c.id));
    const discard = can && ui.sel.size === 1 ? '<button class="btn" data-sr="discard">Discard selected (ends your turn)</button>' : '';
    return `<div class="sr-hand" role="group" aria-label="Your hand">${cards.map((c) => cardHTML(c, { tag: 'button', cls: ui.sel.has(c.id) ? 'sel' : '', attrs: `type="button" data-sr="sel" data-id="${c.id}" aria-pressed="${ui.sel.has(c.id)}" ${v.phase === 'gameOver' || !can ? 'disabled' : ''}` })).join('')}</div>${discard ? `<div class="sr-actions">${discard}</div>` : ''}`;
  }

  /** One group in words, the same wording as the rules: "set of 3", "run of 5", "6 cards of one colour". */
  const groupLabel = (r) => (r.kind === 'colour' ? `${r.size} cards of one colour` : `${r.kind} of ${r.size}`);
  function phasesHTML(v) {
    const now = v.me >= 0 ? v.players[v.me].stage - 1 : -1;
    const rows = v.goals.map((goal, i) => `<li class="${i === now ? 'ph-current' : ''}"${i === now ? ' aria-current="step"' : ''}><span class="ph-n">${i + 1}</span><span class="ph-body"><b>${esc(v.stageNames[i])}</b><small>${goal.map(groupLabel).join(' and ')}</small></span></li>`).join('');
    return `<div class="overlay" data-sr="closePhases"><div class="sheet" data-stop="1" role="dialog" aria-modal="true" aria-labelledby="sr-phases-title"><h2 id="sr-phases-title">Stages</h2><p class="hint" style="text-align:left">Lay down the groups of your current stage to move on. Your stage is highlighted.</p><ol class="ph-list">${rows}</ol><div class="row"><button class="btn" data-sr="closePhases">Close</button></div></div></div>`;
  }
  function overlayHTML(v, ctx) {
    if (ui.phases) return phasesHTML(v);
    if (v.phase !== 'gameOver') return '';
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => (b.p.stage - a.p.stage) || (a.p.score - b.p.score))
      .map(({ p, i }) => `<li class="${v.winners.includes(i) ? 'win' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>stage ${Math.min(p.stage - 1, v.stageCount)} · ${p.score} pts</span></li>`).join('');
    const title = v.me >= 0 && v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2><p class="hint" style="text-align:left">Most stages completed first, then the fewest points.</p><ul class="sr-final">${rows}</ul>
      <div class="row" style="margin-top:12px">${ctx.isHost ? '<button class="btn" data-sr="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-sr="leave">Leave table</button></div></div></div>`;
  }

  function react(v) {
    const snd = window.CardTable.sound;
    const e = v.event;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
    ui.floatText = floaterText(v);
    ui.floatAt = Date.now();
    if (!snd) return;
    if (v.phase === 'gameOver') snd.play(v.winners.includes(v.me) ? 'win' : 'lose');
    else snd.play(e.type === 'lay' || e.type === 'roundEnd' ? 'collect' : 'card');
  }

  /** Forget selections that no longer make sense (a new turn, cards gone from the hand). */
  function sync(v) {
    const me = v.me >= 0 ? v.players[v.me] : null;
    const key = `${v.round}:${v.turn}:${v.phase}:${me ? me.stage : 0}`;
    const goal = me ? v.goals[Math.min(me.stage, v.stageCount) - 1] : [];
    if (key !== ui.key || ui.groups.length !== goal.length) { ui.key = key; ui.sel = new Set(); ui.groups = goal.map(() => []); }
    const have = new Set(v.hand.map((c) => c.id));
    ui.sel = new Set([...ui.sel].filter((id) => have.has(id)));
    ui.groups = ui.groups.map((g) => g.filter((id) => have.has(id)));
  }

  function render(root, v, ctx) {
    ui.ctx = ctx; ui.latest = v;
    react(v); feedSync(v); sync(v);
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null; // keep keyboard focus on the same card across redraws
    const oldSheet = root.querySelector('[aria-labelledby="sr-phases-title"]');
    const sheetHadFocus = !!oldSheet && oldSheet.contains(document.activeElement);
    const me = v.me >= 0 ? v.players[v.me] : null;
    const goalIdx = me ? Math.min(me.stage, v.stageCount) - 1 : -1;
    const goalLine = me
      ? `Your goal, stage ${goalIdx + 1} · ${esc(stageName(v, goalIdx + 1))}: ${esc(goalText(v.goals[goalIdx]))}${me.laid ? ' ✓ laid down' : ''}`
      : `${v.stageCount} stages · watching`;
    const text = eventText(v);
    const n = v.players.length;
    const table = window.CardTable.pt.tableHTML({
      n,
      me: v.me,
      seat: (i) => seatHTML(v, ctx, i),
      card: () => null,
      center: centreHTML(v),
    });
    root.innerHTML = `
    <div class="wz sr">
      <div class="wz-top">
        <div class="wz-round"><b>Stage 10</b><span class="label"> · round ${v.round}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-sr="phases">Stages</button> <button class="btn ghost small" data-sr="rules">How to play</button>', 'sr')}
      </div>
      <div class="wz-bids sr-stages" aria-label="Every player's stage">${v.players.map((p, i) => {
        const st = shownStage(v, i);
        return `<span class="${i === v.turn && v.phase !== 'gameOver' ? 'sr-now' : ''} ${stageDone(v, i, p) ? 'sr-stage-done' : ''}">${i === v.me ? 'You' : esc(p.name)} stage <b>${st}</b>/${v.stageCount}</span>`;
      }).join('')}</div>
      <p class="sr-goal" role="status">${goalLine}</p>
      <div class="sr-table">${table}${window.GameFeed && feedKey() ? window.GameFeed.html(feedKey(), 'gf-float') : ''}</div>
      ${text ? `<p class="sr-event" role="status">${text}</p>` : ''}
      <div class="wz-status ${v.myTurn ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${traysHTML(v)}
      ${handHTML(v)}
      ${overlayHTML(v, ctx)}
    </div>`;
    root.onclick = onClick;
    const stagesSheet = root.querySelector('[aria-labelledby="sr-phases-title"]');
    if (stagesSheet) stagesSheet.onkeydown = (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault(); // the Stages sheet has one control, Close, so Tab stays on it
      stagesSheet.querySelector('button[data-sr="closePhases"]')?.focus({ preventScroll: true });
    };
    if (focused) { const el = root.querySelector(`.sr-hand [data-id="${focused}"]`); if (el && !el.disabled) el.focus({ preventScroll: true }); }
    // Restore sheet focus only if it owned focus and is visible; endFlow handles its reveal.
    if (sheetHadFocus && !root.closest('.endhold')) root.querySelector('[aria-labelledby="sr-phases-title"] button[data-sr="closePhases"]')?.focus({ preventScroll: true });
    // once the float has faded, remove only that element: a full redraw would drop keyboard focus on the controls
    if (ui.floatText && Date.now() - ui.floatAt < FLOAT_MS) setTimeout(() => { if (ui.latest === v && root.isConnected) { const f = root.querySelector('.sr-float'); if (f) f.remove(); } }, FLOAT_MS - (Date.now() - ui.floatAt) + 50);
  }

  function onClick(e) {
    if (e.target.closest('[data-stop]') && !e.target.closest('button')) return;
    const el = e.target.closest('[data-sr]');
    const v = ui.latest; const ctx = ui.ctx;
    if (!el || !v || !ctx) return;
    const id = Number(el.dataset.id);
    const play = v.myTurn && v.phase === 'play';
    switch (el.dataset.sr) {
      case 'draw': if (v.myTurn && v.phase === 'draw') ctx.act({ type: 'draw', from: el.dataset.from }); break;
      case 'sel': if (play) { if (ui.sel.has(id)) ui.sel.delete(id); else ui.sel.add(id); ctx.rerender(); } break;
      case 'assign': {
        if (!play) break;
        const k = Number(el.dataset.group);
        ui.groups = ui.groups.map((g, j) => (j === k ? g.concat([...ui.sel].filter((x) => !g.includes(x))) : g.filter((x) => !ui.sel.has(x))));
        ui.sel = new Set(); ctx.rerender(); break;
      }
      case 'unassign': ui.groups = ui.groups.map((g) => g.filter((x) => x !== id)); ctx.rerender(); break;
      case 'lay': if (play) ctx.act({ type: 'lay', groups: ui.groups.map((g) => g.slice()) }); break;
      case 'hit': if (play && ui.sel.size === 1) { const card = [...ui.sel][0]; ui.sel = new Set(); const end = el.dataset.end === 'low' || el.dataset.end === 'high' ? el.dataset.end : undefined; ctx.act({ type: 'hit', card, owner: Number(el.dataset.owner), group: Number(el.dataset.group), ...(end ? { end } : {}) }); } break;
      case 'discard': if (play && ui.sel.size === 1) { const card = [...ui.sel][0]; ui.sel = new Set(); ctx.act({ type: 'discard', card }); } break;
      case 'rules': ctx.showRules(); break;
      case 'phases':
        ui.phases = true;
        ctx.rerender();
        document.querySelector('.sr .sheet button[data-sr="closePhases"]')?.focus({ preventScroll: true });
        break;
      case 'closePhases': {
        ui.phases = false;
        ctx.rerender();
        // Restore after the app's document click handler has closed the toolbar menu.
        setTimeout(() => {
          // when the toolbar is folded, Phases sits in its hidden menu: focus the menu button rather than opening it
          const trigger = document.querySelector('button[data-sr="phases"]');
          const target = trigger && !trigger.closest('.tb-pop[hidden]') ? trigger : document.querySelector('.tb-more-btn');
          target?.focus({ preventScroll: true });
        }, 0);
        break;
      }
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('stagerummy', { render });
})();
