'use strict';
/**
 * What guests may do, switched by the owner in the admin console (Guests tab). Each feature is either open to guests
 * (enabled = true) or locked (the default). A locked feature is refused by the server with the code `guest_locked`, and the
 * page answers with the account reminder. Registered players and staff are never affected.
 *
 * Nothing here reads environment variables. A change made in the console is applied in this process at once, and the other
 * processes pick it up on their next read (lib/idlePoller.js: while somebody is connected, every 15 minutes).
 *
 * Fail closed: until the first complete read is applied, every feature is locked for guests.
 */

const FEATURES = [
  { key: 'private_tables', label: 'Create private tables', hint: 'Guests can only open and use public tables while this is locked.' },
  { key: 'rejoin', label: 'Rejoin a table they left', hint: 'A guest who leaves a table on purpose cannot get back in. A dropped connection still reconnects.' },
  { key: 'profiles', label: 'Open player profiles and stats', hint: 'Tapping a player shows their card, profile and win totals.' },
  { key: 'blocking', label: 'Block players', hint: "Hides a player's chat from the guest." },
  { key: 'reports', label: 'Report chat messages', hint: "Guests may report chat messages. Reporting a player always needs an account. Reports go to the owner's moderation queue." },
];
const KEYS = new Set(FEATURES.map((f) => f.key));

let open = new Set(); // features open to guests (only from a complete read)
let ready = false; // true after the first complete read
let issued = 0; // reads started
let applied = 0; // the newest read applied: an older read that finishes late is dropped
const listeners = new Set();

function same(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** Marks the start of a read. Pass the token to apply, so reads are applied in the order they started. */
function begin() {
  return ++issued;
}

/**
 * Replaces the snapshot with rows ({ feature, enabled }) read at `token`. Unknown features are ignored. Returns true when the
 * snapshot changed; listeners are told then.
 */
function apply(rows, token = begin()) {
  if (token < applied) return false;
  applied = token;
  const next = new Set();
  for (const r of Array.isArray(rows) ? rows : []) if (KEYS.has(r.feature) && r.enabled === true) next.add(r.feature);
  const changed = !ready || !same(open, next);
  open = next;
  ready = true;
  if (changed) for (const fn of listeners) { try { fn(); } catch (e) { console.error('[guest-features] listener failed: ' + e.message); } }
  return changed;
}

/** True when guests may use the feature. Unknown features and anything before the first read are locked. */
function allowed(feature) {
  return ready && KEYS.has(feature) && open.has(feature);
}

/** Sets one feature in this process at once (the admin route does this before its own re-read). */
function setOne(feature, enabled) {
  if (!KEYS.has(feature)) return false;
  applied = begin(); // reads that started before this change must not restore the old value (as gameFlags.setOne)
  const next = new Set(open);
  if (enabled) next.add(feature); else next.delete(feature);
  if (same(open, next) && ready) return false;
  open = next;
  ready = true;
  for (const fn of listeners) { try { fn(); } catch (e) { console.error('[guest-features] listener failed: ' + e.message); } }
  return true;
}

/** The list for the admin console: every feature with its current state. */
function list() {
  return FEATURES.map((f) => ({ ...f, enabled: allowed(f.key) }));
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forgets the snapshot (a server lifecycle starts from nothing: the first complete read decides again). */
function reset() {
  open = new Set();
  ready = false;
  applied = begin(); // reads that started before the reset are stale
}

module.exports = { FEATURES, begin, apply, allowed, setOne, list, onChange, reset, isReady: () => ready };
