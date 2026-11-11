# Stage 20.6: invite-only beta readiness (updated 2026-11-11)

**Technical implementation of Stage 20.6: closed by the owner, 2026-11-11.** Current `main` is `ead20c1` (PR #103 merged). The 18+ confirmation (C-A, PR #98) and the voice switch (C-D, PR #99) are merged and their production behaviour is owner-confirmed. Migration 020 is applied in production.

**Wave 1 verdict: NO-GO.** Launch blockers remain (section 7): the policy pages (C-B) are not built or approved, the live smoke tests are not all recorded, and the owner decisions in section 6 are open. C-C is deferred, because Wave 1 sends no broadcasts. PR #101 (Impressum) is an open Draft and is not part of `main`. See `docs/WAVE_1_LAUNCH_READINESS.md` for the full checklist.

**Scope:** free, invite-only beta for friends and friends-of-friends. Signed-in players only. Adults aged 18 and over. One owner account and no other admin. No ads, payments or promotional e-mail campaigns. Nothing in this document authorises a production change, a secret change, a credential rotation, a cleanup run, a database change, a load test, a new admin account or a merge.

## 1. Owner decisions

| # | Decision (owner, 2026-11-10) | What it means for the work |
|---|---|---|
| D-1 | Beta is **signed-in only**. No guest play, no anonymous player creation. | Guest voice and guest TURN questions do not apply. Confirmed in code (section 2). |
| D-2 | Audience is **18+**. A clear 18+ confirmation at registration, enforced on the server if feasible. **No full date of birth.** | Needs change C-A (not yet approved). |
| D-3 | **Voice withheld** from the beta until the Metered HTTP 401 is fixed and cross-network voice is verified. Do not rotate or delete static TURN credentials. | Needs change C-D (not yet approved). Metered work is deferred. |
| D-4 | Support and privacy contact: the owner's existing secondary e-mail for Waves 1 and 2. | Placeholder until the owner provides the address. Not written into any document. |
| D-5 | Free, invite-led, limited to friends and friends-of-friends. No ads, payments or promotional campaigns. | Promotional broadcasts are not planned for the beta. |
| D-6 | Avoid non-essential broadcasts to **unverified** accounts during the beta. | Needs change C-C (not yet approved). Today the compose form defaults to every address. |
| D-7 | Manual bug reports, account deletion requests and safety reports go to the support address. No moderation system or appeals workflow now; a simple manual process is documented. | `docs/SUPPORT_AND_REPORTING.md` (rewritten). |
| D-8 | Match-result durability **Option A accepted**, with the limits and tester wording documented. | `docs/MATCH_RESULT_DURABILITY.md`. Testers must see the wording before they play. |
| D-9 | No home address published. No legal identity or contact details invented. Drafts only; no claim of legal compliance or exemption. Legal review is not bought now. | Policy drafts stay unpublished. Open legal questions are listed in them and need the owner's approval. |
| D-10 | **One owner/admin account only.** | Verified in code and checked by M-6. |

## 2. Facts checked against the code (2026-11-10)

| Claim | Result | Evidence |
|---|---|---|
| Guest play does not exist | **Verified** | The socket answers "Please log in to play." (`server.js`, around line 1575). `createAnonymousPlayer` (`db/players.js`) has no caller outside its module and the memory store. |
| Play needs a verified e-mail | **Verified** | `server.js` around line 1633 ("Please verify your email before entering the lobby"). |
| Privacy, terms or support pages are reachable from the app | **Not so** | No link in `public/` (checked). Task C-B. |
| An age question exists | **No** | Registration form (`public/app.js` lines 438–445): name, username, e-mail, password only. `registerEmail` (`db/auth.js` line 162) takes no age. Task C-A. |
| Account-category broadcasts reach unverified accounts | **Yes** | `db/broadcast.js` `recipientsFrom`: only `promo` requires a verified address. The compose form's first option, "Everyone with an address" (`public/admin.js` line 296), is preselected. Task C-C. |
| Voice can pass the release gate on the static fallback | **No** | `server.js` `turnStatus()` reports Metered's state whenever Metered is configured, and `lib/voiceRelay.js` `iceExpiresAt` returns null for the static pair. The gate needs `turnStatus: ready` with a non-null expiry, which the 401 prevents. No voice switch exists in code. Task C-D. |
| Chat reports can be reviewed in the console | **No** | The Feedback tab reads `feedback` rows only. There is no report list; the Overview shows a count. Reports are reviewed with the read-only query in `docs/CHAT_MODERATION.md`. |
| The full-database cleanup command empties `chat_reports` | **As documented** (`docs/CHAT_MODERATION.md`) | Not re-traced end to end in this pass. It affects the retention decision (O-8 below). |
| Durability behaviour as documented | **Verified** | Retry delays `[500, 1500, 4000, 10000, 20000]` ms; spool default `os.tmpdir()/tableverse-match-spool`; replay every 10 minutes; SIGTERM drain 15 s; `.failed` files; `[matches] NOT SAVED` log (`db/matchQueue.js`, `server.js`). Render restart behaviour is **not verified** (manual check M-3). |
| Account deletion as documented | **Verified** | Password confirmed; owner account refused with 409; seats renamed to `Deleted player`; foreign keys cascade (`db/account.js` `deleteAccount`; migrations 001–016). Broadcast recipient rows cascade by declaration only, not tested end to end. |
| Owner-compromise procedure | **Verified in code**, not live-tested | Owner cannot be suspended or deleted; sign-out and suspension are owner-only (`lib/adminPolicy.js`). A password reset is not blocked by a suspension, but sign-in is refused (`docs/OPERATIONS_RUNBOOK.md`, corrected). |
| Cleanup safeguards | **Verified per script**, corrected in the runbook | `cleanup-unverified.js` has a read-only dry run and a `--max` cap; `cleanup-user-data.js` has `--confirm` and `--expect-host`. The workflow uses only the first. |
| Live production settings | **Not verifiable from the repository** | `render.yaml` sets `REQUIRE_EMAIL_VERIFICATION: "true"` and comments it as a temporary switch; `MATCH_SPOOL_DIR` is unset; GitHub variables and reviewers, and Render's secrets, are not visible here. Manual checks M-1 to M-9. |

## 3. Code changes: status

Status key: **Implemented and merged** = on `main`, tested in CI; **Production verified** = the owner confirmed the behaviour on the live site; **Deferred**; **Pending owner approval**. The descriptions below were the proposals; where the status line says "implemented", the merged code follows the proposal except where noted.

| Change | Status | Evidence |
|---|---|---|
| C-A 18+ confirmation | Implemented and merged (PR #98, `bd575c9`); production verified (owner confirmed live 18+ registration) | `registerEmail` rejects unless `adultConfirmed === true`; migration `020_adult_confirmation.sql`; checkbox in `public/app.js` |
| C-B policy pages | Pending owner approval; not built. `public/privacy.html`, `terms.html` and `support.html` do not exist on `main`. Impressum exists only in PR #101 (Draft) | `ls public` on `main` |
| C-C verified-only broadcasts | Deferred (Wave 1 sends no broadcasts) | Section 7 |
| C-D voice withheld | Implemented and merged (PR #99, `14d46a0`); production verified (owner confirmed voice disabled live) | `VOICE_ENABLED` must be exactly `"true"` to enable voice (`tests/voice-flag.test.js`); `render.yaml` does not set it, so code default is off |
| C-E, C-F, C-G | Optional; not started | Section 3 below |

The detailed proposals follow for reference.

**C-A. 18+ confirmation at registration (D-2).** [Implemented: PR #98.]
- `public/app.js`, registration form (lines 438–445): add a required, unticked checkbox "I confirm I am 18 or older." Send `ageConfirmed: true` in the `postJson('/api/auth/register', …)` call (line 505).
- `lib/authRoutes.js`, `POST /api/auth/register` (lines 217–220): refuse unless `body.ageConfirmed === true`, with 400 "You must confirm you are 18 or older to create an account."
- Optional, recommended: migration 017 adds `players.age_confirmed_at TIMESTAMPTZ`, set at registration. It records that the confirmation was given, and stores no date of birth. Needs approval.
- Tests: registration without the flag is refused (400); with it, accepted; the checkbox is required in the browser test.
- Limits to state in the notice: this is a self-declaration, not age verification.
- Decision for the owner: existing test accounts never confirmed. Confirm that each of them is 18 or over, or accept that they stay as they are.

**C-B. Policy pages before sign-up (D-4, D-9; C-1 in the earlier plan). [Pending owner approval; not built.]**
- After the owner approves the final wording: three static pages (`public/privacy.html`, `public/terms.html`, `public/support.html`) built from the approved text, not the drafts.
- Link them from the registration sheet (`public/app.js` around line 438) and from the home screen footer. The existing static handler serves them; no route changes.
- Until this ships, the fallback is a direct link to the approved text in the invitation message, if the owner accepts that.
- Test: a browser check that the links exist and open.

**C-C. No broadcasts to unverified accounts (D-6). Deferred: not needed for Wave 1.** Wave 1 sends no broadcasts at all (owner rule, section 7), so this code change is not a Wave 1 blocker. Build it only if broadcasts are ever used. Option described for that later use:
- `db/broadcast.js` `recipientsFrom` (lines 23–28): require `a.email_verified_at IS NOT NULL` for every category during the beta. This changes what `all`, `players`, `inactive` and `admins` mean: they become verified-only.
- `lib/broadcast.js` `validateTarget` (line 25): refuse `audience: 'unverified'` with a clear message.
- `public/admin.js` (lines 296 and 307): preselect "Verified accounts" and update the category labels.
- Not affected: verification and password-reset e-mails are sent by transactional mail (`deliver('verify' | 'reset')`), not by broadcasts.
- Tests: the audience-count expectations in `tests/admin.pg.test.js` and the broadcast tests in `tests/admin.test.js` must change accordingly.
- Operational alternative with no code change: always choose "Verified accounts" manually. Not recommended, because the default selects every address.

**C-D. Withhold voice for the beta (D-3). [Implemented: PR #99; production verified.]**
- A new setting `VOICE_ENABLED`, default on in code, set to `false` for the beta in `render.yaml` and in Render's environment (a Render change, so it needs approval).
- `server.js`: the voice message handler (around line 1075) refuses when disabled; `voiceFor` (around line 700) returns an empty list; the welcome payload carries `voiceEnabled: false`.
- `public/app.js` `voiceButtonsHTML` (line 250): returns nothing when `voiceEnabled` is false.
- Tests: a voice request is refused, and the welcome payload says voice is off.
- Metered and the static TURN pair stay as they are. No rotation, no deletion, no cutover.

**C-E. Database-name confirmation for the deletion job (optional, recommended for parity).**
- `scripts/cleanup-unverified.js`: with `--execute`, require `--confirm=<database name>` equal to the database named in `DATABASE_URL`. Refuse otherwise, deleting nothing.
- `.github/workflows/cleanup-unverified.yml`: pass the confirmation from a repository variable the owner sets (a name only, no value in the repository).
- Test: `--execute` without a matching confirmation is refused, and nothing is deleted.

**C-F. Cancel other unused reset links when one is used (optional security hardening).**
- `db/auth.js` `resetPassword`: in the same transaction, mark every other unused `password_reset` token for that player as used.
- Test: a second reset link stops working after the first is used.
- Until this ships, the runbook's compromise procedure keeps the account out of use for at least the live `AUTH_RESET_TTL_MIN` after the last reset e-mail sent before containment, then does a fresh reset (`docs/OPERATIONS_RUNBOOK.md`, step 3).

**C-G. Cancel control for e-mail broadcasts (optional; only if broadcasts are ever used).** Broadcast statuses are `queued`, `sending` and `sent` (migration 016), and the worker resumes unfinished jobs after a restart, so there is no way in the app to stop one. The change would add a `cancelled` status and an owner-only cancel route. Not needed while Wave 1 sends no broadcasts.

## 4. Release gate

Status key: **[x]** verified (in code, CI or owner-recorded evidence), **[ ]** open, **[C]** needs an approved change, **[D]** owner decision, **[M]** manual check on the live site.

**Repository and deployment**
- [x] Protect-Main requires the CI checks before merge (`docs/OPERATIONS_RUNBOOK.md`, "Repository safety"). Ruleset status checked live through the rulesets API on 2026-11-10: `Protect-Main` is active on the branch target.
- [x] Migration 020 (`020_adult_confirmation.sql`) applied to production and verified (owner-confirmed).
- [x] Render deployment, `/healthz` and `/readyz` confirmed by the owner after PRs #98 and #99.
- [M] M-1 for the current `main` (`ead20c1`): not verified. The sandbox cannot reach Render or the live site (403 from the proxy), so the owner must confirm that the latest `main` is deployed.
- [M] M-3: `MATCH_SPOOL_DIR` unset as in `render.yaml`; Render's behaviour on a restart (same machine or fresh) checked in the dashboard.

**Accounts and sessions**
- [x] One active session per account; sign-out everywhere; suspension revokes sessions and devices (CI tests).
- [ ] S-2 to S-5 on the live domain: sign-up, verification e-mail, verification link, login, logout, reset.
- [x] **C-A** 18+ confirmation: implemented (PR #98), tested in CI, production verified by the owner. Existing accounts with no confirmation: see section 6 (open).
- [ ] **D-9 / C-B** policy text approved and reachable (or the owner accepts the direct-link fallback in writing).

**Play and safety**
- [ ] S-6: a verified player joins a public table, a short game finishes, the result appears in both histories.
- [x] Blocks, one report per person per message, invites refused both ways (CI and code).
- [ ] S-8: a chat report is stored and visible to the owner through the read-only query.
- [ ] S-9: a feedback item appears in the Feedback tab.

**Voice**
- [x] **C-D** voice withheld: implemented (PR #99); production verified by the owner (voice disabled on the live site).
- [x] A relayed two-way call worked once (owner's WebRTC dump).
- Re-enabling voice is deferred (section 6).

**Match results (D-8)**
- [x] Option A accepted; limits and wording recorded in `docs/MATCH_RESULT_DURABILITY.md`.
- [ ] Testers have been shown the wording before they play.

**Data and deletion**
- [ ] S-11: deletion of a throwaway account; its finished match shows `Deleted player`.
- [D] **Owner rule:** no broadcasts during Wave 1 (recorded in section 7). Code change C-C deferred.
- [D] O-8: retention for chat reports and broadcast history (see section 5).

**Operations**
- [x] Cleanup disabled; the scheduled workflow is a dry run; the owner recorded zero eligible accounts (`docs/OPERATIONS_RUNBOOK.md`).
- [ ] **Known gap, owner to accept or approve C-E:** the deletion job runs `cleanup-unverified.js --execute`. Its guards are the production-cleanup reviewer, the `CLEANUP_EXECUTE` variable and the 1000-account cap. It has **no** database-name confirmation, unlike `cleanup-user-data.js`.
- [M] M-5: `production-cleanup` has a required reviewer; `CLEANUP_EXECUTE` is not `true`; `CLEANUP_DRYRUN_DATABASE_URL` is a read-only role (names only, never values).
- [M] M-6: `SELECT id, role FROM players WHERE role <> 'user';` returns only the owner (D-10).
- [M] M-7: `SELECT count(*) FROM players WHERE is_anonymous;` returns 0; otherwise decide a rule first.
- [M] M-8: Neon plan, backup and point-in-time window recorded in the runbook.
- [ ] M-10: restore rehearsal recent enough, or a new one run (no production restore).

## 5. Smoke tests for Wave 1

Run on the live domain with two test accounts that are not testers. Record times and account ids, not e-mail addresses, in the owner's private notes.

| # | Check | Expected |
|---|---|---|
| S-1 | `/healthz`, `/readyz`, `server.started` in the logs | 200, 200 `ready`, `store: postgres` |
| S-2 | Sign up (after C-A) | Needs the 18+ tick; account created; verification e-mail arrives |
| S-3 | Play before verifying | Refused with a verification message |
| S-4 | Open the verification link; reuse it | Verified; second use refused |
| S-5 | Log in, log out, forgot password, new password, old session ends | As described |
| S-6 | Public table, two accounts, one short game | Result in both histories |
| S-7 | Keep me signed in: sign in with the box ticked. In the browser's developer tools, delete **only** the `ct_session` cookie (keep `ct_device`), then reload | Signed in again, restored from the device cookie. Settings > Sessions > sign out of every device ends it, and the device cookie stops working |
| S-8 | Chat: send, report, block | Report stored (checked with the read-only query); block hides chat and refuses invites |
| S-9 | Feedback form, then the Feedback tab | Item listed as new |
| S-10 | Owner console: Overview, Users lookup, Broadcasts preview (no send) | Loads for the owner; a second account gets 403 on `/api/admin/*` |
| S-11 | Deletion on a throwaway account | Removed; its match shows `Deleted player` |
| S-12 | Voice (after C-D) | Voice button absent; voice request refused |
| S-13 | Logs after the test | No `[matches] NOT SAVED`, no `process.crash`; `[stats]` present |
| S-14 | Cleanup dry run (scheduled or by hand) | Counts only; no deletion |

After each deploy, repeat S-1, S-6 and S-13.

## 6. Open owner decisions, and recommended answers

| # | Question | Recommendation |
|---|---|---|
| O-1 | Confirm the signed-in-only beta. | Confirmed (D-1). |
| O-2 | Voice in the beta. | Withheld (D-3). |
| O-3 | Age rule. | 18+ with a self-declared tick and no date of birth (D-2). Approve C-A. |
| O-4 | Where the policy text is shown, and who approves it. | In-app pages after approval (C-B); the owner approves. |
| O-5 | Operator identity and any details the law requires (for example, a provider notice). | Owner supplies. Nothing is invented. Open question for the owner, not for this document. |
| O-6 | Legal questions: controller and contact, provider identification (DDG § 5), legal bases, cookies (TDDDG § 25), rights and complaints, processor terms, age, retention, breach notice. | No lawyer review (D-9). The 14 questions are listed at the end of the privacy draft, each marked for the owner's written approval, with the sources checked on 2026-11-10. Any remaining risk is accepted by the owner in writing before Wave 1. |
| O-7 | Support address, response target. | Placeholder until provided (D-4); wording in `docs/SUPPORT_AND_REPORTING.md` needs approval. |
| O-8 | Retention for chat reports and broadcast history; whether live chat not removed on deletion is acceptable. | Decide before Wave 1 for reports (the full cleanup command empties them). Live chat: accept and disclose (already in the privacy draft). |
| O-9 | Who reads reports, how often, appeals. | Owner, daily during the beta, by query. No appeals route yet; say so. |
| O-10 | Approval of the four policy documents and the person who answers beta reports. | Owner, until another person is named. |

## 7. Go / no-go

**Current verdict: NO-GO for Wave 1.** Blocking items are listed below. The list is a minimum: a go requires every item in section 4 that applies to the chosen setup to be marked [x], including the known gap in cleanup unless the owner accepts it in writing.

**Launch blockers (must be done before the first invitation):**
1. ~~C-A approved and built~~: done (PR #98, production verified). Open follow-up: existing accounts with no confirmation (section 6).
2. Owner rule recorded: no broadcasts during Wave 1. C-C (verified-only broadcasts) is deferred, so it is not a blocker.
3. ~~C-D approved and built~~: done (PR #99, production verified). Voice stays off; re-enabling is deferred (section 8).
4. Policy text approved and reachable (C-B), or the owner accepts a direct-link fallback in writing.
5. Smoke tests S-2 to S-6, S-8, S-9, S-11 and S-12 run on the live site with the results recorded.
6. M-1, M-5, M-6 and M-7 recorded.
7. Tester wording from `docs/MATCH_RESULT_DURABILITY.md` included in the invitation.

**Recommendation:** C-A and C-D are shipped and verified. Remaining work before a small Wave 1: approve and publish the policy text (C-B; PR #101 holds the Impressum as a Draft), record the live smoke tests, and settle the owner decisions in section 6. Hold any public launch until the legal questions in D-9 are settled.

**Owner decision recorded (2026-11-11):** the Impressum will use the owner's real legal name and home address. These details are not written into this repository. PR #101 keeps its placeholders unfilled until the owner supplies them.

## 8. Deferred until after Wave 1

- Metered HTTP 401 fix, dynamic TURN cutover, rotation or deletion of static credentials (each needs separate approval). Voice re-enablement and its cross-network checks depend on this.
- Persistent match-result spool (Option B in `docs/MATCH_RESULT_DURABILITY.md`) before any public launch.
- Chat report list in the console (today: read-only query).
- Retention periods and purge rules for chat reports and broadcast history (only if O-8 is not settled before Wave 1).
- Self-service data export; appeals route; admin two-factor sign-in; alerts for admin actions; uptime monitor (M-4 optional).
- Horizontal scaling (live rooms and presence are per process); paid Render, Neon or Metered plans; load tests; native Windows or WSL2 test runs (CI covers Linux only).
- Guest play (a new feature; not planned).
