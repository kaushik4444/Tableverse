# Operations runbook

One Render web service (Node 22, single instance) and one Neon PostgreSQL database. No paid add-ons.

## Health
- `GET /healthz` — process is up (always 200 while running).
- `GET /readyz` — database reachable. 503 `database unavailable` when Neon cannot be reached, 503 `shutting down` during a restart. When match writes are pending or failed the body says so: `ready (matches: 2 pending, 0 failed)`.
- Free uptime monitoring: any free pinger against `/readyz`; Render's own health check uses `/healthz`.

## What happens to players on a restart
Tables, games in progress, chat and presence live in memory and are **lost** on every restart or deploy. Players get a notice and a normal reconnect; they must create a new table. Unfinished games are not recorded. Finished matches are written to PostgreSQL (retried, idempotent) and the server waits up to 15 s for pending writes on SIGTERM. Deploy when few tables are active.

## Deploy
1. CI must be green on the PR (build, unit, PostgreSQL, browser, Docker, audit).
2. Merge to `main`; Render redeploys from the blueprint (`npm ci`, `npm start`).
3. Migrations run at start, transactionally, under an advisory lock. A failing migration makes the new instance refuse to start; Render keeps the previous instance serving.
4. After deploy: `GET /readyz` is 200; log shows `Tableverse running ... (postgres store)`.

## Roll back a broken release
- Render dashboard > service > Events/Deploys > pick the last good deploy > Rollback. (Or revert the merge commit on `main` and push through a PR.)
- Migrations are forward-only. Write migrations so the previous code still works with the new schema (add columns/tables, do not drop or rename in the same release).

## Database failure (Neon down or unreachable)
- Symptoms: `/readyz` 503, logs `[matches] retry n/5 ...`, logins fail.
- Running games continue (they are in memory). Finished matches are retried for ~36 s, then every 10 min while the process runs.
- Do **not** restart the service while the database is down if matches are pending: the local spool survives a process restart but not a replaced instance. Wait for Neon, then check `/readyz` shows no pending matches.
- Neon free scales to zero: the first request after idle can be slow; this is not an outage.

## Migration failure
Startup log `Database migration failed: ...` and the deploy does not become live. Fix forward with a new migration or roll the deploy back; never edit an applied migration.

## Investigate lost or inconsistent match records
1. Search the logs for `[matches] NOT SAVED` — each line names the match key, game, table code and players.
2. `[matches] NOT SAVED (permanent error)` means a bad record (kept as `.failed` in the spool directory of that instance, gone after a redeploy); `after N retries` means the database was down.
3. In SQL: `SELECT id, game_id, finished_at FROM matches WHERE finished_at > now() - interval '1 day' ORDER BY finished_at DESC;` and compare with the logged keys (`match_key`).
4. Re-enter a lost result by hand only with the player ids from the log; the match key makes a repeated insert a no-op.

## Abuse / rate limits
Auth endpoints are rate limited per address and account in `auth_rate_limits`; WebSockets are limited per IP, per socket message rate, payload (8 KiB) and buffered bytes. Check logs for `slow down` closes and `too many connections` spikes.
