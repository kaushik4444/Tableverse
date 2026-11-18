<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:efef4951e8b8ab49ff0b499ed8f20356d14c974a36bbee4802b730702f10f5e3 -->

# Privacy notice: owner decisions, code check and open items

Status: **prepared 2026-11-17 on `docs/privacy-notice-owner-decisions`. Not approved, not published.** Nothing here enables `LEGAL_PRIVACY_PUBLISHED`, sets `GOOGLE_CLIENT_ID`, publishes the Impressum, or changes any Render variable. The Terms stay unpublished. This is engineering documentation, not a legal opinion, and it does not claim legal approval or GDPR certification.

The published wording is `lib/legal/privacy.md`. Each statement in it was checked against the code. Where the code, the owner decision and the notice disagree, the notice keeps an `[OWNER]` or `[LEGAL]` marker, and the marker blocks publication (`lib/legalPages.js`, `PLACEHOLDER`).

## 1. How the owner decisions were applied

| Decision | How it is applied in `lib/legal/privacy.md` |
|---|---|
| Legal basis mapping (Art. 6(1)(b), (f), (c)) | Each purpose is listed with its basis. Purposes the mapping does not cover are marked for review: device login, age confirmation, feedback, audit log, and "records required by law" (no specific obligation identified). |
| Provider locations | Render (Oregon, United States), Neon (AWS Asia Pacific, Singapore), GitHub (global, including the United States), Resend (United States), Metered (primary systems in Canada, relay processing can occur in regions serving traffic, including outside the EEA; voice off by default), Google (global). The notice says that copies can exist in other places, and does not claim single-region storage. |
| International transfers | Stated per provider. The Singapore database transfer is stated as relying on contractual safeguards, with a marker to verify Neon's clauses. Canada is not described as adequate (the owner did not ask for it; legal to confirm). |
| Retention | Each period is stated only where the code enforces it, or marked where it does not (see section 2). |
| Production access | Owner-confirmed on 2026-11-17: the owner is the only person with routine authorised production access, and there are no other production admin users. The notice says so. The code still supports an `admin` role, so creating one would make this statement untrue and needs a notice update first. Providers may have limited technical access under their safeguards; the notice says so and does not claim they have none. |
| Hosting logs and backups | Owner-confirmed on 2026-11-17: Render Hobby logs are kept up to 7 days; Neon production point-in-time restore history is 6 hours. Neither is verifiable from the repository. The notice uses these figures. Manual owner backup files are not covered by the 6-hour figure and remain a marker. |
| Promotional and broadcast e-mail | Owner-confirmed on 2026-11-17: no promotional or owner broadcast e-mail is sent during the beta. The notice says so. The broadcast feature still exists in code (`lib/broadcast.js`, `db/broadcast.js`), so the beta statement relies on the owner not using it. |
| Data requests | Manual process through the privacy contact (`{{IMPRESSUM_EMAIL}}`, which resolves to `PUBLIC_CONTACT_EMAIL` on Render, the same address as `playtableverse@gmail.com`). Identity check by a one-time code sent to the account's e-mail address and quoted in a reply, one-month response (with the GDPR extension rule). The live privacy page exposes this contact independently of Impressum publication; manual deletion is available when either page publicly exposes it and the owner confirms the inbox is monitored. No export feature is claimed. |
| Usage statistics | Not stated as "no identifying information". The notice says the figures shown to staff contain no names, addresses or messages, and discloses the keyed daily hash behind the active-player count (see section 2). |
| Publication date | Left as a marker. The notice is not approved yet, so 18 November 2026 is not used. |
| Google sign-in and deletion | Documented in `docs/ACCOUNT_DELETION_AND_RETENTION.md` (section 4 below). The safeguard is unchanged. |

## 2. Code check: what the notice says against what the code does

| Statement | Code evidence | Result |
|---|---|---|
| Rate-limit records (with the network address) eligible for purge after 1 day | `db/auth.js` `purgeExpired`: `auth_rate_limits` where `window_start < NOW() - INTERVAL '1 day'` | Matches code. **Owner proposed 30 days; the code is 1 day. The notice states the code's period.** Owner to decide whether to keep 1 day (recommended, shorter) or change the code. |
| Login sessions 30 days by default | `db/players.js`: `AUTH_SESSION_TTL_DAYS`, default 30 | Matches. Purge eligibility begins more than 7 days after expiry **or** more than 30 days after revocation (`db/auth.js`); either condition suffices, so removal may occur less than 30 days after revocation. These are purge-eligibility thresholds, not deletion deadlines: periodic housekeeping can remove rows later and retry failures. |
| "Keep me signed in" device logins eligible for purge more than 30 days after expiry or revocation | `db/auth.js` `purgeExpired` | Matches. |
| Verification links 24 h; reset links 30 min; both eligible for purge more than 7 days after expiry or use | `db/auth.js`: `AUTH_VERIFY_TTL_MIN` default 60×24, `AUTH_RESET_TTL_MIN` default 30; token purge at 7 days | Matches. |
| Active-player counts: 35 days | `db/admin.js` `RETENTION.activeDays = 35` | Matches. |
| Active-player rows are a **keyed hash**, one per player per day | `db/admin.js` `actorHash`: HMAC-SHA256 with a server secret, truncated | Matches, but it is **pseudonymous data**, not anonymous. The owner's "no identifying information" is therefore stated only for the aggregate figures shown to staff, and the notice discloses the hash. |
| Daily totals 400 days; analytics write batches 3 days | `RETENTION.dailyDays = 400`; batches purged at 3 days | Matches. |
| Feedback 180 days; admin audit log 365 days | `RETENTION.feedbackDays = 180`, `RETENTION.auditDays = 365` | Matches. |
| Feedback link removed on account deletion, text kept | `ON DELETE SET NULL` (`docs/ACCOUNT_DELETION_AND_RETENTION.md`) | Matches. |
| Chat reports: 12 months after resolution | No resolved state in `chat_reports`; no purge in `db/admin.js` or `db/auth.js` | **Mismatch. Not enforced.** Marked in the notice. |
| Match history: 24 months after the match | Matches are kept indefinitely by design (`db/matches.js`, `db/account.js` comment); no deletion job | **Mismatch. Not enforced.** Marked in the notice. |
| Player reports (not in the owner's list) | No purge | **Gap.** The notice says reports are kept "until dealt with, and then for 12 months" as a single rule, marked for the same deletion job. Owner to confirm the period for player reports too. |
| Hosting logs up to 7 days | Not in the repository. `render.yaml` does not state a retention period. Owner-confirmed 2026-11-17 (Render Hobby) | **Owner-confirmed, not verifiable in the repo.** Notice updated. |
| Account data until deletion | Account deletion removes account, sessions, devices, friends, blocks, recent tables (`db/account.js`) | Matches. Unverified accounts older than 30 days are removed only by manual cleanup (`db/unverifiedCleanup.js`), not by a schedule. |
| Deleted accounts appear as "Deleted player" in finished matches | `db/matches.js` `DELETED_NAME = 'Deleted player'`; `db/account.js` `removePlayerTx` anonymises the seat and clears `player_id` | Matches. The notice adds that the match records (game, scores, positions, times) remain and that anonymity is not assessed. |
| Live chat after deletion | Message text stays in table memory until the table closes; author shown as "Deleted player" (`docs/ACCOUNT_DELETION_AND_RETENTION.md`) | Matches. Disclosed. |
| Reports against a deleted account keep the name | Migrations 015 and 023 keep the name at the time, clear the link | Matches. |
| Staff see country, join and last-seen dates, games, wins, time played, games left early, level; not e-mail or password | `db/playerStats.js` and `public/admin.js` columns | Matches. |
| Staff cannot see an account's e-mail address | `db/admin.js` `authorizeVerifyResend`: the address is returned to the server only, and the audit row records the attempt | Matches. The notice adds that staff can trigger a new verification e-mail. |
| **Owner is the only person with routine production access** | `db/admin.js` allows both `admin` and `owner` roles into the console | **Resolved by owner confirmation (2026-11-17): no other production admin users.** The code's `admin` role is unchanged; see section 1. |
| Owner-sent e-mail to an unverified account, staff cannot read the address | `db/admin.js` `authorizeVerifyResend` | Matches. |
| Public profile shows no country | `db/account.js` `getPublicProfile` returns username, display name, avatar, join date, win/game statistics and progress, with no country or e-mail | Matches. |
| Google profile picture is not stored | `lib/googleAuth.js` returns `picture` to the verifier; no code path stores it | Matches. |
| Neon point-in-time restore history 6 hours | Owner-confirmed 2026-11-17 (Neon console). Not verifiable in the repo. `docs/OPERATIONS_RUNBOOK.md` should record it | Owner-confirmed. Notice updated. |
| Country: optional, chosen by the player, visible to the player and staff, counted in aggregates, not on public profiles | `db/account.js` `updateCountry` (player's choice from the ISO list); `public/app.js` comment; `db/playerStats.js` | **Added to the notice.** It was missing before. |
| No self-service export | No export route in `lib/*Routes.js` | Matches. Manual process only. |
| Google sign-in offered only while the privacy notice is live | `server.js`: `googleAllowed: privacyLive` | Matches. |
| Voice off by default; Metered and STUN used only when voice is on | `lib/voiceRelay.js` `voiceEnabled` (`VOICE_ENABLED === 'true'`); STUN list includes Google and Cloudflare | Matches. |
| E-mail provider is Resend | `lib/email.js` (`EMAIL_PROVIDER=resend`) | Matches. |
| Neon in Singapore; Render in Oregon; Metered primary in Canada | Owner decision only. Not in the repository. Neon's backup and point-in-time retention is recorded as unverified in `docs/OPERATIONS_RUNBOOK.md` | **Owner-stated, unverified.** Marked for confirmation against the provider consoles and terms. |

## 3. Google sign-in readiness

- Google sign-in is offered only when `googleAllowed` is true, which means the privacy notice is published (`server.js`). The client ID (`GOOGLE_CLIENT_ID`) is also needed.
- Google-only accounts can delete themselves through Google confirmation. This needs only the client ID, and the deletion verifier is created whenever the client ID is set.
- While the notice is unpublished, a signed-out Google-only user cannot reach the deletion dialog, because they cannot sign in. This is the edge case the owner described, and it stays until the notice is published and the client ID is set.
- Once both are set and the notice passes its publication checks (complete controller details and no unresolved `[OWNER]` or `[LEGAL]` markers), the flow is: sign in with Google, open the account page, delete, confirm with a fresh Google sign-in for the same identity. The server checks the identity. The safeguard is not removed.
- The manual deletion route (for a user who cannot sign in) is available when either the live privacy notice or the published Impressum publicly exposes the contact and the owner confirms the inbox is monitored. The privacy page exposes `{{IMPRESSUM_EMAIL}}` independently of the Impressum publication switch. Until either page exposes it, do not direct users to that address. Use the identity check and database-backup and recorded-approval process in `docs/ACCOUNT_DELETION_AND_RETENTION.md`.
- **Nothing here sets the client ID or the publication switch.** Both are owner actions on Render, after approval.

## 4. Unresolved items (engineering)

1. Build or confirm a deletion job for **chat reports** (12 months after resolution). This needs a "resolved" state on reports first; none exists today.
2. Build a deletion job for **player reports** and set their period (owner to confirm).
3. Build a deletion job for **finished match records** (24 months). Note the trade-off: match records are kept so other players' results stay correct, so the deletion must keep those results consistent.
4. Decide whether **rate-limit records** stay at 1 day (the code, and what the notice states) or move to the owner's earlier 30-day proposal, which needs a code change.
5. Broadcast history (`email_broadcasts`): no broadcasts are sent in the beta, so no period is needed now. Before any broadcast is sent, set a period and update the notice.
6. Record the **Neon** plan and the 6-hour point-in-time window in `docs/OPERATIONS_RUNBOOK.md` (owner-confirmed; not yet written there).
7. **Guest rows (M-7) are not verified.** The read-only count was not run from this environment: it needs the production database, which this session does not use. See section 5, item 4.
8. **Chat reports, player reports and finished matches have no deletion job.** The owner's 12-month and 24-month periods are not enforced, so the notice keeps them marked. Two ways to resolve: build the jobs (a separate PR: a "resolved" state for reports, a purge for reports, and a match-history job that keeps other players' results correct), or the owner accepts indefinite retention for the beta and the notice says so. Do not publish the periods until one of these is done.

## 5. Owner actions (manual, outside the repository)

1. **Provider DPAs and transfer mechanisms** (not independently evidenced; pending): for Render, Neon, GitHub, Resend, Metered and Google, check the data processing terms in each account and record which transfer mechanism applies. The notice keeps one marker per provider until this is done.
2. **Manual database backups**: state how long the owner keeps any manual `db:backup` file, and where. The notice keeps a marker for this.
3. **Guest count (M-7)**: run the read-only query against production, using the owner's read-only access, and record the result in `docs/STAGE_20_6_BETA_READINESS.md`: `SELECT count(*) FROM players WHERE is_anonymous;`. If the count is above zero, decide a rule before publication. Do not modify or delete any rows.
4. **Retrieve test for data requests**: confirm you can retrieve each category of data by read-only query before promising a copy: profile, sign-in e-mail (`auth_identities`), matches, friends, blocks, reports, feedback.
5. **Legal-basis entries** marked `[LEGAL]` (device login, age confirmation, feedback, audit log, records required by law). Approve, or change, each one.
6. **Retention decision** for chat reports, player reports and finished matches (section 4, item 8).
7. **Publication (when everything above is done)**: open a reviewed PR that removes the last markers and sets the publication date to the day of publication. Then, in the Render dashboard, set `PUBLIC_CONTACT_EMAIL=playtableverse@gmail.com`, and set the publication switch. The switch in the code is `LEGAL_PRIVACY_PUBLISHED=true`. The name `PRIVACY_NOTICE_LIVE` in the release plan is not read by the code. Google sign-in follows the switch (`googleAllowed`), so the Google client ID is set after the notice is live. See section 8 for the exact order.

## 6. Questions that need a lawyer or the owner's verification

- Whether the match records kept after deletion count as anonymous under the GDPR, and whether backups can re-link them.
- Whether the device login ("keep me signed in") is strictly necessary under TDDDG § 25, or needs consent. The earlier draft raised this as open question 4 (`docs/PRIVACY_NOTICE_DRAFT.md`).
- The legitimate-interest balancing test for security, moderation, diagnostics and usage statistics.
- The age self-declaration, per country.
- The notice's complaint wording follows GDPR Art. 77 and does not name one authority. Naming one would need the owner's location. Legal to confirm the wording.
- Breach notification: the notice says the relevant authority, and users where the GDPR requires, is notified. Legal to confirm that the runbook procedure meets the 72-hour rule (Art. 33).
- Whether the § 5 DDG provider identification applies to a free beta.

## 7. Tests

`tests/privacy-notice.test.js` checks, without a server or database, that: the notice has no literal e-mail address and uses the contact token; each retention figure stated in the notice matches the constant in the code; the "Deleted player" name matches; the providers and locations are named; the legal bases are present; the response period is stated; the usage statistics are described as pseudonymous; the publication date is not filled in; the notice still cannot be published while markers remain; and the Google gating and deletion text in the docs match `server.js`.

## 8. Release order (for the owner's manual steps)

The publication switch and Google sign-in are not in this PR. The code's names are used below: the switch is `LEGAL_PRIVACY_PUBLISHED`, and Google sign-in follows it through `googleAllowed`. `PRIVACY_NOTICE_LIVE` is not read by the code.

**Stage A (this PR, #234).** Merge into `development` once CI and CodeRabbit pass and threads are resolved. No switch is changed. The notice stays unpublished, `/privacy` returns 404, and Google sign-in stays off.

**Stage B (owner, before publication).** Clear every item in section 5 and the publication blockers in section 9. The publication PR must also update `tests/privacy-notice.test.js`: the assertions that require markers to remain and the unfilled date must change to match the approved text. The fixture test (markers appended to a copy of the notice must block publication) stays. Each open provider DPA or transfer check, the guest count, the retention decision, and the `[LEGAL]` entries. Then open a reviewed PR that removes the last markers and sets the publication date.

**Stage C (release `development` to `main`).** Use the existing promotion process, with owner approval. The switches are still off, so this release changes no public page and enables no sign-in. Verify after deploy: `/privacy` returns 404, and `GET /api/games` reports `privacyPublished: false`.

**Stage D (owner, Render production).** First, confirm `GOOGLE_CLIENT_ID` is unset. If it is set, unset it before anything else, so Google sign-in cannot switch on as soon as the privacy switch is set. Then, in this order:
1. Set every value the legal pages need (`IMPRESSUM_NAME` and `IMPRESSUM_ADDRESS`, both in `TOKENS`) and `PUBLIC_CONTACT_EMAIL=playtableverse@gmail.com`. Without them the page stays unpublished (`detailsComplete` fails closed).
2. Set `LEGAL_PRIVACY_PUBLISHED=true`. Verify: `/privacy` returns 200, with no `[OWNER` or `[LEGAL` text, and the contact shows `playtableverse@gmail.com`. `GET /api/games` reports `privacyPublished: true`.
3. Google sign-in now follows the privacy switch (`googleAllowed`) but stays disabled until the client ID is set. `GET /api/auth/google/config` should show `enabled: false`. Production never passes the test-only `googleVerifier` override (`server.js`), so the client ID alone does not turn sign-in on.

**Stage E (owner, Render production, after D is verified).** Set `GOOGLE_CLIENT_ID`. Verify: `GET /api/auth/google/config` shows `enabled: true` and `deleteConfirm: true`. Test sign-in and deletion with an owner test account only. Do not use a real player's account. Terms stay unpublished throughout.

Rollback: unset `LEGAL_PRIVACY_PUBLISHED` (the privacy page returns 404 and Google sign-in is turned off), and unset `GOOGLE_CLIENT_ID` to turn Google off. Neither needs a deploy.

## 9. Publication blockers (as of this PR)

- Provider DPA and transfer mechanism: Render, Neon, GitHub, Resend, Metered, Google (section 5, item 1).
- Manual backup retention (section 5, item 2).
- Guest count M-7 (section 5, item 3).
- Chat reports, player reports and finished matches: no deletion job; periods unenforced (section 4, item 8).
- `[LEGAL]` legal-basis and related entries (section 5, item 5, and section 6).
- Publication date (section 5, item 7).


<!-- /coderabbit-ai-generated:v1 -->