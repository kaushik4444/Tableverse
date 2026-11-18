/* Who may start, create or join a game, by the owner's switch for that game (set in the admin console, Games tab).
 * Shared by the server (lib/gameFlags.js enforces it) and the page (draws the locks). The server is the authority.
 *
 * Modes (the value stored per game):
 *   on      Enabled: everyone may play it (the default; a game with no switch is on)
 *   admins  Disabled for non-admins: only the owner and admins may play it. Registered players and guests are refused.
 *   guests  Disabled for guests only: registered players may play it; a guest is refused.
 *   owner   Disabled for all (not owner): only the owner may play it.
 * Roles: owner, admin, user (a registered player), guest (a visitor with a temporary account, see docs/GUEST_PLAY.md).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TvGameAccess = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const MODES = ['on', 'admins', 'guests', 'owner'];
  const ROLES = ['owner', 'admin', 'user', 'guest'];
  const WHO = {
    on: ['owner', 'admin', 'user', 'guest'],
    admins: ['owner', 'admin'],
    guests: ['owner', 'admin', 'user'],
    owner: ['owner'],
  };
  const LABELS = {
    on: 'Enabled for everyone',
    admins: 'Disabled for non-admins (owner and admins only)',
    guests: 'Disabled for guests only',
    owner: 'Disabled for all (owner only)',
  };

  /** True when a player with `role` may play a game in `mode`. An unknown mode or role is refused. */
  function allows(mode, role) {
    if (!Object.hasOwn(WHO, mode) || !ROLES.includes(role)) return false;
    return WHO[mode].includes(role);
  }

  /** The role of a session: a guest is a guest, otherwise the account's own role (owner, admin or user). */
  function roleOf({ isGuest = false, role = 'user' } = {}) {
    if (isGuest) return 'guest';
    return ROLES.includes(role) && role !== 'guest' ? role : 'user';
  }

  return { MODES, ROLES, LABELS, allows, roleOf };
});
