'use strict';
/**
 * Per-game switches: whether a game can be started (new tables, new games and rematches). Every registered game has a flag.
 * A game with no row in game_flags is enabled, so nothing changes until the owner switches a game off.
 *
 * Each game has an access mode (public/game-access.js): on (everyone), admins (owner and admins only), guests (guests are
 * refused), owner (owner only). The owner changes it in the admin console (Games tab). A game with no row is on.
 *
 * Switching a game off does not end games already in progress. The UI shows a game the viewer may not play greyed out
 * (it is still listed), and the server refuses to start it for that role.
 *
 * This module keeps a snapshot in memory:
 * - Nothing can start until the first complete read has been applied ("ready"). A process that cannot read the switches
 *   refuses to start games rather than guessing.
 * - Reads are applied in the order they were started, so a slow older read cannot overwrite a newer one.
 * - Listeners (onChange) are told when the snapshot changes, so connected players get the new list at once.
 */
const games = require('../games');
const access = require('../public/game-access');

const REFRESH_MS = 15000;
let explicit = new Map(); // gameId -> access mode ('on' | 'admins' | 'guests' | 'owner'), only for games with a row
let ready = false; // true after the first complete read (or when there is no database and nothing to read)
let issued = 0; // reads started
let applied = 0; // the newest read applied: older reads that finish late are dropped
const listeners = new Set();

function same(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function notify(changed) {
  if (!changed) return;
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error('[games] change listener failed: ' + e.message); }
  }
}

/** The access mode a game is set to ('on' when it has no row). Null for an unknown game or before the first read. */
function modeOf(gameId) {
  if (!ready) return null;
  if (typeof gameId !== 'string' || !games.get(gameId)) return null;
  return explicit.has(gameId) ? explicit.get(gameId) : 'on';
}

/**
 * True when the game can be started now. Without a role: true only when the game is open to everybody ('on'). With a role
 * ('owner' | 'admin' | 'user' | 'guest'): true when that role may play it. Unknown games are never enabled, and nothing is
 * enabled before the first read.
 */
function isEnabled(gameId, role) {
  const mode = modeOf(gameId);
  if (mode === null) return false;
  return role === undefined ? mode === 'on' : access.allows(mode, role);
}

/** The access mode from a stored row: the access column, or for a row written before it existed, enabled false = owner only. */
function modeFromRow(r) {
  if (access.MODES.includes(r.access)) return r.access;
  return r.enabled === false ? 'owner' : 'on';
}

function isReady() {
  return ready;
}

/** Marks the start of a read. Pass the returned token to apply, so reads are applied in the order they started. */
function begin() {
  return ++issued;
}

/**
 * Replaces the snapshot with rows read at `token` ({ game_id, enabled }). Unknown ids are ignored. Returns true when the
 * snapshot changed (listeners were told), false when the read was older than one already applied.
 */
function apply(rows, token = begin()) {
  if (token < applied) return false;
  applied = token;
  const next = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (games.get(r.game_id)) next.set(r.game_id, modeFromRow(r));
  }
  const wasReady = ready;
  const changed = !same(explicit, next) || !wasReady;
  explicit = next;
  ready = true;
  notify(changed);
  return changed;
}

/** Records a switch this process has just written (an access mode; a boolean is accepted too), so it applies at once. Reads started before it are dropped. */
function setOne(gameId, mode) {
  // Before the first complete read a single switch cannot describe the others, so it waits for that read (the re-read that
  // follows the write, or the next periodic one, supplies the full state).
  if (!games.get(gameId)) return false;
  applied = begin(); // reads started before this write are stale, whether or not the snapshot is ready yet
  if (!ready) return false;
  // A boolean is the older switch: true = on, false = owner only.
  const next_ = access.MODES.includes(mode) ? mode : (mode === true ? 'on' : 'owner');
  const changed = explicit.get(gameId) !== next_;
  const next = new Map(explicit);
  next.set(gameId, next_);
  explicit = next;
  notify(changed);
  return changed;
}

/** Calls fn after each change to the snapshot. Returns a function that removes the listener. */
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forgets the snapshot (used when the server stops, and by tests). */
function reset() {
  explicit = new Map();
  ready = false;
}

/**
 * The game list with `access` (the mode) and `enabled` (may this role play it now) on each entry. Without a role, `enabled`
 * is the same as "open to everybody". The page uses `access` to show why a game is locked for it.
 */
function withFlags(list, role) {
  return list.map((g) => ({ ...g, access: modeOf(g.id) || 'owner', enabled: isEnabled(g.id, role) }));
}

module.exports = { isEnabled, modeOf, isReady, begin, apply, setOne, onChange, reset, withFlags, REFRESH_MS };
