/* Ludo table renderer: the board, the four home yards, the dice and your tokens.
 * Registered with the app shell via CardTable.register('ludo', ...). */
(() => {
  'use strict';
  const { esc, toast } = window.CardTable;

  const COLORS = ['🔴', '🟡', '🟢', '🔵'];
  const HOMES = ['Home 1', 'Home 2', 'Home 3', 'Home 4'];
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // track squares that protect from capture

  // Absolute board square for a token (player 0-3, internal position -1..57).
  function absSquare(playerIdx, p) {
    const STARTS = [0, 13, 26, 39];
    if (p === -1) return null; // in the yard
    if (p >= 0 && p < 52) return (STARTS[playerIdx] + p) % 52; // on the track
    if (p >= 52 && p < 58) return null; // in the home column (not on the shared track)
    return null; // finished
  }

  const ui = { ctx: null, latest: null, seq: null, rolled: null, selected: null, animating: false };

  function tokenMark(p, cls = '') {
    // internal position -> small drawn token glyph
    if (p === -1) return `<span class="lt yard">⚪</span>`;
    if (p >= 0 && p < 52) return `<span class="lt track ${cls}">●</span>`;
    if (p >= 52 && p < 58) return `<span class="lt home">↑</span>`;
    return `<span class="lt done">✓</span>`;
  }

  function sizes(v) {
    const w = window.innerWidth;
    let cw = w < 520 ? 44 : 52;
    return { cw };
  }

  function statusText(v) {
    const nm = (i) => esc(v.players[i].name);
    if (v.phase === 'gameOver') {
      const w = v.winner >= 0 ? nm(v.winner) : 'Nobody';
      return `Game over — ${w} won`;
    }
    if (v.phase === 'ready') return v.myTurn ? 'Tap Ready to start' : `${nm(v.turn)} is getting ready…`;
    if (v.phase === 'rolling') return v.canRoll ? 'Tap to roll the dice' : `${nm(v.turn)} is rolling…`;
    if (v.phase === 'moving') return v.canMove ? 'Move a token' : `${nm(v.turn)} is moving…`;
    return '…';
  }

  function boardHTML(v) {
    const tracks = []; // player's tokens on the track, keyed by absolute square -> tokens
    const at = {};
    for (let i = 0; i < v.n; i++) {
      for (let t = 0; t < v.tokens[i].length; t++) {
        const p = v.tokens[i][t];
        const sq = absSquare(i, p);
        if (sq === null) continue;
        (at[sq] = at[sq] || []).push({ i, t, p, color: v.players[i].color });
      }
    }
    const cells = [];
    for (let sq = 0; sq < 52; sq++) {
      const safe = SAFE.has(sq);
      const toks = at[sq] || [];
      cells.push(`<div class="lc ${safe ? 'safe' : ''}"><div class="lc-toks">${toks.map((x) => `<span class="lc-tok" style="color:${x.color === '🔴'?'#ef4444':x.color==='🟡'?'#eab308':x.color==='🟢'?'#22c55e':'#3b82f6'}" data-lt="tok:${x.i}:${x.t}">${x.color}</span>`).join('')}</div><small class="lc-num">${sq + 1}</small></div>`);
    }
    return `<div class="lb"><div class="lb-track">${cells.join('')}</div>${homeAreasHTML(v)}</div>`;
  }

  function homeAreasHTML(v) {
    // yards (p === -1) and home columns (p >= 52)
    const yards = [];
    const cols = [];
    for (let i = 0; i < v.n; i++) {
      const yard = v.tokens[i].filter((p) => p === -1).length;
      const inHome = v.tokens[i].filter((p) => p >= 52 && p < 58).length;
      const done = v.tokens[i].filter((p) => p >= 58).length;
      yards.push(`<div class="ly"><div class="ly-color">${v.players[i].color}</div><div class="ly-count" title="${esc(v.players[i].name)}'s yard">${yard}</div></div>`);
      cols.push(`<div class="lc"><div class="ly-color">${v.players[i].color}</div><div class="lc-toks">${Array.from({ length: inHome }, () => '<span class="lt home">↑</span>').join('')}${Array.from({ length: done }, () => '<span class="lt done">✓</span>').join('')}</div><small class="lc-num">home</small></div>`);
    }
    return `<div class="lyard">${yards.join('')}</div><div class="lhomecols">${cols.join('')}</div>`;
  }

  function diceHTML(v) {
    const d = v.dice === null ? '?' : v.dice;
    return `<div class="ldice"><button class="btn big ld-roll ${!v.canRoll ? 'disabled' : ''}" data-lt="roll" ${!v.canRoll ? 'disabled' : ''}>${d === '?' ? 'Roll' : d}</button>${v.sixes ? `<span class="ld-sixes">sixes: ${v.sixes}</span>` : ''}</div>`;
  }

  function controlsHTML(v, ctx) {
    if (v.me < 0) return '';
    if (v.phase === 'ready') {
      const me = v.players[v.me];
      return `<div class="lready"><h3>Get ready</h3><p class="hint">Everyone taps Ready, then the first player rolls.</p><button class="btn big" data-lt="ready" ${me.ready ? 'disabled' : ''}>${me.ready ? 'Waiting for the others…' : 'Ready'}</button></div>`;
    }
    if (v.phase === 'gameOver') {
      const w = v.winner >= 0 ? esc(v.players[v.winner].name) : 'Nobody';
      const isHost = ctx && ctx.isHost;
      return `<div class="lready"><h2>${v.me === v.winner ? 'You won! 🎉' : `Game over — ${w} won`}</h2><p class="hint">Finishing order: ${v.finishedOrder.map((i) => esc(v.players[i].name)).join(' → ')}.</p><div class="row" style="margin-top:12px">${isHost ? '<button class="btn" data-lt="again">Play again</button>' : '<span class="hint">Waiting for the host to start another game</span>'}<button class="btn ghost" data-lt="leave">Leave table</button></div></div>`;
    }
    return '';
  }

  function render(root, v, ctx) {
    ui.ctx = ctx;
    ui.latest = v;
    const z = sizes(v);
    root.style.setProperty('--lcw', z.cw + 'px');
    root.innerHTML = `
    <div class="ludo ${v.phase === 'gameOver' ? 'over' : ''}">
      <div class="wz-top">
        <div class="wz-round"><b>Ludo</b><span class="label">· ${v.players.length} players</span></div>
        <div class="row" style="gap:6px">${CardTable.sound.button()}${CardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button><button class="btn ghost small" data-lt="rules">Rules</button><button class="btn ghost small" data-lt="leave">✕</button></div>
      </div>
      <div class="l-status ${v.myTurn ? 'mine' : ''}">${statusText(v)}</div>
      ${boardHTML(v)}
      ${diceHTML(v)}
      ${controlsHTML(v, ctx)}
    </div>`;
    root.onclick = onClick;
  }

  function onClick(e) {
    const el = e.target.closest('[data-lt]');
    if (!el) return;
    const v = ui.latest;
    const ctx = ui.ctx;
    if (!v || !ctx) return;
    if (el.classList.contains('disabled')) return;
    const act = el.dataset.lt;
    if (act === 'roll') {
      ctx.act({ type: 'roll' });
    } else if (act === 'ready') {
      ctx.act({ type: 'ready' });
    } else if (act === 'rules') {
      ctx.showRules();
    } else if (act === 'again') {
      ctx.rematch();
    } else if (act === 'leave') {
      ctx.leave();
    } else if (act.startsWith('tok:')) {
      const [, i, t] = act.split(':');
      ui.selected = { i: Number(i), t: Number(t) };
      ctx.act({ type: 'move', token: ui.selected.t });
      ui.selected = null;
    }
  }

  window.CardTable.register('ludo', { render });
})();
