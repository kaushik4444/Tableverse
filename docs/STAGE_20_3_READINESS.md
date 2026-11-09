# Stage 20.3 readiness

Status: **Stage 20.3 is PASS.** The owner's block rule is merged to `main` as PR #85 (`0207b31`, squash; CI green before merge). PR #81 (`d7da199`, five CI checks green) had introduced the opposite seating rule; PR #82 is superseded and was not merged. On 2026-11-10 the owner decided the three open block questions: chat is one way, a host may keep a blocked guest at the host's own table, and the 'Blocked' profile label stays as it is. M2 (fixed sleeps in PostgreSQL tests) is a non-security test-robustness follow-up, accepted as open. The rest of this status text describes what is verified and what is not.

## 1. Completed work and merged PRs

"Code merged" means merged to `main` with CI passing. "Production verified" means someone observed the behaviour in production; only the owner's own reports count, and they are marked as such.

| PR | What | Code merged | Production verified |
|---|---|---|---|
| #66 | Stage 20.5 admin console, analytics, announcements, roles, audit log | yes | not separately recorded |
| #70 | Bounded retry for the first database connectivity check at startup (Neon wake-up) | yes (`10:35 UTC`) | owner health check reported; this behaviour not separately verified |
| #71 | Announcement date fields are selectable | yes (`11:25 UTC`) | not separately verified |
| #72 | Metered REST logins: server side, bounded retries, activation delay, ICE restart on a new login | yes (`12:20 UTC`) | not verified (no Metered login observed by this review) |
| #73 | A block hides the public profile in both directions | yes (`12:28 UTC`) | not verified |
| #74 | Cleanup: read-only dry run, approval-gated deletion, admins and owners excluded | yes (`14:54 UTC`) | dry run reported by the owner (section 2) |
| #75 | Explicit TLS for Neon (`db/poolConfig.js`), Actions `@v5`, dry-run record | yes (`ede0672`) | Actions notice removal: confirm in the next run |
| #76 | Metered logins: 48-hour lifetime, replaced every 24 hours; 15-minute minimum requested lifetime; rotation handover fix | yes (`f7ba6fc`) | not verified (no deployed login observed) |
| #77 | This readiness record | yes (`0306f7c`) | not applicable |

Other merged work relevant to Stage 20.3: `#69` (announcement stale-cache fix).

## 2. Production verification evidence

- Health: production health verification complete (per owner).
- Voice relay evidence (owner-provided WebRTC-Internals dump, 2026-11-09): ICE and DTLS reached `connected`; the selected/nominated candidate pair `CPrBAH9UFb_VDR1Vs2V` is `succeeded`; its local candidate `IrBAH9UFb` is `candidateType=relay` with `relayProtocol=udp`; remote candidate is peer-reflexive. The pair recorded 311,875 bytes sent, 202,044 received, 2,887 packets sent and 2,794 received. This confirms actual TURN relay use for this call. The ICE server URL was `turn:global.relay.metered.ca:80`, but the dump supplied no `turnStatus`, `iceExpiresAt`, or credential-source evidence, so dynamic Metered REST credential use is not confirmed. Network recovery and in-place credential-rotation ICE restart were not tested in the supplied evidence.
- Dynamic Metered credential status (owner-provided WebSocket `welcome` payload and Render log excerpts, 2026-11-09): `turnStatus: unavailable`, `iceExpiresAt: null`; Render logged `[turn] Metered credential request failed (HTTP 401)`. The app is not currently obtaining a usable dynamic Metered credential; the existing static fallback remains configured. This is explicitly carried forward as a Stage 20.6 voice-enabled beta gate. Do not remove or rotate the static fallback during this work.

- Scheduled run history: the scheduled run at 11:36 UTC on 2026-11-09 failed at the step "Check the database secret is set", because `CLEANUP_DATABASE_URL` was not yet configured. Nothing ran against the database. The owner has since set the secret and variable; Claude has not triggered or inspected any run.
- Cleanup dry run (owner's report, 2026-11-09; not re-run by Claude): 0 unverified accounts older than 30 days; 0 records deleted; read-only transaction confirmed; read-only role has no write privileges; dry-run job contains no deletion SQL and no deletion secret. `CLEANUP_EXECUTE=false`. Recorded in `docs/DATA_CLEANUP.md`.

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
| 48 h lifetime, 24 h rotation | **Was not implemented** (TTL capped at 24 h, default 1 h, rotation 10 min before expiry). Implemented in #76 (merged `f7ba6fc`); production verification pending. |
| Old credential usable during overlap | Yes: the old login is not deleted; it expires naturally. |
| API failures do not issue expired or invalid credentials | Yes: a credential is never handed out before propagation or in its last minute. |
| New credentials not distributed before activation | Yes: `readyAt = issued + 2 min`; a timer and a poll both promote it. |
| Authenticated-user restrictions | **Partly enforced.** A socket with no session cookie is refused before `welcome` (`handleHello` in `server.js`), so logged-out visitors get no TURN settings. Anonymous (guest) players who hold a session do get Metered logins, and so do signed-in players. Open finding, see below. |
| 10-active-credential limit | Partly. With a 48 h lifetime and rotation every 24 h, about two credentials are active per running instance. Each restart or deploy adds one more until it expires, so repeated restarts within 48 h could approach the limit. Not tracked by the code. Open finding. |
| Existing calls not unnecessarily interrupted | Partly. Each new login is pushed to every signed-in player and relayed calls apply it with an ICE restart. With 24 h rotation this is about once a day per call, which is acceptable but still a restart. Open finding (could push only to players without a live relayed call). |

### Open findings (not fixed in this pass)

1. **Guest players receive Metered logins — accepted.** The owner approved this for the initial beta. Monitor Metered's 500 MB monthly allowance and active-credential count. Logged-out sockets are still refused before `welcome`.
2. **Static TURN pair is the fallback** when no Metered login is usable (`lib/voiceRelay.js` `iceServers`). This is intended until the cutover, and it must be removed in the cutover (below).
3. **Credential count is not tracked** across restarts. Low risk at one instance; monitor `turnStatus` and Metered's dashboard.
4. **Test dependency:** `tests/pool-config.test.js` (added on `main` in `e0b3f65`) requires `pg-connection-string`, which is not declared in `package.json`. It works in CI through npm hoisting. Recommend declaring it as a devDependency when a lockfile update is possible.

## 4. Optional static TURN credential cutover plan (NOT executed)

Static TURN cutover is optional for the limited beta. Retaining the approved static fallback does not block beta readiness. Do not start a cutover until the owner approves after real-device tests (section 7).

Preconditions (all must hold):
1. PR #76 is merged (done, `f7ba6fc`) and deployed (not verified); Render logs show no `[turn]` failure lines (`quota`, `HTTP 4xx`, `network error`, `timeout`, `bad answer`) for at least 48 hours. Healthy requests write no `[turn]` line, so the absence of failure lines is the signal, and precondition 2 confirms that logins are being issued.
2. `turnStatus` is `ready` in welcome messages for at least 95% of the observation window (check via browser diagnostics, section 6).
3. Real-device tests passed (section 7), including a relayed call on mobile data.
4. `ICE_SERVERS` is unset on Render. It overrides Metered when set, and then `iceExpiresAt` is null and the list is static.
5. Owner has chosen a maintenance window (low player count).

Steps (for the approved window):
1. Record the current Render environment variable names (not values) and export nothing to the repository.
2. Set `TURN_USERNAME` and `TURN_CREDENTIAL` to empty on Render (or remove them). **Do not delete the static credential at Metered yet.**
3. Redeploy or restart; check welcome messages carry only Metered logins (`ice` list has one TURN entry with a login name and no static pair).
   **Known gap:** after the static pair is removed, every restart leaves about two minutes (the Metered propagation time) with no TURN settings (`turnStatus` `pending`). Calls that start in that window can only connect directly. Expect it after each restart and record it. No `TURN_SHARED_SECRET` fallback is configured, so there is no other relay during that window.
4. Watch for 60 minutes: call setup success, relayed candidate counts, `turnStatus` values, any `[turn]` failures.
5. Only after 24 hours of clean operation, the owner may disable the static credential at Metered.

Rollback (at any step):
1. Turn Metered off on Render: remove `METERED_APP_NAME` and `METERED_SECRET_KEY`. The server uses Metered only when both are set (`fromEnv` in `lib/meteredTurn.js`). Keep `TURN_URL`.
2. Restore `TURN_USERNAME` and `TURN_CREDENTIAL` from the owner's secret store. `lib/voiceRelay.js` prefers a usable Metered login, so the static pair is offered only once Metered is off.
3. If the static credential was already disabled at Metered (step 5), create a new static credential at Metered first (owner action) and use it in step 2. A disabled credential cannot be restored.
4. Restart. Players reconnect and get the static pair again. No code change is needed. Welcome messages should show `turnStatus` `static`.

Explicitly not part of the cutover: rotating `METERED_SECRET_KEY`, changing `TURN_URL`, changing `TURN_TTL_SECONDS`.

## 5. Cleanup workflow and SSL / Actions

- PostgreSQL SSL warning: resolved by #75 (`db/poolConfig.js`). Only `require`, `prefer`, `verify-ca` are rewritten to `verify-full`; other TLS settings are untouched. Test: `tests/pool-config.test.js`.
- GitHub Actions Node.js 20 notices: `actions/checkout` and `actions/setup-node` moved to `@v5` in `ci.yml` and `cleanup-unverified.yml` (#75). The runtime of `@v5` could not be read from the sandbox; confirm the runner notices are gone in the next run.
- Cleanup safeguards unchanged: `CLEANUP_EXECUTE=false`; the execute job needs its own approval; `--max` cap stays.

## 6. Browser diagnostics: relay candidates and ICE recovery

Use two browsers or devices, both signed in, both at the same table with voice on. Do not paste credentials anywhere; redact them in any screenshot.

**A. Confirm the relay is offered**
1. Open the page's DevTools → Network → WS. Read the initial ICE settings from the `welcome` message (a healthy connection does not get an `ice` message right after it; later `ice` messages come only on a credential or status change). Expected during the first two minutes after a start: `turnStatus` is `pending`, the list has the static fallback, and `iceExpiresAt` is null. That is not a failure. Wait for the next `ice` message (sent when the new login becomes usable) or reconnect after two minutes. Then check: `turnStatus` is `ready`; the list has a TURN entry whose `urls` starts with `turn:` or `turns:`; `iceExpiresAt` is a time, not null (null means a static list). After the cutover the list has no second TURN entry with a static username.
2. Chrome: open `chrome://webrtc-internals` before joining voice. After the call connects, expand the peer connection and find **Candidate pairs** with state `succeeded`/`selected`. For the forced-relay test below, at least one of the **local** and **remote** candidates of the selected pair must be `relay`. The other side may be `host` or `srflx`, and that is still a relayed call.

**B. Force a relayed call (test only)**
1. Relay is not forced by a VPN or a restrictive network: direct candidates can still work. A network that blocks UDP forces relay only if TURN is reachable over TCP or TLS (for example `turns:` on port 443). Use such a network, or a test-only build with `iceTransportPolicy: 'relay'`, which is not in the code today. Whatever the network, confirm the result in `webrtc-internals` (step 2). A selected pair with only `host` or `srflx` candidates is not a relayed call; repeat the test.
2. Join voice on both devices. In `webrtc-internals`, the selected pair should show a `relay` candidate on at least one side.
3. Speak; confirm audio both ways.

**C. ICE recovery**
1. With a relayed call up, switch the test device's network: Wi-Fi off for 5 seconds, then back on (or toggle airplane mode for 5 seconds).
2. In `webrtc-internals`, the connection state should go to `disconnected` and return to `connected` within about 30 seconds. This tests network recovery only. A network drop closes and recreates the peer connection, so it does not exercise the in-place ICE restart. Record a new peer connection as a recreation.
3. The in-place ICE restart path (`createOffer({ iceRestart: true })`) runs when a connected relayed call receives changed ICE credentials. Test it with the credential push in section D: the same peer connection stays, and the local `a=ice-ufrag` changes.
4. If it stays `failed`, record the time, the network type and a copy of the `webrtc-internals` dump (Download the dump, check it contains no credential before sharing).

**D. Credential rotation**
1. Each Metered login lasts 48 hours. A replacement is requested 24 hours after the login was issued, and it is pushed to connected players when it becomes usable (about two minutes later). Note the `iceExpiresAt` value in the `ice` message. A new `ice` message with a later `iceExpiresAt` should arrive about 24 hours after the first one.
2. Audio should not drop at the push. A relayed call re-keys in place (see C). A short interruption once a day per call is an accepted risk (section 11); record any drop with its time.

## 7. Real-device tests required before the cutover

Before creating fresh voice connections for these tests, confirm both devices receive `turnStatus: ready` and a non-null `iceExpiresAt`, so the test uses propagated Metered credentials rather than the static fallback.

1. iPhone Safari on mobile data, relayed call with a second device on Wi-Fi.
2. Android Chrome on mobile data, same.
3. Desktop Chrome and Firefox on a restrictive network (a corporate or hotel Wi-Fi if available).
4. A relayed call that stays open across a credential push (section 6 D), which runs an in-place ICE restart (same peer connection, changed `a=ice-ufrag`), with audio continuing. Waiting 24 hours is impractical, so use a non-production service with `TURN_TTL_SECONDS=900`, where a push happens about every 10 minutes. This needs owner approval.
5. A call older than one rotation (24 h) is impractical to wait for: instead, confirm the scheduled push in staging or by setting `TURN_TTL_SECONDS` to 900 (the shortest allowed) in a non-production service, which is test-only and needs owner approval.
6. On the relayed call, verify network recovery as described in section 6 C.

## 8. Neon load-test plan (NOT created, NOT run)

Owner approval required before any step.

**Isolation proof**
- The test uses a new Neon branch, created from a parent branch that has no user data (schema migrations only). Record the branch ID before and after creation.
- The test connection string is supplied only to the load generator, not to Render or any `.env` file. The script aborts unless the host it connects to is one of the endpoints returned by Neon for the new test branch (recorded when the branch is created). It also aborts if the host matches any production endpoint, pooled or direct. Only the branch ID is printed; no host or connection string is printed.
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

Requirements: Node 22, a local PostgreSQL server (version 14 or later), and `psql` on the PATH (it ships with PostgreSQL, usually in `C:\Program Files\PostgreSQL\16\bin`). No production URL anywhere in these commands.

**Important:** the full `npm test` and `npm run test:pg` suites include `tests/db-backup.test.js`, which runs POSIX shell fixtures (`#!/bin/sh`, `stat -c`). Those fixtures do not run under native Windows Node. Run the full suites in WSL2 (section 9b). The PowerShell steps below run everything else, and the migration check.

```powershell
# 1. From the repository folder
cd C:\path\to\tableverse
npm ci

# 2. Point the tests at your LOCAL server only (never a Neon or Render URL).
#    Replace the password and port. The tests create and drop their own databases.
$env:TEST_DATABASE_URL = "postgres://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/postgres"

# 3. Make sure DATABASE_URL is NOT set in this window (the tests never use it)
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

# 4. The PostgreSQL-free tests (no database needed). On native Windows this stops at tests/db-backup.test.js:
#    run the individual files listed in package.json, skipping db-backup.test.js, or use WSL2 (section 9b).

# 5. Do not run `npm run test:pg` on native Windows. It chains every suite with &&, so it stops at the
#    db-backup fixtures and nothing after them runs. Use WSL2 (section 9b) for the PostgreSQL suites.

# 6. Migration check against a throw-away local database only.
#    The migration does not create the database, so create it first.
$env:PGPASSWORD = "YOUR_LOCAL_PASSWORD"
psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE tableverse_migrate_check"
$env:DATABASE_URL = "postgres://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/tableverse_migrate_check"
npm run migrate
npm run migrate   # second run must report nothing to apply
Remove-Item Env:DATABASE_URL

# 7. Remove the throw-away database and the password variable
psql -h localhost -p 5432 -U postgres -c "DROP DATABASE tableverse_migrate_check"
Remove-Item Env:PGPASSWORD
```

**9b. Full suites under WSL2 (Ubuntu)**
```bash
# In an Ubuntu terminal (WSL2), from the repository folder (a copy inside the Linux file system is faster)
sudo apt-get install -y postgresql nodejs npm   # or use nvm for Node 22
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'YOUR_LOCAL_PASSWORD'"
npm ci
export TEST_DATABASE_URL="postgres://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/postgres"
unset DATABASE_URL
npm test && npm run test:pg
```

Notes:
- The local-server helper `scripts/pg-local-test.sh` is for macOS or Linux (and WSL2).
- If `npm run test:pg` reports a connection error, check the port, the password and that the PostgreSQL service is running (`Get-Service postgresql*` on Windows, `sudo service postgresql status` in WSL2).
- These steps are documented but not yet run on a Windows machine. Record the result of the first run in this document.

## 10. Remaining manual tests (NOT RUN)

1. Cross-network phone voice connectivity: **owner-tested successfully between two people, one on Wi-Fi and one on mobile data**. Audio connectivity and TURN relay use passed; the supplied WebRTC stats confirm a selected `relay` candidate.
2. Browser WebRTC diagnostics confirmed that the successful call selected a `relay` candidate. The latest `welcome` payload reports `turnStatus: unavailable` and `iceExpiresAt: null`; Render logs report Metered HTTP 401. Dynamic credential authentication is deferred to Stage 20.6.
3. Windows and WSL2 runs are **deferred** for the limited beta; do not treat them as release blockers.
4. Render: confirm `TURN_TTL_SECONDS` is unset (default 48 hours). Any value is limited to 15 minutes to 48 hours. **Not verified.**
5. Neon: confirm the production pooled endpoint is in use and `sslmode=require` is set. **Not verified by Claude.**
6. Render: observe Metered credential status and `[turn]` failures over at least 48 hours before any static TURN cutover. **Not yet recorded.**
7. Actions: confirm the next CI run shows no Node.js 20 deprecation notice. **Not confirmed.**

## 11. Outstanding risks and approvals

| Item | Risk | Approval needed |
|---|---|---|
| Guest players get Metered logins | Relay bandwidth used by anonymous players with a session. | Owner approved for initial beta; monitor usage |
| Static TURN fallback present | Static credential is sent to every admitted session until cutover | Cutover approval after section 7 |
| Two-minute TURN gap after each restart once static is removed | Calls starting in that window can only connect directly | Owner: accept or change |
| Credential count across restarts | Could exceed 10 with frequent restarts | Monitor; no approval needed |
| Re-key on rotation restarts relayed calls | Brief audio interruption about once a day per call | Accept or change |
| Blocked players may share a table (seating) | Chat/voice/profile filtering did not cover table entry or seating | Owner approved all-surface blocking; PR #81 merged (`d7da199`, CI green). Review found a high-severity reconnect defect, fixed in open PR #82 |
| `pg-connection-string` not declared | Test may break if transitive layout changes | Maintenance change when a lockfile update is possible |
| Windows and WSL2 suites not run | Native Windows/WSL2 support is unverified | Deferred for limited beta |
| Cleanup execution | Deletes accounts | Separate approval; `CLEANUP_EXECUTE` stays `false` |
| Neon load test | Scale limits not measured | Deferred until usage justifies it |
| Stage 20.6 | Preparation underway in PR #79 | Owner approved proceeding with limited-beta preparation |

## 12. Stage 20.3 PASS/FAIL checklist

"Code" is what CI and review show on `main`. "Production" is only what someone observed in production.

| # | Check | Code | Production | Result |
|---|---|---|---|---|
| 1 | Admin console, analytics, announcements, audit log | merged, CI green | not separately recorded | CODE PASS |
| 2 | Production health verification | n/a | owner report | PASS (owner-reported) |
| 3 | Startup survives a slow first database connection | merged (#70) | not separately verified | CODE PASS |
| 4 | Metered TURN follows 48 h / 24 h guidance | merged (#72, #76), CI green | not verified | CODE PASS, PRODUCTION NOT VERIFIED |
| 5 | Metered secret never logged or sent to clients | tests and review | log check not done | CODE PASS, PRODUCTION NOT VERIFIED |
| 6 | Metered logins for session-authenticated players, including guests | implemented | owner policy approved; production issuance not yet observed | POLICY PASS, PRODUCTION NOT VERIFIED |
| 7 | 10-credential limit handled across restarts | not tracked | n/a | PARTIAL |
| 8 | Optional static TURN cutover | not done (by design) | n/a | DEFERRED (not a limited-beta blocker) |
| 9 | Cross-network voice connectivity | n/a | owner-tested Wi-Fi ↔ mobile; audio worked; selected relay candidate confirmed | CONNECTIVITY PASS, RELAY PASS |
| 10 | Cleanup dry run recorded; execute disabled | merged (#74, #75) | owner-reported dry run; `CLEANUP_EXECUTE=false` | PASS (owner-reported) |
| 11 | SSL warning removed; secure TLS kept | merged (#75) | CI log confirmation pending | CODE PASS |
| 12 | Actions off Node.js 20 notices | merged (#75) | next run not checked | CODE PASS, CONFIRMATION PENDING |
| 13 | Blocked-user privacy in profiles | merged (#73) | not verified | CODE PASS (public profile only) |
| 14 | Blocked-user rule on seating and other surfaces | PR #85 merged (`0207b31`, CI green before merge); PR #81 superseded by it; PR #82 superseded | not production verified | PASS (code) |
| 15 | Windows and WSL2 PostgreSQL and migration runs | deferred | not run | DEFERRED (not a limited-beta blocker) |
| 16 | Neon load-test plan | deferred for limited beta | not executed | DEFERRED |
| 17 | Focused security review of #81 and main | review of #81 recorded; H1 and M1 void under #85; M2 open and accepted as a follow-up; M3 decided by the owner | n/a | PASS (review recorded) |

**Stage 20.3 overall: PASS.** PR #85 is merged (`0207b31`). Production items that need a live check remain listed in section 12 (`not production verified`).

## 13. Focused security review: status

**Reviewed.** The focused review of PR #81

- **Admin/owner authorization:** `lib/adminRoutes.js` requires a current session and reads the role from PostgreSQL on every admin request. State-changing store methods re-check staff authority under transaction locks and write the audit row in the same transaction. Role changes lock actor and target and pass through `adminPolicy`.
- **Sessions and WebSockets:** `db/auth.js` stores SHA-256 token hashes, checks expiry and revocation on reads, and revokes prior sessions when issuing a new single-active session. `server.js` re-checks open socket sessions every 60 seconds and refuses an invalid/revoked session.
- **Cleanup permissions:** the daily workflow uses a separate read-only database role for its dry run. Deletion requires a manual workflow dispatch, the explicit `execute` input, `CLEANUP_EXECUTE=true`, and approval in the protected `production-cleanup` environment. The owner reports the current dry run found zero candidates and deleted zero rows; `CLEANUP_EXECUTE=false` remains in force.
- **TURN secret handling:** `lib/meteredTurn.js` sends the secret only to Metered, never logs the request URL or secret, and logs only a failure category. Dynamic API authentication currently fails with HTTP 401; this is explicitly deferred to Stage 20.6, and static fallback remains configured.
- **Blocked-user privacy:** public profile hiding (#73) and chat/voice filtering are implemented. The table-entry/seating gap was found in this review; PR #81 implements the owner's all-surface rule (merged, see 13.1).
- **Credential count:** active Metered credentials are not tracked across restarts; monitor the provider dashboard and usage. This is a known low-risk operational limitation for a single instance.

The review of #81 is recorded in 13.1. The broader audit of email verification, rate limiting, WebSocket reconnect edge cases, database permissions and pooling remains outside this limited-beta review and is not represented as complete.

### 13.1 Focused review of PR #81 (merged to `main` as `d7da199`)

**Result: PASS.** PR #85 is merged. The owner decided M3 on 2026-11-10 and accepted M2 as a follow-up.

Reviewed: the reconnect (hello) guard; pending and committed block writes; the block command's failure path; the removal of blocked seats when a game finishes and when a block is committed; rejoin rules for players who left a running game; the running-game exception; reciprocal blocks; spectator removal; and the table directory.

| ID | Severity | Finding | Status and evidence |
|---|---|---|---|
| H1 | High (void under #85) | A reconnect decided denial with pending blocks but removal with committed blocks. Under the owner's rule (PR #85) a block never removes anyone, and the reconnect block branch is removed, so the defect does not exist on #85. PR #82 is superseded; close it unmerged. |
| M1 | Medium (void under #85) | A spectator who blocks a seated player stayed until the game ended. Under #85 a block never removes anyone from a table (`docs/CHAT_MODERATION.md`). The spectator test is rewritten to match (`tests/private-table-access.pg.test.js`). |
| M2 | Medium | PostgreSQL moderation and voice-block tests wait with fixed sleeps, which can be slow or flaky under load. | Open. Not changed. Watch CI for intermittent failures. |
| M3 | Decided 2026-11-10 | (a) Chat is one way: the blocker stops seeing the blocked player's table chat; voice is two ways. The Settings text and the notice now say so. (b) A host may keep a blocked guest at the host's own table; documented in `docs/CHAT_MODERATION.md`. (c) The 'Blocked' label on a profile stays as it is, shown to both sides. | Closed. |
| M2 | Medium | PostgreSQL moderation and voice-block tests wait with fixed sleeps, which can be slow or flaky under load. | Open. Not changed. Watch CI for intermittent failures. |

Checked by reading the code (not observed in production):
- A pending block never removes a seat. The block command's failure path releases the reservation; removals use committed blocks only.
- Finishing a game removes a blocked seat only on a committed block.
- A player who explicitly left a running game cannot rejoin while the pair would share the table.
- A seated player in a running game keeps the seat when a blocker or blocked player is involved, until the game ends (the running-game exception).
- The table directory hides tables shared with a blocked player.

Test evidence:
- CI on `d7da199`: Build and test (Node 20), Build and test (Node 22), Browser layout and interaction checks, Production dependency audit and Build production Docker image all passed.
- On the #85 branch (merged as `0207b31`)

Stage 20.3 is marked PASS for this review item: PR #85 is merged, M2 is accepted as a follow-up and the M3 questions are decided.
