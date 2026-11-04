# Performance notes

Measured here (sandbox, one core, no network): the seeded simulation plays **120 complete games** (all 8 game types, 2-8 seats, bots, garbage-action probes) in about **1.4 s**, so game-engine CPU is negligible next to networking.

Implemented safeguards (verified in code, covered by tests): per-socket message queue bound, 8 KiB WebSocket payload, per-IP socket cap, per-socket message rate, bounded outbound buffer (slow clients are dropped), 120 ms coalesced lobby broadcasts with a per-player change key, static file ETag/304/gzip, pool of 10 DB connections with timeouts, room/player garbage collection.

**Not yet measured:** concurrent-socket load (hundreds of players), memory growth over hours, query plans on production-sized data. These need a soak/load script and, for the database, realistic data; see the audit's "Not yet tested".

Known scaling limit: one process, state in memory. Per-viewer `view()` is computed for every player on each change (cost grows with table size, fine up to 8 seats); the chat log is resent in full on join; the client rebuilds the whole game screen on each state (a keyed diff would be cheaper on low-end phones).
