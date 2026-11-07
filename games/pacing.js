'use strict';
/**
 * Animation-aware pacing. A game that animates a token (walking square by square) tells the server how long that
 * animation takes, and the server will not let a bot (or an automatic play) act again until it has finished plus a short
 * reading pause. Times only ever extend; consecutive walks (a move, then a card that moves again) queue one after another.
 * Kept outside the game state, so it is never sent to a client or saved.
 */
const until = new WeakMap();

/** Reserve `ms` after whatever is already reserved (or after now). */
function hold(g, ms) {
  const base = Math.max(Date.now(), until.get(g) || 0);
  until.set(g, base + Math.max(0, ms));
}
/** Milliseconds still reserved. */
function remaining(g) { return Math.max(0, (until.get(g) || 0) - Date.now()); }

module.exports = { hold, remaining };
