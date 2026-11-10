'use strict';
/* Admin console client (Stage 20.5). It only DISPLAYS and sends requests: the server decides who may do what on every call
   (session cookie + role read from the database + CSRF), so hiding a button here protects nothing and is not relied on. */
(() => {
  const main = document.getElementById('adMain');
  const tabs = document.getElementById('adTabs');
  const who = document.getElementById('adWho');
  const state = { me: null, tab: 'overview', csrf: '', gen: 0 }; // gen: which view is current; answers for an older view are dropped
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    const rows = nums.map((v, i) => `<tr><td>${esc(labels[i] || '')}</td><td>${v === null ? 'not kept' : v}</td></tr>`).join('');
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

  // ---------------------------------------------------------------- logs
  /** Recent lines of this process: already redacted by lib/log.js, never shown raw beyond what the server kept. */
  async function logs(filters = {}) {
    const gen = state.gen;
    const f = { level: filters.level || '', component: filters.component || '', event: filters.event || '' };
    const o = await api(`/api/admin/logs?${new URLSearchParams({ ...f, limit: '100' }).toString()}`);
    if (gen !== state.gen) return; // the admin has switched tabs since this was asked
    const rows = o.items.map((e) => {
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
      return `<tr><td data-l="Player"><b>${esc(u.display_name)}</b><br><small class="ad-muted">${u.username ? '@' + esc(u.username) : 'guest'}</small></td><td data-l="Role"><span class="ad-pill ${esc(u.role)}">${esc(u.role)}</span>${u.suspended_at ? ' <span class="ad-pill danger">suspended</span>' : ''}</td><td data-l="Verified">${u.verified ? 'yes' : 'no'}</td><td data-l="Joined">${esc(when(u.created_at))}</td><td data-l="Last seen">${esc(when(u.last_seen_at))}</td><td data-l="">${staff && !owner ? '' : `<div class="ad-row">${acts.join('')}</div>`}</td></tr>`;
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
          <p>Role: ${esc(x.role)} · Verified: ${x.verified ? 'yes' : 'no'} · Joined ${esc(when(x.created_at))} · Last seen ${esc(when(x.last_seen_at))}</p>
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

  const views = { overview: () => overview(), users: () => users(), feedback: () => feedback(), announcements, health, logs: async (f) => { await logs(f); if (state.me.isOwner) await renderHistory(); }, audit: () => audit() };
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
      tabs.hidden = false;
      show('overview');
    } catch (e) {
      main.innerHTML = e.status === 401
        ? '<p class="ad-msg err">Please log in to Tableverse first, then come back. <a href="/">Go to Tableverse</a></p>'
        : `<p class="ad-msg err">${esc(e.message)}</p>`;
    }
  })();
})();
