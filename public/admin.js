'use strict';
/* Admin console client (Stage 20.5). It only DISPLAYS and sends requests: the server decides who may do what on every call
   (session cookie + role read from the database + CSRF), so hiding a button here protects nothing and is not relied on. */
(() => {
  const main = document.getElementById('adMain');
  const tabs = document.getElementById('adTabs');
  const who = document.getElementById('adWho');
  const state = { me: null, tab: 'overview', csrf: '' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  async function csrf(force) {
    if (state.csrf && !force) return state.csrf;
    const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    state.csrf = ((await r.json()) || {}).csrfToken || '';
    return state.csrf;
  }
  async function api(path, body, retried) {
    const opts = { credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    const out = await r.json().catch(() => ({}));
    if (r.status === 403 && /CSRF/i.test(out.error || '') && !retried && body !== undefined) { await csrf(true); return api(path, body, true); }
    if (!r.ok || out.ok === false) { const e = new Error(out.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return out;
  }
  const say = (id, text, kind) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = 'ad-msg ' + (kind || ''); } };
  const fail = (e) => { main.innerHTML = `<p class="ad-msg err">${esc(e.message)}</p>`; };

  // ---------------------------------------------------------------- overview
  const bars = (rows, empty) => rows.length
    ? `<div class="ad-bars">${rows.map((r) => { const max = Math.max(...rows.map((x) => x.total), 1); return `<div class="ad-bar"><span>${esc(r.name)}</span><i style="width:${Math.max(2, Math.round((r.total / max) * 100))}%"></i><span>${r.total}</span></div>`; }).join('')}</div>`
    : `<p class="ad-muted">${esc(empty)}</p>`;
  const spark = (values, label) => { const max = Math.max(...values, 1); return `<div class="ad-spark" role="img" aria-label="${esc(label)}">${values.map((v) => `<i style="height:${Math.round((v / max) * 100)}%" title="${v}"></i>`).join('')}</div>`; };
  async function overview() {
    const o = await api('/api/admin/overview?days=30');
    const t = (m) => o.totals[m] || 0;
    const tile = (n, l) => `<div class="ad-card"><b>${esc(n)}</b><small>${esc(l)}</small></div>`;
    main.innerHTML = `<h2>Overview <small class="ad-muted">last ${o.days} days</small></h2>
      <div class="ad-grid">${tile(o.active.dau, 'active today')}${tile(o.active.wau, 'active, 7 days')}${tile(o.active.mau, 'active, 30 days')}${tile(o.accounts.registered, 'registered accounts')}${tile(o.accounts.registered_24h, 'new in 24 hours')}${tile(t('registration'), 'registrations')}${tile(t('session'), 'sessions')}${tile(t('game_finished'), 'games finished')}${tile(t('error'), 'errors')}</div>
      <h3>Sessions per day</h3>${spark(o.series.session || [], 'Sessions per day')}
      <h3>Games finished per day</h3>${spark(o.series.game_finished || [], 'Games finished per day')}
      <h3>Popular games</h3>${bars(o.popularGames, 'No finished games yet.')}
      <h3>Errors by kind</h3>${bars(o.errors, 'No errors recorded.')}
      <p class="ad-muted">Counters only: no addresses, names or messages are recorded. Active users are counted from a keyed hash, never an account id. Detail rows are kept ${o.retention ? esc(o.retention.activeDays) : '35'} days, daily totals ${o.retention ? esc(o.retention.dailyDays) : '400'} days.</p>`;
  }

  // ---------------------------------------------------------------- users
  async function users(q = '', page = 1) {
    const o = await api(`/api/admin/users?q=${encodeURIComponent(q)}&page=${page}`);
    const owner = state.me.isOwner;
    const rows = o.users.map((u) => {
      const staff = u.role !== 'user';
      const acts = [];
      if (u.role === 'user' || (u.role === 'admin' && owner)) acts.push(`<button class="ad-btn" data-so="${esc(u.id)}">Sign out</button>`);
      if (owner && u.role === 'user' && !u.is_anonymous) acts.push(`<button class="ad-btn" data-role="admin" data-id="${esc(u.id)}">Make admin</button>`);
      if (owner && u.role === 'admin') acts.push(`<button class="ad-btn danger" data-role="user" data-id="${esc(u.id)}">Remove admin</button>`);
      return `<tr><td data-l="Player"><b>${esc(u.display_name)}</b><br><small class="ad-muted">${u.username ? '@' + esc(u.username) : 'guest'}</small></td><td data-l="Role"><span class="ad-pill ${esc(u.role)}">${esc(u.role)}</span></td><td data-l="Verified">${u.verified ? 'yes' : 'no'}</td><td data-l="Joined">${esc(when(u.created_at))}</td><td data-l="Last seen">${esc(when(u.last_seen_at))}</td><td data-l="">${staff && !owner ? '' : `<div class="ad-row">${acts.join('')}</div>`}</td></tr>`;
    }).join('');
    const pages = Math.max(1, Math.ceil(o.total / o.pageSize));
    main.innerHTML = `<h2>Users <small class="ad-muted">${o.total}</small></h2>
      <form class="ad-search ad-row" id="uSearch"><input name="q" value="${esc(q)}" placeholder="Search name or username" maxlength="40" aria-label="Search users" style="flex:1"><button class="ad-btn primary">Search</button></form>
      <p id="uMsg" class="ad-msg" role="status"></p>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>Player</th><th>Role</th><th>Verified</th><th>Joined</th><th>Last seen</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="ad-muted">No players found.</td></tr>'}</tbody></table></div>
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="uPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${page} of ${pages}</span><button class="ad-btn" id="uNext" ${page >= pages ? 'disabled' : ''}>Next</button></div>
      <p class="ad-muted">E-mail addresses are never shown here. ${owner ? 'As the owner you manage admin roles; the owner role itself cannot be changed.' : 'Only the owner can manage admin roles.'}</p>`;
    document.getElementById('uSearch').onsubmit = (e) => { e.preventDefault(); users(new FormData(e.target).get('q'), 1).catch(fail); };
    document.getElementById('uPrev').onclick = () => users(q, page - 1).catch(fail);
    document.getElementById('uNext').onclick = () => users(q, page + 1).catch(fail);
    main.querySelectorAll('[data-so]').forEach((b) => { b.onclick = async () => { if (!confirm('Sign this player out of every device?')) return; try { const r = await api('/api/admin/users/sign-out', { playerId: b.dataset.so }); say('uMsg', `Signed out (${r.revoked} session${r.revoked === 1 ? '' : 's'}).`, 'ok'); } catch (e) { say('uMsg', e.message, 'err'); } }; });
    main.querySelectorAll('[data-role]').forEach((b) => { b.onclick = async () => { if (!confirm(b.dataset.role === 'admin' ? 'Give this player admin access?' : 'Remove admin access from this player?')) return; try { await api('/api/admin/roles', { playerId: b.dataset.id, role: b.dataset.role }); await users(q, page); say('uMsg', 'Role updated.', 'ok'); } catch (e) { say('uMsg', e.message, 'err'); } }; });
  }

  // ---------------------------------------------------------------- feedback
  async function feedback(status = '', page = 1) {
    const o = await api(`/api/admin/feedback?status=${encodeURIComponent(status)}&page=${page}`);
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

  // ---------------------------------------------------------------- announcements
  const localInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  async function announcements() {
    const o = await api('/api/admin/announcements');
    const rows = o.items.map((a) => `<tr><td data-l="Message">${esc(a.message)}</td><td data-l="Status"><span class="ad-pill ${esc(a.status)}">${esc(a.status)}</span></td><td data-l="Who">${esc(a.audience.replace('_', ' '))}</td><td data-l="Starts">${esc(when(a.starts_at))}</td><td data-l="Ends">${esc(when(a.ended_at && new Date(a.ended_at) < new Date(a.ends_at) ? a.ended_at : a.ends_at))}</td><td data-l="">${a.status === 'live' || a.status === 'scheduled' ? `<button class="ad-btn danger" data-end="${esc(a.id)}">End now</button>` : ''}</td></tr>`).join('');
    main.innerHTML = `<h2>Announcements</h2>
      <form class="ad-form two" id="aForm">
        <label class="span2">Message <textarea name="message" rows="2" maxlength="${o.limits.maxMessage}" required></textarea></label>
        <label>Style <select name="level"><option value="info">Info</option><option value="warning">Warning</option><option value="success">Good news</option></select></label>
        <label>Who sees it <select name="audience"><option value="all">Everyone</option><option value="signed_in">Signed-in players</option><option value="guests">Guests (not signed in)</option><option value="admins">Admins only</option></select></label>
        <label>Runs for <select name="preset"><option value="24">1 day</option><option value="1">1 hour</option><option value="168">1 week</option><option value="custom">Custom dates…</option></select></label>
        <label>Starts <input type="datetime-local" name="startsAt" disabled></label>
        <label>Ends <input type="datetime-local" name="endsAt" disabled></label>
        <div class="span2"><small class="ad-muted">Preview</small><div class="ad-preview" id="aPrev"></div></div>
        <div class="span2 ad-row"><button class="ad-btn primary" id="aGo">Publish</button><small class="ad-muted">The start is now unless you choose custom dates. Times are in your time zone. Every banner expires (at most ${o.limits.maxDays} days).</small></div>
      </form>
      <p id="aMsg" class="ad-msg" role="status"></p>
      <h3>Recent and upcoming</h3>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>Message</th><th>Status</th><th>Who</th><th>Starts</th><th>Ends</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="ad-muted">No announcements yet.</td></tr>'}</tbody></table></div>
      <p class="ad-muted">Signed-in players dismiss a banner once for all their devices; guests dismiss it in their own browser. Changing the text shows it again to everyone.</p>`;
    const f = document.getElementById('aForm');
    const prev = () => { const d = new FormData(f); document.getElementById('aPrev').textContent = (d.get('message') || 'Your message appears here.'); };
    const custom = () => { const c = f.preset.value === 'custom'; f.startsAt.disabled = f.endsAt.disabled = !c; if (c && !f.startsAt.value) { const n = new Date(); f.startsAt.value = localInput(n); f.endsAt.value = localInput(new Date(n.getTime() + 86400000)); } };
    f.preset.onchange = custom; f.message.oninput = prev; prev();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = new FormData(f);
      const body = { message: d.get('message'), level: d.get('level'), audience: d.get('audience') };
      if (d.get('preset') === 'custom') { body.startsAt = new Date(d.get('startsAt')).toISOString(); body.endsAt = new Date(d.get('endsAt')).toISOString(); } else body.durationHours = Number(d.get('preset'));
      const go = document.getElementById('aGo'); go.disabled = true;
      try { await api('/api/admin/announcements', body); await announcements(); say('aMsg', 'Published.', 'ok'); } catch (err) { say('aMsg', err.message, 'err'); go.disabled = false; }
    };
    main.querySelectorAll('[data-end]').forEach((b) => { b.onclick = async () => { if (!confirm('End this announcement now?')) return; try { await api('/api/admin/announcements/end', { id: b.dataset.end }); await announcements(); } catch (e) { say('aMsg', e.message, 'err'); } }; });
  }

  // ---------------------------------------------------------------- health and audit
  async function health() {
    const h = await api('/api/admin/health');
    const p = h.platform || {};
    const tile = (n, l, cls) => `<div class="ad-card"><b class="${cls || ''}">${esc(n)}</b><small>${esc(l)}</small></div>`;
    const up = p.uptimeSec != null ? `${Math.floor(p.uptimeSec / 3600)}h ${Math.floor((p.uptimeSec % 3600) / 60)}m` : '—';
    main.innerHTML = `<h2>Platform health</h2><div class="ad-grid">
      ${tile(h.db.ok ? 'OK' : 'DOWN', 'database', h.db.ok ? '' : 'ad-pill bad')}${tile(h.db.dbMs != null ? h.db.dbMs + ' ms' : '—', 'database round trip')}${tile(up, 'uptime')}${tile(p.sockets ?? '—', 'open connections')}${tile(p.players ?? '—', 'players on this server')}${tile(p.rooms ?? '—', 'tables')}${tile(p.memoryMb != null ? p.memoryMb + ' MB' : '—', 'memory')}${tile(h.db.feedback_new ?? '—', 'new feedback')}${tile(h.db.migrations ?? '—', 'migrations applied')}</div>
      <h3>Analytics</h3><div class="ad-grid">${tile(h.analytics.enabled ? 'on' : 'off', 'collection')}${tile(h.analytics.buffered ?? 0, 'counters waiting to be saved')}${tile(h.analytics.failures ?? 0, 'failed saves', h.analytics.failures ? 'ad-pill warn' : '')}${tile(h.analytics.dropped ?? 0, 'dropped counts')}</div>
      <p class="ad-muted">${esc(p.mode === 'postgres' ? 'Running on PostgreSQL.' : 'Running in memory mode.')} Node ${esc(p.node || '')}. ${p.shuttingDown ? 'The server is shutting down.' : ''} ${h.analytics.lastErrorCode ? 'Last analytics error code: ' + esc(h.analytics.lastErrorCode) : ''}</p>`;
  }
  async function audit(page = 1) {
    const o = await api(`/api/admin/audit?page=${page}`);
    const rows = o.items.map((a) => `<tr><td data-l="When">${esc(when(a.at))}</td><td data-l="Who">${a.actor ? '@' + esc(a.actor) : '<span class="ad-muted">(removed account)</span>'}</td><td data-l="Action"><code>${esc(a.action)}</code></td><td data-l="Target">${esc(a.target_type || '')} <small class="ad-muted">${esc((a.target_id || '').slice(0, 8))}</small></td><td data-l="Detail"><small class="ad-muted">${esc(a.detail && Object.keys(a.detail).length ? JSON.stringify(a.detail) : '')}</small></td></tr>`).join('');
    main.innerHTML = `<h2>Audit log <small class="ad-muted">${o.total}</small></h2>
      <div class="ad-scroll"><table class="ad-t stack"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="ad-muted">Nothing recorded yet.</td></tr>'}</tbody></table></div>
      <div class="ad-row" style="margin-top:12px"><button class="ad-btn" id="pPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ad-muted">Page ${page}</span><button class="ad-btn" id="pNext" ${page * o.pageSize >= o.total ? 'disabled' : ''}>Next</button></div>
      <p class="ad-muted">The log can only be added to from this console; entries are removed automatically after one year.</p>`;
    document.getElementById('pPrev').onclick = () => audit(page - 1).catch(fail);
    document.getElementById('pNext').onclick = () => audit(page + 1).catch(fail);
  }

  const views = { overview, users: () => users(), feedback: () => feedback(), announcements, health, audit: () => audit() };
  function show(tab) {
    state.tab = tab;
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    main.innerHTML = '<p class="ad-muted">Loading…</p>';
    views[tab]().catch(fail);
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });

  (async () => {
    try {
      const me = await api('/api/admin/me');
      if (!me.isAdmin) { main.innerHTML = '<p class="ad-msg err">This page is for administrators. <a href="/">Back to Tableverse</a></p>'; return; }
      state.me = me;
      who.textContent = me.isOwner ? 'Signed in as owner' : 'Signed in as admin';
      tabs.hidden = false;
      show('overview');
    } catch (e) {
      main.innerHTML = e.status === 401
        ? '<p class="ad-msg err">Please log in to Tableverse first, then come back. <a href="/">Go to Tableverse</a></p>'
        : `<p class="ad-msg err">${esc(e.message)}</p>`;
    }
  })();
})();
