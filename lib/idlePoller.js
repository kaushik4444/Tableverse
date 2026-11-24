'use strict';
/**
 * A background read that only runs while somebody is connected.
 *
 * Neon's free compute autosuspends after 5 minutes without a query, and every running second counts against the monthly allowance.
 * A plain setInterval that reads the database keeps the compute awake for as long as this process is up, even when nobody is using
 * the site (and an open browser tab is enough to keep the process up). This wrapper makes such a read follow use instead:
 *
 *  - the timer fires every `everyMs`, but the read only happens when `active()` is true (somebody is using the site);
 *  - `touch()`, called when somebody connects, reads at once when the last read is older than `staleMs`, so the first person to arrive
 *    after a quiet spell sees current data;
 *  - reads never overlap, and a failed read does not stop the timer (the caller's `run` reports its own errors).
 *
 * Changes made through this process do not wait for any of this: they update the in-memory snapshot directly (lib/gameFlags.js,
 * lib/guestFeatures.js). The periodic read is only a backstop for edits made outside this process.
 */
function createIdlePoller({ run, everyMs, staleMs, active, now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
  let timer = null;
  let lastAt = 0; // when the last read started
  let inflight = null;

  function read() {
    if (inflight) return inflight;
    lastAt = now();
    inflight = Promise.resolve().then(run).catch(() => {}).finally(() => { inflight = null; });
    return inflight;
  }

  return {
    /** Starts the timer. `markFresh()` first when the caller has just read, so the first connection does not read again. */
    start() {
      if (timer) return;
      timer = setTimer(() => { if (active()) void read(); }, everyMs);
      if (timer && timer.unref) timer.unref();
    },
    stop() { if (timer) { clearTimer(timer); timer = null; } },
    /** Somebody connected: read now if the snapshot has gone stale. */
    touch() { if (now() - lastAt >= staleMs) return read(); return inflight || Promise.resolve(); },
    markFresh() { lastAt = now(); },
    lastReadAt: () => lastAt,
  };
}

/**
 * Retries a failed attempt after each delay in `delaysMs`, then stops: at most delaysMs.length retries, so a database that stays
 * down costs a handful of queries, not a loop. `attempt` returns true when it worked (a throw or false counts as a failure). A success
 * resets the sequence. `run()` may be called by others too: it never adds a second pending retry, and a success cancels a pending one.
 */
function retryWithBackoff(attempt, delaysMs, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let next = 0;
  let timer = null;
  const clear = () => { if (timer) { clearTimer(timer); timer = null; } };
  async function run() {
    let ok = false;
    try { ok = (await attempt()) === true; } catch { ok = false; }
    if (ok) { clear(); next = 0; return true; }
    // a retry that is already scheduled stays scheduled (an outside call must not cancel it); a new one needs budget left
    if (!timer && next < delaysMs.length) {
      timer = setTimer(() => { timer = null; void run(); }, delaysMs[next++]);
      if (timer && timer.unref) timer.unref();
    }
    return false;
  }
  return { run, stop: clear };
}

module.exports = { createIdlePoller, retryWithBackoff };
