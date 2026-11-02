/* Classic cross-board Ludo renderer. Rules and server state remain in games/ludo/engine.js. */
(() => {
  'use strict';
  const { esc } = window.CardTable;
  const ui = { ctx: null, latest: null };
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const HEX = { red: '#e84b4b', yellow: '#f2c94c', green: '#28a66a', blue: '#4388df' };
  const EMOJI = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' };
  const TRACK = [
    [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
    [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
    [7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],
    [14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
    [7,0],[6,0]
  ];
  const SAFE = new Set([0,8,13,21,26,34,39,47]);
  const HOME = [
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
  ];
  const STARTS = [0,13,26,39];
  function pos(i, p) {
    if (p >= 0 && p < 52) return TRACK[(STARTS[i] + p) % 52];
    if (p >= 52 && p < 58) return HOME[i][p - 52];
    return null;
  }
  function status(v) {
    if (v.phase === 'gameOver') return v.winner >= 0 ? v.players[v.winner].name + ' wins!' : 'Game over';
    if (v.phase === 'ready') return v.myTurn ? 'Everyone ready? Start the game' : v.players[v.turn].name + ' is getting ready';
    if (v.phase === 'rolling') return v.canRoll ? 'Your turn — roll the dice' : v.players[v.turn].name + ' is rolling';
    if (v.phase === 'moving') return v.canMove ? 'Choose a highlighted token to move' : v.players[v.turn].name + ' is moving';
    return 'Ludo';
  }
  function tokenButton(v, i, t, p, x, y, home = false) {
    if (p === 58) return '';
    const selectable = i === v.me && v.canMove && (v.legalTokens || []).includes(t);
    const color = COLORS[i];
    const title = `${v.players[i].name} — token ${t + 1}`;
    return `<button type="button" class="ludo-token ${color} ${selectable ? 'legal' : ''} ${home ? 'in-yard' : ''}" style="left:${(x / 15) * 100 + 3.333}%;top:${(y / 15) * 100 + 3.333}%" ${selectable ? `data-lt="tok:${t}" aria-label="${home ? "Bring token " + (t + 1) + " out" : p >= 52 ? "Move home-column token " + (t + 1) : "Move token " + (t + 1)}"` : 'disabled aria-hidden="true"'} title="${esc(title)}"><span></span></button>`;
  }
  function board(v) {
    const tiles = TRACK.map(([r,c], sq) => {
      const safe = SAFE.has(sq);
      const start = STARTS.indexOf(sq);
      const cls = start >= 0 ? COLORS[start] + '-start' : safe ? 'safe' : '';
      return `<div class="ludo-cell ${cls}" style="grid-row:${r+1};grid-column:${c+1}">${start >= 0 ? '★' : safe ? '✦' : ''}</div>`;
    }).join('');
    const lanes = HOME.map((lane,i) => lane.map(([r,c],j) =>
      `<div class="ludo-cell lane ${COLORS[i]}" style="grid-row:${r+1};grid-column:${c+1}">${j===5?'◆':''}</div>`
    ).join('')).join('');
    const bases = [
      ['red',1,1],['yellow',1,9],['blue',9,1],['green',9,9]
    ].map(([color,r,c]) => `<div class="ludo-base ${color}" style="grid-row:${r}/span 6;grid-column:${c}/span 6"><div class="ludo-base-inner"><div class="ludo-yard">${[0,1,2,3].map(k=>'<i></i>').join('')}</div></div><b>${color.toUpperCase()}</b></div>`).join('');
    const tokens = [];
    for (let i=0;i<v.n;i++) {
      for (let t=0;t<4;t++) {
        const p=v.players[i].tokens[t];
        if (p===58) continue;
        const xy=pos(i,p);
        if (xy) tokens.push(tokenButton(v,i,t,p,xy[1],xy[0]));
        else {
          const homeCells = [[2,2],[2,4],[4,2],[4,4],[2,10],[2,12],[4,10],[4,12],[10,10],[10,12],[12,10],[12,12],[10,2],[10,4],[12,2],[12,4]];
          const baseOffset=[0,4,8,12][i];
          const [r,c]=homeCells[baseOffset+t];
          tokens.push(tokenButton(v,i,t,p,c,r,true));
        }
      }
    }
    const center = `<div class="ludo-center" style="grid-row:7/span 3;grid-column:7/span 3"><div class="tri red"></div><div class="tri yellow"></div><div class="tri green"></div><div class="tri blue"></div><span>★</span></div>`;
    return `<div class="ludo-board-wrap"><div class="ludo-board">${bases}${tiles}${lanes}${center}<div class="ludo-tokens">${tokens.join('')}</div></div></div>`;
  }
  function players(v) {
    return `<div class="ludo-players">${v.players.map((p,i)=> {
      const done=p.tokens.filter(x=>x===58).length;
      const active=i===v.turn && v.phase!=='gameOver';
      return `<div class="ludo-player ${COLORS[i]} ${active?'active':''} ${i===v.me?'you':''}"><span class="player-dot"></span><div class="player-copy"><b>${esc(p.name)} ${i===v.me?'<small>(you)</small>':''}</b><small>${active?'Playing now':p.ready?'Ready':'Waiting'}</small></div><strong>${done}/4 <small>home</small></strong></div>`;
    }).join('')}</div>`;
  }
  function dice(v) {
    const d=v.dice;
    const face=d===null?'?':String(d);
    return `<div class="ludo-dice-panel"><div class="ludo-die ${v.canRoll?'rollable':''}">${face}</div><div class="ludo-dice-copy"><b>${d===null?'Roll the dice': 'You rolled a '+d}</b><small>${v.sixes? v.sixes+' consecutive six'+(v.sixes===1?'':'es')+' — roll again':''}</small></div><button class="btn big ludo-roll" data-lt="roll" ${v.canRoll?'':'disabled'}>${v.canRoll?'Roll dice':v.phase==='moving'?'Select a token':'Waiting'}</button></div>`;
  }
  function controls(v,ctx) {
    if(v.phase==='ready' && v.me>=0) return `<div class="ludo-ready"><b>Ready to play?</b><span>All players must be ready before the first roll.</span><button class="btn big" data-lt="ready" ${v.players[v.me].ready?'disabled':''}>${v.players[v.me].ready?'Ready ✓':'I’m ready'}</button></div>`;
    if(v.phase==='gameOver') {
      const w=v.winner>=0?esc(v.players[v.winner].name):'Nobody';
      return `<div class="ludo-ready"><b>${v.me===v.winner?'You won the game! 🎉':w+' won the game'}</b><span>Finishing order: ${(v.finishedOrder||[]).map(i=>esc(v.players[i].name)).join(' · ')}</span><div class="row">${ctx&&ctx.isHost?'<button class="btn" data-lt="again">Play again</button>':''}<button class="btn ghost" data-lt="leave">Leave table</button></div></div>`;
    }
    return '';
  }
  function render(root,v,ctx) {
    ui.latest=v; ui.ctx=ctx;
    root.innerHTML=`<section class="ludo ${v.phase==='gameOver'?'over':''}">
      <header class="ludo-header"><div><span class="ludo-kicker">TABLEVERSE CLASSICS</span><h2>🎲 Ludo</h2><p>Race your tokens home. First to finish all four wins.</p></div><nav>${CardTable.sound.button()}${CardTable.chat.button()}<button class="btn ghost small" data-act="emotes" aria-label="Send a reaction">😀</button><button class="btn ghost small" data-lt="rules">Rules</button><button class="btn ghost small" data-lt="leave" aria-label="Leave table">✕</button></nav></header>
      <div class="ludo-status ${v.myTurn?'mine':''}"><span class="ludo-status-pulse"></span><b>${esc(status(v))}</b>${v.phase==='moving'&&v.canMove?'<small>Tap one of the glowing tokens on the board</small>':''}</div>
      <div class="ludo-layout"><main class="ludo-play-area">${board(v)}</main><aside class="ludo-side"><h3>Players</h3>${players(v)}${dice(v)}<div class="ludo-hint"><b>How to play</b><span>Roll a 6 to leave your yard. Land on opponents to send them home. Reach the centre with an exact roll.</span></div></aside></div>
      ${controls(v,ctx)}
    </section>`;
    root.onclick=onClick;
  }
  function onClick(e) {
    const el=e.target.closest('[data-lt]');
    if(!el)return;
    const v=ui.latest,ctx=ui.ctx;
    if(!v||!ctx||el.disabled)return;
    const a=el.dataset.lt;
    if(a==='roll')ctx.act({type:'roll'});
    else if(a==='ready')ctx.act({type:'ready'});
    else if(a==='rules')ctx.showRules();
    else if(a==='again')ctx.rematch();
    else if(a==='leave')ctx.leave();
    else if(a.startsWith('tok:')) {
      const token=Number(a.slice(4));
      if(Number.isInteger(token)&&v.canMove&&(v.legalTokens||[]).includes(token))ctx.act({type:'move',token});
    }
  }
  window.CardTable.register('ludo',{render});
})();
