/* Social and home-page markup: the friends panel and page, the compact friends card, the notification bell and the
 * coming-soon cards. Pure string builders; app.js owns state, rendering and events and passes what they need in. */
'use strict';
window.TVHomeUI = function TVHomeUI({ S, esc, gameMeta, pingBadge, pendingSocial }) {
  function socialHTML() {
    if (S.guest) return '';
    const friends = S.friends.map((f) => `<li class="social-row"><span class="social-avatar">${esc(f.avatar || '🧙')}</span><span class="social-info"><b class="friend-name" data-act="openProfile" data-username="${esc(f.username)}">${esc(f.display_name || f.username)}</b><small>@${esc(f.username)} · ${f.online ? (f.playing ? '🎮 Playing ' + esc((gameMeta(f.playing) || {}).name || f.playing) : '🟢 Online') + ' · ' + pingBadge(f.ping) : 'Last seen ' + (f.last_seen ? new Date(f.last_seen).toLocaleString() : 'unknown')}</small></span><button class="btn ghost small" data-act="removeFriend" data-id="${esc(f.id)}">Remove</button></li>`).join('');
    const friendNames = new Set(S.friends.map((friend) => friend.username));
    const requestNames = new Set([...S.friendRequests.incoming, ...S.friendRequests.outgoing].map((request) => request.username));
    const invitationNames = new Set(S.invitations.incoming.map((invitation) => invitation.username));
    const searchResults = S.friendSearch.filter((player) => !friendNames.has(player.username) && !requestNames.has(player.username) && !invitationNames.has(player.username));
    const resultHTML = searchResults.map((p) => `<li class="social-row"><span class="social-info"><b>${esc(p.display_name || p.username)}</b><small>@${esc(p.username)}</small></span><button class="btn small" data-act="sendFriend" data-username="${esc(p.username)}">Add friend</button></li>`).join('');
    const incoming = S.friendRequests.incoming.map((r) => `<li class="social-row"><span class="social-info"><b>${esc(r.display_name || r.username)}</b><small>@${esc(r.username)} sent a friend request</small></span><button class="btn small" data-act="acceptFriend" data-id="${esc(r.id)}">Accept</button><button class="btn ghost small" data-act="declineFriend" data-id="${esc(r.id)}">Decline</button></li>`).join('');
    const outgoing = S.friendRequests.outgoing.map((r) => `<li class="social-row"><span class="social-info"><b>${esc(r.display_name || r.username)}</b><small>Request pending</small></span><button class="btn ghost small" data-act="cancelFriend" data-id="${esc(r.id)}">Cancel</button></li>`).join('');
    const invites = S.invitations.incoming.map((i) => `<li class="social-row"><span class="social-info"><b>${esc(i.display_name || i.username)}</b><small>${esc(i.game_id)} table · ${esc(i.room_code)} · expires ${esc(new Date(i.expires_at).toLocaleString())}</small></span><button class="btn small" data-act="acceptInvitation" data-id="${esc(i.id)}">Accept</button><button class="btn ghost small" data-act="declineInvitation" data-id="${esc(i.id)}">Decline</button></li>`).join('');
    const sent = S.invitations.outgoing.map((i) => `<li class="social-row"><span class="social-info"><b>${esc(i.display_name || i.username)}</b><small>${esc(i.room_code)} · ${esc(i.status)}</small></span><button class="btn ghost small" data-act="revokeInvitation" data-id="${esc(i.id)}">Revoke</button></li>`).join('');
    return `<section class="home-section social-panel" id="friends-panel"><div class="row" style="justify-content:space-between"><h2 class="section">Friends</h2><button class="btn ghost small" data-act="refreshSocial">Refresh</button></div>
      ${S.socialError ? `<p class="social-error" role="alert">${esc(S.socialError)}</p>` : ''}${S.socialNotice ? `<p class="social-notice" role="status">${esc(S.socialNotice)}</p>` : ''}${S.socialLoading ? '<p class="hint">Loading friends…</p>' : ''}
      <form id="friendSearchForm" class="social-search"><label class="sr-only" for="friendSearch">Search by username</label><input id="friendSearch" minlength="1" maxlength="24" autocomplete="off" placeholder="Find someone by username" value="${esc(S.friendQuery)}"><button class="btn small" type="submit" ${S.friendSearchBusy ? 'disabled' : ''}>Search</button></form>
      ${resultHTML ? `<ul class="social-list">${resultHTML}</ul>` : (S.friendQuery && !S.friendSearchBusy ? '<p class="hint">No new players found.</p>' : '')}
      ${incoming || outgoing ? `<h3>Friend requests</h3><ul class="social-list">${incoming}${outgoing}</ul>` : ''}
      <h3>Your friends</h3>${friends ? `<ul class="social-list">${friends}</ul>` : '<p class="hint">No friends yet. Search for a username to add someone.</p>'}
      ${invites ? `<h3>Table invitations</h3><ul class="social-list">${invites}</ul>` : ''}${sent ? `<details><summary>Sent invitations</summary><ul class="social-list">${sent}</ul></details>` : ''}
    </section>`;
  }

  function inviteFriendsHTML() {
    if (!S.room || S.room.visibility !== 'private' || S.room.hostId !== S.id || S.guest) return '';
    const outgoing = S.invitations.outgoing || [];
    const alreadyInvited = new Set(outgoing.filter((i) => i.room_code === S.room.code && (i.status === 'pending' || i.status === 'accepted')).map((i) => i.username));
    const rows = S.friends.map((f) => {
      const invited = alreadyInvited.has(f.username);
      const status = invited ? 'Invited' : (f.online ? (f.playing ? 'Playing' : 'Online') : 'Offline');
      return `<option value="${esc(f.username)}" ${invited ? 'disabled' : ''}>${esc(f.display_name || f.username)} (@${esc(f.username)}) · ${status}</option>`;
    }).join('');
    return `<form id="tableInviteForm" class="social-search"><label for="tableInviteFriend">Invite a friend to this private table</label><select id="tableInviteFriend" required>${rows || '<option value="" disabled>No friends to invite</option>'}</select><button class="btn small" type="submit" ${rows ? '' : 'disabled'}>Send invitation</button></form>`;
  }


  /** Home: a small friends card (who is online). Requests and invitations are answered from the bell in the top bar. */
  function friendsStripHTML() {
    if (S.guest) return '';
    const online = S.friends.filter((f) => f.online);
    const pend = pendingSocial();
    const chips = online.slice(0, 6).map((f) => `<span class="fs-chip" data-act="openProfile" data-username="${esc(f.username)}" title="@${esc(f.username)}"><span class="social-avatar">${esc(f.avatar || '🧙')}</span>${esc(f.display_name || f.username)}</span>`).join('');
    const summary = S.friends.length
      ? (online.length ? `${online.length} of ${S.friends.length} friends online` : `${S.friends.length} friend${S.friends.length === 1 ? '' : 's'}, none online`)
      : 'Add friends to invite them to private tables.';
    return `<section class="home-section friends-strip" aria-label="Friends">
      <div class="fs-head"><div><h2 class="section">Friends</h2><p class="hint">${summary}${pend ? ` · <b>${pend} waiting in your bell</b>` : ''}</p></div><button type="button" class="btn ghost small" data-act="openFriendsPage">Manage</button></div>
      ${chips ? `<div class="fs-chips">${chips}</div>` : ''}
    </section>`;
  }

  function friendsPageHTML() {
    return `<main class="page profile-page friends-page"><a class="back-link" href="/" data-act="goHome">← Back to games</a>${socialHTML()}</main>`;
  }

  /** Notification bell: friend requests and table invitations waiting for an answer, answered in place. */
  function bellHTML() {
    const n = pendingSocial();
    const reqs = S.friendRequests.incoming.map((r) => `<li class="bell-row"><span class="social-info"><b>${esc(r.display_name || r.username)}</b><small>@${esc(r.username)} wants to be friends</small></span><span class="bell-btns"><button type="button" class="btn small" data-act="acceptFriend" data-id="${esc(r.id)}">Accept</button><button type="button" class="btn ghost small" data-act="declineFriend" data-id="${esc(r.id)}">Decline</button></span></li>`).join('');
    const invs = S.invitations.incoming.map((i) => `<li class="bell-row"><span class="social-info"><b>${esc(i.display_name || i.username)}</b><small>invited you to a ${esc((gameMeta(i.game_id) || {}).name || i.game_id)} table</small></span><span class="bell-btns"><button type="button" class="btn small" data-act="acceptInvitation" data-id="${esc(i.id)}">Accept</button><button type="button" class="btn ghost small" data-act="declineInvitation" data-id="${esc(i.id)}">Decline</button></span></li>`).join('');
    const panel = S.bellOpen ? `<div class="menu bell-panel" role="dialog" aria-label="Notifications"><h3 class="bell-title">Notifications</h3>${n ? `<ul class="bell-list">${reqs}${invs}</ul>` : '<p class="hint bell-empty">You are all caught up.</p>'}<button type="button" class="btn ghost small bell-manage" data-act="openFriendsPage">Manage friends</button></div>` : '';
    return `<div class="menu-wrap bell-wrap"><button type="button" class="tb-bell" data-act="toggleBell" aria-haspopup="dialog" aria-expanded="${!!S.bellOpen}" aria-label="Notifications${n ? `, ${n} waiting` : ''}"><span aria-hidden="true">🔔</span>${n ? `<span class="bell-count" aria-hidden="true">${n > 9 ? '9+' : n}</span>` : ''}</button>${panel}</div>`;
  }

  const COMING_SOON = [
    ['🏠', 'Property Rivals', 'Buy properties, trade smartly and build your empire.', 'Your build order'],
    ['⛏️', 'Hidden Miners', 'Work together to find gold — unless you are the saboteur.', 'Your build order'],
    ['🐂', 'Bullhead Run', 'Play numbered cards and avoid collecting bullheads.', 'Your build order'],
    ['🎨', 'Color Clash', 'Match colours and numbers, then play action cards wisely.', 'Your build order'],
    ['🚢', 'Sea Battle', 'Hide your fleet, call your shots and sink the opposing ships.', 'Your build order'],
    ['🌾', 'Resource Isles — 4 players', 'Gather resources, trade and build settlements and roads.', 'Your build order'],
    ['🌾', 'Resource Isles — 5–6 players', 'Bring the larger-group expansion to the island.', 'Your build order'],
    ['🟡', 'Four in a Row', 'Connect four pieces before your opponent does.', 'Additional games'],
    ['🕵️', 'Secret Clues', 'Give clever clues so your team finds the right words.', 'Additional games'],
    ['❎', 'Tic-Tac-Toe', 'Take turns placing Xs and Os to make a line of three.', 'Additional games'],
  ];
  function comingSoonCards(items, start) {
    return items.map(([ico, name, description], index) => `<article class="soon-card">
      <span class="soon-number" aria-label="Roadmap position ${start + index}">${start + index}</span>
      <span class="soon-ico" aria-hidden="true">${ico}</span>
      <div class="soon-copy"><b>${esc(name)}</b><small>${esc(description)}</small></div>
      <span class="soon-tag">Planned</span>
    </article>`).join('');
  }
  function comingSoonHTML() {
    const requested = COMING_SOON.filter((item) => item[3] === 'Your build order');
    const additional = COMING_SOON.filter((item) => item[3] === 'Additional games');
    return `<section class="home-section coming-roadmap" aria-label="Coming soon games">
      <div class="soon-heading">
        <div><h2 class="section">Coming soon</h2><p class="soon-intro">The next games planned for Tableverse, in development order.</p></div>
        <span class="soon-count">${COMING_SOON.length} planned</span>
      </div>
      <h3 class="soon-group-title">Development order</h3>
      <div class="soon-grid">${comingSoonCards(requested, 1)}</div>
      <h3 class="soon-group-title soon-more-title">Also on the list</h3>
      <div class="soon-grid">${comingSoonCards(additional, requested.length + 1)}</div>
      <p class="soon-footnote">Titles are working names. Game rules will be implemented with original artwork and presentation.</p>
    </section>`;
  }


  return { socialHTML, inviteFriendsHTML, friendsStripHTML, friendsPageHTML, bellHTML, comingSoonHTML };
};
