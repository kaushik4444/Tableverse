/* Shared poker-table layout: seats sit around an oval table, each player's played card lies in front of them.
 * Games call CardTable.pt.tableHTML(...) and provide the markup for each seat and card. */
(() => {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const RX = 37; // seat ellipse radii, in % of the table area
  const RY = 38;
  const CARD_K = 0.44; // played cards lie halfway between the centre and the seat

  /** Positions for n players, with player `me` at the bottom and the turn order running clockwise. */
  function layout(n, me) {
    const m = Math.max(me, 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = (i - m + n) % n;
      const a = ((90 + (k * 360) / n) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const cx = 50 + CARD_K * RX * cos;
      const cy = 50 + CARD_K * RY * sin;
      out.push({
        sx: +(50 + RX * cos).toFixed(2),
        sy: +(50 + RY * sin).toFixed(2),
        cx: +cx.toFixed(2),
        cy: +cy.toFixed(2),
        fx: +(cos * 240).toFixed(0), // where a played card flies in from (in % of its own size)
        fy: +(sin * 150).toFixed(0),
      });
    }
    return out;
  }

  const avatarColor = (s) => {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 45% 32%)`;
  };

  /** One player's seat: avatar disc, name plate and a status line. */
  function seatHTML(o) {
    const face = o.avatar ? esc(o.avatar) : esc([...o.name][0] || '?').toUpperCase();
    return `<div class="pseat ${o.first ? 'first' : ''} ${o.turn ? 'turn' : ''} ${o.me ? 'me' : ''} ${o.team !== undefined ? 'team' + o.team : ''}" data-pid="${esc(o.pid)}" data-act="playerCard" role="button" tabindex="0" aria-label="${esc(o.name)}: open player card">
      <div class="badges">${o.dealer ? '<span class="bdg d" title="Dealer">Dealer</span>' : ''}${o.first ? '<span class="bdg f" title="Bids and leads first this round">1st</span>' : ''}${o.badges || ''}</div>
      <div class="av" style="--avbg:${avatarColor(o.name)}"><span class="face">${face}</span>${o.extra || ''}</div>
      <div class="plate"><b>${esc(o.name)}</b><span>${esc(o.sub || '')}</span></div>${o.under || ''}
    </div>`;
  }

  /**
   * opts: { n, me, seat(i) -> html, card(i) -> {html, win?} | null, center: html, info?: html }
   */
  function tableHTML(opts) {
    const L = layout(opts.n, opts.me);
    let out = `<div class="pt" data-n="${opts.n}"><div class="pt-felt"></div>`;
    if (opts.info) out += `<div class="pt-info">${opts.info}</div>`;
    if (opts.center) out += `<div class="pt-center">${opts.center}</div>`;
    if (opts.corner) out += `<div class="pt-corner">${opts.corner}</div>`;
    for (let i = 0; i < opts.n; i++) {
      const c = opts.card(i);
      if (c) {
        const sweep = opts.collect !== undefined && opts.collect >= 0 && L[opts.collect];
        const to = sweep ? `;--tx:${L[opts.collect].sx}%;--ty:${L[opts.collect].sy}%` : '';
        out += `<div class="pt-card ${c.win ? 'win' : ''} ${c.lead ? 'lead' : ''} ${sweep ? 'sweep' : ''}" style="left:${L[i].cx}%;top:calc(${L[i].cy}% + ${(-L[i].fy / 150).toFixed(2)} * var(--card-push, 16px));--fx:${L[i].fx}%;--fy:${L[i].fy}%${to}">${c.html}</div>`;
      }
    }
    for (let i = 0; i < opts.n; i++) out += `<div class="pt-seat" style="left:${L[i].sx}%;top:${L[i].sy}%">${opts.seat(i)}</div>`;
    return out + '</div>';
  }

  /** Avatar emoji for a player id, from the room's member list. */
  const avatarOf = (room, id) => {
    const m = room && room.members.find((x) => x.id === id);
    return m ? m.avatar : '';
  };

  // A finished trick stays on the table for a moment (winner highlighted), then sweeps to the winner.
  // The server waits about the same time before the next card, so nobody plays into a trick that is still shown.
  const TRICK = { show: 1250, sweep: 450 };
  const hold = { init: false, key: null, phase: 'done', timers: [] };
  const clearHold = () => { hold.timers.forEach(clearTimeout); hold.timers = []; };

  /**
   * Call from a game's render with its latest view (needs v.lastTrick, v.trick, v.trickNo and v.round or v.handNo).
   * Returns { phase: 'show' | 'sweep' | 'done', active: boolean }. While active the UI should treat the player as not
   * on turn yet and show the finished trick; `rerender` is called when the phase changes.
   */
  function trickHold(v, rerender) {
    const key = v.lastTrick ? `${v.round || v.handNo}:${v.trickNo}` : null;
    if (!hold.init) {
      hold.init = true; // first render (page load / reconnect): do not replay an old trick
      hold.key = key;
      hold.phase = 'done';
    } else if (!key) {
      clearHold();
      hold.key = null;
      hold.phase = 'done';
    } else if (v.trick.length) {
      clearHold();
      hold.key = key;
      hold.phase = 'done';
    } else if (key !== hold.key) {
      clearHold();
      hold.key = key;
      hold.phase = 'show';
      hold.timers.push(setTimeout(() => {
        hold.phase = 'sweep';
        if (window.CardTable.sound) window.CardTable.sound.play('collect');
        rerender();
      }, TRICK.show));
      hold.timers.push(setTimeout(() => { hold.phase = 'done'; rerender(); }, TRICK.show + TRICK.sweep));
    }
    return { phase: hold.phase, active: hold.phase !== 'done' };
  }

  window.CardTable = window.CardTable || {};
  window.CardTable.TRICK_HOLD_MS = TRICK.show + TRICK.sweep;
  /** Index of the single player strictly ahead on `score(i)` (at least `min`), or -1 when it is tied or nobody has scored. */
  function leaderOf(n, score, min = 1) {
    let best = -Infinity, at = -1, tie = false;
    for (let i = 0; i < n; i++) { const s = score(i); if (s > best) { best = s; at = i; tie = false; } else if (s === best) tie = true; }
    return !tie && best >= min ? at : -1;
  }
  /**
   * The Ready control every round game shows in the place where the next thing happens (the round summary, or where you bid or
   * act): who has pressed, who the table still waits for, and a Ready button. It is plain HTML; its button uses the page-wide
   * data-act="readyUp". The data-ready-here mark tells the page that this game shows Ready itself, so no extra bar is added.
   */
  function readyBox(ctx, opts = {}) {
    const g = ctx && ctx.gate;
    const e = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const title = opts.title || 'Ready for the next round?';
    if (!g) return `<div class="ready-bar ready-box ${opts.cls || ''}" data-ready-here role="status"><span><b>${e(title)}</b></span><button class="btn" data-act="readyUp">Ready</button></div>`;
    const names = g.waiting.map(e).join(', ');
    const cls = `ready-bar ready-box ${opts.cls || ''}`;
    if (g.seated && !g.youReady) return `<div class="${cls}" data-ready-here role="status"><span><b>${e(title)}</b> ${g.ready} of ${g.total} ready${names ? ` · waiting for ${names}` : ''}</span><button class="btn" data-act="readyUp">Ready</button></div>`;
    return `<div class="${cls}" data-ready-here role="status"><span>${g.seated ? 'You are ready. ' : ''}${names ? `Waiting for ${names}` : 'Everybody is ready'}</span></div>`;
  }
  window.CardTable.readyBox = readyBox;
  window.CardTable.pt = { trickHold, layout, seatHTML, tableHTML, avatarOf, avatarColor, leaderOf };
})();
