# Wave 1 launch readiness (updated 2026-11-11)

**Verdict: NO-GO.** Stage 20.6's technical implementation is closed (see `docs/STAGE_20_6_BETA_READINESS.md`). Wave 1 is not approved until every applicable blocker below is resolved or explicitly accepted by the owner in writing.

Nothing in this document authorises a merge, a deployment, a production change, a secret or environment change, a credential rotation, a cleanup run, a database change, a load test or a new admin account. It records evidence; it does not publish policy text or fill in personal placeholders.

## 0. Current state (checked 2026-11-11)

| Item | Value | Status |
|---|---|---|
| Latest `main` | `ead20c14fc7922371b665375f118139a60ccca96` (PR #103, squash-merged 2026-11-11) | Verified (git) |
| CI on `main` | Build and test (Node 20 and 22), browser layout and interaction checks, production dependency audit, Docker image build: all success | Verified in CI |
| Open PRs | #101 (Impressum, head `8ed927a`) only. Draft, open, unmerged | Verified (GitHub API) |
| Recently merged | #103, #102, #100, #99 (C-D), #98 (C-A), #97 (readiness docs) | Verified (GitHub API) |
| Render deployed commit | Could not be verified. The sandbox cannot reach `game-fmy4.onrender.com` or `playtableverse.com` (HTTP 403 from the proxy) | **Pending owner action** |
| Working trees | Work done on `games-ux-ui-pass` (merged) and `docs/wave-1-launch-readiness` (this PR). No other open branch with unmerged code for Wave 1 | Verified (git) |

Earlier baseline `14d46a0` is superseded. Use `ead20c1` for all checks.

## 1. Stage 20.6 items: current status

| Item | Status | Evidence |
|---|---|---|
| C-A 18+ confirmation | **Implemented and merged** (PR #98), **production verified** (owner confirmed live 18+ registration) | `registerEmail` rejects without `adultConfirmed === true`; migration 020 |
| C-D voice withheld | **Implemented and merged** (PR #99), **production verified** (owner confirmed disabled voice) | `VOICE_ENABLED` must be exactly `"true"`; default is off in code |
| C-C verified-only broadcasts | **Deferred.** Wave 1 sends no broadcasts (owner rule) | Not a Wave 1 blocker |
| C-B policy pages | **Pending owner approval.** No privacy, terms or support page exists on `main`. The Impressum is in PR #101 (Draft) only | `ls public` on `main` |
| Migration 020 | **Owner-confirmed applied in production** | Owner report |
| Render deployment, `/healthz`, `/readyz` (for PRs #98 and #99) | **Owner-confirmed** | Owner report |

## 2. Checklist by area

Status labels: **Verified in production** (live check recorded with evidence); **Owner-confirmed** (owner reported the result); **Verified in code/CI only**; **Pending owner action**; **Deferred**; **Not applicable**.

### A. Deployment and infrastructure

| Check | Status | Notes |
|---|---|---|
| Latest `main` deployed on Render | **Pending owner action** | Owner to confirm the deployed commit is `ead20c1` (or later) |
| `/healthz` and `/readyz` | **Owner-confirmed** for the PR #98 and #99 deployment | Re-check on `ead20c1` (M-1) |
| PostgreSQL connectivity and migration state | **Owner-confirmed** (migration 020) | `/readyz` should show `store: postgres` |
| Render startup and restart behaviour | **Pending owner action** | M-3: check the dashboard; `MATCH_SPOOL_DIR` is unset |
| Neon plan, backup and point-in-time recovery window | **Pending owner action** | M-8: record in the runbook |
| Restore rehearsal evidence | **Pending owner action** | M-10: rehearsal recent enough, or a new one on a non-production copy |
| Monitoring and crash-log checks | **Pending owner action** | S-13 after the test; no uptime monitor (M-4 optional) |

### B. Authentication and accounts

| Check | Status | Notes |
|---|---|---|
| Registration and 18+ confirmation | **Owner-confirmed** (live) | Self-declaration, not age verification |
| Verification e-mail delivery and link | **Pending owner action** | S-2 and S-4 on the live domain. Resend domain verified per README |
| Login, logout, password reset | **Verified in code/CI only** for session revocation; live check pending | `resetPassword` revokes all `auth_sessions` and `auth_devices` in the same transaction (`db/auth.js`); reset-race test `tests/session-lifecycle.pg.test.js`. S-5 pending |
| Old-session invalidation after reset | **Verified in code/CI only** | As above; live check S-5 pending |
| Keep-me-signed-in | **Verified in code/CI only**; live check pending | Device cookie `ct_device`, migration 018; `tests/devices.pg.test.js`. S-7 pending |
| Existing accounts with NULL `adult_confirmed_at` | **Pending owner decision** | Confirm each is 18 or over, or accept as is (C-A decision) |
| One owner/admin account only | **Pending owner action** | M-6: `SELECT id, role FROM players WHERE role <> 'user';` returns only the owner |
| Legacy anonymous-player count | **Pending owner action** | M-7: `SELECT count(*) FROM players WHERE is_anonymous;` should be 0 |

### C. Games and match results

| Check | Status | Notes |
|---|---|---|
| Public and private table access | **Verified in code/CI only** | `tests/private-table-access.pg.test.js`; live S-6 pending |
| Joining, sitting, reconnecting, starting | **Verified in code/CI only** | Browser UI suites pass on `ead20c1` |
| Completed match results in both histories | **Pending owner action** (live) | S-6 |
| Option A limitations communicated before play | **Pending owner action** | Testers must see `docs/MATCH_RESULT_DURABILITY.md` wording before playing |
| Game catalogue smoke test (including recent Ludo, Snakes and Ladders, Property Rivals changes) | **Verified in code/CI only** | Layout audit of all 18 setups: 0 errors. Browser suites: Ludo, Snakes and Ladders, Property Rivals, Go Fish, Wizard, mobile fit, accessibility, touch targets, game settings all pass |
| Mobile layouts at 320, 360 and 390 px | **Verified in code/CI only** | Layout audit covers 320x568, 360x640, 390x844, 667x375, 768x1024, 1280x800. Known: Property Rivals board text is small on phones (not a blocker; see section 4) |

### D. Safety and support

| Check | Status | Notes |
|---|---|---|
| Chat reporting | **Verified in code/CI only**; live S-8 pending | Reports read with the read-only query in `docs/CHAT_MODERATION.md`. They do not appear in the console |
| Daily manual review of all reports, with pagination and a review checkpoint | **Pending owner action** | Process not yet recorded as in use; O-9 |
| Blocking and invitations | **Verified in code/CI only** | Blocks hide chat and refuse invites both ways (tests) |
| Account deletion and match anonymisation | **Verified in code/CI only**; live S-11 pending | `deleteAccount`: password confirmed; owner refused; seats renamed `Deleted player` |
| Feedback submission and owner console visibility | **Pending owner action** (live) | S-9, S-10 |
| Support contact and response expectations | **Pending owner action** | D-4 placeholder; O-7. Address not written into any document |
| Report retention and indefinite-retention decision | **Pending owner decision** | O-8. The full cleanup command empties `chat_reports` |

### E. Operations and safeguards

| Check | Status | Notes |
|---|---|---|
| `CLEANUP_EXECUTE` is not `true` | **Pending owner action** | M-5 |
| Production-cleanup environment reviewer | **Pending owner action** | M-5: required reviewer on `production-cleanup` |
| Read-only role for cleanup dry runs | **Pending owner action** | M-5: `CLEANUP_DRYRUN_DATABASE_URL` is read-only (names only, never values) |
| Cleanup remains disabled | **Owner-confirmed** per runbook note (zero eligible accounts recorded) | Scheduled workflow is a dry run |
| Known gap: deletion job has no database-name confirmation | **Pending owner decision** | Accept in writing, or approve C-E (optional) |
| Database backup and recovery procedure | **Pending owner action** | M-8 and M-10 |
| No unnecessary credential rotation or production configuration change | **Not applicable** (standing rule) | Metered and static TURN untouched |
| Voice remains disabled | **Owner-confirmed** | C-D |
| No broadcasts during Wave 1 | **Owner rule** | C-C deferred |

### F. Legal and publication

| Check | Status | Notes |
|---|---|---|
| Privacy Notice | **Pending owner approval.** Draft only (`docs/PRIVACY_NOTICE_DRAFT.md`), unpublished | Not on `main` |
| Beta Terms | **Pending owner approval.** Draft only (`docs/BETA_TERMS_DRAFT.md`), unpublished | Not on `main` |
| Support and reporting contact | **Pending owner action.** Placeholder address | `docs/SUPPORT_AND_REPORTING.md` wording needs approval |
| Impressum | **Pending owner action.** Draft in PR #101 (Draft, unmerged) with placeholders and a draft banner | Owner has chosen to use real legal name and home address. These details stay out of Git. Do not merge PR #101 until the owner approves |
| Owner identity and contact details | **Pending owner action** | Supplied by the owner outside the repository |
| Remaining legal questions and risk acceptance | **Pending owner decision** | The 14 questions at the end of the privacy draft; owner to answer in writing and accept any residual risk |

## 3. Smoke tests S-1 to S-14

| # | Check | Status |
|---|---|---|
| S-1 | `/healthz`, `/readyz`, `server.started` in logs | Owner-confirmed for PR #98/#99 deployment; re-run after `ead20c1` |
| S-2 | Sign up with 18+ tick; verification e-mail arrives | Partly owner-confirmed (18+ registration). E-mail delivery **pending** |
| S-3 | Play before verifying is refused | **Pending owner action** |
| S-4 | Verification link works; second use refused | **Pending owner action** |
| S-5 | Login, logout, forgot password, new password, old session ends | **Pending owner action**. Code verified (section 2B) |
| S-6 | Public table, two accounts, one short game; result in both histories | **Pending owner action** |
| S-7 | Keep-me-signed-in: restored from device cookie after deleting only `ct_session` | **Pending owner action** |
| S-8 | Chat send, report, block | **Pending owner action** |
| S-9 | Feedback form, then Feedback tab | **Pending owner action** |
| S-10 | Owner console loads; second account gets 403 on `/api/admin/*` | **Pending owner action** |
| S-11 | Deletion of a throwaway account; match shows `Deleted player` | **Pending owner action** |
| S-12 | Voice button absent; voice request refused | **Owner-confirmed** (voice disabled on the live site) |
| S-13 | Logs after the test: no `[matches] NOT SAVED`, no `process.crash`; `[stats]` present | **Pending owner action** |
| S-14 | Cleanup dry run: counts only, no deletion | **Owner-confirmed** per runbook note; re-run after the next deploy |

Create no production test accounts for these checks unless the owner runs them. Record times and account IDs, not e-mail addresses.

## 4. Manual checks M-1 to M-10

| # | Check | Status |
|---|---|---|
| M-1 | Latest `main` deployed; `/healthz` 200; `/readyz` 200 `ready`, `store: postgres` | **Pending owner action** for `ead20c1` (earlier deployments owner-confirmed) |
| M-2 | Not defined in the Stage 20.6 document | **Not applicable.** Owner to confirm nothing was intended here |
| M-3 | `MATCH_SPOOL_DIR` unset; Render restart behaviour checked | **Pending owner action** |
| M-4 | Uptime monitor (optional) | **Deferred** |
| M-5 | Cleanup safeguards (reviewer, `CLEANUP_EXECUTE`, read-only dry-run role) | **Pending owner action** |
| M-6 | Only the owner has role other than `user` | **Pending owner action** |
| M-7 | Zero anonymous players | **Pending owner action** |
| M-8 | Neon plan, backup, PITR window recorded | **Pending owner action** |
| M-9 | Live production settings (listed as manual in section 2 of the Stage 20.6 document) | **Pending owner action**. `render.yaml` sets `REQUIRE_EMAIL_VERIFICATION: "true"` |
| M-10 | Restore rehearsal recent enough, or a new one run | **Pending owner action** |

Known documentation discrepancy: `README.md` (lines 28 to 33) says email verification is optional in this environment, while `render.yaml` sets `REQUIRE_EMAIL_VERIFICATION: "true"`. The live Render setting could not be read from here. The README is **not changed** in this PR. Owner to confirm the live value; then correct the README to match.

## 5. Remaining blockers

**Owner action**
1. Confirm the deployed commit is `ead20c1` or later, and that `/healthz` and `/readyz` pass (M-1).
2. Run or confirm the live smoke tests S-2 to S-7, S-8, S-9, S-10, S-11 and S-13.
3. Record M-3, M-5, M-6, M-7, M-8 and M-10.
4. Confirm the live `REQUIRE_EMAIL_VERIFICATION` value, then the README correction.
5. Decide on existing accounts without an 18+ confirmation (`adult_confirmed_at` NULL).
6. Decide on chat-report and broadcast retention (O-8), and on the daily review process (O-9).
7. Accept, in writing, the cleanup database-name gap, or approve C-E.
8. Supply the support address (D-4).
9. Fill the Impressum placeholders outside Git (owner's own copy), then decide on PR #101 separately. It stays a Draft until then.

**Technical work**
1. C-B: build the privacy, terms and support pages from approved text only, with a browser test that the links open. Not started.
2. Property Rivals: the phone board text is small. A larger font clips squares, so the layout needs a decision (section 6). Not a launch blocker unless the owner says so.
3. Optional, not blocking: C-E, C-F, C-G.

**Legal and policy decision**
1. Approve the Privacy Notice, Beta Terms, support wording and Impressum text (D-9, O-4, O-6, O-10).
2. Answer the 14 legal questions in the privacy draft, or accept the residual risk in writing.
3. Confirm the operator identity and any details the law requires (O-5).

## 6. Owner decisions still open

| # | Question |
|---|---|
| O-3 | Accounts with no 18+ confirmation: confirm each is 18 or over, or accept as is |
| O-6 | Answers to the 14 legal questions |
| O-7 | Support address and response target |
| O-8 | Retention for chat reports and broadcast history |
| O-9 | Who reads reports, how often, and appeals |
| O-10 | Approval of the four policy documents |
| — | Whether to accept the Property Rivals phone-board text size for Wave 1, or redesign the phone layout first |

## 7. Final Go / No-Go checklist

Mark each item **[x]** only with evidence. Do not mark a launch on this checklist alone.

- [ ] Latest `main` deployed on Render, confirmed by the owner (M-1)
- [ ] `/healthz` and `/readyz` pass on that deployment (S-1)
- [x] C-A 18+ confirmation implemented and production verified
- [x] C-D voice withheld and production verified
- [ ] C-B policy pages approved, built and reachable, or a direct-link fallback accepted in writing
- [ ] Verification e-mail arrives and the link works (S-2, S-4)
- [ ] Play before verifying refused (S-3)
- [ ] Login, logout, reset and old-session check (S-5)
- [ ] Keep-me-signed-in check (S-7)
- [ ] Public table, two accounts, result in both histories (S-6)
- [ ] Chat report stored and visible to the owner through the read-only query (S-8)
- [ ] Feedback item visible in the Feedback tab (S-9)
- [ ] Owner console loads; second account gets 403 (S-10)
- [ ] Deletion of a throwaway account; match shows `Deleted player` (S-11)
- [x] Voice button absent and refused (S-12, owner-confirmed)
- [ ] Logs clean after the test (S-13)
- [ ] M-3, M-5, M-6, M-7, M-8, M-10 recorded
- [ ] Existing accounts without 18+ confirmation decided (O-3)
- [ ] Retention and review process decided (O-8, O-9)
- [ ] Cleanup database-name gap accepted in writing, or C-E approved
- [ ] Support address supplied (D-4, O-7)
- [ ] Privacy Notice, Beta Terms, support wording and Impressum approved by the owner
- [ ] Legal questions answered or residual risk accepted in writing (O-6)
- [ ] Tester wording for Option A shown to testers before they play
- [ ] No broadcasts sent during Wave 1 (owner rule)

**Result: NO-GO** until every unchecked item applicable to the chosen setup is checked or accepted in writing by the owner.
