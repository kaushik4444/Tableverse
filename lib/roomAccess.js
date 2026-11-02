'use strict';
/**
 * Who may be at a private table: the one place the rule lives. Pure apart from the lookup it is given, so every case of
 * the table's life can be tested without a server or a database. The written policy is docs/PRIVATE_TABLES.md.
 *
 *  1. Public tables: everyone.
 *  2. The creator and the current host: always (a host is never thrown out of the table they run).
 *  3. Anyone who was already here when a public table was made private (`room.admitted`): they were let in as public guests.
 *  4. Without a database (no friends exist) or for an anonymous player: nobody else.
 *  5. Everybody else: an ACCEPTED invitation from the creator, the current host or any earlier host, AND that friendship
 *     must still exist (the database checks both; removing a friend revokes the invitations between the two).
 *     `present` = already at the table: an expired invitation then still counts, because expiry only stops NEW entries.
 *
 * Being seated is never a pass by itself: join, sit, reconnect, rematch and "a friendship ended" all re-ask the database.
 * (server.js decides what to do with someone who fails: see revokeAccess there.)
 */
const inviterIds = (room) => [...new Set([room.creatorId, room.hostId, ...(room.hosts || [])].filter(Boolean))];

/**
 * @param {object} o
 * @param {object} o.room  { visibility, hostId, creatorId, hosts:Set, admitted:Set }
 * @param {string} o.playerId
 * @param {boolean} [o.isAnonymous]
 * @param {boolean} o.hasDatabase
 * @param {boolean} [o.present]  already at the table
 * @param {(inviterIds:string[], opts:{allowExpired:boolean}) => Promise<boolean>} o.invitedBy
 * @returns {Promise<{ allowed: boolean, rule: string }>}
 */
async function decideAccess({ room, playerId, isAnonymous = false, hasDatabase, present = false, invitedBy }) {
  if (room.visibility === 'public') return { allowed: true, rule: 'public' };
  if (room.hostId === playerId || room.creatorId === playerId) return { allowed: true, rule: 'host' };
  if (room.admitted && room.admitted.has(playerId)) return { allowed: true, rule: 'admitted' };
  if (!hasDatabase || isAnonymous) return { allowed: false, rule: 'no-friends' };
  return (await invitedBy(inviterIds(room), { allowExpired: present })) ? { allowed: true, rule: 'invitation' } : { allowed: false, rule: 'no-invitation' };
}

module.exports = { decideAccess, inviterIds };
