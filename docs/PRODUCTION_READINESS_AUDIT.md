# Production readiness audit

Audited against `main` at `c10f6a6` (includes PRs #26–#35, all shipped game modes). All 10 playable game modes are covered. Every finding states whether it was **confirmed** (reproduced or read in the code), **theoretical**, or an **improvement**. Nothing here assumes paid infrastructure.

**Audit status key:**
- ✅ Fixed — in a merged PR, with a regression test that fails without the fix
- 🔵 Reviewed — no defect found; coverage noted
- 🟡 Accepted — documented limitation; cannot be fixed for free or by design
- 🔴 Open — defect confirmed but not yet fixed

---

## Games covered (10 modes)

| ID | Name | Engine | Unit test | Simulation | UI test |
|----|------|--------|-----------|------------|---------|
| `wizard` | Wizard | `games/wizard` | `engine.test.js` | ✅ | `wizard-layout.js` |
| `twentynine` | 29 | `games/twentynine` | `engine.test.js` | ✅ | `scorecard-layout.js` |
| `poker` | Poker | `games/poker` | `poker.test.js` | ✅ | `lead-ui.js` |
| `themind` | The Mind | `games/themind` | `themind.test.js` | ✅ | `feed-ui.js` |
| `ludo` | Ludo | `games/ludo` | `ludo.test.js` | ✅ | `ludo-ui.js` |
| `gofish` | Go Fish | `games/gofish` | `gofish.test.js` | ✅ | `gofish-ui.js` |
| `snakesladders` | Snakes & Ladders | `games/snakesladders` | `snakesladders.test.js` | ✅ | `snakesladders-ui.js` |
| `propertyrivals` | Property Rivals | `games/propertyrivals` | `propertyrivals.test.js` | ✅ | `propertyrivals-ui.js` |
| `tictactoe` | Tic-Tac-Toe | `games/linegames` | `linegames.test.js` | ✅ | `linegames-ui.js` |
| `fourinarow` | Four in a Row | `games/linegames` | `linegames.test.js` | ✅ | `linegames-ui.js` |

**Partially covered (scripted cases only, random-play not exhaustive):**
- Poker side-pot splits under deep random play
- Property Rivals trade outcomes under random play

---

## Findings

### F1 — One throwing bot/auto-move crashed the whole server ✅ Fixed
- **Severity:** High
- **Where:** `server.js` `schedule()` timer callback.
- **Problem (confirmed):** `g.botAction()`, `g.act()` and `afterChange()` ran with no `try/catch`. Any exception in one game's bot was an uncaught exception in a timer — Node exited and every live table was lost. Reproduced by `tests/room-fault.test.js`: without the fix the process dies.
- **Fix:** callback is guarded; after 3 consecutive failures only that table is closed and its players are notified.
- **Test:** `tests/room-fault.test.js`

### F2 — A restart gave players no explanation ✅ Fixed
- **Severity:** Medium
- **Where:** `server.js` `close()` / SIGTERM path.
- **Problem (confirmed):** sockets were terminated with no message; `/readyz` kept answering ready; tables could still be created while stopping.
- **Fix:** while stopping, `/readyz` returns 503, new tables are refused, every socket gets a notice + `1012` close. Unfinished games are never recorded as finished.
- **Test:** `tests/shutdown.test.js`

### F3 — Match-result spool is not durable on ephemeral disk 🟡 Accepted
- **Severity:** High (accepted limitation)
- **Where:** `db/matchQueue.js`, `MATCH_SPOOL_DIR` defaults to `os.tmpdir()`.
- **Problem (confirmed by design):** a result that cannot be written (database down) is retried for ~36 s, spooled to disk, retried every 10 min while the process lives. Render's free filesystem is ephemeral; a redeploy during a Neon outage loses the spool.
- **Why not fixed:** a database-backed outbox cannot help when the database is down; no free persistent storage alternative exists.
- **Mitigation:** jitter retries, idempotent inserts (match key), failed/pending counters on `/readyz`, loud logs for manual recovery (see runbook). Neon outages are normally short.

### F4 — Classic Property Rivals can run forever with bots ✅ Fixed
- **Severity:** Medium
- **Where:** `games/propertyrivals` ("Until one player is left" mode).
- **Problem (confirmed):** `tests/simulation.test.js` found a seeded 4-bot game (seed 3) that exceeded 2,000 rounds with nobody bankrupt (cash grows without limit: salary at Start, no sink).
- **Fix:** new tables default to the 60-round game (richest player wins); classic mode remains a lobby option.
- **Test:** `tests/propertyrivals.test.js` asserts the default; simulation covers termination.

### F5 — Game-engine robustness under random play 🔵 Reviewed
- **Coverage:** `tests/simulation.test.js` plays 120 seeded games across all 10 game modes and every seat count (min / default / max). Invariants checked every game:
  - Bots always produce accepted actions
  - Game always terminates (no stuck state, no infinite loop)
  - Garbage actions (null, wrong types, prototype keys, NaN, huge numbers, unknown seats) never throw and never change the public view
  - Finished games accept nothing and await nobody
  - Views serialise and never include another seat's `hand`
- **Partially covered (scripted cases only):**
  - Poker side-pot splits under random multi-elimination hands
  - Property Rivals trade outcomes under random multi-player play
- **Recommendation:** add deeper invariant tests for Poker side pots and Property Rivals trades (future work, no blocking defect found).

### F6 — Authentication and sessions 🔵 Reviewed
- Argon2id (`@node-rs/argon2`), constant-time dummy hash for unknown users, HttpOnly + SameSite=Lax + Secure (production) cookie, double-submit CSRF, database-backed rate limits with in-memory fallback, session revocation.
- WebSocket upgrades validate `Origin`; payload (8 KiB), message-rate, per-IP connection, send-buffer and queue bounds exist.
- **Not tested:** real email delivery, SPF/DKIM, abuse from many IPs.

### F7 — Database pool and schema 🔵 Reviewed
- Pool of 10, 5 s connect timeout, 10 s statement timeout; migrations transactional under an advisory lock; indexes match queries (sessions by token hash, matches by finish time, participants by player, friends both directions, invitations by invitee/status).
- **Not tested:** PostgreSQL integration suites require a live database (they run in CI); no query-plan comparison against production-sized data.

### F8 — Memory and cleanup 🔵 Reviewed (long-soak not done)
- Idle rooms (no connected human for 10 min), idle lobbies (15 min), idle games (60 min) are destroyed; spectators and players pruned; per-IP maps pruned; `MAX_ROOMS=500`; chat log capped.
- **Not tested:** hours-long soak (memory leak search), behaviour under sustained load.

### F9 — Single instance 🟡 Accepted
- Rooms, sockets and presence are in process memory. Single instance only; documented in `docs/PRODUCTION_READINESS.md`. Horizontal scaling requires a shared realtime layer.

### F10 — Free-tier cold starts 🟡 Accepted
- Render free instances sleep when idle; first visitor waits for cold start and in-memory tables are gone. Neon free scales to zero; first query is slower. No change possible without paying.

### F11 — Front-end layout and accessibility 🔵 Reviewed (partial)
- Layout audits (`tests/ui/game-audit.js`, `mobile-fit.js`, `wizard-layout.js`, `scorecard-layout.js`) are clean at six viewport sizes for all 10 game modes after PRs #30, #32, #33, #35.
- `tests/ui/a11y.js` checks the home page and all 10 game tables for unnamed controls, unlabeled fields, images without alt, missing `lang`/viewport, visible focus ring.
- **Not tested:** real-device behaviour, screen-reader announcement quality, colour contrast measurement, zoom/text scaling.

### F12 — One account could flood the server with parked tables ✅ Fixed
- **Severity:** High
- **Where:** `server.js` `leaveRoom()`.
- **Problem (confirmed):** a create/start/leave loop from one account left one parked table per iteration. With `MAX_ROOMS=500`, an account could block everyone for 10+ minutes.
- **Fix:** a player keeps at most one parked table; leaving a second running game closes the previous parked one.
- **Test:** `tests/room-limits.test.js`

### F13 — HTTP route error left requests hanging ✅ Fixed
- **Severity:** Low
- **Where:** `server.js` top-level async request handler.
- **Problem (confirmed):** an exception outside `authRoutes` became an unhandled rejection; the request hung until the 30 s timeout and (without a process handler) crashed the server.
- **Fix:** every request is wrapped; 500 is returned immediately, logged with method and path (no query string, no tokens).
- **Test:** `tests/room-fault.test.js` (second case)

### F14 — WebSocket fuzzing 🔵 Reviewed
- `tests/ws-fuzz.test.js` sends ~4,000 random, malformed and hostile messages (all 18 handler types, plus truncated JSON, prototype keys, NaN/huge numbers, oversized strings) while a game runs. No internal error logged, prototype not polluted, other players retain connections, new table works afterwards.

### F15 — unhandledRejection continued silently ✅ Fixed (branch `prod-readiness-3`)
- **Severity:** High
- **Where:** `server.js` standalone section, `process.on('unhandledRejection', ...)`.
- **Problem (confirmed):** the handler only logged the error. A rejected promise nobody awaited left the server running in a potentially inconsistent state with no restart.
- **Fix:** `unhandledRejection` now calls the same `crashShutdown` path as `uncaughtException`: drain match-queue writes (up to 5 s), notify clients, exit(1) so the host restarts. A `crashing` guard prevents concurrent shutdown sequences.
- **Test:** `tests/unhandled-rejection.test.js` (no external deps; asserts exit code 1 and stderr log).

### F16 — Shared floating feed (new, Stage 18) 🔵 Reviewed
- `public/feed.js` delivers floating action messages in Wizard, 29, Poker, Ludo, The Mind and Property Rivals.
- Covered by `tests/ui/feed-ui.js` (UI integration) and `tests/ui/lead-ui.js` (leader crown).
- **Not tested:** feed behaviour under rapid state changes at large tables (8 seats, fast bots).

---

## Coverage summary

| Area | Status |
|------|--------|
| All 10 game engines — seeded random play, garbage input, invariants | ✅ Tested |
| Server fault isolation (bot crash, HTTP error) | ✅ Tested |
| Graceful shutdown (SIGTERM, SIGINT, unhandledRejection, uncaughtException) | ✅ Tested |
| Match-queue drain and spool | ✅ Tested |
| Room lifecycle and cleanup | ✅ Tested |
| Parked-table flood | ✅ Tested |
| WebSocket fuzzing | ✅ Tested |
| Auth / sessions (design review) | 🔵 Reviewed |
| Database pool / schema (design review) | 🔵 Reviewed |
| Accessibility basics (scripted) | 🔵 Reviewed |
| Layout across 10 games / 6 viewports | 🔵 Reviewed |
| Poker side-pot invariants (random play) | ⚠️ Partial — scripted only |
| Property Rivals trade invariants (random play) | ⚠️ Partial — scripted only |
| Long-running soak (memory leak search) | ❌ Not done |
| Load test (hundreds of sockets) | ❌ Not done (see `scripts/loadtest.js`) |
| Colour contrast measurement | ❌ Not done |
| Screen reader / real device | ❌ Not done |
| Email deliverability (SPF/DKIM) | ❌ Not done |
| Database outage drills against Neon | ❌ Not done |
| Match spool durability on ephemeral disk | 🟡 Accepted limitation |
| Free-tier sleep / cold starts | 🟡 Accepted limitation |
| Single-instance deployment | 🟡 Accepted limitation |

---

## Not yet tested

- Hours-long soak (memory leak search under sustained play)
- Load test with hundreds of concurrent sockets (`scripts/loadtest.js` runs a shorter burst; see `PERFORMANCE.md`)
- Colour contrast (WCAG AA) — not yet measured
- Real-device mobile behaviour (all testing is Playwright/desktop)
- Screen reader announcement quality
- Email deliverability (SPF/DKIM/DMARC alignment, bounce handling)
- Database outage drills against a live Neon instance
- Poker side-pot splits and Property Rivals trades under random multi-player play

## Requires paid infrastructure

- Always-on hosting (no sleep, guaranteed availability)
- Persistent disk for the match spool across redeploys
- Multi-instance horizontal scaling (needs shared realtime layer)
- Managed monitoring and alerting (Render free has no alert rules)
- Point-in-time restore beyond Neon free limits

## Final assessment (main at c10f6a6 + prod-readiness-3)

**Verified and fixed:** F1 (table crash isolation), F2 (graceful shutdown), F4 (Property Rivals default), F12 (parked-table flood), F13 (HTTP error guard), F15 (unhandledRejection shutdown) — each with a regression test that fails without the fix.

**Verified, no defect found:** engine robustness under seeded random play and garbage input (F5) across all 10 game modes, reconnect/duplicate-identity handling, auth/session design (F6), database pool/timeouts/indexes by reading (F7), WebSocket fuzzing (F14), layout across all 10 games at 6 viewport sizes (F11).

**Verified but not fixed (cannot be fixed for free):** match spool durability on ephemeral disk (F3), free-tier sleep and cold starts (F10).

**Partial coverage (scripted cases only, not random play):** Poker side-pot splits, Property Rivals trade outcomes.

**Not yet tested:** hours-long soak, real-Argon2 signup bursts, database outage drills against Neon, real devices, screen readers, colour contrast, email deliverability.

**Requires paid infrastructure:** always-on hosting, persistent disk, multi-instance scaling, managed alerting.

**Future scalability:** shared realtime layer before more than one instance; keyed UI diff; per-viewer view caching at large tables.

CI green is necessary, not sufficient. See the release checklist in `docs/PRODUCTION_READINESS.md`.
