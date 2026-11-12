'use strict';
// Counts how game sockets have closed since this process started, in three buckets:
//   normal:   a normal close (1000, 1001, and 1005 when no code is sent; the app's own replacements also arrive as 1005);
//   replaced: the app closed its own old socket on purpose (4000-4002: tab replaced, signed out, and so on);
//   lost:     anything else, such as a dropped connection, a timeout, or a server-side drop.
// Counts only; no player is named, so the Health tab can show the numbers without exposing anyone.
function createCloseCounter() {
  let normal = 0;
  let replaced = 0;
  let lost = 0;
  return {
    record(code) {
      if (code === 1000 || code === 1001 || code === 1005) normal += 1;
      else if (code >= 4000 && code <= 4002) replaced += 1;
      else lost += 1;
    },
    stats() { return { normal, replaced, lost }; },
  };
}

module.exports = { createCloseCounter };
