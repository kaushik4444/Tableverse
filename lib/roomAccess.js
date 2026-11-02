'use strict';
/**
 * Who may be at a private table: the one place the rule lives. Pure apart from the two lookups it is given, so every
 * case of the table's life can be tested without a server or a database.
 *
 * POLICY
 *  1. Public tables: everyone.
 *  2. The current host: always (hosting is how access to the table is handed over).
 *  3. A seat in a game that is under way (or just finished and not yet restarted) stays with its player, even if the
 *     friendship that got them in has ended since. Taking a seat away mid-game would break the game for everyone.
 *     The seat is theirs only while they keep it: once they leave, the old invitation no longer counts.
 *  4. A previous host (the table was handed over to someone else): only while they are still friends with the CURRENT host.
 *     Otherwise a host who unfriended them could not keep them out of the table.
 *  5. Everybody else (lobby seats, spectators, anyone joining or reconnecting): an accepted, unexpired invitation from
 *     the current host or any earlier host, AND that inviter and the guest must still be friends. An invitation survives
 *     a legitimate host change; it does not survive the end of the friendship (removing a friend revokes it).
 *  6. Without a database (no friends exist), nobody but the host.
 *
 * ENFORCEMENT (server.js): the rule is applied on join, sit and reconnect, and re-applied to everybody at the table when a
 * friendship ends and when a finished game is restarted. Spectators are never kept by rule 3.
 */
const hostIds = (room) => [...new Set([room.hostId, ...(room.hosts || [])].filter(Boolean))];

/**
 * @param {object} o
 * @param {object} o.room  { visibility, status, hostId, hosts:Set|undefined, members:[{id,bot}], spectators:[{id}] }
 * @param {string} o.playerId
 * @param {boolean} [o.isAnonymous]
 * @param {boolean} o.hasDatabase
 * @param {(inviterIds:string[]) => Promise<boolean>} o.invitedBy   accepted + unexpired invitation from one of them, friendship intact
 * @param {(a:string, b:string) => Promise<boolean>} o.areFriends
 * @returns {Promise<{ allowed: boolean, rule: string }>}
 */
async function decideAccess({ room, playerId, isAnonymous = false, hasDatabase, invitedBy, areFriends }) {
  if (room.visibility === 'public') return { allowed: true, rule: 'public' };
  if (room.hostId === playerId) return { allowed: true, rule: 'host' };
  const seated = room.members.some((m) => m.id === playerId && !m.bot);
  if (seated && room.status !== 'lobby') return { allowed: true, rule: 'seat-in-game' };
  if (!hasDatabase || isAnonymous) return { allowed: false, rule: 'no-friends' };
  if ((room.hosts && room.hosts.has(playerId))) {
    return (await areFriends(playerId, room.hostId)) ? { allowed: true, rule: 'previous-host' } : { allowed: false, rule: 'previous-host-unfriended' };
  }
  return (await invitedBy(hostIds(room))) ? { allowed: true, rule: 'invitation' } : { allowed: false, rule: 'no-invitation' };
}

module.exports = { decideAccess, hostIds };
