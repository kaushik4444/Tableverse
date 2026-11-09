# Stage 20.6 — lean public-beta readiness

Status: **PREPARATION ONLY — not approved for public launch.**

This checklist deliberately separates release-critical verification from optional platform coverage and scale testing. It is intended to close the remaining Stage 20.3 gaps without expanding the project unnecessarily.

## Decisions recorded

- Anonymous guest players **may receive Metered TURN logins** during the initial beta. Monitor the Metered 500 MB monthly allowance and active-credential count.
- Metered's recommended policy is implemented in merged PR #76: 48-hour credential lifetime, replacement every 24 hours, allow up to two minutes for propagation, and let old credentials expire naturally.
- Static TURN credentials remain configured until the owner explicitly approves cutover.
- Cleanup remains disabled: `CLEANUP_EXECUTE=false`. The production dry-run reported zero eligible accounts and zero deletions.
- No Windows or WSL2 test run has been performed.
- Owner tested a two-person call across Wi-Fi and mobile data; two-way voice connectivity worked. The selected ICE candidate pair was not recorded, so Metered relay use is not yet proven.
- No Neon load test has been performed; it is deferred for the initial friend/limited beta.

## Minimum Stage 20.3 closure

### Required before declaring voice verification complete

1. Confirm the current Render deployment contains PRs #72 and #76.
2. Confirm `METERED_APP_NAME`, `METERED_SECRET_KEY`, and `TURN_URL` are configured; confirm `ICE_SERVERS` is unset and `TURN_TTL_SECONDS` is unset (48-hour default).
3. Owner has completed a two-person phone call across Wi-Fi and mobile data; two-way audio worked.
4. If practical, inspect the selected WebRTC candidate pair to determine whether a `relay` candidate was used. The current connectivity pass does not by itself prove Metered relay usage.
5. Keep static fallback configured. Do not repeat broad device/browser tests for this limited beta.
6. Inspect Render logs for `[turn]` failures and Metered usage as part of the normal observation before any static cutover.

Do not attempt to force relay by merely enabling a VPN. If the network does not force relay, use browser WebRTC diagnostics to verify the selected candidate pair; record a direct connection as inconclusive for relay verification.

### Required before static TURN cutover

- The real-device relay and reconnect test passes.
- Render shows no Metered credential failures during at least 48 hours of observation.
- `turnStatus: ready` is observed after credential propagation.
- `ICE_SERVERS` is unset.
- The owner chooses a low-traffic maintenance window and explicitly approves the cutover.

The cutover is a separate owner-authorized production operation. Until then, retain the static fallback. Do not delete the old Metered static credential as part of this documentation or test work.

### Narrow final security check

Review only the remaining known high-impact areas on current `main`:

- Guest and signed-in socket authorization; guest Metered access follows the owner decision above.
- Blocked-user privacy in chat, voice, friend/invite flows and table seating. Chat/voice filtering and public-profile hiding are implemented; table seating remains open. Owner has approved all-surface blocking.
- Admin/owner authorization and session revocation.
- TURN secret handling and cleanup workflow permissions.

Record findings with file/test references. Fix any critical or high-severity issue in a small PR. Do not repeat already-green CI suites manually without a specific failure or changed code.

## Explicitly deferred (not Stage 20.6 blockers for a limited initial beta)

- Native Windows and WSL2 test runs. CI already exercises Node 20/22, disposable PostgreSQL integration, browser UI, dependency audit and Docker build on Linux. Do not claim Windows/WSL2 support has been verified.
- A Neon load test or creation of a Neon test branch. Defer until usage justifies it; do not use production for load testing.
- Broad multi-browser/device matrix beyond the single cross-network phone test.
- Horizontal scaling. Keep one Render application instance because live rooms and presence are process-local.
- Paid Render/Neon/Metered upgrades. No upgrade is authorized by this checklist.

## Stage 20.6 — final limited-beta release gate

Before inviting the initial beta cohort, verify and record:

- [ ] Latest `main` commit is deployed on Render and deployment is healthy.
- [ ] `/healthz` and `/readyz` return healthy responses.
- [ ] Production signup, email verification, login, logout and password reset work on the live domain.
- [ ] A guest can join a table and use voice under the approved guest policy.
- [x] Cross-network two-person voice connectivity works (owner-tested Wi-Fi ↔ mobile). Selected relay candidate remains unverified; static TURN fallback stays enabled.
- [ ] Cleanup remains disabled and the protected deletion environment remains in place.
- [ ] One-instance operating model is retained; do not scale horizontally.
- [ ] Match-result spool durability limitation is explicitly accepted for a limited beta or resolved before relying on match history as durable.
- [ ] Privacy notice, terms/rules, support contact and account/data deletion explanation are available and reviewed.
- [ ] A rollback path and person responsible for responding to beta reports are identified.

## Release decision

Stage 20.6 can be prepared now. A limited beta release is **not yet a PASS** until the blocked-user seating gap is resolved, required live deployment and signup/email checks are recorded, and privacy/support checks above are complete. Cross-network voice connectivity is owner-tested; relay selection is not yet proven. A public, unrestricted launch requires a separate review of hosting availability, durable match-result storage, monitoring and legal/privacy obligations.

No production changes, credential deletion/rotation, cleanup execution, paid upgrades, or load tests are authorized by this document.
