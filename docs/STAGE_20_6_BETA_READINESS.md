# Stage 20.6 — lean public-beta readiness

Status: **PREPARATION ONLY — not approved for public launch.**

This checklist deliberately separates release-critical verification from optional platform coverage and scale testing. It is intended to close the remaining Stage 20.3 gaps without expanding the project unnecessarily.

## Decisions recorded

- Anonymous guest players **may receive Metered TURN logins** during the initial beta. Monitor the Metered 500 MB monthly allowance and active-credential count.
- Metered's recommended policy is implemented in merged PR #76: 48-hour credential lifetime, replacement every 24 hours, allow up to two minutes for propagation, and let old credentials expire naturally.
- Static TURN credentials remain configured until the owner explicitly approves cutover.
- Cleanup remains disabled: `CLEANUP_EXECUTE=false`. The production dry-run reported zero eligible accounts and zero deletions.
- No Windows or WSL2 test run has been performed.
- Owner tested a two-person call across Wi-Fi and mobile data; two-way audio worked. The supplied `webrtc-internals` stats show a nominated, succeeded candidate pair with local candidate `relay` (`relayProtocol=udp`), 311,875 bytes sent and 202,044 received. **TURN relay use is confirmed for this call.** The supplied ICE-server list shows `turn:global.relay.metered.ca:80`, but `turnStatus`, `iceExpiresAt`, and the credential source were not captured; dynamic Metered REST credential use is therefore not yet proven.
- The latest owner-provided WebSocket `welcome` payload reports `turnStatus: unavailable` and `iceExpiresAt: null`; Render logs report `[turn] Metered credential request failed (HTTP 401)`. Dynamic Metered credential authentication is currently failing. This is the one explicitly deferred voice issue carried into Stage 20.6. Keep the static TURN fallback in place; do not rotate or remove credentials without separate approval.
- No Neon load test has been performed; it is deferred for the initial friend/limited beta.

## Voice-enabled beta verification

Guest table access is required for the beta. Guest voice access is required only if voice is included; if voice is withheld, record that decision and keep voice unavailable to the beta cohort.

Before creating fresh voice connections for the voice-enabled beta checks, confirm that both devices receive `turnStatus: ready` and a non-null `iceExpiresAt`. This verifies the propagated Metered login rather than the retained static fallback.

- [x] Verify a two-person call uses a selected `relay` candidate and has two-way audio (owner-provided dump: nominated/succeeded pair, local relay candidate over UDP).
- [ ] Verify network recovery on the relayed call.
- [ ] Verify a propagated Metered credential update triggers an in-place ICE restart: the same peer connection remains, its local `a=ice-ufrag` changes, and audio continues.
- [ ] Resolve the Metered HTTP 401 and confirm `turnStatus: ready` and non-null `iceExpiresAt` on both devices before a fresh call, to distinguish a dynamic Metered login from the retained static fallback. Current status is `unavailable` / `null`; static fallback remains active.
- Keep static fallback configured for the beta unless the separate cutover gate below is completed. Do not repeat broad device/browser tests for this limited beta.

Do not attempt to force relay by merely enabling a VPN. If the network does not force relay, use browser WebRTC diagnostics to verify the selected candidate pair; record a direct connection as inconclusive for relay verification.

### Optional: additional prerequisites for static TURN cutover

- Confirm the current Render deployment contains PRs #72 and #76, and `METERED_APP_NAME`, `METERED_SECRET_KEY`, and `TURN_URL` are configured.
- Render shows no Metered credential failures during at least 48 hours of observation.
- The voice-enabled verification above passes using propagated Metered credentials on both devices.
- `ICE_SERVERS` is unset.
- The owner chooses a low-traffic maintenance window and explicitly approves the cutover.

Retaining the approved static fallback does not block a limited beta. These additional prerequisites apply only if static TURN cutover is chosen.

The cutover is a separate owner-authorized production operation. Until then, retain the static fallback. Do not delete the old Metered static credential as part of this documentation or test work.

### Narrow final security check

Review only the remaining known high-impact areas on current `main`:

- Guest and signed-in socket authorization; guest Metered access follows the owner decision above.
- Blocked-user privacy in chat, voice, friend/invite flows and table seating. Chat/voice filtering and public-profile hiding are implemented; PR #81 adds table-entry, seating, lobby-removal and active-game rejoin enforcement and is awaiting CI/review/merge.
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
- [ ] A guest can join a table. If voice is included, both devices receive Metered `turnStatus: ready` with non-null `iceExpiresAt` before fresh connections, and relay, network recovery, and in-place credential-push ICE-restart checks pass. If voice is withheld, record the voice-disabled decision and keep voice unavailable to the beta cohort.
- [x] For voice-enabled beta, record a two-way relayed call. The owner-provided dump confirms a nominated, succeeded pair using a local UDP relay candidate.
- [ ] If voice is included, resolve the known Metered HTTP 401 and confirm that the relayed call used a propagated dynamic Metered credential (`turnStatus: ready` and non-null `iceExpiresAt`); record N/A if voice is withheld. Current `turnStatus: unavailable` and `iceExpiresAt: null` mean this gate is not yet passed.
- [ ] Cleanup remains disabled and the protected deletion environment remains in place.
- [ ] One-instance operating model is retained; do not scale horizontally.
- [ ] Match-result spool durability limitation is explicitly accepted for a limited beta or resolved before relying on match history as durable.
- [ ] Privacy notice, terms/rules, support contact and account/data deletion explanation are available and reviewed.
- [ ] The focused security review in Stage 20.3 section 13 is complete and recorded; all critical/high-severity findings are resolved.
- [ ] A rollback path and person responsible for responding to beta reports are identified.

## Release decision

Stage 20.6 can be prepared now. A limited beta release is **not yet a PASS** until PR #81 is merged with CI green, the focused security review is complete with critical/high findings resolved, required live deployment and signup/email checks are recorded, and privacy/support checks above are complete. If voice is included, its Metered HTTP 401 must be resolved and the dynamic credential, relay, network recovery, and ICE-restart gates must pass; a recorded voice-disabled state satisfies the voice portion of the gate. Cross-network voice connectivity and TURN relay selection are owner-tested and confirmed by the supplied WebRTC stats, but the current welcome payload/logs show dynamic Metered credential authentication is unavailable (HTTP 401). A public, unrestricted launch requires a separate review of hosting availability, durable match-result storage, monitoring and legal/privacy obligations.

No production changes, credential deletion/rotation, cleanup execution, paid upgrades, or load tests are authorized by this document.
