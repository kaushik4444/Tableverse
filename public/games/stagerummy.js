/* Stage Rummy table renderer: the stage goal, a scoreboard with every laid group, the two piles, and your hand.
 * Select cards, then: put them into the goal's groups and lay down, tap a laid group to add a selected card, or discard one card.
 * Styles in stagerummy.css. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, latest: null, sel: new Set(), groups: [], key: '', seq: null };

  const COL = { R: { name: 'Red', sym: '●' }, B: { name: 'Blue', sym: '■' }, G: { name: 'Green', sym: '▲' }, Y: { name: 'Yellow', sym: '◆' } };
  const KIND = { set: 'set', run: 'run', colour: 'colour' };
  const goalText = (g) => g.map((r) => `${r.kind === 'colour' ? 'colour' : KIND[r.kind]} of ${r.size}`).join(' + ');
  const cardName = (c) => (c.k === 'w' ? 'Wild card' : c.k === 's' ? 'Skip card' : `${COL[c.c].name} ${c.v}`);

  function cardHTML(c, { cls = '', attrs = '', tag = 'div' } = {}) {
    const face = c.k === 'w' ? '★' : c.k === 's' ? '⊘' : c.v;
    const sym = c.k === 'n' ? COL[c.c].sym : '';
    const as = c.as ? `<u>${c.as}</u>` : '';
    return `<${tag} class="sr-card ${c.k === 'n' ? 'c' + c.c : c.k === 'w' ? 'wild' : 'skip'} ${cls}" aria-label="${esc(cardName(c) + (c.as ? ' as ' + c.as : ''))}" ${attrs}><b>${face}</b><i>${sym}</i>${as}</${tag}>`;
  }
  const nameOf = (v, i) => (i === v.me ? 'You' : (v.players[i] ? esc(v.players[i].name) : 'Someone'));

  function eventText(v) {
    const e = v.event;
    if (!e) return '';
    const by = nameOf(v, e.by);
    switch (e.type) {
      case 'draw': return e.from === 'discard' ? `${by} took the discard.` : `${by} drew from the stock.`;
      case 'lay': return `<b>${by} laid down stage ${e.stage}!</b>`;
      case 'hit': return `${by} added a card to a group.`;
      case 'discard': return `${by} discarded.`;
      case 'skip': return `${nameOf(v, e.who)} lost a turn (skip).`;
      case 'roundEnd': return `<b>${by} went out. Round over.</b>`;
      default: return '';
    }
  }

  function guidance(v) {
    if (v.phase === 'gameOver') return v.winners.includes(v.me) ? 'You won!' : 'Game over';
    if (v.me < 0) return `Watching: ${nameOf(v, v.turn)} ${v.myTurn ? '' : 'to play'}`.trim();
    if (!v.myTurn) return `${nameOf(v, v.turn)} is playing…`;
    if (v.phase === 'draw') return 'Your turn: draw from the stock or take the discard';
    const me = v.players[v.me];
    if (!me.laid) return `Lay down: ${goalText(v.goals[Math.min(me.stage, v.stageCount) - 1])}, or discard to end your turn`;
    return ui.sel.size === 1 ? 'Tap a laid group to add the card, or discard it' : 'Select a card to add to a group or discard';
  }

  function groupHTML(v, owner, k, grp) {
    const label = grp.kind === 'set' ? `Set of ${grp.num}s` : grp.kind === 'colour' ? `${COL[grp.colour].name} cards` : `Run ${grp.lo}–${grp.hi}`;
    const me = v.players[v.me];
    const canHit = v.myTurn && v.phase === 'play' && me && me.laid && ui.sel.size === 1;
    const inner = `<span class="sr-glabel">${esc(label)}</span><span class="sr-gcards">${grp.cards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</span>`;
    return canHit
      ? `<button type="button" class="sr-group hit" data-sr="hit" data-owner="${owner}" data-group="${k}" aria-label="${esc('Add the selected card to ' + label)}">${inner}</button>`
      : `<div class="sr-group" role="group" aria-label="${esc(label)}">${inner}</div>`;
  }

  function playersHTML(v) {
    return `<ul class="sr-players">${v.players.map((p, i) => `<li class="${i === v.turn && v.phase !== 'gameOver' ? 'turn' : ''} ${i === v.me ? 'me' : ''}">
      <div class="sr-phead"><span class="sr-name">${esc(p.name)}${i === v.me ? ' (you)' : ''}</span><span class="sr-meta" title="Stage, cards in hand, points">S${p.stage} · ${p.cards}🂠 · ${p.score}pt</span></div>
      ${p.laid ? `<div class="sr-laid">${p.laid.map((grp, k) => groupHTML(v, i, k, grp)).join('')}</div>` : ''}</li>`).join('')}</ul>`;
  }

  function pilesHTML(v) {
    const mine = v.myTurn && v.phase === 'draw';
    const top = v.discardTop;
    const canTake = mine && top && top.k !== 's';
    return `<div class="sr-piles">
      <button type="button" class="sr-pile" data-sr="draw" data-from="stock" ${mine && v.stockCount + v.discardCount > 1 ? '' : 'disabled'} aria-label="Draw from the stock, ${v.stockCount} cards"><span class="sr-back">🪜</span><small>Stock · ${v.stockCount}</small></button>
      <button type="button" class="sr-pile" data-sr="draw" data-from="discard" ${canTake ? '' : 'disabled'} aria-label="Take the top discard">${top ? cardHTML(top) : '<span class="sr-empty"></span>'}<small>Discard${top && top.k === 's' ? ' (skip)' : ''}</small></button>
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
      return `<div class="sr-tray ${cards.length === r.size ? 'done' : ''}"><button type="button" class="btn small" data-sr="assign" data-group="${k}" ${ui.sel.size ? '' : 'disabled'}>Add selected to group ${k + 1}</button>
        <span class="sr-tlabel">${r.kind === 'colour' ? 'Colour' : r.kind[0].toUpperCase() + r.kind.slice(1)} of ${r.size} · ${cards.length}/${r.size}</span>
        <span class="sr-tcards">${cards.map((c) => cardHTML(c, { tag: 'button', cls: 'mini', attrs: `type="button" data-sr="unassign" data-id="${c.id}"` })).join('')}</span></div>`;
    }).join('');
    return `<div class="sr-trays panel">${trays}<button class="btn big" data-sr="lay" ${full ? '' : 'disabled'}>Lay down stage ${me.stage}</button></div>`;
  }

  function handHTML(v) {
    if (v.me < 0) return '';
    const assigned = new Set(ui.groups.flat());
    const can = v.myTurn && v.phase === 'play';
    const cards = v.hand.filter((c) => !assigned.has(c.id));
    const discard = can && ui.sel.size === 1 ? '<button class="btn" data-sr="discard">Discard selected</button>' : '';
    return `<div class="sr-hand" role="group" aria-label="Your hand">${cards.map((c) => cardHTML(c, { tag: 'button', cls: ui.sel.has(c.id) ? 'sel' : '', attrs: `type="button" data-sr="sel" data-id="${c.id}" aria-pressed="${ui.sel.has(c.id)}" ${v.phase === 'gameOver' ? 'disabled' : ''}` })).join('')}</div>${discard ? `<div class="sr-actions">${discard}</div>` : ''}`;
  }

  function overlayHTML(v) {
    if (v.phase !== 'gameOver') return '';
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => (b.p.stage - a.p.stage) || (a.p.score - b.p.score))
      .map(({ p, i }) => `<li class="${v.winners.includes(i) ? 'win' : ''}"><span>${v.winners.includes(i) ? '🏆 ' : ''}<b>${esc(p.name)}${i === v.me ? ' (you)' : ''}</b></span><span>stage ${Math.min(p.stage - 1, v.stageCount)} · ${p.score} pts</span></li>`).join('');
    const title = v.me >= 0 && v.winners.includes(v.me) ? (v.winners.length > 1 ? 'You share the win! 🎉' : 'You won! 🎉') : 'Game over';
    return `<div class="overlay"><div class="sheet"><h2>${title}</h2><p class="hint" style="text-align:left">Most stages completed, then the fewest points.</p><ul class="sr-final">${rows}</ul>
      <div class="row" style="margin-top:12px">${ui.ctx.isHost ? '<button class="btn" data-sr="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-sr="leave">Leave table</button></div></div></div>`;
  }

  function react(v) {
    const snd = window.CardTable.sound;
    const e = v.event;
    if (ui.seq === null) { ui.seq = e ? e.seq : 0; return; }
    if (!e || e.seq === ui.seq) return;
    ui.seq = e.seq;
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
    react(v); sync(v);
    const me = v.me >= 0 ? v.players[v.me] : null;
    const mine = v.myTurn;
    const goalLine = me ? `Stage ${Math.min(me.stage, v.stageCount)}: ${goalText(v.goals[Math.min(me.stage, v.stageCount) - 1])}${me.laid ? ' ✓' : ''}` : `${v.stageCount} stages`;
    const text = eventText(v);
    root.innerHTML = `
    <div class="wz sr">
      <div class="wz-top">
        <div class="wz-round"><b>Stage Rummy</b><span class="label"> · round ${v.round}</span></div>
        ${CardTable.toolbarSeed('<button class="btn ghost small" data-sr="rules">Rules</button>', 'sr')}
      </div>
      <p class="sr-goal" role="status">${esc(goalLine)}</p>
      ${playersHTML(v)}
      ${pilesHTML(v)}
      ${text ? `<p class="sr-event" role="status">${text}</p>` : ''}
      <div class="wz-status ${mine ? 'mine' : ''}"><span>${guidance(v)}</span></div>
      ${traysHTML(v)}
      ${handHTML(v)}
      ${overlayHTML(v)}
    </div>`;
    root.onclick = onClick;
  }

  function onClick(e) {
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
      case 'hit': if (play && ui.sel.size === 1) { const card = [...ui.sel][0]; ui.sel = new Set(); ctx.act({ type: 'hit', card, owner: Number(el.dataset.owner), group: Number(el.dataset.group) }); } break;
      case 'discard': if (play && ui.sel.size === 1) { const card = [...ui.sel][0]; ui.sel = new Set(); ctx.act({ type: 'discard', card }); } break;
      case 'rules': ctx.showRules(); break;
      case 'again': ctx.rematch(); break;
      case 'leave': ctx.leave(); break;
    }
  }

  window.CardTable.register('stagerummy', { render });
})();
