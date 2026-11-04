# Production readiness audit

Branch `production-readiness-overhaul`, audited against `main` at 4ae6777 (includes PRs #26 to #33). Every finding says whether it was **confirmed** (reproduced or read in the code), **theoretical**, or an **improvement**. Nothing here assumes paid infrastructure.

Status legend: Fixed (in this branch, with a test) · Open · Accepted (documented limitation).

## Findings

### F1 — One throwing bot/auto move crashed the whole server — High — Fixed
- **Where:** `server.js` `schedule()` timer callback; the process had no `unhandledRejection` / `uncaughtException` handlers.
- **Problem (confirmed):** the callback that plays a bot's, an absent player's or a timed-out player's move ran `g.botAction()`, `g.act()` and `afterChange()` with no `try/catch`. Any exception (a bug in one game's bot) is an uncaught exception in a timer: Node exits and every live table is lost. Reproduced by `tests/room-fault.test.js`: with the fix removed the process dies with the thrown error.
- **Impact:** one bad game state at one table ends everyone's game.
- **Fix:** the callback is guarded; after 3 consecutive failures only that table is closed and its players are told. Process-level handlers log unhandled rejections and, for an uncaught exception, drain pending match writes and exit so the host restarts the service.
- **Free:** yes. **Test:** `tests/room-fault.test.js`.

### F2 — A restart gave players no explanation — Medium — Fixed
- **Where:** `server.js` `close()` / SIGTERM path.
- **Problem (confirmed):** sockets were terminated with no message; `/readyz` kept answering ready; tables could still be created while stopping.
- **Fix:** while stopping, `/readyz` returns 503, new tables are refused, and every socket gets a notice ("tables are not kept across a restart") and a `1012` close. Unfinished games are never recorded as finished (verified by test).
- **Free:** yes. **Test:** `tests/shutdown.test.js`.

### F3 — Match-result spool is not durable on an ephemeral host — High — Accepted (documented, cannot be fully solved for free)
- **Where:** `db/matchQueue.js`, `MATCH_SPOOL_DIR` default `os.tmpdir()`.
- **Problem (confirmed by design):** a result that cannot be written (database down) is retried for about 36 s, kept as a file, and retried again every 10 minutes while the process lives. Render's free filesystem is ephemeral, so if the instance is replaced while the database is still unreachable that file is gone.
- **Why not fixed here:** a database-backed outbox cannot help when the database is the thing that is down; a free alternative store does not exist. Retry-until-saved and visibility are the best free option.
- **Mitigation that exists:** retries with jitter, idempotent inserts (match key), failed/pending counts on `/readyz`, loud logs with the players' names so a record can be re-entered by hand (see runbook). Neon outages are normally short; the exposure is "database down AND redeploy in the same window".
- **Open improvement:** expose the pending/failed counters as a log line every minute while non-zero (cheap alerting via Render log search).

### F4 — Classic Property Rivals can run forever with bots — Medium — Fixed (default changed, classic still selectable)
- **Where:** `games/propertyrivals` ("Until one player is left").
- **Problem (confirmed):** `tests/simulation.test.js` found a seeded 4-bot game (seed 3) that reached 2,000+ rounds with nobody bankrupt (cash grows without limit: salary at Start, no sink).
- **Impact:** an all-bot or stalled table stays active indefinitely and is never garbage collected.
- **Fix (owner-approved):** new tables default to the 60-round game (richest player wins). The classic "until one player is left" is still a lobby choice, now labelled as possibly never ending. Rules unchanged. The simulation test plays the 60-round variant.
- **Test:** `tests/propertyrivals.test.js` asserts the default; the simulation covers termination.

### F12 — One account could fill the server with parked tables — High — Fixed
- **Where:** `server.js` `leaveRoom()`: when the last human leaves a running game it is parked for 10 minutes so they can come back with one tap.
- **Problem (confirmed):** a create / start / leave loop from a single verified account left one parked table per loop (12 loops = 12 tables, reproduced by `tests/room-limits.test.js`). With `MAX_ROOMS = 500` an account could make "Server is full" appear for everyone for 10+ minutes.
- **Fix:** a player keeps at most one parked table; leaving a second running game closes the previous parked one. Legitimate comebacks to the latest table are unchanged.
- **Remaining (theory):** several accounts can still do this, bounded by account creation limits and email verification.
- **Test:** `tests/room-limits.test.js`.

### F5 — Game logic robustness (engines) — Verified, no defect found
`tests/simulation.test.js` (new, runs in `npm test`) plays 120 seeded games across all 8 games and every seat count (min / default / max) and asserts: bots always produce accepted actions, the game ends, garbage actions (null, wrong types, prototype keys, NaN, huge numbers, unknown seats) never throw and never change the public view, finished games accept nothing and await nobody, views serialise and never include another seat's `hand`. Existing per-game suites cover rules, scoring and hidden information in depth. **Not covered:** deep per-game scoring invariants for Poker side pots and Property Rivals trades under random play (existing unit tests cover scripted cases only).

### F6 — Authentication and sessions — Reviewed, no defect found
Argon2id (`@node-rs/argon2`), constant-time dummy hash for unknown users, HttpOnly + SameSite=Lax + Secure (production) session cookie, double-submit CSRF, database-backed rate limits with in-memory fallback, session revocation, single active session. WebSocket upgrades validate `Origin` when a browser sends one; payload (8 KiB), message-rate, per-IP connection, send-buffer and queue bounds exist. **Not tested here:** real email delivery, SPF/DKIM, abuse from many IPs.

### F7 — Database — Reviewed, no defect found
Pool of 10 with 5 s connect and 10 s statement timeouts; migrations transactional under an advisory lock; indexes match the queries read (sessions by token hash, matches by finish time, participants by player, friends both directions, invitations by invitee/status). **Not tested here:** the PostgreSQL integration suites need a database (they run in CI); no query-plan comparison against production-sized data.

### F8 — Memory and cleanup — Reviewed
Rooms: idle (no connected human) for 10 min, lobbies idle 15 min, games idle 60 min are destroyed; spectators and players pruned; per-IP maps pruned; `MAX_ROOMS=500`; the per-room chat log is capped (`CHAT_KEEP`). Theory: `players` entries for connected-but-idle sessions live until the socket closes. No leak measured; no long-duration soak was run (**not yet tested**).

### F9 — Single instance — Accepted
Rooms, sockets and presence are in process memory. One instance only; documented in `docs/PRODUCTION_READINESS.md`. Do not scale horizontally without a shared layer.

### F10 — Free-tier hosting behaviour — Accepted
Render free instances sleep when idle and cold-start (first visitor waits, in-memory tables are gone). Neon free scales to zero (first query slower; the 5 s connect timeout covers typical cold starts). No change possible without paying.

### F13 — Accessibility basics — Verified clean (scripted)
`tests/ui/a11y.js` (in `test:ui`) checks the home page and all 8 game tables for controls without accessible names, unlabeled fields, images without alt, missing `lang`/viewport, and a visible focus ring; a negative control proves the scanner catches an unnamed button. Not covered: screen-reader announcement quality, colour contrast measurement, zoom/text scaling.

### F11 — Front end — Improvement
Layout audits (`tests/ui/game-audit.js`, `mobile-fit.js`, `wizard-layout.js`) are clean at six sizes for all games after PRs #30, #32, #33. Open: below-the-fold controls on 320 px screens (scroll to reach), small tap targets (e.g. "What's new" link). Real-device and screen-reader testing has **not** been done.

## Not yet tested
Load (hundreds of sockets), long-running soak, database outage drills against a real database, real-device mobile behaviour, accessibility with a screen reader, email deliverability.

## Requires paid infrastructure
Always-on hosting (no sleep), persistent disk for the spool, multi-instance scaling, managed monitoring/alerts, point-in-time restore beyond Neon free limits.
