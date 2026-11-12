'use strict';
// Counts how game sockets have closed since this process started, in three buckets:
//   closed:   the player left or the page closed (1000, 1001, and 1005 when the browser sends no code);
//   replaced: the app closed its own old socket on purpose (4000-4002: tab replaced, signed out, and so on);
//   lost:     anything else, such as a dropped connection, a timeout, or a server-side drop.
// Counts only; no player is named, so the Health tab can show the numbers without exposing anyone.
function createCloseCounter() {
  let closed = 0;
  let replaced = 0;
  let lost = 0;
  return {
    record(code) {
      if (code === 1000 || code === 1001 || code === 1005) closed += 1;
      else if (code >= 4000 && code <= 4002) replaced += 1;
      else lost += 1;
    },
    stats() { return { closed, replaced, lost }; },
  };
}

module.exports = { createCloseCounter };
