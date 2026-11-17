'use strict';
/**
 * Per-game availability: whether a game can be started (new tables, new games and rematches). Every registered game has
 * a flag. A game with no row in game_flags is enabled, so nothing changes until the owner switches a game off.
 *
 * Switching a game off does not end games already in progress. The UI shows a disabled game greyed out and locked (it is
 * still listed), and the server refuses to start it. The owner changes flags in the admin console (Games tab); the
 * server keeps a short-lived snapshot here, refreshed every 15 seconds and right after a change, so no restart is needed.
 */
const games = require('../games');

const REFRESH_MS = 15000;
let explicit = new Map(); // gameId -> boolean, only for games with a row

/** True when the game exists and can be started now. An unknown game is never enabled. */
function isEnabled(gameId) {
  if (typeof gameId !== 'string' || !games.get(gameId)) return false;
  return explicit.has(gameId) ? explicit.get(gameId) : true;
}

/** Replaces the snapshot with rows from game_flags ({ game_id, enabled }). Unknown ids are ignored. */
function apply(rows) {
  const next = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (games.get(r.game_id)) next.set(r.game_id, Boolean(r.enabled));
  }
  explicit = next;
}

/** The game list with `enabled` on each entry, for the welcome message and the home page. */
function withFlags(list) {
  return list.map((g) => ({ ...g, enabled: isEnabled(g.id) }));
}

module.exports = { isEnabled, apply, withFlags, REFRESH_MS };
