'use strict';
/* Admin console client (Stage 20.5). It only DISPLAYS and sends requests: the server decides who may do what on every call
   (session cookie + role read from the database + CSRF), so hiding a button here protects nothing and is not relied on. */
(() => {
  const main = document.getElementById('adMain');
  const tabs = document.getElementById('adTabs');
  const who = document.getElementById('adWho');
  const state = { me: null, tab: 'overview', csrf: '', gen: 0 }; // gen: which view is current; answers for an older view are dropped
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const countryName = (c) => { if (!c) return ''; try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || c; } catch { return c; } };
  const when = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  async function csrf(force) {
    if (state.csrf && !force) return state.csrf;
    const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    state.csrf = ((await r.json()) || {}).csrfToken || '';
    return state.csrf;
  }
  let view = null; // AbortController of the tab on screen: switching tabs cancels the requests of the one before
  let generation = 0; // counts tab switches: an answer that arrives for an earlier tab is dropped, even without AbortController
  const cancelled = () => { const e = new Error('cancelled'); e.name = 'AbortError'; return e; };
  async function api(path, body, retried) {
    const mine = generation;
    const opts = { credentials: 'same-origin', headers: {}, signal: view ? view.signal : undefined };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    // an abort while the body is read must reach the cancellation guard, not look like an empty answer
    const out = await r.json().catch((e) => { if (e && e.name === 'AbortError') throw e; return {}; });
    if (mine !== generation) throw cancelled(); // the tab changed while this request was in flight
    if (r.status === 403 && /CSRF/i.test(out.error || '') && !retried && body !== undefined) { await csrf(true); return api(path, body, true); }
    if (!r.ok || out.ok === false) { const e = new Error(out.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return out;
  }
  const say = (id, text, kind) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = 'ad-msg ' + (kind || ''); } };
  const fail = (e) => { if (e && e.name === 'AbortError') return; main.innerHTML = `<p class="ad-msg err">${esc(e.message)}</p>`; };

  // ---------------------------------------------------------------- overview
  const bars = (rows, empty) => rows.length
    ? `<div class="ad-bars">${rows.map((r) => { const max = Math.max(...rows.map((x) => x.total), 1); return `<div class="ad-bar"><span>${esc(r.name)}</span><i style="width:${Math.max(2, Math.round((r.total / max) * 100))}%"></i><span>${r.total}</span></div>`; }).join('')}</div>`
    : `<p class="ad-muted">${esc(empty)}</p>`;
  const spark = (values, label) => { const max = Math.max(...values, 1); return `<div class="ad-spark" role="img" aria-label="${esc(label)}">${values.map((v) => `<i style="height:${Math.round((v / max) * 100)}%" title="${v}"></i>`).join('')}</div>`; };
  /** A line chart as SVG with a data table under it (the chart is for sight, the table for screen readers and copying). */
  const lineChart = (values, labels, label) => {
    // null = not kept (outside the retention window): drawn as a gap, never as zero
    const nums = values.map((v) => (v == null ? null : Number(v) || 0));
    const known = nums.filter((v) => v !== null);
    const w = 600; const h = 170; const pad = 30;
    // an integer scale top of at least 2, so every tick label is a whole count at its true position
    const top = Math.max(2, Math.ceil(Math.max(...known, 0)));
    const max = top;
    const n = nums.length;
    const x = (i) => (n <= 1 ? pad : pad + (i * (w - 2 * pad)) / (n - 1));
    const y = (v) => h - pad - (v / max) * (h - 2 * pad);
    const grid = [0, Math.round(top / 2), top].map((tick) => {
      const yy = y(tick).toFixed(1);
      return `<line x1="${pad}" x2="${w - pad}" y1="${yy}" y2="${yy}" class="ad-grid-line"/><text x="${pad - 6}" y="${yy}" class="ad-axis" text-anchor="end" dominant-baseline="middle">${tick}</text>`;
    }).join('');
    const pts = nums.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    const dots = nums.map((v, i) => (v === null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="ad-dot"><title>${esc(labels[i] || '')}: ${v}</title></circle>`)).join('');
    const first = esc(labels[0] || ''); const last = esc(labels[n - 1] || '');
    const rows = nums.map((v, i) => `<tr><td>${esc(labels[i] || '')}</td><td>${v === null ? 'not kept' : v}</td></tr>`).reverse().join('');
    return `<figure class="ad-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${grid}<polyline points="${pts}" class="ad-line" fill="none"/>${dots}<text x="${pad}" y="${h - 6}" class="ad-axis">${first}</text><text x="${w - pad}" y="${h - 6}" class="ad-axis" text-anchor="end">${last}</text></svg><details><summary>${esc(label)}: data table</summary><table class="ad-t"><thead><tr><th>Day</th><th>${esc(label)}</th></tr></thead><tbody>${rows}</tbody></table></details></figure>`;
  };
  const RANGES = [7, 30, 90];

  async function overview(days = 30) {
    const gen = state.gen;
    const range = RANGES.includes(Number(days)) ? Number(days) : 30;
    const o = await api(`/api/admin/overview?days=${range}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const t = (m) => o.totals[m] || 0;
    const tile = (n, l) => `<div class="ad-card"><b>${esc(n)}</b><small>${esc(l)}</small></div>`;
    const q = o.queues || {};
    const rangeButtons = RANGES.map((d) => `<button class="ad-btn ${d === range ? 'primary' : ''}" data-days="${d}" aria-pressed="${d === range}">${d} days</button>`).join('');
    main.innerHTML = `<h2>Overview <small class="ad-muted">last ${o.days} days</small></h2>
      <div class="ad-row" role="group" aria-label="Date range" style="margin-bottom:12px">${rangeButtons}</div>
      <div class="ad-grid">${tile(o.active.dau, 'active today')}${tile(o.active.wau, 'active, 7 days')}${tile(o.active.mau, 'active, 30 days')}${tile(o.accounts.registered, 'registered accounts')}${tile(o.accounts.registered_24h, 'new in 24 hours')}${tile(t('registration'), 'registrations')}${tile(t('session'), 'sessions')}${tile(t('game_finished'), 'games finished')}${tile(t('error'), 'errors')}${tile(q.feedback_new || 0, 'feedback to read')}${tile(q.reports7d || 0, 'chat reports, 7 days')}${tile(q.reports_total || 0, 'chat reports, all time')}</div>
      <h3>Active players per day</h3>${lineChart(o.activeDaily || [], o.labels || [], 'Active players')}
      <h3>Registrations per day</h3>${lineChart(o.series.registration || (o.labels || []).map(() => 0), o.labels || [], 'Registrations')}
      <h3>Sessions per day</h3>${spark(o.series.session || [], 'Sessions per day')}
      <h3>Games finished per day</h3>${spark(o.series.game_finished || [], 'Games finished per day')}
      <h3>Popular games</h3>${bars(o.popularGames, 'No finished games yet.')}
      <h3>Errors by kind</h3>${bars(o.errors, 'No errors recorded.')}
      <p class="ad-muted">Counters only: no addresses, names or messages are recorded. Active users are counted from a keyed hash, never an account id. Detail rows are kept ${o.retention ? esc(o.retention.activeDays) : '35'} days, daily totals ${o.retention ? esc(o.retention.dailyDays) : '400'} days.</p>`;
    // a new range makes every answer still on its way out of date: bump the view generation so only the latest one is drawn
    // each click takes its own generation: an older request that fails later must not replace the current view
    main.querySelectorAll('[data-days]').forEach((b) => {
      b.onclick = () => {
        state.gen += 1;
        const mine = state.gen;
        overview(Number(b.dataset.days)).catch((e) => { if (mine === state.gen) fail(e); });
      };
    });
  }

  // ---------------------------------------------------------------- insights
  const ZONES = [['UTC', 'UTC'], ['Europe/Berlin', 'Germany'], ['Asia/Kolkata', 'India']];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
  const pctText = (a, b) => { const p = pct(a, b); return p === null ? '—' : p + '%'; };
  const hh = (h) => String(h).padStart(2, '0') + ':00';
  const mins = (m) => (m >= 120 ? (m / 60).toFixed(1) + ' h' : Math.round(m) + ' min');
  const stackBars = (a, b, labels, la, lb) => {
    const max = Math.max(...a.map((v, i) => v + b[i]), 1);
    const cols = a.map((v, i) => `<div class="ad-col" title="${esc(labels[i])}: ${v} new, ${b[i]} returning"><i class="r" style="height:${(b[i] / max) * 100}%"></i><i class="n" style="height:${(v / max) * 100}%"></i></div>`).join('');
    const rows = a.map((v, i) => `<tr><td>${esc(labels[i])}</td><td>${v}</td><td>${b[i]}</td></tr>`).reverse().join('');
    return `<figure class="ad-chart"><div class="ad-stack" role="img" aria-label="${esc(la)} and ${esc(lb)} players per day">${cols}</div>
      <p class="ad-muted"><span class="ad-key n"></span>${esc(la)} <span class="ad-key r"></span>${esc(lb)} (a player counts once a day)</p>
      <details><summary>Data table</summary><table class="ad-t"><thead><tr><th>Day</th><th>${esc(la)}</th><th>${esc(lb)}</th></tr></thead><tbody>${rows}</tbody></table></details></figure>`;
  };
  const heatmap = (heat, zone) => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    heat.forEach((c) => { grid[c.dow][c.hour] = c.playerGames; });
    const max = Math.max(...grid.flat(), 0);
    if (!max) return '<p class="ad-muted">No finished games in this range yet.</p>';
    const cells = grid.map((row, d) => `<span class="ad-hl">${DAYS[d]}</span>${row.map((v, h) => `<i class="ad-hc" style="--k:${(v / max).toFixed(2)}" title="${DAYS[d]} ${hh(h)}: ${v} player-games"></i>`).join('')}`).join('');
    const axis = '<span></span>' + [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span class="ad-hx" style="grid-column:${h + 2}/span 3">${hh(h)}</span>`).join('');
    const all = heat.slice().sort((x, y) => (x.dow - y.dow) || (x.hour - y.hour));
    const best = heat.slice().sort((x, y) => y.playerGames - x.playerGames).slice(0, 5);
    const byHour = Array(24).fill(0); heat.forEach((c) => { byHour[c.hour] += c.playerGames; });
    const peak = byHour.indexOf(Math.max(...byHour));
    return `<div class="ad-heat" role="img" aria-label="Player-games by weekday and hour, ${esc(zone)}">${axis}${cells}</div>
      <p class="ad-muted">Busiest hour overall: <b>${hh(peak)}–${hh((peak + 1) % 24)}</b> (${esc(zone)}). Darker is busier.</p>
      <p class="ad-muted">Busiest slots: ${best.map((c) => `${DAYS[c.dow]} ${hh(c.hour)} (${c.playerGames})`).join(', ')}.</p>
      <details><summary>All hours as a table</summary><table class="ad-t"><thead><tr><th>Slot</th><th>Games started</th><th>Player-games</th></tr></thead><tbody>${all.map((c) => `<tr><td>${DAYS[c.dow]} ${hh(c.hour)}</td><td>${c.matches}</td><td>${c.playerGames}</td></tr>`).join('')}</tbody></table></details>`;
  };

  const sel = { days: 30, tz: 'UTC' }; // the range and zone the admin chose last, even if that answer has not arrived yet
  async function insights(days = 30, tz = 'UTC') {
    const gen = state.gen;
    const range = RANGES.includes(Number(days)) ? Number(days) : 30;
    sel.days = range; sel.tz = tz;
    const o = await api(`/api/admin/insights?days=${range}&tz=${encodeURIComponent(tz)}`);
    if (gen !== state.gen) return;
    const tile = (n, l) => `<div class="ad-card"><b>${esc(n)}</b><small>${esc(l)}</small></div>`;
    const g = o.games || [];
    const sum = (k) => g.reduce((a, r) => a + r[k], 0);
    const matches = sum('matches'); const humans = sum('humans'); const left = sum('leftEarly');
    const rangeButtons = RANGES.map((d) => `<button class="ad-btn ${d === range ? 'primary' : ''}" data-days="${d}" aria-pressed="${d === range}">${d} days</button>`).join('');
    const zoneButtons = ZONES.map(([z, n]) => `<button class="ad-btn ${z === o.zone ? 'primary' : ''}" data-zone="${z}" aria-pressed="${z === o.zone}">${n}</button>`).join('');
    const gameRows = g.map((r) => `<tr><td data-l="Game">${esc(r.gameId)}</td><td data-l="Finished">${r.matches}</td><td data-l="Avg length">${mins(r.avgMinutes)}</td><td data-l="Avg seats">${r.avgSeats}</td><td data-l="Left early">${pctText(r.leftEarly, r.humans)}</td><td data-l="With a leaver">${pctText(r.withLeaver, r.matches)}</td><td data-l="Drawn">${pctText(r.draws, r.matches)}</td><td data-l="Finished of started">${pctText(r.finished, r.started)}</td></tr>`).join('');
    const pt = o.playtime; const buckets = ['under 10 min', '10–30 min', '30–60 min', '1–3 h', '3 h +'];
    const top = (o.top || []).map((r) => `<tr><td data-l="Player">${esc(r.displayName || r.username)} <span class="ad-muted">@${esc(r.username)}</span></td><td data-l="Games">${r.games}</td><td data-l="Wins">${r.wins}</td><td data-l="Played">${mins(r.minutes)}</td><td data-l="Usual hour">${r.peakHour == null ? '—' : hh(r.peakHour)}</td></tr>`).join('');
    const c = o.returning.cohort;
    main.innerHTML = `<h2>Insights <small class="ad-muted">last ${o.days} days, ${esc(o.zone)}</small></h2>
      <div class="ad-row" role="group" aria-label="Date range" style="margin-bottom:8px">${rangeButtons}</div>
      <div class="ad-row" role="group" aria-label="Time zone" style="margin-bottom:12px">${zoneButtons}</div>
      <div class="ad-grid">${tile(matches, 'games finished')}${tile(g.filter((r) => r.matches).length, 'different games played')}${tile(pt.players, 'signed-in players')}${tile(mins(pt.avgMinutes), 'avg play time per player')}${tile(pctText(left, humans), 'players who left early')}${tile(pctText(c.d1, c.size), 'came back next day')}${tile(pctText(c.d7, c.size), 'came back within a week')}</div>
      <h3>When people play</h3>${heatmap(o.heat || [], o.zone)}
      <h3>How each game goes</h3>${g.length ? `<table class="ad-t stack"><thead><tr><th>Game</th><th>Finished</th><th>Avg length</th><th>Avg seats</th><th>Left early</th><th>With a leaver</th><th>Drawn</th><th>Finished of started</th></tr></thead><tbody>${gameRows}</tbody></table>` : '<p class="ad-muted">No games yet.</p>'}
      <h3>New and returning players</h3>${stackBars(o.returning.newPerDay, o.returning.returningPerDay, o.labels, 'New', 'Returning')}
      <p class="ad-muted">Next-day and one-week return use players whose first game was between ${o.days + 7} and 7 days ago, so each has had a full week to come back (${c.size} players).</p>
      <h3>Time spent playing</h3>${bars(buckets.map((name, i) => ({ name, total: pt.buckets[i] })), 'No play yet.')}
      <p class="ad-muted">Median ${mins(pt.medianMinutes)}, total ${mins(pt.totalMinutes)}. Players per time bucket; games a player left early are not counted as time.</p>
      <h3>Where players are from</h3>${bars((o.countries || []).map((r) => ({ name: r.country ? countryName(r.country) : 'Not set', total: r.players })), 'No players yet.')}
      <p class="ad-muted">Players who played in this range, by the country they chose on their profile.</p>
      <h3>Most active players</h3>${top ? `<table class="ad-t stack"><thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Played</th><th>Usual hour</th></tr></thead><tbody>${top}</tbody></table>` : '<p class="ad-muted">No signed-in players yet.</p>'}
      <p class="ad-muted">Signed-in players only: guests and bots are left out. Figures come from finished games; nothing personal beyond the public username is shown.</p>`;
    const again = (d, z) => { sel.days = d; sel.tz = z; state.gen += 1; const mine = state.gen; insights(d, z).catch((e) => { if (mine === state.gen) fail(e); }); };
    main.querySelectorAll('[data-days]').forEach((b) => { b.onclick = () => again(Number(b.dataset.days), sel.tz); });
    main.querySelectorAll('[data-zone]').forEach((b) => { b.onclick = () => again(sel.days, b.dataset.zone); });
  }

  // ---------------------------------------------------------------- players (directory and per-player stats)
  const SORTS = [['seen', 'Last seen'], ['joined', 'Newest'], ['games', 'Games'], ['wins', 'Wins'], ['minutes', 'Time played'], ['leaving', 'Left early']];
  const hourColumns = (hourly, zone) => {
    hourly = hourly[zone] || hourly.UTC;
    const max = Math.max(...hourly, 1);
    const cols = hourly.map((v, h) => `<div class="ad-col" title="${hh(h)}: ${v} games"><i class="n" style="height:${(v / max) * 100}%"></i></div>`).join('');
    const peak = hourly.indexOf(Math.max(...hourly));
    return `<figure class="ad-chart"><div class="ad-stack" role="img" aria-label="Games started per hour of the day, ${esc(zone)}">${cols}</div>
      <p class="ad-muted">${Math.max(...hourly) ? `Usually starts around <b>${hh(peak)}</b>` : 'No games yet'} (${esc(zone)}). Left is midnight, right is 23:00.</p>
      <details><summary>Data table</summary><table class="ad-t"><thead><tr><th>Hour</th><th>Games</th></tr></thead><tbody>${hourly.map((v, h) => `<tr><td>${hh(h)}</td><td>${v}</td></tr>`).join('')}</tbody></table></details></figure>`;
  };
  const playerSel = { q: '', sort: 'seen', page: 1, tz: 'UTC' };

  async function players(q = playerSel.q, sort = playerSel.sort, pageNo = playerSel.page) {
    const gen = state.gen;
    Object.assign(playerSel, { q, sort, page: pageNo });
    const o = await api(`/api/admin/players?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&page=${pageNo}`);
    if (gen !== state.gen) return;
    const pages = Math.max(1, Math.ceil(o.total / o.pageSize));
    const sortButtons = SORTS.map(([k, n]) => `<button class="ad-btn ${k === o.sort ? 'primary' : ''}" data-sort="${k}" aria-pressed="${k === o.sort}">${n}</button>`).join('');
    const rows = o.players.map((p) => `<tr><td data-l="Player"><b>${esc(p.displayName)}</b><br><small class="ad-muted">@${esc(p.username)}${p.country ? ' · ' + esc(countryName(p.country)) : ''}</small>${p.suspended ? ' <span class="ad-pill danger">suspended</span>' : ''}</td>
      <td data-l="Games">${p.games}</td><td data-l="Wins">${p.wins}</td><td data-l="Win rate">${pctText(p.wins, p.rated - p.draws)}</td><td data-l="Left early">${pctText(p.leftEarly, p.games)}</td><td data-l="Played">${mins(p.minutes)}</td>
      <td data-l="Last seen">${esc(when(p.lastSeenAt))}</td><td><button class="ad-btn" data-view="${esc(p.username)}" aria-label="Open the profile of ${esc(p.username)}">Open</button></td></tr>`).join('');
    main.innerHTML = `<h2>Players <small class="ad-muted">${o.total} registered</small></h2>
      <form class="ad-search ad-row" id="pForm"><input name="q" value="${esc(q)}" placeholder="Search username or name" maxlength="40" aria-label="Search players" style="flex:1"><button class="ad-btn primary" type="submit">Search</button></form>
      <div class="ad-row" role="group" aria-label="Sort by" style="margin:8px 0 12px">${sortButtons}</div>
      ${o.players.length ? `<table class="ad-t stack"><thead><tr><th>Player</th><th>Games</th><th>Wins</th><th>Win rate</th><th>Left early</th><th>Played</th><th>Last seen</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="ad-muted">No players match.</p>'}
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="pPrev" ${pageNo <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${pageNo} of ${pages}</span><button class="ad-btn" id="pNext" ${pageNo >= pages ? 'disabled' : ''}>Next</button></div>
      <p class="ad-muted">Registered players only. Wins and win rate count only games with a recorded result that the player stayed to the end of, and leave out draws; time played leaves out games a player left early. Opening a profile is recorded in the audit log.</p>`;
    const go = (a, b, c) => { state.gen += 1; const mine = state.gen; players(a, b, c).catch((e) => { if (mine === state.gen) fail(e); }); };
    document.getElementById('pForm').onsubmit = (e) => { e.preventDefault(); go(new FormData(e.target).get('q') || '', o.sort, 1); };
    main.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => go(q, b.dataset.sort, 1); });
    document.getElementById('pPrev').onclick = () => go(q, o.sort, pageNo - 1);
    document.getElementById('pNext').onclick = () => go(q, o.sort, pageNo + 1);
    main.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { state.gen += 1; const mine = state.gen; playerProfile(b.dataset.view, 'UTC').catch((e) => { if (mine === state.gen) fail(e); }); }; });
  }

  async function playerProfile(username, tz = 'UTC') {
    const gen = state.gen;
    const o = await api(`/api/admin/players/profile?username=${encodeURIComponent(username)}`);
    if (gen !== state.gen) return;
    if (!o.player) { main.innerHTML = '<p class="ad-muted">No registered player with that username.</p><button class="ad-btn" id="pBack">Back to players</button>'; document.getElementById('pBack').onclick = () => { state.gen += 1; players().catch(fail); }; return; }
    const p = o.player; const t = o.totals;
    const draw = (zone) => {
    o.zone = zone;
    const tile = (n, l) => `<div class="ad-card"><b>${esc(n)}</b><small>${esc(l)}</small></div>`;
    const zoneButtons = ZONES.map(([z, n]) => `<button class="ad-btn ${z === o.zone ? 'primary' : ''}" data-zone="${z}" aria-pressed="${z === o.zone}">${n}</button>`).join('');
    const perGame = o.perGame.map((g) => `<tr><td data-l="Game">${esc(g.gameId)}</td><td data-l="Games">${g.games}</td><td data-l="Wins">${g.wins}</td><td data-l="Win rate">${pctText(g.wins, g.rated - g.draws)}</td><td data-l="Drawn">${g.draws}</td><td data-l="Left early">${g.leftEarly}</td><td data-l="Played">${mins(g.minutes)}</td></tr>`).join('');
    const recent = o.recent.map((r) => `<tr><td data-l="When">${esc(when(r.at))}</td><td data-l="Game">${esc(r.gameId)}</td><td data-l="Seats">${r.seats}</td><td data-l="Result">${r.leftEarly ? 'left early' : r.unknown ? 'result not recorded' : r.draw ? 'draw' : r.won ? 'won' : 'lost'}</td><td data-l="Length">${mins(r.minutes)}</td></tr>`).join('');
    main.innerHTML = `<div class="ad-row"><button class="ad-btn" id="pBack">Back to players</button></div>
      <h2>${esc(p.displayName)} <small class="ad-muted">@${esc(p.username)}</small></h2>
      <p class="ad-muted">${p.country ? esc(countryName(p.country)) + ' · ' : ''}Role: ${esc(p.role)} · ${p.verified ? 'verified' : 'not verified'} · Joined ${esc(when(p.joinedAt))} · Last seen ${esc(when(p.lastSeenAt))}${p.suspended ? ' · <b>suspended</b>' : ''}</p>
      <div class="ad-grid">${tile(t.games, 'games played')}${tile(t.wins, 'wins')}${tile(pctText(t.wins, t.rated - t.draws), 'win rate (draws left out)')}${tile(t.draws, 'draws')}${tile(pctText(t.leftEarly, t.games), 'games left early')}${tile(mins(t.minutes), 'time played')}${tile(t.activeDays, 'days played')}</div>
      <p class="ad-muted">First game ${esc(when(t.firstGameAt))} · latest game ${esc(when(t.lastGameAt))}</p>
      <h3>When this player plays</h3><div class="ad-row" role="group" aria-label="Time zone" style="margin-bottom:8px">${zoneButtons}</div>${hourColumns(o.hourly, o.zone)}
      <h3>By game</h3>${o.perGame.length ? `<table class="ad-t stack"><thead><tr><th>Game</th><th>Games</th><th>Wins</th><th>Win rate</th><th>Drawn</th><th>Left early</th><th>Played</th></tr></thead><tbody>${perGame}</tbody></table>` : '<p class="ad-muted">No finished games yet.</p>'}
      <h3>Latest games</h3>${o.recent.length ? `<table class="ad-t stack"><thead><tr><th>When</th><th>Game</th><th>Seats</th><th>Result</th><th>Length</th></tr></thead><tbody>${recent}</tbody></table>` : '<p class="ad-muted">No finished games yet.</p>'}
      <p class="ad-muted">Opening this profile was recorded in the audit log. No e-mail address, network address or chat message is shown.</p>`;
    document.getElementById('pBack').onclick = () => { state.gen += 1; const mine = state.gen; players().catch((e) => { if (mine === state.gen) fail(e); }); };
    main.querySelectorAll('[data-zone]').forEach((b) => { b.onclick = () => draw(b.dataset.zone); });
    };
    draw(tz);
  }

  // ---------------------------------------------------------------- logs
  /** Recent lines of this process: already redacted by lib/log.js, never shown raw beyond what the server kept. */
  async function logs(filters = {}) {
    const gen = state.gen;
    const f = { level: filters.level || '', component: filters.component || '', event: filters.event || '' };
    const o = await api(`/api/admin/logs?${new URLSearchParams({ ...f, limit: '100' }).toString()}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const newestFirst = (o.items || []).slice().sort((x, y) => (Date.parse(y.time) || 0) - (Date.parse(x.time) || 0));
    const rows = newestFirst.map((e) => {
      const { time, level, component, event, ...rest } = e;
      const details = JSON.stringify(rest).slice(0, 300);
      return `<tr><td data-l="Time">${esc(when(time))}</td><td data-l="Level"><span class="ad-pill ${level === 'error' ? 'danger' : level === 'warn' ? 'warn' : ''}">${esc(level)}</span></td><td data-l="Component">${esc(component)}</td><td data-l="Event">${esc(event)}</td><td data-l="Details"><code>${esc(details === '{}' ? '' : details)}</code></td></tr>`;
    }).join('');
    main.innerHTML = `<h2>Logs <small class="ad-muted">${o.items.length} shown, ${o.held} held</small></h2>
      <form class="ad-search ad-row" id="lFilter">
        <select name="level" aria-label="Level"><option value="">Any level</option>${['info', 'warn', 'error'].map((v) => `<option value="${v}" ${f.level === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input name="component" value="${esc(f.component)}" placeholder="Component, e.g. db" maxlength="60" aria-label="Component">
        <input name="event" value="${esc(f.event)}" placeholder="Event contains, e.g. pool" maxlength="60" aria-label="Event" style="flex:1">
        <button class="ad-btn primary">Filter</button>
      </form>
      <p class="ad-muted">Recent lines of this server since its last restart, secrets masked. Buffer capacity ${esc(o.capacity)}; ${esc(o.dropped)} older lines dropped. Render's log view keeps the full history.</p>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>Time</th><th>Level</th><th>Component</th><th>Event</th><th>Details</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="ad-muted">No lines match.</td></tr>'}</tbody></table></div>`;
    document.getElementById('lFilter').onsubmit = (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      state.gen += 1; // a newer filter makes every older answer out of date, including its error
      const mine = state.gen;
      // through the Logs view, so the Render history panel is drawn again with it (logs() replaces the whole tab)
      views.logs({ level: d.get('level'), component: d.get('component'), event: d.get('event') }).catch((err) => { if (mine === state.gen) fail(err); });
    };
  }

  // ---------------------------------------------------------------- users
  async function users(q = '', page = 1) {
    const gen = state.gen;
    const o = await api(`/api/admin/users?q=${encodeURIComponent(q)}&page=${page}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const owner = state.me.isOwner;
    const rows = o.users.map((u) => {
      const staff = u.role !== 'user';
      const acts = [];
      if (owner && (u.role === 'user' || u.role === 'admin')) acts.push(`<button class="ad-btn" data-so="${esc(u.id)}">Sign out</button>`); // owner only (Stage 20.8)
      if (owner && u.role === 'user' && !u.is_anonymous) acts.push(u.suspended_at
        ? `<button class="ad-btn" data-unsusp="${esc(u.id)}">Lift suspension</button>`
        : `<button class="ad-btn danger" data-susp="${esc(u.id)}">Suspend</button>`);
      if (!u.verified && !u.is_anonymous && (u.role === 'user' || (u.role === 'admin' && owner))) acts.push(`<button class="ad-btn" data-rv="${esc(u.id)}">Resend verification</button>`);
      if (owner && u.role === 'user' && !u.is_anonymous) acts.push(`<button class="ad-btn" data-role="admin" data-id="${esc(u.id)}">Make admin</button>`);
      if (owner && u.role === 'admin') acts.push(`<button class="ad-btn danger" data-role="user" data-id="${esc(u.id)}">Remove admin</button>`);
      return `<tr><td data-l="Player"><b>${esc(u.display_name)}</b><br><small class="ad-muted">${u.username ? '@' + esc(u.username) : 'guest'}${u.country ? ' · ' + esc(countryName(u.country)) : ''}</small></td><td data-l="Role"><span class="ad-pill ${esc(u.role)}">${esc(u.role)}</span>${u.suspended_at ? ' <span class="ad-pill danger">suspended</span>' : ''}</td><td data-l="Verified">${u.verified ? 'yes' : 'no'}</td><td data-l="Joined">${esc(when(u.created_at))}</td><td data-l="Last seen">${esc(when(u.last_seen_at))}</td><td data-l="">${staff && !owner ? '' : `<div class="ad-row">${acts.join('')}</div>`}</td></tr>`;
    }).join('');
    const pages = Math.max(1, Math.ceil(o.total / o.pageSize));
    main.innerHTML = `<h2>Users <small class="ad-muted">${o.total}</small></h2>
      <form class="ad-search ad-row" id="uSearch"><input name="q" value="${esc(q)}" placeholder="Search name or username" maxlength="40" aria-label="Search users" style="flex:1"><button class="ad-btn primary">Search</button></form>
      <form class="ad-search ad-row" id="lookupForm"><input name="username" placeholder="Exact username for lookup" maxlength="24" aria-label="Look up a username" style="flex:1"><button class="ad-btn">Look up</button></form>
      <div id="lookupOut" aria-live="polite"></div>
      <p id="uMsg" class="ad-msg" role="status"></p>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>Player</th><th>Role</th><th>Verified</th><th>Joined</th><th>Last seen</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="ad-muted">No players found.</td></tr>'}</tbody></table></div>
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="uPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${page} of ${pages}</span><button class="ad-btn" id="uNext" ${page >= pages ? 'disabled' : ''}>Next</button></div>
      <p class="ad-muted">E-mail addresses are never shown here. ${owner ? 'As the owner you manage admin roles; the owner role itself cannot be changed.' : 'Only the owner can manage admin roles.'}</p>`;
    document.getElementById('uSearch').onsubmit = (e) => { e.preventDefault(); users(new FormData(e.target).get('q'), 1).catch(fail); };
    document.getElementById('uPrev').onclick = () => users(q, page - 1).catch(fail);
    document.getElementById('lookupForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = String(new FormData(e.target).get('username') || '').trim().toLowerCase();
      const out = document.getElementById('lookupOut');
      if (!name) return;
      const seq = ++lookupSeq;
      try {
        const r = await api('/api/admin/users/lookup?username=' + encodeURIComponent(name));
        if (seq !== lookupSeq) return; // a later lookup has been asked for: this answer is out of date
        if (!r.user) { out.innerHTML = '<p class="ad-muted">No account with that username.</p>'; return; }
        const x = r.user;
        out.innerHTML = `<div class="ad-card"><b>${esc(x.display_name)}</b> <small class="ad-muted">@${esc(x.username)}</small>
          <p>Country: ${x.country ? esc(countryName(x.country)) : 'not set'} · Role: ${esc(x.role)} · Verified: ${x.verified ? 'yes' : 'no'} · Joined ${esc(when(x.created_at))} · Last seen ${esc(when(x.last_seen_at))}</p>
          <p>Active sessions: ${x.active_sessions}${x.suspended_at ? ` · <b>Suspended</b> since ${esc(when(x.suspended_at))}${x.suspended_reason ? ': ' + esc(x.suspended_reason) : ''}` : ''}</p></div>`;
      } catch (err) { if (seq === lookupSeq) out.innerHTML = `<p class="ad-msg err">${esc(err.message)}</p>`; }
    };
    let lookupSeq = 0;
    document.getElementById('uNext').onclick = () => users(q, page + 1).catch(fail);
    main.querySelectorAll('[data-rv]').forEach((b) => { b.onclick = async () => { if (!confirm('Send this player a new verification e-mail?')) return; try { await api('/api/admin/users/resend-verification', { playerId: b.dataset.rv }); say('uMsg', 'Verification e-mail sent.', 'ok'); } catch (e) { say('uMsg', e.message, 'err'); } }; });
    main.querySelectorAll('[data-susp]').forEach((b) => { b.onclick = async () => {
      const reason = prompt('Reason for the suspension (kept in the audit log; staff with lookup access can also see it):', '');
      if (reason === null) return;
      if (!confirm('Suspend this account? Its sessions end now and it cannot sign in until the suspension is lifted.')) return;
      try { await api('/api/admin/users/suspend', { playerId: b.dataset.susp, reason }); await users(q, page); say('uMsg', 'Account suspended.', 'ok'); } catch (e) { say('uMsg', e.message, 'err'); }
    }; });
    main.querySelectorAll('[data-unsusp]').forEach((b) => { b.onclick = async () => {
      if (!confirm('Lift the suspension? The player can sign in again (old sessions stay ended).')) return;
      try { await api('/api/admin/users/unsuspend', { playerId: b.dataset.unsusp }); await users(q, page); say('uMsg', 'Suspension lifted.', 'ok'); } catch (e) { say('uMsg', e.message, 'err'); }
    }; });
    main.querySelectorAll('[data-so]').forEach((b) => { b.onclick = async () => { if (!confirm('Sign this player out of every device?')) return; try { const r = await api('/api/admin/users/sign-out', { playerId: b.dataset.so }); say('uMsg', `Signed out (${r.revoked} session${r.revoked === 1 ? '' : 's'}).`, 'ok'); } catch (e) { say('uMsg', e.message, 'err'); } }; });
    main.querySelectorAll('[data-role]').forEach((b) => { b.onclick = async () => { if (!confirm(b.dataset.role === 'admin' ? 'Give this player admin access?' : 'Remove admin access from this player?')) return; try { await api('/api/admin/roles', { playerId: b.dataset.id, role: b.dataset.role }); await users(q, page); say('uMsg', 'Role updated.', 'ok'); } catch (e) { say('uMsg', e.message, 'err'); } }; });
  }

  // ---------------------------------------------------------------- feedback
  async function feedback(status = '', page = 1) {
    const gen = state.gen;
    const o = await api(`/api/admin/feedback?status=${encodeURIComponent(status)}&page=${page}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const items = o.items.map((f) => `<div class="ad-card"><div class="ad-row"><span class="ad-pill">${esc(f.category)}</span><span class="ad-pill ${f.status === 'new' ? 'warn' : ''}">${esc(f.status)}</span><small class="ad-muted">${esc(when(f.created_at))} · ${f.username ? '@' + esc(f.username) : 'guest'}</small></div><p style="white-space:pre-wrap;margin:8px 0">${esc(f.message)}</p><div class="ad-row">${['new', 'read', 'resolved'].filter((s) => s !== f.status).map((s) => `<button class="ad-btn" data-fid="${esc(f.id)}" data-st="${s}">Mark ${s}</button>`).join('')}</div></div>`).join('');
    main.innerHTML = `<h2>Feedback <small class="ad-muted">${o.total}</small></h2>
      <div class="ad-row" style="margin-bottom:12px">${['', 'new', 'read', 'resolved'].map((s) => `<button class="ad-btn ${s === status ? 'primary' : ''}" data-f="${s}">${s || 'All'}</button>`).join('')}</div>
      <p id="fMsg" class="ad-msg" role="status"></p><div class="ad-list">${items || '<p class="ad-muted">Nothing here.</p>'}</div>
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="fPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${page}</span><button class="ad-btn" id="fNext" ${page * o.pageSize >= o.total ? 'disabled' : ''}>Next</button></div>`;
    main.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => feedback(b.dataset.f, 1).catch(fail); });
    document.getElementById('fPrev').onclick = () => feedback(status, page - 1).catch(fail);
    document.getElementById('fNext').onclick = () => feedback(status, page + 1).catch(fail);
    main.querySelectorAll('[data-fid]').forEach((b) => { b.onclick = async () => { try { await api('/api/admin/feedback/status', { id: b.dataset.fid, status: b.dataset.st }); await feedback(status, page); } catch (e) { say('fMsg', e.message, 'err'); } }; });
  }

  // ---------------------------------------------------------------- chat reports (read-only queue)
  const SEV_LABEL = { high: 'high', medium: 'medium', low: 'low' };
  async function reports(page = 1) {
    const gen = state.gen;
    const o = await api(`/api/admin/reports?page=${page}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const items = o.items.map((r) => `<div class="ad-card"><div class="ad-row"><span class="ad-pill ${r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : ''}">${esc(SEV_LABEL[r.severity] || r.severity)}</span><span class="ad-pill">${esc(r.reason)}</span>${r.reportedSuspended ? '<span class="ad-pill danger">suspended</span>' : ''}<small class="ad-muted">${esc(when(r.createdAt))} · room ${esc(r.room)}</small></div>
      <p><b>${esc(r.reported)}</b> reported by <b>${esc(r.reporter || 'an account no longer on record')}</b> · ${r.reportedTotal == null ? 'report counts unavailable: the reported account was deleted' : `reported ${r.reportedTotal} time${r.reportedTotal === 1 ? '' : 's'} in all, ${r.reportedRecent} in the last ${o.recentDays} days`}</p>
      <blockquote class="ad-muted" style="margin:6px 0">${esc(r.message)}</blockquote>${r.details ? `<p class="ad-muted">Note from the reporter: ${esc(r.details)}</p>` : ''}</div>`).join('');
    main.innerHTML = `<h2>Chat reports <small class="ad-muted">${o.total} in total</small></h2>
      <p class="ad-muted">Read-only. Reports are listed newest first; the severity is set by the reason given. Opening this list is recorded in the audit log. Resolving reports comes later.</p>
      <div class="ad-list">${items || '<p class="ad-muted">No chat reports.</p>'}</div>
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="rPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${page}</span><button class="ad-btn" id="rNext" ${page * o.pageSize >= o.total ? 'disabled' : ''}>Next</button></div>`;
    // each click takes a new generation, so an older page request that finishes late cannot overwrite the page on screen
    const go = (p) => { state.gen += 1; const mine = state.gen; reports(p).catch((e) => { if (mine === state.gen) fail(e); }); };
    document.getElementById('rPrev').onclick = () => go(page - 1);
    document.getElementById('rNext').onclick = () => go(page + 1);
  }

  // ---------------------------------------------------------------- announcements
  const localInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  async function announcements() {
    const gen = state.gen;
    const o = await api('/api/admin/announcements');
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const rows = o.items.map((a) => `<tr><td data-l="Message">${esc(a.message)}</td><td data-l="Status"><span class="ad-pill ${esc(a.status)}">${esc(a.status)}</span></td><td data-l="Who">${esc(a.audience.replace('_', ' '))}</td><td data-l="Starts">${esc(when(a.starts_at))}</td><td data-l="Ends">${esc(when(a.ended_at && new Date(a.ended_at) < new Date(a.ends_at) ? a.ended_at : a.ends_at))}</td><td data-l="">${a.status === 'live' || a.status === 'scheduled' ? `<button class="ad-btn danger" data-end="${esc(a.id)}">End now</button>` : ''}</td></tr>`).join('');
    main.innerHTML = `<h2>Announcements</h2>
      <form class="ad-form two" id="aForm">
        <label class="span2">Message <textarea name="message" rows="2" maxlength="${o.limits.maxMessage}" required></textarea></label>
        <label>Style <select name="level"><option value="info">Info</option><option value="warning">Warning</option><option value="success">Good news</option></select></label>
        <label>Who sees it <select name="audience"><option value="all">Everyone</option><option value="signed_in">Signed-in players</option><option value="guests">Guests (not signed in)</option><option value="admins">Admins only</option></select></label>
        <label>Runs for <select name="preset"><option value="24">1 day</option><option value="1">1 hour</option><option value="168">1 week</option><option value="custom">Custom dates…</option></select></label>
        <label>Starts <input type="datetime-local" name="startsAt"></label>
        <label>Ends <input type="datetime-local" name="endsAt"></label>
        <div class="span2"><small class="ad-muted">Preview</small><div class="ad-preview" id="aPrev"></div></div>
        <div class="span2 ad-row"><button class="ad-btn primary" id="aGo">Publish</button><small class="ad-muted">The start is now unless you choose custom dates. Times are in your time zone. Every banner expires (at most ${o.limits.maxDays} days).</small></div>
      </form>
      <p id="aMsg" class="ad-msg" role="status"></p>
      <h3>Recent and upcoming</h3>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>Message</th><th>Status</th><th>Who</th><th>Starts</th><th>Ends</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="ad-muted">No announcements yet.</td></tr>'}</tbody></table></div>
      <p class="ad-muted">Signed-in players dismiss a banner once for all their devices; guests dismiss it in their own browser. Changing the text shows it again to everyone.</p>`;
    const f = document.getElementById('aForm');
    const prev = () => { const d = new FormData(f); document.getElementById('aPrev').textContent = (d.get('message') || 'Your message appears here.'); };
    // The date fields are always selectable. Choosing a date picks "Custom dates" for the admin; the fields are required only then.
    const isCustom = () => f.preset.value === 'custom';
    const custom = () => {
      if (isCustom()) {
        if (!f.startsAt.value) f.startsAt.value = localInput(new Date());
        if (!f.endsAt.value) f.endsAt.value = localInput(new Date(new Date(f.startsAt.value).getTime() + 86400000));
      }
      f.startsAt.required = f.endsAt.required = isCustom();
    };
    // picking (or clearing) a date only chooses custom dates: it must not refill a field the admin just emptied
    const pickedDate = () => { f.preset.value = 'custom'; f.startsAt.required = f.endsAt.required = true; };
    f.preset.onchange = custom;
    f.startsAt.onchange = f.endsAt.onchange = pickedDate;
    f.message.oninput = prev; prev(); custom();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const go = document.getElementById('aGo'); go.disabled = true;
      try {
        const d = new FormData(f);
        const body = { message: d.get('message'), level: d.get('level'), audience: d.get('audience') };
        if (d.get('preset') === 'custom') {
          const starts = new Date(d.get('startsAt'));
          const ends = new Date(d.get('endsAt'));
          if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) throw new Error('Choose a valid start and end time.');
          body.startsAt = starts.toISOString();
          body.endsAt = ends.toISOString();
        } else body.durationHours = Number(d.get('preset'));
        await api('/api/admin/announcements', body);
        await announcements();
        say('aMsg', 'Published.', 'ok');
      } catch (err) { say('aMsg', err.message, 'err'); go.disabled = false; }
    };
    main.querySelectorAll('[data-end]').forEach((b) => { b.onclick = async () => { if (!confirm('End this announcement now?')) return; try { await api('/api/admin/announcements/end', { id: b.dataset.end }); await announcements(); } catch (e) { say('aMsg', e.message, 'err'); } }; });
  }

  // ---------------------------------------------------------------- health and audit
  async function health() {
    const gen = state.gen;
    const h = await api('/api/admin/health');
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const p = h.platform || {};
    const tile = (n, l, cls) => `<div class="ad-card"><b class="${cls || ''}">${esc(n)}</b><small>${esc(l)}</small></div>`;
    const up = p.uptimeSec != null ? `${Math.floor(p.uptimeSec / 3600)}h ${Math.floor((p.uptimeSec % 3600) / 60)}m` : '—';
    main.innerHTML = `<h2>Platform health</h2><div class="ad-grid">
      ${tile(h.db.ok ? 'OK' : 'DOWN', 'database', h.db.ok ? '' : 'ad-pill bad')}${tile(h.db.dbMs != null ? h.db.dbMs + ' ms' : '—', 'database round trip')}${tile(up, 'uptime')}${tile(p.sockets ?? '—', 'open connections')}${tile(p.players ?? '—', 'players on this server')}${tile(p.rooms ?? '—', 'tables')}${tile(p.memoryMb != null ? p.memoryMb + ' MB' : '—', 'memory')}${tile(h.db.feedback_new ?? '—', 'new feedback')}${tile(h.db.migrations ?? '—', 'migrations applied')}</div>
      <h3>Deployment and connections</h3><div class="ad-grid">${tile(p.deployedCommit || 'not set', 'deployed commit')}${tile(p.startedAt ? when(p.startedAt) : '—', 'process started')}${tile(p.socketCloses ? p.socketCloses.normal : '—', 'connections closed normally (since start)')}${tile(p.socketCloses ? p.socketCloses.other : '—', 'connections lost or dropped (since start)', p.socketCloses && p.socketCloses.other ? 'ad-pill warn' : '')}</div>
      <h3>Analytics</h3><div class="ad-grid">${tile(h.analytics.enabled ? 'on' : 'off', 'collection')}${tile(h.analytics.buffered ?? 0, 'counters waiting to be saved')}${tile(h.analytics.failures ?? 0, 'failed saves', h.analytics.failures ? 'ad-pill warn' : '')}${tile(h.analytics.dropped ?? 0, 'dropped counts')}</div>
      <p class="ad-muted">${esc(p.mode === 'postgres' ? 'Running on PostgreSQL.' : 'Running in memory mode.')} Node ${esc(p.node || '')}. ${p.shuttingDown ? 'The server is shutting down.' : ''} ${h.analytics.lastErrorCode ? 'Last analytics error code: ' + esc(h.analytics.lastErrorCode) : ''}</p>`;
  }
  async function audit(page = 1) {
    const gen = state.gen;
    const o = await api(`/api/admin/audit?page=${page}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const rows = o.items.map((a) => `<tr><td data-l="When">${esc(when(a.at))}</td><td data-l="Who">${a.actor ? '@' + esc(a.actor) : '<span class="ad-muted">(removed account)</span>'}</td><td data-l="Action"><code>${esc(a.action)}</code></td><td data-l="Target">${esc(a.target_type || '')} <small class="ad-muted">${esc((a.target_id || '').slice(0, 8))}</small></td><td data-l="Detail"><small class="ad-muted">${esc(a.detail && Object.keys(a.detail).length ? JSON.stringify(a.detail) : '')}</small></td></tr>`).join('');
    main.innerHTML = `<h2>Audit log <small class="ad-muted">${o.total}</small></h2>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="ad-muted">Nothing recorded yet.</td></tr>'}</tbody></table></div>
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="pPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${page}</span><button class="ad-btn" id="pNext" ${page * o.pageSize >= o.total ? 'disabled' : ''}>Next</button></div>
      <p class="ad-muted">The log can only be added to from this console; entries are removed automatically after one year.</p>`;
    document.getElementById('pPrev').onclick = () => audit(page - 1).catch(fail);
    document.getElementById('pNext').onclick = () => audit(page + 1).catch(fail);
  }

  // ---------------------------------------------------------------- e-mail (owner only; the server checks every call again)
  // The send is two steps: the owner checks the recipient count, then types that number. The server refuses the send if the list
  // changed in between, so the count the owner confirmed is the count that goes out.
  const AUDIENCE_LABELS = { all: 'Everyone with an address', verified: 'Verified accounts', unverified: 'Unverified accounts',
    admins: 'Admins and the owner', players: 'Ordinary players', inactive: 'Inactive for 30 days or more' };
  const KIND_LABELS = { account: 'Account e-mail (service notice; also reaches unverified accounts)', promo: 'Promotion or greeting (verified accounts that have not opted out; adds an unsubscribe link)' };
  const STATUS_LABELS = { queued: 'Queued', sending: 'Sending', sent: 'Sent' };
  async function emailTab() {
    main.innerHTML = `
      <section class="ad-card" aria-labelledby="mailHead">
        <h2 id="mailHead">Send e-mail</h2>
        <p class="ad-muted">Only the owner can send e-mail. Mail goes out in small batches after you queue it and cannot be recalled. The message text is not kept in the audit log.</p>
        <form id="mailForm" class="ad-form" novalidate>
          <label>Who receives it
            <select id="mAud">${Object.keys(AUDIENCE_LABELS).map((k) => `<option value="${k}">${esc(AUDIENCE_LABELS[k])}</option>`).join('')}</select>
          </label>
          <label>Kind of e-mail
            <select id="mCat">${Object.keys(KIND_LABELS).map((k) => `<option value="${k}">${esc(KIND_LABELS[k])}</option>`).join('')}</select>
          </label>
          <label>Subject <input id="mSub" maxlength="160" autocomplete="off"></label>
          <label>Message <textarea id="mBody" maxlength="5000" rows="8"></textarea></label>
          <div class="ad-row">
            <button type="button" id="mCheck" class="ad-btn">Check recipients</button>
            <span id="mCount" class="ad-muted" aria-live="polite"></span>
          </div>
          <label>Type the recipient count to confirm <input id="mConfirm" inputmode="numeric" autocomplete="off" disabled></label>
          <div class="ad-row"><button type="submit" id="mSend" class="ad-btn" disabled>Queue the send</button></div>
          <p id="mMsg" class="ad-msg" role="status"></p>
        </form>
      </section>
      <section class="ad-card" aria-labelledby="sentHead">
        <h2 id="sentHead">Sent</h2>
        <div id="mHistory"><p class="ad-muted">Loading…</p></div>
      </section>`;
    const f = { aud: document.getElementById('mAud'), cat: document.getElementById('mCat'), sub: document.getElementById('mSub'),
      body: document.getElementById('mBody'), check: document.getElementById('mCheck'), count: document.getElementById('mCount'),
      confirm: document.getElementById('mConfirm'), send: document.getElementById('mSend'), form: document.getElementById('mailForm') };
    let checked = null; // the count the owner just saw, for this audience and kind
    let checkSeq = 0; // a preview answer counts only if the selection has not changed since it was asked for
    let sending = false; // one submit at a time: the button's state alone is not a guard
    const reset = () => { checkSeq++; checked = null; f.count.textContent = ''; f.confirm.value = ''; f.confirm.disabled = true; f.send.disabled = true; };
    const ready = () => { f.send.disabled = sending || !(checked !== null && f.confirm.value.trim() === String(checked) && f.sub.value.trim() && f.body.value.trim()); };
    f.aud.onchange = reset; f.cat.onchange = reset;
    f.sub.oninput = ready; f.body.oninput = ready;
    f.confirm.oninput = ready;
    f.check.onclick = async () => {
      say('mMsg', '', '');
      const seq = ++checkSeq;
      try {
        const q = new URLSearchParams({ audience: f.aud.value, category: f.cat.value });
        const out = await api('/api/admin/broadcasts/preview?' + q.toString());
        if (seq !== checkSeq) return; // the audience or kind changed while this was pending: that count is not for the current selection
        checked = out.count;
        f.count.textContent = `${out.count} recipient${out.count === 1 ? '' : 's'} now`;
        f.confirm.disabled = out.count === 0;
        ready();
      } catch (e) { if (seq !== checkSeq) return; reset(); say('mMsg', e.message, 'err'); }
    };
    f.form.onsubmit = async (e) => {
      e.preventDefault();
      if (sending || f.send.disabled) return;
      sending = true; f.send.disabled = true;
      try {
        const out = await api('/api/admin/broadcasts', { audience: f.aud.value, category: f.cat.value, subject: f.sub.value, body: f.body.value, expectedCount: checked });
        say('mMsg', `Queued for ${out.recipientCount} recipient${out.recipientCount === 1 ? '' : 's'}. It is sent in batches; the history below shows progress.`, 'ok');
        f.sub.value = ''; f.body.value = ''; reset();
        await history(1);
      } catch (err) { say('mMsg', err.message, 'err'); }
      finally { sending = false; ready(); }
    };
    await history(1);
  }
  // history: pages of 25 (newest first), and a refresh while anything is still queued or sending
  let mailPage = 1;
  let mailTimer = null;
  async function history(page = mailPage) {
    const box = document.getElementById('mHistory');
    if (!box) return;
    clearTimeout(mailTimer);
    mailPage = page;
    const o = await api('/api/admin/broadcasts?page=' + page);
    const rows = o.items.map((b) => `<tr>
        <td data-l="When">${esc(when(b.created_at))}</td>
        <td data-l="Who">${esc(AUDIENCE_LABELS[b.audience] || b.audience)}</td>
        <td data-l="Kind">${b.category === 'promo' ? 'Promotion' : 'Account'}</td>
        <td data-l="Subject">${esc(b.subject)}</td>
        <td data-l="Status">${esc(STATUS_LABELS[b.status] || b.status)}</td>
        <td data-l="Recipients">${b.recipient_count}</td>
        <td data-l="Sent / failed">${b.sent_count} / ${b.failed_count}</td>
        <td data-l="By">${esc(b.created_by || '—')}</td></tr>`).join('');
    const last = Math.max(1, Math.ceil(o.total / o.pageSize));
    const nav = o.total > o.pageSize
      ? `<div class="ad-row"><button type="button" class="ad-btn" id="mNewer" ${page <= 1 ? 'disabled' : ''}>Newer</button><span class="ad-muted">Page ${page} of ${last}</span><button type="button" class="ad-btn" id="mOlder" ${page >= last ? 'disabled' : ''}>Older</button></div>`
      : '';
    box.innerHTML = (o.items.length
      ? `<div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>When</th><th>Who</th><th>Kind</th><th>Subject</th><th>Status</th><th>Recipients</th><th>Sent / failed</th><th>By</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="ad-muted">Nothing has been sent yet.</p>') + nav;
    box.querySelector('#mNewer')?.addEventListener('click', () => history(page - 1).catch(() => {}));
    box.querySelector('#mOlder')?.addEventListener('click', () => history(page + 1).catch(() => {}));
    // delivery runs in the background: keep the list current until every send has finished (the timer stops with the tab)
    if (o.items.some((b) => b.status !== 'sent')) mailTimer = setTimeout(() => history(mailPage).catch(() => {}), 15000);
  }

  // Render history (owner only, Stage 20.8): Render's own log of this service for the last 24 hours, read on the server.
  let renderSeq = 0; // each Render search has its own sequence: a slower, older search must not overwrite a newer one
  async function renderHistory(text = '') {
    const gen = state.gen;
    const seq = ++renderSeq;
    if (!document.getElementById('rHistWrap')) {
      main.insertAdjacentHTML('beforeend', `<section class="ad-card" id="rHistWrap" aria-labelledby="rHead" style="margin-top:16px">
        <h2 id="rHead">Render history <small class="ad-muted">last 24 hours</small></h2>
        <form class="ad-search ad-row" id="rForm"><input name="text" maxlength="100" placeholder="Contains, e.g. error" aria-label="Filter Render lines" style="flex:1"><button class="ad-btn">Load</button></form>
        <div id="rHist"><p class="ad-muted">Loading…</p></div></section>`);
      document.getElementById('rForm').onsubmit = (e) => { e.preventDefault(); renderHistory(new FormData(e.target).get('text') || '').catch(() => {}); };
    }
    const out = document.getElementById('rHist');
    try {
      const r = await api('/api/admin/render-logs?' + new URLSearchParams({ text, limit: '100' }).toString());
      if (gen !== state.gen || seq !== renderSeq) return;
      if (!r.configured) { out.innerHTML = '<p class="ad-muted">Render history is not set up on this server. Set RENDER_API_KEY, RENDER_SERVICE_ID and RENDER_OWNER_ID in the Render service\'s environment.</p>'; return; }
      if (r.error) { out.innerHTML = `<p class="ad-msg err">${esc(r.error)}</p>`; return; }
      const rows = r.items.map((e) => `<tr><td data-l="Time">${esc(when(e.time))}</td><td data-l="Level"><span class="ad-pill ${e.level === 'error' ? 'danger' : e.level === 'warn' ? 'warn' : ''}">${esc(e.level)}</span></td><td data-l="Source">${esc(e.source)}</td><td data-l="Line" style="word-break:break-word">${esc(e.text)}</td></tr>`).join('');
      out.innerHTML = rows
        ? `<div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Line</th></tr></thead><tbody>${rows}</tbody></table></div>${r.hasMore ? '<p class="ad-muted">More lines exist; narrow the filter to see them.</p>' : ''}`
        : '<p class="ad-muted">No lines in the last 24 hours for this filter.</p>';
    } catch (e) { if (e && e.name !== 'AbortError' && gen === state.gen && seq === renderSeq) out.innerHTML = `<p class="ad-msg err">${esc(e.message)}</p>`; }
  }

  const views = { overview: () => overview(), insights: () => insights(), players: () => players(), users: () => users(), feedback: () => feedback(), reports: () => reports(), announcements, health, logs: async (f) => { const g = state.gen; await logs(f); if (state.me.isOwner && g === state.gen) await renderHistory(); }, audit: () => audit(), email: () => emailTab() };
  function show(tab) {
    state.tab = tab;
    generation++; // answers still on their way for the previous tab are dropped when they arrive
    if (view) view.abort(); // and their requests are cancelled, where the browser supports it
    view = typeof AbortController === 'function' ? new AbortController() : null;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    state.gen++;
    const gen = state.gen;
    main.innerHTML = '<p class="ad-muted">Loading…</p>';
    views[tab]().catch((e) => { if (gen === state.gen) fail(e); });
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });

  (async () => {
    try {
      const me = await api('/api/admin/me');
      if (!me.isAdmin) { main.innerHTML = '<p class="ad-msg err">This page is for administrators. <a href="/">Back to Tableverse</a></p>'; return; }
      state.me = me;
      who.textContent = me.isOwner ? 'Signed in as owner' : 'Signed in as admin';
      const mailTab = tabs.querySelector('[data-tab="email"]');
      if (mailTab) mailTab.hidden = !me.isOwner; // hidden for admins; the server refuses them anyway
      tabs.hidden = false;
      show('overview');
    } catch (e) {
      main.innerHTML = e.status === 401
        ? '<p class="ad-msg err">Please log in to Tableverse first, then come back. <a href="/">Go to Tableverse</a></p>'
        : `<p class="ad-msg err">${esc(e.message)}</p>`;
    }
  })();
})();
