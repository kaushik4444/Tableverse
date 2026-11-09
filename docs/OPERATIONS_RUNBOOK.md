# Operations runbook

One Render web service (Node 22, single instance) and one Neon PostgreSQL database. No paid add-ons.
Status labels used below: **verified in code/tests** (what this repository proves), **owner-recorded** (someone checked it in the provider dashboard and wrote it down), **manual** (still to be checked by a person).

## Health
| Endpoint | Meaning | Status codes |
|---|---|---|
| `GET /healthz` | Liveness: the process is running. Never touches the database. | 200 `ok` |
| `GET /readyz` | Readiness: the database answered `SELECT 1` within 3 s. | 200 `ready` (with `(matches: n pending, n failed)` when relevant); 200 `ready (in-memory store)` for local play; 503 `database unavailable`; 503 `shutting down` during a restart |

- **Render** must use `/healthz` as its health check (`render.yaml`: `healthCheckPath: /healthz`). A Neon outage must not restart the web service.
- **External uptime monitor** (optional, manual): point it at `/readyz`. A 503 means the database is unreachable or the service is stopping.
- Neither endpoint returns hostnames, usernames, driver errors or stack traces.

## Logs
Most events are one JSON object per line (search by `"event"` in Render's log view). Older human-readable lines still exist and are listed after the table.

| Event | Level | Written when | Useful fields |
|---|---|---|---|
| `server.started` / `server.stopping` / `server.start_failed` | info / error | process start, SIGTERM/SIGINT, refused start | `port`, `store`, `signal` |
| `process.crash` | error | unhandled rejection or uncaught exception | `reason`, `err` |
| `http.unhandled` | error | a route threw; the response was 500 | `requestId`, `method`, `path`, `err` |
| `ws.socket_error` | warn | a WebSocket failed (bad frame, reset) | `connId`, `code` |
| `game.handler_failed` | error | a game action threw; the player got "Something went wrong" | `connId`, `type`, `room` |
| `db.pool_error` | error | an idle database connection failed | `code`, `err` |
| `db.query_failed` | warn | a query failed | `op` (first SQL keyword only), `code`, `err` |
| `db.rollback_failed` | warn | a transaction could not roll back | `code`, `err` |
| `db.migration_failed` | error | a migration failed at start | `err` |
| `health.db_unreachable` / `health.db_recovered` | warn / info | the first failed readiness probe, and recovery (not every probe) | `code`, `timeoutMs` |
| `[email] delivery failed` / `sent` | error / info | a verification or reset e-mail | masked address (`a***@example.com`), provider status |

- **Request IDs.** Every HTTP response carries `X-Request-Id`. A plain ID sent by a proxy or client is kept; anything else is replaced. A 500 log line carries the same ID.
- **Connection IDs.** `connId` ties together the WebSocket lines for one socket.
- **Never logged:** passwords, session or verification or reset tokens, API keys, `DATABASE_URL`, chat content, full e-mail addresses. The logger also masks these if they reach it by accident (`lib/log.js`, tested in `tests/log.test.js`).
- Still human-readable: the `[stats]` line (below), `[matches] ...` spool messages, `[server] automatic play failed` and `Tableverse running ...`.

## Free log dashboard
Every 5 minutes (every minute while a match result is pending or failed) the server logs one line, searchable in Render's log view:
`[stats] rooms=12 playing=5 sockets=31 players=40 rssMB=96 matches(saved=118 pending=0 failed=0 retried=2)`.
Watch `rssMB` (Render free has 512 MB), `pending`/`failed` (a database problem) and `sockets` (load).

## Diagnose: application or database?
1. `GET /healthz` fails or times out → the **application** is down or restarting: check Render's Events and the last `process.crash` / `server.start_failed` line.
2. `/healthz` is 200 but `/readyz` is 503 → the **database** (or a shutdown in progress). Check `health.db_unreachable` in the logs and the status of Neon.
3. Both 200 but players report errors → look for `http.unhandled`, `game.handler_failed` or `db.query_failed` with the request ID or `connId` the player gives you.
4. `/readyz` shows `pending` or `failed` matches → a database problem that has not cleared; see "Database failure".

## What happens to players on a restart
Tables, games in progress, chat and presence live in memory and are **lost** on every restart or deploy. Players get a notice and a normal reconnect; they must create a new table. Unfinished games are not recorded. Finished matches are written to PostgreSQL (retried, idempotent) and the server waits up to 15 s for pending writes on SIGTERM. Deploy when few tables are active.

## Deploy
1. CI must be green on the PR (build, unit, PostgreSQL, browser, Docker, audit).
2. Merge to `main`; Render redeploys from the blueprint (`npm ci`, `npm start`).
3. Migrations run at start, transactionally, under an advisory lock. A failing migration makes the new instance refuse to start; Render keeps the previous instance serving.
4. After deploy: `GET /readyz` is 200; log shows `Tableverse running ... (postgres store)` and a `server.started` event.

## Roll back a broken release
- Render dashboard > service > Events/Deploys > pick the last good deploy > Rollback. (Or revert the merge commit on `main` and push through a PR.)
- Migrations are forward-only. Write migrations so the previous code still works with the new schema (add columns/tables, do not drop or rename in the same release).
- Rolling back does not restore lost in-memory games; it only returns the code.

## Database failure (Neon down or unreachable)
- Symptoms: `/readyz` 503, `health.db_unreachable` in the logs, `db.query_failed` lines, logins fail.
- Running games continue (they are in memory). Finished matches are retried for ~36 s, then every 10 min while the process runs.
- Do **not** restart the service while the database is down if matches are pending: the local spool survives a process restart but not a replaced instance. Wait for Neon, then check `/readyz` shows no pending matches.
- Neon free scales to zero: the first request after idle can be slow; this is not an outage. A probe that takes longer than 3 s returns 503 `database unavailable`; repeat it before escalating.

## Startup fails with "Cannot reach the database"
`FATAL: refusing to start: Cannot reach the database: ...` means the very first `SELECT 1` failed, **before any migration ran**. A failed migration reads `Database migration failed: ...` instead. The server never falls back to the in-memory store in production.
- `Connection terminated due to connection timeout` (or `timeout exceeded when trying to connect`) is the 5 s connect timeout of `db/pool.js`. It usually means Neon's compute was asleep or briefly unavailable, or the network path is blocked.
- In production the first check is retried for up to 45 s (waits of 1, 2, 4, 8, 8 ... s) for connection-level errors only. The log shows `[db] Not reachable yet (...); attempt N` and then either `Reachable after N attempts` or the FATAL line with `(after N attempts)`. A wrong password, unknown database or bad host name is not retried and fails at once. `DB_STARTUP_WAIT_MS` changes the limit (`0` = single attempt, capped at 120000); nothing needs to be set.
- If it still fails after the retries, the previous Render instance keeps serving. Check, in this order:
  1. **Neon status page**, and the project's **Operations** list at the failure time (a `start_compute` that failed or took long).
  2. **Neon usage**: compute hours used against the plan's limit. An exhausted free quota suspends the compute.
  3. **Connection string host**: the runtime `DATABASE_URL` should be the **pooled** string (the host contains `-pooler`); use the direct string only for scripts such as the cleanup tool. Compare the host with the one the Neon console shows now (a deleted or reset branch has a new endpoint). Never paste the full URL anywhere.
  4. **Neon IP Allow** (if enabled) must include Render's outbound addresses.
  5. **Render**: Events and Logs for that deploy, the Environment value of `DATABASE_URL` (no stray spaces), the service region against the Neon region, and [Render's status page](https://status.render.com). A manual redeploy that works points to a cold start rather than a configuration fault.

## Migration failure
Startup log `db.migration_failed` (or `Database migration failed: ...`) and the deploy does not become live. Fix forward with a new migration or roll the deploy back; never edit an applied migration.

## Investigate lost or inconsistent match records
1. Search the logs for `[matches] NOT SAVED` — each line names the match key, game, table code and players.
2. `[matches] NOT SAVED (permanent error)` means a bad record (kept as `.failed` in the spool directory of that instance, gone after a redeploy); `after N retries` means the database was down.
3. In SQL: `SELECT id, game_id, finished_at FROM matches WHERE finished_at > now() - interval '1 day' ORDER BY finished_at DESC;` and compare with the logged keys (`match_key`).
4. Re-enter a lost result by hand only with the player ids from the log; the match key makes a repeated insert a no-op.

## Backups (independent of Neon)
Persistent data: accounts, sessions, friendships, private-table invitations, recent tables and finished matches. Neon's own history is one recovery path; the dump below is a second one that you control.

**Create a backup** (read-only against the database; nothing is scheduled):
```sh
# Keep DATABASE_URL in your shell or secret manager, never in a file in this repository.
npm run db:backup -- --out "$HOME/tableverse-backups/tableverse-$(date +%F-%H%M).dump"
npm run db:backup -- --verify "$HOME/tableverse-backups/tableverse-2026-11-06-2100.dump"
```
- The script passes the password to `pg_dump` through environment variables, so it does not appear in the process list or in shell history. Do not replace it with `pg_dump "$DATABASE_URL" ...`, which puts the whole URL, password included, on the command line.
- Output is `<name>.dump` plus `<name>.dump.sha256`, both `0600`. The `.partial` file is created exclusively at `0600` before `pg_dump` starts, so a second run aimed at the same name is refused and never touches the first run's files. The checksum is staged first, and both files are published only after `pg_restore --list` reads the dump and the `schema_migrations` table is present. A failed run removes only the files it created.
- Refuses: output inside this repository (checked on the resolved path, so a symlinked folder that leads into the checkout is refused too; `backups/` and `*.dump` are git-ignored as well), a name without `.dump`, any existing file or symlink at the destination.
- `db:restore-check` refuses a dump with no `.sha256` file, a malformed one, or one that does not match its bytes. Read-only `--verify` may report a dump without a checksum, and says so.
- Needs `pg_dump` and `pg_restore` at least as new as the database server. Check the server's major version in Neon before relying on the tools in a new environment (manual).

**Storage recommendations (manual):** keep dumps off Render and off the repository. Use an encrypted location you control (for example an encrypted disk or a password manager's file attachment for small dumps). Keep at least one copy older than a week. Treat a dump as personal data: it contains e-mail addresses and password hashes.

## Restore test (rehearsal, never production)
Run this at least once a quarter and after any change to migrations. It never touches production data.
1. In Neon, create a new **empty** database or branch for the test, or use a local PostgreSQL. Do not reuse the production branch.
2. Set `RESTORE_TEST_DATABASE_URL` to that database's URL, and keep `DATABASE_URL` pointed at production (the script uses it only to refuse a target that is production).
3. `npm run db:restore-check -- --dump "$HOME/tableverse-backups/<file>.dump"`
4. Expect `"ok": true`, all migrations applied, no orphaned rows, no unvalidated foreign keys, and counts in the report.
5. Compare the counts with production by running `SELECT count(*) FROM players;` (and `matches`, `auth_identities`) read-only on production. Small differences are expected if the dump is older than the query; a large difference means investigate before trusting the backup.
6. Delete the test database or branch afterwards.

The script refuses a target that already holds tables, and a dump whose checksum has changed. Both refusals are tested (`tests/db-restore.pg.test.js`, run by `npm run test:pg`).

## Validate a populated point-in-time branch (read-only)
Use this for a Neon branch created from history, which already holds data. It never writes to the branch or to production. Run the queries in the Neon SQL editor with the branch selected, or in `psql` against the branch's connection string.
1. Confirm you are on the branch, not production (the branch selector shows its name). In `psql`, start with `SET default_transaction_read_only = on;` so any write is rejected. In the Neon editor the setting may not persist between statements, so run only the SELECT queries below and never type INSERT, UPDATE, DELETE or DDL there.
2. Schema: `SELECT version FROM schema_migrations ORDER BY version;` must list every file in `db/migrations/` (the set this code release expects). A branch missing a later migration predates it, so expect the code to need the migration run before the lobby opens.
3. Counts, to record: `SELECT count(*) FROM players;`, and the same for `auth_identities`, `matches`, `match_participants` and `friendships`.
4. Last recorded match: `SELECT max(finished_at) FROM matches;`. It must be at or before the point you chose; anything after is a sign the branch is not the point you think it is.
5. Orphans, both must be 0: `SELECT count(*) FROM match_participants mp WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = mp.match_id);` and `SELECT count(*) FROM auth_identities a WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = a.player_id);`.
6. Foreign keys, must be 0: `SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;`.
7. Write the results and the chosen timestamp in the incident record. Counts will be below production's today by everything written after that timestamp; that gap is the expected data loss the owner must approve, not a fault. Delete the branch only after the owner decides.

## Recovery procedure (for real)
Only with owner approval. Recovery replaces what players see; decide first, then act.
1. **Stop the bleeding:** if the damage is a bad deploy, roll back first (above). If it is data loss, take a fresh backup of whatever is left (`db:backup`) before changing anything.
2. **Choose the source:** Neon point-in-time branch (fastest, limited by the retention window), or the most recent verified dump (independent, limited by how old the dump is).
3. **Restore into a new target, not over production.** Two different paths:
   - **A dump:** an empty database, then `db:restore-check` against it. The script refuses any target that already has tables.
   - **A Neon point-in-time branch:** the branch is already populated, so `db:restore-check` does not apply and would refuse it. Validate it with the read-only procedure below instead.
4. **Point the application at it:** change `DATABASE_URL` on Render to the restored database (or restore the branch over the main one in Neon, which the owner must approve), redeploy, confirm `/readyz` is 200 and `server.started` shows `store: postgres`.
5. **Verify:** counts as in the restore test; sign in as a known test account; check a recent match appears in the match history.
6. **Record:** what was restored, from when, what data after that point is lost, and who approved it.

**Limits to tell the owner:** everything written after the chosen point is lost (accounts created, matches finished, friendships made). Tables and games in progress are in memory and are never recovered. Neon point-in-time history is limited by the plan's retention window, which must be checked in the Neon dashboard (manual; see below). Restoring a dump older than the last deploy may bring back schema that the current code does not expect; run migrations and `/readyz` checks before opening the lobby.

## Neon backups — what is verified and what is not
- **Verified in code and tests:** the dump, verification and restore-rehearsal scripts above, including refusals.
- **Owner-recorded (2026-11-06):** a branch created "from point-in-time history" matched production's `matches` row count, and the test branch was deleted. This was checked in the Neon dashboard by the owner; it was not re-run as part of this change.
- **Manual, not yet recorded:** the plan name, whether automatic backups and point-in-time restore are included on the current plan, and the exact retention window. Record them here after checking: Neon > project > Settings. Plan: `____`. Retention window: `____`. Checked on: `____`.
- Do not assume a window: free-tier history is typically short. Re-check periodically.

## Monitoring and alerts
| What | How | Status |
|---|---|---|
| Failed deploys and health checks | Render service Events/Deploys; Render's health check on `/healthz` | Built in; **manual**: confirm Render's notification e-mail settings in the account |
| Restarts and crashes | `process.crash` and `server.started` events in Render logs; repeated `server.started` close together = restart loop | Logged; **manual**: search the log view or set a log alert if the plan offers one |
| Database unreachable | `health.db_unreachable` warn event; `/readyz` 503 | Logged; alert requires an external monitor (below) |
| Critical application exceptions | `http.unhandled`, `process.crash`, `game.handler_failed` | Logged; no automatic notification today |
| Resource use | `[stats] rssMB=…` line every 5 minutes | Logged; watch against Render free's 512 MB |
| Downtime | External uptime monitor against `/readyz` | **Not configured.** Optional and free-tier-capable, but it needs a third-party account: awaiting your approval |
| Neon compute and connection problems | Neon dashboard monitoring | **Manual**: not verified for this plan |

**Known limitations:** which Render events send notifications on the current plan is not verified in this repository (manual). An external monitor is the only check here that tells you about downtime while nobody is watching. Log lines are only as long-lived as Render's retention for the plan.

## Incident handling
1. Confirm scope with `/healthz`, `/readyz` and a test sign-in (see "Diagnose").
2. Note the start time and the most recent `request ID` or `connId` reported by a player.
3. If the cause is the latest deploy, roll back (above) and record it.
4. If the database is at fault, wait and re-check `/readyz`; do not restart while matches are pending.
5. Escalate to the owner immediately for: any data-loss suspicion, any need to restore, any change to Neon or Render settings, or any request to disable email verification (never done in an incident).
6. Afterwards, write a short note: timeline, cause, what was lost, and which check would have caught it earlier.

## Voice chat connectivity (TURN) — verify in production
Voice is peer to peer. With only STUN (the default), players on some mobile carriers or office networks cannot hear each other.
- Check: Render > service > Environment has `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` (or `ICE_SERVERS`). Status: **configured** (Metered.ca free tier, set on Render, 2026-11-06).
- Security: the current static pair is sent to every visitor in the welcome message. Status: **code ready, not switched on (needs your approval)**.
- Preferred: Metered's official REST API (`lib/meteredTurn.js`). Per Metered's docs (https://metered.ca/docs/turn-rest-api/post-create-credential) the call is `POST https://<app>.metered.live/api/v1/turn/credential?secretKey=…` with optional JSON `expiryInSeconds` and `label`, returning `username` and `password`. The server fetches credentials ahead of use and keeps them valid; a new credential takes up to 2 minutes to propagate, so it is only handed out after that. An earlier note in this file named `mla2.metered.live`; confirm the host in the Metered dashboard before switching on.
- Switch-over (needs your approval; do these in one redeploy, never a half-switched state):
  1. Set on Render (secret values only in Render's secret environment, never in the repository or logs): `METERED_APP_NAME` (the app name, not a URL), `METERED_SECRET_KEY`, keep `TURN_URL`.
  2. Remove `ICE_SERVERS` if it is set; it overrides every other TURN setting.
  3. Keep `TURN_USERNAME` and `TURN_CREDENTIAL` set during validation. While no Metered login is ready (startup, or after failures) the server offers the static pair as a fallback, so voice keeps working; once a Metered login is ready the static pair is no longer sent. After one successful, approved test (below), remove both variables and rotate the static credential at Metered so the old pair stops working. Do not remove them before that approval: without them, voice falls back to STUN only whenever Metered is not ready.
  4. Check the welcome message of a test connection: the TURN entry must carry a fresh Metered `username` and no static login. Logs show only the kind of failure (`HTTP 401`, `timeout`, `network error`), never the key.
  5. Run the two-phone test below, and a table open for over an hour, before calling it done.
- Quota (Metered free tier, checked on the dashboard by the owner on 2026-11-09): 500 MB of relay traffic per month; 309 MB used (62%), 191 MB left; renews 2026-12-06. When the quota is used up the relay stops until the next cycle, and there are no overage charges at $0/GB. The app cannot read relay usage itself: watch the dashboard. Players see a notice when the relay is unavailable (`turnStatus` `unavailable`) or out of quota (`quota`); voice then works only where a direct connection is possible.
- Retries are bounded: failures back off from 30 s up to 15 min, and a 402, 403 or 429 waits one hour. Credential requests never run in a loop. Tests use stubs only and never call Metered, so they do not use quota.
- Fallback: `TURN_SHARED_SECRET` (HMAC `<expiry>:<player id>` logins) remains for a provider that documents the coturn `use-auth-secret` scheme. Metered does not use that scheme.
- Refresh (Metered logins, `lib/meteredTurn.js`): each login lasts 48 hours and a replacement is requested every 24 hours (Metered's recommendation). A new login is used two minutes after it is requested, and the old one is left to expire. Players are sent the new settings when it becomes usable, so open calls keep their audio. `TURN_TTL_SECONDS` may shorten the lifetime for tests, but never below 15 minutes; the maximum is 48 hours.
- Metered REST logins (when `METERED_APP_NAME` and `METERED_SECRET_KEY` are set; the paragraph above is for `TURN_SHARED_SECRET`): each login lasts 48 hours and is replaced every 24 hours, as Metered recommends. A replacement becomes usable 2 minutes after it is created. Old logins are left to expire, because Metered's expiry is a hard cutoff. Checks after a deploy: `GET /readyz` is unaffected; the welcome message carries `turnStatus: ready` within about 2 minutes of start-up.
- Test: two phones on different mobile networks join one table, both tap the microphone; each must hear the other. Status: **passed** (2026-11-06).
- If it fails only on some networks, TURN is missing or misconfigured (wrong port or protocol, expired credential).

## Repository safety
`main` is protected by a ruleset ("Protect-Main", GitHub > Settings > Rules > Rulesets) that requires a pull request and passing status checks before merge. **Status: enabled**, all five CI jobs required: `Build and test (Node 20)`, `Build and test (Node 22)`, `Browser layout and interaction checks`, `Production dependency audit`, `Build production Docker image`.

## Abuse / rate limits
Auth endpoints are rate limited per address and account in `auth_rate_limits`; WebSockets are limited per IP, per socket message rate, payload (8 KiB) and buffered bytes. Check logs for `slow down` closes and `too many connections` spikes.

## Neon connection: TLS setting (`sslmode`)

- Keep `?sslmode=require` (or `verify-full`) in the Neon URL. `db/poolConfig.js` rewrites `require`, `prefer` and `verify-ca` to `verify-full` at start-up, which is what they already mean: TLS with the certificate and host name checked. The connection is the same; only the library's deprecation warning goes away.
- Do not change it to `disable`. In production a remote host whose URL has no `sslmode` at all is still forced to verified TLS.
- A URL that also sets `ssl`, `sslrootcert` or similar, or `uselibpqcompat`, is passed on unchanged, so the warning can still appear for those. That is expected.
