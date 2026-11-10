# Stage 20.6 — limited-beta readiness (reconciled 2026-11-10)

Status: **READY TO PREPARE, NOT YET A GO.** The code gaps for a signed-in, invited beta are closed on `main` (PRs through #96). The remaining items are owner decisions, manual production checks, and the publication of the policy pages. Nothing in this document authorises a production change, a credential rotation or a deletion.

Scope: a free, staged beta shared with friends and friends-of-friends. No paid services, subscriptions or advertising. One owner/admin account, and no other admin accounts.

## Owner decisions already recorded

| # | Decision | Effect on this checklist |
|---|---|---|
| D-A | Match-result durability: **Option A accepted** for the limited beta (2026-11-10). | Details and tester wording in `docs/MATCH_RESULT_DURABILITY.md`. The durability gate is closed. |
| D-B | Admin model: **one owner only**. No admin accounts for beta testers. | Verified in code (see "Admin model" below). |
| D-C | Launch model: free, staged, invite-only (friends and friends-of-friends). | No public launch gates apply yet. |
| D-D | No paid services, subscriptions or advertising. | No paid-tier work is in scope. |
| D-E | Metered HTTP 401 handled after the other readiness work. **Do not rotate or delete static TURN credentials.** | Voice gate stays open; see "Voice" and owner decision O-2. |

## Findings reconciled against `main` (2026-11-10)

1. **Guest play does not exist in the current code.** The earlier wording "a guest can join a table" and "anonymous guest players may receive Metered TURN logins" is withdrawn. Evidence:
   - The client keeps a visitor on the public snapshot and asks them to log in before any play action (`public/app.js`, `gateLogin`, "Play actions need a live lobby session").
   - The WebSocket handshake answers `authRequired` ("Please log in to play") without a session cookie (`server.js`, `handleHello`).
   - `createAnonymousPlayer` in `db/players.js` has no caller outside its own module and the in-memory store.
   - Public browsing is not guest gameplay: visitors can read the home screen and public table list and send feedback, nothing more.
   - **Consequence:** the beta is signed-in only. The guest voice and guest TURN questions are not applicable. Owner decision O-1 confirms this.
2. **Signed-in players must verify their e-mail address before they can play.** Sign-in works without verification, but the socket refuses play until the address is verified (`server.js`, `isEmailVerificationRequired`). `REQUIRE_EMAIL_VERIFICATION` defaults to required.
3. **No policy page is reachable from the app.** The app links to no privacy notice, terms or support page. The drafts are not published and must not be published until reviewed (owner decision O-4, essential change C-1).
4. **No age question exists at sign-up.** Minimum age is an owner decision (O-3).
5. **Non-promotional broadcasts reach every registered, non-guest account, including unverified accounts.** Only the promotional category requires a verified address and no opt-out (`db/broadcast.js`). The privacy draft now says so; the legal review must confirm it (O-6).
6. **The app's cleanup safeguards are in place and documented** (see "Cleanup safeguards" below).

## Admin model (verified in code, D-B)

- Exactly one `owner` row is allowed by the database (unique partial index), and `owner` cannot be granted through the API (`lib/adminPolicy.js`, `docs/ADMIN.md`).
- Only the owner can: send e-mail broadcasts, sign an account out of every device, suspend or lift a suspension, change admin roles.
- An `admin` role exists in code. For this beta it is **not used**; the owner must confirm that no other account has it (manual check M-6).
- The owner account cannot be suspended or deleted through the app (`checkSuspend`; `db/account.js` returns 409).

## Cleanup safeguards (verified in code, D-7)

Production cleanup stays disabled. The layers, each of which must hold:

1. Nothing in the server runs cleanup. `scripts/cleanup-unverified.js` is a dry run unless `--execute` is given (`docs/DATA_CLEANUP.md`).
2. The dry run refuses any database role that can write, and runs inside a read-only transaction.
3. Deletion needs `--execute` **and** `--confirm=<exact database name>`; `scripts/cleanup-user-data.js` also needs `--expect-host` for a remote host.
4. The scheduled GitHub workflow (`.github/workflows/cleanup-unverified.yml`, daily at 03:17 UTC) is a dry run only. It uses the read-only secret `CLEANUP_DRYRUN_DATABASE_URL`.
5. The deletion job runs only when started by hand with `execute=true` **and** the repository variable `CLEANUP_EXECUTE=true`, and it waits for approval in the `production-cleanup` environment (manual check M-5).

Owner-recorded: the production dry run reported zero eligible accounts and zero deletions.

## Voice (D-E)

- Verified by the owner (two-person call, Wi-Fi and mobile data): two-way audio, nominated and succeeded pair, local `relay` candidate over UDP. **TURN relay use is confirmed for that call.**
- Open: the welcome payload reports `turnStatus: unavailable`, `iceExpiresAt: null`, and Render logs show `[turn] Metered credential request failed (HTTP 401)`. Dynamic Metered credentials are not working. Static fallback remains configured and must stay until the owner approves a cutover.
- Not yet verified: network recovery on a relayed call; an in-place ICE restart after a credential push; `turnStatus: ready` with a non-null `iceExpiresAt` on both devices.
- Owner decision O-2 decides whether voice is in the beta at all, and if so whether it runs on the static fallback until the 401 is fixed.

## Release gate

Status key: **[x] verified** (in code, CI or owner-recorded evidence named), **[ ] open**, **[D] owner decision**, **[M] manual production check**.

### Repository and deployment
- [x] The Protect-Main ruleset requires the five CI checks before merge (`docs/OPERATIONS_RUNBOOK.md`, "Repository safety"). The owner reports PRs through #96 merged. Confirm on the latest `main` commit before inviting testers (M-1).
- [M] Latest `main` (`4a85a43` or later) is the deployed commit on Render, and the deployment is healthy (owner reported production deployment verified).
- [M] `/healthz` returns 200 and `/readyz` returns 200 `ready` with the `postgres` store (owner reported verified; re-check on the invite day).

### Accounts and sessions
- [ ] Live signup, verification e-mail, verification link, login, logout and password reset on the live domain (smoke test S-2 to S-5).
- [x] Single active session per account, enforced by the database; a second sign-in ends the first (`tests/session.pg.test.js`).
- [x] Suspension revokes sessions and trusted devices in one transaction; the owner-only suspension is refused for guests, admins and the owner (`db/admin.js`, `lib/adminPolicy.js`).
- [x] Sign-out of every device works from settings (`POST /api/auth/logout-all`) and clears the session cookie (`tests/devices.pg.test.js`).

### Play and safety
- [ ] A signed-in verified player can join a table, play a full game and see the result in history (smoke test S-6).
- [x] Blocks: chat is one-way, voice is two-way, invites and friendships are refused both ways, a block never removes anyone from a table (`server.js`, `db/friends.js`, `docs/CHAT_MODERATION.md`).
- [x] Chat report: one report per person per message (`db/moderation.js`).
- [ ] A chat report and a feedback item reach the owner's console (smoke test S-9).

### Voice
- [D] O-2: voice included or withheld for the beta.
- [x] Relayed two-way call confirmed by the owner's WebRTC dump.
- [ ] If included: `turnStatus: ready` and `iceExpiresAt` non-null on both devices before a fresh call; network recovery; in-place ICE restart on a credential push. Blocked by the Metered HTTP 401.
- [D] Static TURN fallback stays configured; no rotation or deletion without separate approval.

### Match results (D-A, closed)
- [x] Owner accepted Option A (2026-11-10). Limitations and tester wording recorded in `docs/MATCH_RESULT_DURABILITY.md`.
- [ ] Testers have been shown the accepted wording (in the invitation message and in the beta terms).

### Policy, support and data (blocked until owner decisions and legal review)
- [ ] Privacy notice, beta terms, support page and account/data deletion explanation: drafts exist and were corrected against the code (see the four `docs/*_DRAFT.md` files and `docs/SUPPORT_AND_REPORTING.md`). **Not reviewed, not published, and not reachable from the app** (C-1).
- [D] O-1 to O-6 below.
- [ ] Account deletion works on a throwaway account and past matches show `Deleted player` (smoke test S-11).

### Operations
- [x] Cleanup disabled and protected by the layers above (owner-recorded dry run: zero eligible).
- [x] Single-instance operating model retained; no horizontal scaling.
- [M] Owner-run check of the `production-cleanup` environment reviewer and the `CLEANUP_EXECUTE` variable (M-5).
- [ ] Rollback path and a named person for beta reports: the owner (see the go/no-go list).
- [x] Owner-only admin procedures, and a separate procedure for a compromised owner account, in `docs/OPERATIONS_RUNBOOK.md`.

## Minimum smoke test for a staged beta

Run on the live domain with two test accounts that are not beta testers. Record the time and the account ids (not e-mail addresses) in the owner's private notes.

| # | Check | Expected |
|---|---|---|
| S-1 | `/healthz`, `/readyz`, and the Render log's `server.started` | 200, 200 `ready`, `store: postgres` |
| S-2 | Sign up with a test address | Account created; verification e-mail arrives |
| S-3 | Play before verifying | Refused with a verification message |
| S-4 | Open the verification link | Verified; a second use of the link is refused |
| S-5 | Log in, log out; forgot-password; new password works; the old session ends (socket closes with 4001) | As described |
| S-6 | Account A creates a public table; account B joins; one short game finishes | Result appears in both players' history |
| S-7 | Keep me signed in: close the tab, reopen the site | Signed in again; device listed in Sessions; "sign out of every device" ends it |
| S-8 | Chat: send a message; report another message; block the sender | Report stored; blocked chat hidden; invites refused both ways |
| S-9 | Feedback form from the signed-out home screen; check the owner's Feedback tab | Item listed as new |
| S-10 | Owner console: Overview, Users lookup, Broadcasts preview (no send) | Loads for the owner; a second test account gets 403 on `/api/admin/*` |
| S-11 | Account deletion on a throwaway account | Removed; its finished match shows `Deleted player` |
| S-12 | Voice, if included: two devices hear each other; `turnStatus` on both | As in "Voice" |
| S-13 | Logs after the test: no `[matches] NOT SAVED`, no `process.crash`; `[stats]` line present | Clean |
| S-14 | Cleanup dry run (scheduled or by hand) | Counts only; no deletion |

After each deploy, repeat S-1, S-6 and S-13.

## Owner decisions to close before the invitation

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| O-1 | Confirm **signed-in-only** beta (no guest play). | Guest play does not exist in code; the earlier guest wording is withdrawn. | Confirm. Building guest sessions is a new feature and out of scope. |
| O-2 | Voice in the beta: include on the static fallback until the Metered 401 is fixed, or withhold voice. | Metered is failing; static fallback is working for the owner's test. | Withhold voice for the first invitation unless the 401 is fixed before then. |
| O-3 | Minimum age, and how it is enforced. | No age question exists; the drafts leave it open. | Owner chooses; add a date-of-birth or confirmation question only if a minimum above 13 is set (small code change, not in this PR). |
| O-4 | Where the policy pages are hosted, and who approves the final text. | No policy page is reachable from the app (C-1). | Host the reviewed text in the app (small static-page change) after review. Do not publish the drafts. |
| O-5 | Controller/provider identity, and any Impressum-type details the applicable law requires. | Drafts contain placeholders only. | Owner supplies; nothing is invented. |
| O-6 | Legal review: lawful basis, processor agreements (Render, Neon, Resend, Metered, Google, Cloudflare), governing law, liability wording, notice periods, EU/UK users, and whether non-promotional broadcasts may reach unverified accounts. | Required before publication. | Limit the beta to users in a jurisdiction the owner has reviewed. |
| O-7 | Public support and privacy contact address; a private security address; a response target. | Drafts and `docs/SUPPORT_AND_REPORTING.md` have placeholders. | Use one private address; a target such as "acknowledged within 3 working days" is only a promise if the owner can keep it. |
| O-8 | Retention: chat reports (no period yet), broadcast history (none yet), match history (kept indefinitely, by design), and whether live chat that is not removed on account deletion is acceptable. | Stated as gaps in `docs/ACCOUNT_DELETION_AND_RETENTION.md`. | Pick periods, then implement in a separate small PR. |
| O-9 | Report handling: who reads reports (the owner), how often, and whether there is any suspension appeal (none exists in the product). | Terms section 4 and 5 promise a review without a process. | State "reviewed by the owner; no appeal route yet", or add an appeal address. |
| O-10 | Publication and legal review of the four policy documents, and the name of the person who answers beta reports and rollbacks. | Gate for publication. | The owner, until another person is named. |

## Go / no-go checklist

### Remaining owner tasks
- [ ] O-1 to O-10 decided and recorded.
- [ ] Policy text reviewed; placeholders filled; the owner accepts the drafts for publication.
- [ ] Testers told the accepted durability wording (`docs/MATCH_RESULT_DURABILITY.md`).
- [ ] Owner confirms the beta cohort and invitation text.

### Remaining manual production checks
- [ ] M-1 Render: latest `main` deployed; `/healthz`, `/readyz`, `server.started` with `store: postgres`.
- [ ] M-2 Live signup, verification, login, logout, reset on the live domain (S-2 to S-5), with test accounts.
- [ ] M-3 Render: `MATCH_SPOOL_DIR` unset (as in `render.yaml`); whether a redeploy reuses the same machine is checked in Render's dashboard (not verifiable from the repository).
- [ ] M-4 Render notification e-mails and an external uptime monitor decision (optional).
- [ ] M-5 GitHub: `production-cleanup` environment has a required reviewer; repository variable `CLEANUP_EXECUTE` is not `true`; `CLEANUP_DRYRUN_DATABASE_URL` is a read-only role. Use the names only; never print values.
- [ ] M-6 Admin model check (read-only): `SELECT id, role FROM players WHERE role <> 'user';` returns only the owner.
- [ ] M-7 Guest rows check (read-only): `SELECT count(*) FROM players WHERE is_anonymous;`. Expected 0 for a signed-in-only beta. If not 0, record the count and decide a retention rule before inviting anyone (O-8).
- [ ] M-8 Neon: plan name, backup and point-in-time window recorded in the runbook (currently placeholders).
- [ ] M-9 Metered: confirm the host name in the dashboard, the quota, and that `METERED_APP_NAME` and `METERED_SECRET_KEY` match the account (the 401 is most likely a credential or host mismatch; the owner checks this; no value is pasted anywhere).
- [ ] M-10 A test restore rehearsal, or confirmation that the last rehearsal is recent enough (runbook, "Restore test").

### Essential code changes
- [ ] **C-1 Reachable policy pages.** Testers must be able to read the privacy notice, terms and support details from the app before signing up. Implementation: static pages served by the existing static handler, linked from the sign-up sheet and the footer. **Not implemented in this PR**, because it would publish unreviewed draft text. Do it after O-4 and the legal review, as a small separate PR.
- [ ] **C-2 Only if O-3 sets a minimum age above 13:** an age confirmation at sign-up. Not needed otherwise.
- [ ] **C-3 Only if O-8 sets retention periods:** the purge rules for chat reports and broadcast history. Do not implement without the decision.

No other essential code change was found for a signed-in, invited beta. The admin model, deletion, suspension, blocks, cleanup safeguards and durability behaviour match their documentation.

### Deferred (not required for this limited beta)
- Guest play (new feature; O-1 recommends not building it for the beta).
- Native Windows and WSL2 test runs (CI covers Linux only; do not claim Windows support).
- Neon load test or Neon test branch creation.
- Broad browser and device matrix beyond the cross-network phone test.
- Horizontal scaling (live rooms and presence are per process).
- Paid Render, Neon or Metered upgrades.
- Static-to-dynamic TURN cutover and rotation or deletion of static credentials (separate owner approval).
- Owner transfer in the UI, two-factor sign-in for admins, e-mail alerts for admin actions, self-service data export, an in-app promotional opt-out.
- Persistent match-result spool (Option B in `docs/MATCH_RESULT_DURABILITY.md`), to revisit before a public launch.

## Release decision

Stage 20.6 is **complete as a preparation stage** once the owner has recorded O-1 to O-10 and the manual checks M-1 to M-10 are recorded. A limited invited beta is then a go if C-1 is done, or if the owner accepts sharing the policy text by a direct link in the invitation message. A public, unrestricted launch is not covered by this document and needs its own review.

No production changes, credential deletion or rotation, cleanup execution, paid upgrades, Neon branches, load tests or additional admin accounts are authorised by this document.
