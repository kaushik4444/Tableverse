# Match-result durability — assessment for the limited beta (2026-11-10)

Status: **assessment and recommendation. No code was changed.** The decision belongs to the owner. The recommendation below is option A, with conditions.

## What survives a server restart or redeploy

| Data | Where it lives | Survives a restart or redeploy? |
|---|---|---|
| Finished matches, seats, scores and positions | PostgreSQL (`matches`, `match_participants`) | **Yes**, once the database write has succeeded. |
| Player statistics and match history | Computed from the saved match rows (`db/stats.js`, `db/account.js`) | **Yes**: they are derived from the saved rows, so they are only as complete as those rows. |
| Accounts, sessions, friends, blocks, recent tables | PostgreSQL | **Yes.** |
| A finished match whose database write has not yet succeeded | A file in the match spool (`db/matchQueue.js`) | **Partly.** The default spool is `os.tmpdir()/tableverse-match-spool`, so it survives a process restart on the same machine only. A redeploy onto a fresh instance loses it. `MATCH_SPOOL_DIR` is not set in `render.yaml`. |
| Unfinished games, tables, table chat, presence, voice state | Server memory | **No.** These are lost on every restart or deploy. Documented for players in `docs/OPERATIONS_RUNBOOK.md`. |

## How a finished match is saved

1. When a game ends, the result is written to the spool file first, then saved to PostgreSQL in the background. If that spool write fails, the error is logged (`could not spool`) and the queue continues without a file for that result. The result is then only in memory until its database write succeeds, so a restart at that moment loses it.
2. The write is retried up to 5 times, with waits of 0.5, 1.5, 4, 10 and 20 seconds (about 36 seconds in total). The match key makes a repeated insert a no-op, so retries are safe. The 36 seconds are the length of the retry waits, not a minimum outage before anything is lost.
3. On `SIGTERM` (a deploy or restart) the server waits up to 15 seconds for pending writes to finish, and then stops. Render waits 30 seconds before killing the process. Writes still pending after 15 seconds are kept in the spool if it can be written.
4. Recovery is not only at the next start. The server replays the spool at startup and again every ten minutes (`server.js`), so a result whose retries ran out during an outage is retried without a restart. A record that fails for a permanent reason (bad data) is moved aside as `.failed` and is not retried forever.
5. When the queue gives up on a result, the server logs `[matches] NOT SAVED` and, if the original table is still open with the same match key, warns the players at that table. Neither warning is guaranteed: a changed table or an abrupt termination can prevent it.

## What happens when Render restarts during an active match

- **During the game:** the game is lost. Nothing is recorded for it. Players reconnect to a fresh server and must start a new table. This is the same for every game in progress.
- **Just after the game ends, database reachable:** the result is saved before the restart in almost all cases; the 15-second wait covers the normal path.
- **Just after the game ends, database unreachable for longer than the retries:** the result is in the spool, if the spool write succeeded. A restart on the same machine re-sends it at the next start or the next ten-minute replay. A redeploy onto a fresh instance loses it. If the spool write itself failed, the result is lost at any restart.
- **Replacement while a result is still pending:** an instance can be replaced before the retries finish, and the shutdown wait is only 15 seconds, so a result that is still pending can be lost in this case.

Whether Render restarts a service on the same machine or on a fresh one, for a plain restart and for a deploy, is **not verified** from the repository or the Render documentation available to this check. The owner can confirm this in Render's dashboard.

## Known risks and limitations

1. A finished result can be lost if it is still pending when the instance is replaced: the database is unreachable beyond the retries, or the shutdown wait ends first, or the spool write failed. Players are warned only in the conditional case in point 5 above; otherwise the loss is visible only in the log line.
2. The default spool is in the container's temporary directory. Its survival across a redeploy is not guaranteed.
3. Backups and point-in-time restore for the database are **not verified** (`docs/OPERATIONS_RUNBOOK.md`, "Neon backups"). If the database itself loses data, matches are lost with it.
4. Unfinished games are never recorded. Players may expect a restarted game to resume; it does not.
5. The app runs one instance, because live rooms are in memory (`docs/STAGE_20_6_BETA_READINESS.md`). A redeploy always interrupts active tables.
6. Match statistics depend on the saved rows; a lost result is missing from the history and the statistics, with no correction.

## Options

**A. Accept the current limitations for the limited beta.**
Committed results (those saved to PostgreSQL) are durable there. Results still pending are at risk only if the database stays unavailable past the retries and the periodic replay, or the spool write failed, *and* the instance is replaced before recovery. The beta cohort is small and invited, and the team can watch the logs. Conditions:
- Tell testers that a game in progress is not kept, and that a finished result is kept.
- Check the logs after every deploy for `[matches] NOT SAVED`, and follow the runbook section "Investigate lost or inconsistent match records".
- Do not treat match history as an official record in the beta terms.

**B. Block the beta until additional persistence work is complete.**
This means setting `MATCH_SPOOL_DIR` on a persistent disk, or moving the pending-result queue into the database. Both are new persistence work, and the disk option depends on the Render plan, which is not verified.

## Recommendation

**Option A, with the conditions above.** The risk is real but narrow. It covers only finished results that are still pending when the instance is replaced, and it does not affect ongoing play, which is already lost on any restart. The cost of option B (new persistence work and a possible paid disk) is not justified for a small invited beta, and that work would itself need testing. Revisit before a public launch, and as soon as either of these is verified: the Render plan offers a persistent disk, or match loss is seen in the logs.

**Decision needed from the owner:** A or B. Until a decision is recorded, the beta gate in `docs/STAGE_20_6_BETA_READINESS.md` ("Match-result spool durability limitation") stays open.
