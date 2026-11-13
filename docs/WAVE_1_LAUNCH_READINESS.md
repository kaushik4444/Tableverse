# Wave 1 launch readiness (updated 2026-11-11)

**Verdict: NO-GO.** Wave 1 is a small, invite-only beta for adults. This is not a public launch. Do not declare GO until every applicable blocker in section 7 is resolved. The owner may accept only the specific gaps the Stage 20.6 gate allows to be accepted (listed in section 8); live smoke tests and manual checks cannot be waived by general acceptance.

Companion: `docs/STAGE_20_6_BETA_READINESS.md` (the Stage 20.6 record and the release gate).

## 1. Baseline

| Item | Evidence |
|---|---|
| Latest `main` (historical snapshot, 2026-11-11) | `297acc4ee2b34c28fe15dd2a13450bb4ac7a1dce` (PR #106 squash merge: Chromium install retry). Historical only; do not use it as the launch baseline |
| CI on `297acc4` | Not yet checked on the main push. The same `ci.yml` content passed on PR #106 (head `f9c1e87`, browser job included). Previous main `ead20c14`: all five check runs completed successfully: Build and test (Node 20), Build and test (Node 22), Browser layout and interaction checks, Build production Docker image, Production dependency audit |
| Current `main` launch baseline (checked 2026-11-13) | `0a55a63` (PR #139 reconciliation), the current `main` revision. Render must be running this revision or a later `main` release for this baseline to be confirmed |
| Latest `development` (checked 2026-11-13) | `1167576`, which includes the technical architecture handbook (#141), local development onboarding (#142), public-by-default tables (#143), the 29 trump visibility fix (#144) and the UI audit record (#145). These changes are not part of the launch baseline until promoted through the release gates in `docs/RELEASES.md` and deployment on Render is confirmed |
| UI audit (2026-11-13) | `docs/UI_AUDIT.md` (PR #145) records the layout checks run in Chromium emulation at phone, tablet and desktop sizes. Not verified on real iOS or Android devices |
| Recently merged | #106 CI Chromium install retry (`297acc4`); #100 Ludo 5–6 players, Snakes and Ladders 2–6, Property Rivals goal; #102 Ludo improvements and settings toolbar; #103 Ludo visual refinements and 320px mobile layout |
| PR #101 (Impressum) | Open, **Draft**, head `8ed927a`, base `14d46a0`. Not on `main`, not published. Needs updating against the newer `main` before any merge. Not touched by this review |
| Production | https://playtableverse.com; Render service https://game-fmy4.onrender.com |
| Render deployed commit | **Could not be verified from this review.** No dashboard access in this session. Owner to confirm that the deployed commit is `0a55a63` or a later `main` release, or record the one that is live. A `development` commit does not qualify until it passes the release gates and is deployed |
| Previous baseline | `14d46a0` and `297acc4` are historical; neither is the current launch baseline |

## 2. Status key

- **Verified in production**: checked on the live site, with the evidence recorded.
- **Owner-confirmed**: the owner has reported it; no separate artefact is kept here.
- **Verified in code/CI only**: proven by tests or code on `main`, not on the live site.
- **Verified in development only**: proven by tests or code on `development`; pending promotion through the release gates and deployment.
- **Pending owner action**: needs a decision, an approval or a dashboard check by the owner.
- **Deferred**: intentionally postponed; not needed for Wave 1.
- **Not applicable**: does not apply to this setup.

## 3. Owner-confirmed facts (do not re-ask unless a newer deployment makes them necessary)

- Render deployment for PRs #98 and #99.
- `/healthz` and `/readyz`.
- Migration 020 applied to production.
- Live behaviour: 18+ registration and voice disabled.

## 4. Readiness checklist

### A. Deployment and infrastructure

| Check | Status | Evidence / next step |
|---|---|---|
| Latest `main` deployed on Render | Pending owner action | Owner to confirm the deployed commit (see section 1) |
| `/healthz` and `/readyz` | Owner-confirmed | Re-check after the next deploy (S-1) |
| PostgreSQL connectivity and migration state | Owner-confirmed (migration 020) | Migrations are in `db/migrations/` |
| Render startup and restart behaviour | Pending owner action | M-3: check in the Render dashboard; `MATCH_SPOOL_DIR` is unset in `render.yaml` |
| Neon plan, backup and point-in-time recovery window | Pending owner action | M-8: record in `docs/OPERATIONS_RUNBOOK.md` |
| Restore rehearsal evidence | Pending owner action | M-10: a recent rehearsal, or run one on a non-production copy. No production restore |
| Monitoring and crash-log checks | Pending owner action | S-13 after each deploy: no `[matches] NOT SAVED`, no `process.crash` |

### B. Authentication and accounts

| Check | Status | Evidence / next step |
|---|---|---|
| Registration and 18+ confirmation | Owner-confirmed; verified in code/CI | PR #98; `db/auth.js` refuses without the confirmation |
| Verification e-mail delivery and link | Pending owner action | S-2, S-4 on the live site with two test accounts |
| Login, logout, password reset, old-session invalidation | Pending owner action | S-5 on the live site. Code/CI: one active session per account; sign-out everywhere |
| Keep-me-signed-in | Pending owner action | S-7 (delete only `ct_session`, keep `ct_device`) |
| Existing accounts with NULL `adult_confirmed_at` | Pending owner action | Owner decides: confirm each is 18 or over, or accept as is (see STAGE_20_6 C-A) |
| One owner/admin account only | Pending owner action | M-6: `SELECT id, role FROM players WHERE role <> 'user';` returns only the owner |
| Legacy anonymous-player count | Pending owner action | M-7: `SELECT count(*) FROM players WHERE is_anonymous;` should return 0 |

### C. Games and match results

| Check | Status | Evidence / next step |
|---|---|---|
| Public and private table access, joining, sitting, reconnecting, starting | Pending owner action | S-6 with two accounts. The public-by-default change is on `development` (PR #143, `tests/public-default-tables.test.js`); it is not part of the launch baseline until it passes the release gates and is deployed |
| Completed match results in both player histories | Pending owner action | S-6 |
| Match-result Option A limitations communicated before play | Pending owner action | Wording is in `docs/MATCH_RESULT_DURABILITY.md`; testers must see it before they play |
| Current game catalogue smoke test (Ludo, Snakes and Ladders, Property Rivals) | Verified in code/CI only | Ludo, Snakes and Property Rivals tests pass on `main`; a live smoke test is still pending |
| Mobile layouts at 320px, 360px and 390px | Verified in development only | Browser layout and mobile-fit checks in CI. The 29 trump indicator regression test (PR #144) and UI audit record (PR #145) are on `development`, not the launch baseline. A live check and a real-device check are still pending |

### D. Safety and support

| Check | Status | Evidence / next step |
|---|---|---|
| Chat reporting | Pending owner action | S-8: a report is stored and visible through the read-only query in `docs/CHAT_MODERATION.md` |
| Daily manual review of all reports, with pagination and a review checkpoint | Pending owner action | There is no report list in the console; the review is a manual query. Owner to set the daily checkpoint (O-9) |
| Blocking and invitations | Verified in code/CI only | Blocks, one report per person per message, and invites refused both ways |
| Account deletion and match anonymisation | Pending owner action | S-11 on a throwaway account. Code: `db/account.js` `deleteAccount` |
| Feedback submission and owner console visibility | Pending owner action | S-9 and S-10 |
| Support contact and response expectations | Pending owner action | Support address is a placeholder until the owner provides it (D-4, O-7) |
| Report retention and indefinite-retention decision | Pending owner action | O-8. The full-database cleanup command empties `chat_reports` |

**Operational detail:** chat reports have no automatic retention and must be reviewed by hand, at least daily during the beta.

### E. Operations and safeguards

| Check | Status | Evidence / next step |
|---|---|---|
| `CLEANUP_EXECUTE` is not `true` | Pending owner action | M-5 |
| Production-cleanup environment reviewer | Pending owner action | M-5: a required reviewer is set |
| Read-only role for cleanup dry runs | Pending owner action | M-5: `CLEANUP_DRYRUN_DATABASE_URL` is a read-only role (names only, never values in Git) |
| Cleanup remains disabled | Verified in code/CI only | Runbook records zero eligible accounts; the scheduled workflow is a dry run. Known gap: no database-name confirmation (STAGE_20_6 C-E), for the owner to accept or approve |
| Database backup and recovery procedure | Pending owner action | M-8 and M-10 |
| No unnecessary credential rotation or production configuration changes | Deferred | Nothing in this review changes production |
| Voice remains disabled | Owner-confirmed | `VOICE_ENABLED` fails closed; S-12 to record on the live site |
| No broadcasts during Wave 1 | Owner rule | Recorded in STAGE_20_6 section 7. C-C is deferred |

### F. Legal and publication

| Check | Status | Evidence / next step |
|---|---|---|
| Privacy Notice | Pending owner action | Draft only, unpublished. Approval needed (C-B) |
| Beta Terms | Pending owner action | Draft only, unpublished. Approval needed (C-B) |
| Support and reporting contact | Pending owner action | Placeholder (D-4). Not written into any document |
| Impressum | Pending owner action | Implemented on Draft PR #101, not on `main`, not published. The owner has decided to use their real legal name and home address on it (owner decision, 2026-11-11). This is **not** a legal approval: the Impressum text, its placeholders and its publication stay pending owner approval, and PR #101 stays Draft. Those details are **not** recorded in Git |
| Legal review gate (tracking) | **Mandatory before any public beta in Germany** | The Impressum is implemented but **not published**: `/impressum.html` returns 404 and the sign-in and footer links are hidden unless the server runs with `LEGAL_IMPRESSUM_PUBLISHED=true`. Merging PR #101 does not publish it. To publish, a lawyer must approve the text, the draft banner and its comment must be removed from `public/impressum.html`, and the owner must set `LEGAL_IMPRESSUM_PUBLISHED=true` in Render. `render.yaml` deliberately does not set it. The owner's name, address and email are **not in Git**: set `IMPRESSUM_NAME`, `IMPRESSUM_ADDRESS` and `IMPRESSUM_EMAIL` in Render (dashboard only). The page stays 404 unless all three are set. Tests fail if personal data or `render.yaml` flags appear in the repository. |
| Owner identity and contact details | Pending owner action | Owner supplies. Nothing is invented |
| Remaining legal questions and risk acceptance | Pending owner action | The 14 questions in the privacy draft (O-6). Any remaining risk is accepted in writing by the owner before Wave 1 |

No policy text is published, and no personal placeholder is filled, by this review.

## 5. Manual checks and smoke tests (reconciled)

| ID | Check | Status |
|---|---|---|
| M-1 | Latest `main` deployed; `/healthz` 200; `/readyz` 200 `ready`; `server.started` shows `store: postgres` | Health owner-confirmed; deployed commit pending owner action |
| M-3 | Render restart behaviour; `MATCH_SPOOL_DIR` unset | Pending owner action |
| M-4 | Uptime monitor (optional) | Deferred |
| M-5 | Cleanup environment reviewer; `CLEANUP_EXECUTE` not `true`; read-only dry-run role | Pending owner action |
| M-6 | Only the owner has a non-user role | Pending owner action |
| M-7 | No anonymous players | Pending owner action |
| M-8 | Neon plan, backup and point-in-time window | Pending owner action |
| M-9 | Live production settings (GitHub variables, reviewers, Render secrets) | Pending owner action. Not visible from the repository |
| M-10 | Restore rehearsal recent enough, or a new one | Pending owner action |
| S-1 | Health endpoints and `server.started` | Owner-confirmed for the endpoints; re-check after the next deploy |
| S-2 | Sign-up, verification e-mail | Pending owner action (test accounts) |
| S-3 | Play before verifying refused | Pending owner action |
| S-4 | Verification link; reuse refused | Pending owner action |
| S-5 | Login, logout, forgot password, old session ends | Pending owner action |
| S-6 | Public table, two accounts, one short game; result in both histories | Pending owner action |
| S-7 | Keep me signed in | Pending owner action |
| S-8 | Chat report stored; block hides chat | Pending owner action |
| S-9 | Feedback appears in the Feedback tab | Pending owner action |
| S-10 | Owner console; a second account gets 403 on `GET /api/admin/overview` (not `/api/admin/me`, which returns 200 with `isAdmin: false` by design) | Pending owner action |
| S-11 | Deletion on a throwaway account | Pending owner action |
| S-12 | Voice button absent; voice request refused | Owner-confirmed behaviour; record on the live site |
| S-13 | Logs clean after the test | Pending owner action |
| S-14 | Cleanup dry run: counts only | Pending owner action |

Test accounts must not be the testers' accounts. Record times and account ids, not e-mail addresses.

## 6. Owner decisions

| # | Decision | Status |
|---|---|---|
| O-1 | Signed-in-only beta | Decided (D-1) |
| O-2 | Voice withheld in the beta | Decided (D-3); implemented |
| O-3 | 18+ self-declared confirmation, no date of birth | Decided (D-2); implemented |
| O-4 | Where policy text is shown, and who approves it | Pending owner action |
| O-5 | Operator identity and any details the law requires | Pending owner action |
| O-6 | Legal questions (14, in the privacy draft) | Pending owner action |
| O-7 | Support address and response target | Pending owner action |
| O-8 | Retention for chat reports and broadcast history | Pending owner action |
| O-9 | Who reads reports, how often, appeals | Owner, daily during the beta, by query. No appeals route yet |
| O-10 | Approval of the four policy documents and who answers beta reports | Pending owner action |

## 7. Blockers, grouped

**Owner action**
1. Confirm the deployed Render commit is `0a55a63` or a later `main` release (or record the live one). Development changes remain outside the launch baseline until promoted through the release gates and deployed.
2. Provide the support address and response target (O-7), and approve the policy text (O-4, O-6, O-10).
3. Decide report retention (O-8) and the daily review checkpoint (O-9).
4. Decide the existing-account 18+ question (STAGE_20_6 C-A) and accept or approve the cleanup database-name gap (STAGE_20_6 C-E).
5. Record the dashboard checks: M-3, M-5, M-8, M-9, M-10.
6. Run or approve the live smoke tests S-2 to S-6, S-8, S-9, S-11 and S-12, and record the results.

**Technical work**
1. Live smoke tests in section 5, after the deployed commit is confirmed.
2. After any deploy, repeat S-1, S-6 and S-13 (as in STAGE_20_6 section 5): health endpoints and logs, and a short game with its results in both histories. Do not reuse gameplay evidence from an earlier deployment.
3. Optional before Wave 1: C-E (database-name confirmation for the cleanup job), unless the owner accepts the gap.
4. Update PR #101 against the newer `main` if the Impressum is to be published. Do not merge it without approval.

**Legal and policy decisions**
1. Approve the Privacy Notice, Beta Terms and Impressum wording and the 14 open questions (O-6).
2. Owner identity and contact details (O-5, D-4).
3. Accept any remaining risk in writing.

## 8. Go / no-go

Wave 1 is GO only when:

- every applicable check in sections 4 and 5 is verified with evidence, and the live smoke tests and manual checks (S-, M- items) are recorded as run. These cannot be waived;
- every blocker in section 7 is cleared;
- the owner has accepted in writing only the gaps that the Stage 20.6 gate allows to be accepted: the direct-link fallback for policy text (C-B), the cleanup database-name gap (C-E), the existing-account 18+ question, and the remaining legal risk.

Until then the verdict is **NO-GO**.

Testers must see the Option A match-result wording (`docs/MATCH_RESULT_DURABILITY.md`) before they play.
