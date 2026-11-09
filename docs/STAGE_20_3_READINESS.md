# Stage 20.3 readiness

Status: **technical work complete except the items under "Remaining manual tests" and the approvals under "Outstanding risks and approvals"**. Nothing in this document has been executed against production: no branch created, no load test run, no static TURN credential removed, no cleanup enabled, no data changed.

## 1. Completed work and merged PRs

| PR | What | State |
|---|---|---|
| #72 | Metered TURN logins via Metered's REST API (server side, bounded retries, activation delay, ICE restart on a new login) | merged |
| #69 | Announcement stale-cache fix | merged |
| #72, #73, #74 | Stage 20.3 items (per owner's brief) | merged |
| #75 | Explicit TLS for Neon (`sslmode` handling in `db/poolConfig.js`), Actions `@v5`, dry-run record | merged (`ede0672`) |
| #70 | Bounded retry for the first database connectivity check at startup (Render "Cannot reach the database") | merged |
| #76 | Metered logins: 48-hour lifetime, replaced every 24 hours | open, for review |
| this PR | Stage 20.3 readiness record | open, for review |

## 2. Production verification evidence

- Health: production health verification complete (per owner).
- Cleanup dry run (owner's report, 2026-11-09): 0 unverified accounts older than 30 days; 0 records deleted; read-only transaction confirmed; read-only role has no write privileges; dry-run job contains no deletion SQL and no deletion secret. `CLEANUP_EXECUTE=false`. Recorded in `docs/DATA_CLEANUP.md`.

## 3. Metered support confirmation

Owner's written confirmation from Metered Support: REST-created TURN credentials are supported on the free plan; up to 10 active credentials; API-created credentials count toward the limit; they expire automatically; recommended 48-hour lifetime with a new credential every 24 hours; allow up to 2 minutes for activation; do not delete old credentials early; expiry is a hard cutoff that can end active calls; no paid upgrade needed.

Checked against Metered's public docs (`metered.ca/docs/turn-rest-api/post-create-credential` and `.../turnserver-guides/expiring-turn-credentials`):

- Endpoint and method match the code: `POST https://<app>.metered.live/api/v1/turn/credential`, `secretKey` as a query parameter, JSON body with `expiryInSeconds` and `label`. Response fields `username`, `password`, `expiryInSeconds` match what the code reads.
- Propagation: docs say "Allow up to 2 minutes for a new credential to propagate", which the code respects.
- The docs state no limit on active credentials and no maximum lifetime. The 10-credential limit and 48-hour guidance come only from the support email.

### Review of PR #72 against the guidance

| Requirement | Result |
|---|---|
| Credentials created server-side | Yes. Only the server calls Metered (`lib/meteredTurn.js`). |
| Secret never in clients or logs | Yes for logs and errors (only the failure kind is logged; tests check this). The secret travels in the request URL, as Metered's docs require. |
| Creation and refresh reliable | Bounded retries with back-off; 402/403/429 wait one hour; a failed refresh keeps the current login. |
| 48 h lifetime, 24 h rotation | **Was not implemented** (TTL capped at 24 h, default 1 h, rotation 10 min before expiry). Fixed in #76. |
| Old credential usable during overlap | Yes: the old login is not deleted; it expires naturally. |
| API failures do not issue expired or invalid credentials | Yes: a credential is never handed out before propagation or in its last minute. |
| New credentials not distributed before activation | Yes: `readyAt = issued + 2 min`; a timer and a poll both promote it. |
| Authenticated-user restrictions | **Not enforced.** The welcome message (`server.js`) sends ICE with Metered logins to any connected player, including guests. Push-on-change is limited to signed-in players. Open finding, see below. |
| 10-active-credential limit | Partly. With a 48 h lifetime and rotation every 24 h, about two credentials are active per running instance. Each restart or deploy adds one more until it expires, so repeated restarts within 48 h could approach the limit. Not tracked by the code. Open finding. |
| Existing calls not unnecessarily interrupted | Partly. Each new login is pushed to every signed-in player and relayed calls apply it with an ICE restart. With 24 h rotation this is about once a day per call, which is acceptable but still a restart. Open finding (could push only to players without a live relayed call). |

### Open findings (not fixed in this pass)

1. **Guests receive Metered logins** (`server.js`, `welcome` / `iceMsg`). Decide: restrict Metered logins to authenticated players, or accept that guests can use relay bandwidth. Needs owner decision.
2. **Static TURN pair is the fallback** when no Metered login is usable (`lib/voiceRelay.js` `iceServers`). This is intended until the cutover, and it must be removed in the cutover (below).
3. **Credential count is not tracked** across restarts. Low risk at one instance; monitor `turnStatus` and Metered's dashboard.
4. **Test dependency:** `tests/pool-config.test.js` (added on `main` in `e0b3f65`) requires `pg-connection-string`, which is not declared in `package.json`. It works in CI through npm hoisting. Recommend declaring it as a devDependency when a lockfile update is possible.

## 4. Static TURN credential cutover plan (NOT executed)

Do not start until the owner approves after real-device tests (section 7).

Preconditions (all must hold):
1. PR #76 merged and deployed; Render logs show `[turn]` lines with no `quota` or repeated `HTTP 4xx` for at least 48 hours.
2. `turnStatus` is `ready` in welcome messages for at least 95% of the observation window (check via browser diagnostics, section 6).
3. Real-device tests passed (section 7), including a relayed call on mobile data.
4. Owner has chosen a maintenance window (low player count).

Steps (for the approved window):
1. Record the current Render environment variable names (not values) and export nothing to the repository.
2. Set `TURN_USERNAME` and `TURN_CREDENTIAL` to empty on Render (or remove them). **Do not delete the static credential at Metered yet.**
3. Redeploy or restart; check welcome messages carry only Metered logins (`ice` list has one TURN entry with a login name and no static pair).
4. Watch for 60 minutes: call setup success, relayed candidate counts, `turnStatus` values, any `[turn]` failures.
5. Only after 24 hours of clean operation, the owner may disable the static credential at Metered.

Rollback (at any step):
1. Restore `TURN_USERNAME` and `TURN_CREDENTIAL` on Render from the owner's secret store.
2. Restart. Players reconnect and get the static pair again. No code change is needed.

Explicitly not part of the cutover: rotating `METERED_SECRET_KEY`, changing `TURN_URL`, changing `TURN_TTL_SECONDS`.

## 5. Cleanup workflow and SSL / Actions

- PostgreSQL SSL warning: resolved by #75 (`db/poolConfig.js`). Only `require`, `prefer`, `verify-ca` are rewritten to `verify-full`; other TLS settings are untouched. Test: `tests/pool-config.test.js`.
- GitHub Actions Node.js 20 notices: `actions/checkout` and `actions/setup-node` moved to `@v5` in `ci.yml` and `cleanup-unverified.yml` (#75). The runtime of `@v5` could not be read from the sandbox; confirm the runner notices are gone in the next run.
- Cleanup safeguards unchanged: `CLEANUP_EXECUTE=false`; the execute job needs its own approval; `--max` cap stays.

## 6. Browser diagnostics: relay candidates and ICE recovery

Use two browsers or devices, both signed in, both at the same table with voice on. Do not paste credentials anywhere; redact them in any screenshot.

**A. Confirm the relay is offered**
1. Open the page's DevTools → Network → WS. Find the `ice` message after the welcome. Check: `turnStatus` is `ready` (or `pending` in the first 2 minutes); the list has a TURN entry whose `urls` starts with `turn:` or `turns:`; after the cutover the list has no second TURN entry with a static username.
2. Chrome: open `chrome://webrtc-internals` before joining voice. After the call connects, expand the peer connection and find **Candidate pairs** with state `succeeded`/`selected`. The **local** and **remote** candidate types should be shown as `relay` for the forced-relay test below.

**B. Force a relayed call (test only)**
1. On one device, turn on a strict network: mobile data with a VPN or a restrictive Wi-Fi, or block UDP on the router for that device. This makes direct paths fail and forces the relay.
2. Join voice on both devices. In `webrtc-internals`, the selected pair should show a `relay` candidate on at least one side.
3. Speak; confirm audio both ways.

**C. ICE recovery**
1. With a relayed call up, switch the test device's network: Wi-Fi off for 5 seconds, then back on (or toggle airplane mode for 5 seconds).
2. In `webrtc-internals`, the connection state should go to `disconnected` and return to `connected` within about 30 seconds. An ICE restart shows as a new negotiation (new `local-offer` in the stats timeline).
3. If it stays `failed`, record the time, the network type and a copy of the `webrtc-internals` dump (Download the dump, check it contains no credential before sharing).

**D. Credential rotation**
1. Note the `iceExpiresAt` value from the `ice` message. Around the time it is reached minus 10 minutes, the server pushes a new `ice` message; audio should not drop.

## 7. Real-device tests required before the cutover

1. iPhone Safari on mobile data, relayed call with a second device on Wi-Fi.
2. Android Chrome on mobile data, same.
3. Desktop Chrome and Firefox on a restrictive network (a corporate or hotel Wi-Fi if available).
4. A call that stays open across one ICE restart (section 6 C) with audio continuing.
5. A call older than one rotation (24 h) is impractical to wait for: instead, confirm the scheduled push in staging or by setting `TURN_TTL_SECONDS` to 300 in a non-production service, which is test-only and needs owner approval.

## 8. Neon load-test plan (NOT created, NOT run)

Owner approval required before any step.

**Isolation proof**
- The test uses a new Neon branch, created from a parent branch that has no user data (schema migrations only). Record the branch ID before and after creation.
- The test connection string is supplied only to the load generator, not to Render or any `.env` file. The script aborts if the host equals the production host (the host name is compared, the value is never printed).
- Before the run: `SELECT current_database(), inet_server_addr()` and a check that `pg_stat_activity` shows only the test client.

**Synthetic data only**
- A seed script inserts fake players (names like `loadtest_0001`), fake matches and chat rows. No real e-mail addresses, no real names.

**Concurrency and workload**
- Levels: 10, 25, 50 concurrent connections, each for 5 minutes, then 100 for 5 minutes as the upper bound.
- Mix: 70% reads (lobby listing, match history), 25% writes (match record insert), 5% admin-style queries.
- Pool settings under test: the production pool values (`max: 10` per process, `statement_timeout: 10000`, `connectionTimeoutMillis: 5000`).

**Metrics and success criteria**
- p50, p95, p99 latency per query type; target p95 below 300 ms for reads and below 500 ms for writes.
- Error rate below 0.5%; no `statement timeout` at the lower levels.
- Connection-acquire wait below 100 ms at p95.
- Neon compute: scales as configured, no sustained time at maximum compute.

**Estimated usage and cost**
- Duration: about 30 minutes of compute in total.
- Cost: Neon bills compute time and storage. Check the current price for the plan in Neon's console before approval; this document does not state a price, to avoid quoting a figure that may be out of date.

**Stop conditions** (any one stops the test and deletes the branch)
- Error rate above 2% for 2 minutes.
- p95 above 2 seconds for 2 minutes.
- Compute reaches its configured maximum for more than 5 minutes.
- Any connection reaches the production host.
- Any write outside the synthetic tables.

**Teardown**
1. Stop the load generator; confirm no open connections to the test branch.
2. Delete the test branch in Neon's console (not from the production branch).
3. Confirm the branch is gone and no test credential remains in any environment variable or file.
4. Record the results (counts and percentiles only) in this document.

## 9. Local PostgreSQL and migration tests on Windows (PowerShell)

Requirements: Node 22, a local PostgreSQL server (version 14 or later) you can create databases on, and no production URL anywhere in these commands.

```powershell
# 1. From the repository folder
cd C:\path\to\tableverse
npm ci

# 2. Point the tests at your LOCAL server only (never a Neon or Render URL).
#    Replace user, password and port. The test creates and drops its own databases.
$env:TEST_DATABASE_URL = "postgres://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/postgres"

# 3. Make sure DATABASE_URL is NOT set in this window (the tests never use it)
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

# 4. Run the in-memory suite first (no database needed)
npm test

# 5. Run the PostgreSQL suites; they fail instead of skipping when TEST_DATABASE_URL is missing
npm run test:pg

# 6. Migration check against a local, throw-away database only
$env:DATABASE_URL = "postgres://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/tableverse_migrate_check"
npm run migrate
npm run migrate   # second run must report nothing to apply
Remove-Item Env:DATABASE_URL
```

Notes:
- The local-server helper `scripts/pg-local-test.sh` is for macOS or Linux; on Windows use the commands above.
- If `npm run test:pg` reports a connection error, check the port, the password and that the PostgreSQL service is running (`Get-Service postgresql*`).

## 10. Remaining manual tests

1. Real-device relay tests (section 7), including iPhone and Android on mobile data.
2. Browser diagnostics A–D (section 6) on two devices.
3. Render: confirm `TURN_TTL_SECONDS` is unset or set to a value no lower than 172800 after #76 (a value of 3600 keeps the old hourly rotation).
4. Neon: confirm the production pooled endpoint is in use (the URL contains `-pooler`) and `sslmode=require` is still set (no change needed).
5. Render: one restart of the production service after #76 is merged; check `[turn]` log lines show no failures.
6. Actions: confirm the next CI run shows no Node.js 20 deprecation notice.

## 11. Outstanding risks and approvals

| Item | Risk | Approval needed |
|---|---|---|
| Guests get Metered logins | Relay bandwidth use by anonymous users | Owner decision: restrict or accept |
| Static TURN fallback still present | Static credential visible to all visitors until cutover | Cutover approval after section 7 |
| Credential count across restarts | Could exceed 10 with frequent restarts | Monitor; no approval needed |
| Re-key on rotation restarts relayed calls | Brief audio interruption once a day per call | Accept or change |
| `pg-connection-string` not declared | Test may break if transitive layout changes | Maintenance change when registry access is available |
| Cleanup execution | Deletes accounts | Separate approval; `CLEANUP_EXECUTE` stays `false` |
| Load test on Neon branch | Cost and compute use | Owner approves plan in section 8 |
| Stage 20.6 | Not started | Owner decision |

## 12. Stage 20.3 PASS/FAIL checklist

| # | Check | Status |
|---|---|---|
| 1 | Admin console, analytics, announcements, audit log merged | PASS (per merged PRs) |
| 2 | Production health verification | PASS (owner) |
| 3 | Startup no longer fails on a first-connection timeout | PASS (#70 merged; deployment check pending) |
| 4 | Metered TURN follows the 48 h / 24 h guidance | PASS once #76 is merged (pending review) |
| 5 | Metered secret never logged or sent to clients | PASS (code review and tests) |
| 6 | Authenticated-only Metered logins | FAIL (open: guests receive logins) |
| 7 | 10-credential limit handled across restarts | PARTIAL (monitor) |
| 8 | Static TURN credentials removed | NOT DONE (by design; awaiting approval) |
| 9 | Real-device relay and ICE recovery tests | PENDING (manual) |
| 10 | Cleanup dry run recorded; execute disabled | PASS |
| 11 | SSL warning removed; secure TLS kept | PASS (#75; confirm in CI logs) |
| 12 | Actions off Node.js 20 notices | PASS in code (#75); confirm in next run |
| 13 | Neon load test plan | DRAFTED (not run; approval needed) |
| 14 | Final security audit of main | NOT COMPLETE (see section 13) |

## 13. Security audit: status

Not completed in this pass. Findings so far: item 1 and item 3 in section 3 (guest TURN logins, credential counting). The full audit (authentication, sessions, blocked-user privacy across directory, chat, voice, friends, invitations and seats, admin authorization, rate limits, database access, WebSocket reconnect handling, voice authorization, cleanup workflow permissions) remains to be done as a separate task, with findings reported by severity and fixed in small PRs.
