'use strict';
// Counts how game sockets have closed since this process started: a normal close (1000 or 1001, the player
// left or the page closed) or any other close (a lost connection, a timeout, a server-side drop). Counts only;
// no player is named, so the Health tab can show the numbers without exposing anyone.
function createCloseCounter() {
  let normal = 0;
  let other = 0;
  return {
    record(code) {
      if (code === 1000 || code === 1001) normal += 1;
      else other += 1;
    },
    stats() { return { normal, other }; },
  };
}

module.exports = { createCloseCounter };
