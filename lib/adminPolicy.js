'use strict';
/**
 * Who may do what in the admin console. Pure rules, no I/O: the stores call these inside their transactions with rows read
 * from the database, and the routes never take a role from the request.
 *
 *  - owner: exactly one account (the database allows one). Manages admin roles. Cannot be changed, demoted or removed here.
 *  - admin: sees the console, manages announcements and feedback, signs ordinary users out. Cannot touch other staff.
 *  - user: nothing.
 */
const ROLES = ['user', 'admin', 'owner'];
const ASSIGNABLE_ROLES = ['user', 'admin']; // "owner" can never be granted through the API
const isStaff = (role) => role === 'admin' || role === 'owner';

class PolicyError extends Error {
  constructor(message, status = 403) { super(message); this.name = 'PolicyError'; this.status = status; }
}

/** Throws PolicyError unless `actor` may give `target` the role `newRole`. Returns { noop } when nothing would change. */
function checkSetRole({ actor, target, newRole }) {
  if (!actor || actor.role !== 'owner') throw new PolicyError('Only the owner can manage admin roles.', 403);
  if (!ASSIGNABLE_ROLES.includes(newRole)) throw new PolicyError('The role must be "admin" or "user". Ownership cannot be granted here.', 400);
  if (!target) throw new PolicyError('No such account.', 404);
  if (target.id === actor.id) throw new PolicyError('You cannot change your own role.', 400);
  if (target.role === 'owner') throw new PolicyError('The owner role cannot be changed.', 403);
  return { noop: target.role === newRole };
}

/** Throws PolicyError unless `actor` may act on the account `target` (sign it out). Staff are protected from other admins. */
function checkManageUser({ actor, target }) {
  if (!actor || !isStaff(actor.role)) throw new PolicyError('Admin access is required.', 403);
  if (!target) throw new PolicyError('No such account.', 404);
  if (target.role === 'owner' && actor.role !== 'owner') throw new PolicyError('The owner account cannot be managed by an admin.', 403);
  if (target.role === 'admin' && actor.role !== 'owner') throw new PolicyError('Only the owner can manage another admin.', 403);
  return true;
}

/**
 * Should this authenticated account become the owner? Only when no owner exists and the operator's server-side configuration
 * names this very account: ADMIN_OWNER_ID (stable account id, preferred) or ADMIN_OWNER_EMAIL (a VERIFIED login e-mail).
 * Request data never takes part; the arguments come from the session and the database.
 */
function shouldClaimOwner({ env, hasOwner, playerId, verifiedEmail }) {
  if (hasOwner || !playerId) return false;
  const id = String((env && env.ADMIN_OWNER_ID) || '').trim().toLowerCase();
  if (id) return id === String(playerId).toLowerCase(); // an explicit id wins; the e-mail setting is then ignored
  const email = String((env && env.ADMIN_OWNER_EMAIL) || '').trim().toLowerCase();
  return Boolean(email && verifiedEmail && String(verifiedEmail).trim().toLowerCase() === email);
}

module.exports = { ROLES, ASSIGNABLE_ROLES, PolicyError, isStaff, checkSetRole, checkManageUser, shouldClaimOwner };
