# Performance notes

Measured here (sandbox, one core, no network): the seeded simulation plays **120 complete games** (all 8 game types, 2-8 seats, bots, garbage-action probes) in about **1.4 s**, so game-engine CPU is negligible next to networking.

Implemented safeguards (verified in code, covered by tests): per-socket message queue bound, 8 KiB WebSocket payload, per-IP socket cap, per-socket message rate, bounded outbound buffer (slow clients are dropped), 120 ms coalesced lobby broadcasts with a per-player change key, static file ETag/304/gzip, pool of 10 DB connections with timeouts, room/player garbage collection.

## Load test (`npm run loadtest -- <players> <seconds>`, `scripts/loadtest.js`)
Real server in memory mode, real WebSocket clients, tables of four (Go Fish, Wizard, 29, Poker) started by the clients. Sandbox results, one core, no network latency:

| players | tables | duration | open at end | unexpected closes | errors | msgs/s | KB/s | event-loop p99 / max | RSS start -> end |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 25 | 15 s | 100 | 0 | 0 | 88 | 183 | 12 / 22 ms | 97 -> 85 MB |
| 400 | 100 | 30 s | 400 | 0 | 0 | 317 | 848 | 15 / 65 ms | 145 -> 104 MB |

Caveats: the clients stay connected but do not play, so most traffic is deals, bot turns for timeouts and lobby updates, not a full human-speed game; account creation uses a fast stand-in for Argon2 in this sandbox (real signups are far more CPU-heavy: see below); Render's free instance has less CPU and 512 MB RAM, so absolute numbers there will be lower. Treat this as a regression baseline (compare before/after a change), not a capacity promise.

**Not yet measured:** hours-long memory growth, real-Argon2 signup bursts (each hash is deliberately expensive and serialised by the auth queue), query plans on production-sized data.

Known scaling limit: one process, state in memory. Per-viewer `view()` is computed for every player on each change (cost grows with table size, fine up to 8 seats); the chat log is resent in full on join; the client rebuilds the whole game screen on each state (a keyed diff would be cheaper on low-end phones).
