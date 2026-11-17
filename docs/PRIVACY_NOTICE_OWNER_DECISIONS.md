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
| Production access | Owner is the only routine authorised person, with a marker because the code has an `admin` role. Providers may have limited technical access under their safeguards; the notice does not say they have none. |
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
| Hosting and application logs 30 days | Not in the repository. `render.yaml` does not state a region or a retention period | **Unverified.** Marked. |
| Account data until deletion | Account deletion removes account, sessions, devices, friends, blocks, recent tables (`db/account.js`) | Matches. Unverified accounts older than 30 days are removed only by manual cleanup (`db/unverifiedCleanup.js`), not by a schedule. |
| Deleted accounts appear as "Deleted player" in finished matches | `db/matches.js` `DELETED_NAME = 'Deleted player'`; `db/account.js` `removePlayerTx` anonymises the seat and clears `player_id` | Matches. The notice adds that the match records (game, scores, positions, times) remain and that anonymity is not assessed. |
| Live chat after deletion | Message text stays in table memory until the table closes; author shown as "Deleted player" (`docs/ACCOUNT_DELETION_AND_RETENTION.md`) | Matches. Disclosed. |
| Reports against a deleted account keep the name | Migrations 015 and 023 keep the name at the time, clear the link | Matches. |
| Staff see country, join and last-seen dates, games, wins, time played, games left early, level; not e-mail or password | `db/playerStats.js` and `public/admin.js` columns | Matches. |
| Staff cannot see an account's e-mail address | `db/admin.js` `authorizeVerifyResend`: the address is returned to the server only, and the audit row records the attempt | Matches. The notice adds that staff can trigger a new verification e-mail. |
| **Owner is the only person with routine production access** | `db/admin.js` allows both `admin` and `owner` roles into the console | **Conflict.** Marked. Owner to confirm whether any admin accounts exist, or to change the decision. |
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
4. Decide whether **rate-limit records** stay at 1 day (the code) or move to the owner's 30 days (the notice currently states the code's period).
5. Set a period for **broadcast history** (`email_broadcasts`), or confirm that broadcasts are not sent during the beta.
6. Record the **Neon** plan, backup and point-in-time retention window in `docs/OPERATIONS_RUNBOOK.md` (manual check).
7. Decide whether **guest rows** exist in production (read-only count; runbook M-7).

## 5. Owner actions (manual, outside the repository)

1. Confirm the **provider terms** (DPA and transfer mechanism) for Render, Neon, GitHub, Resend, Metered and Google, and the **data locations** named in the notice. Record the Neon backup window.
2. Confirm whether any **admin accounts** exist. If they do, the notice paragraph on access must say so, or the decision must change.
3. Confirm **Render log retention** (the decision is 30 days).
4. Confirm you can retrieve each category of data by read-only query before promising a copy: profile, sign-in e-mail (`auth_identities`), matches, friends, blocks, reports, feedback.
5. Confirm that no **owner broadcast** is sent during the beta.
6. Approve the **legal-basis** entries marked `[LEGAL]` (device login, age confirmation, feedback, audit log, records required by law).
7. Set `PUBLIC_CONTACT_EMAIL=playtableverse@gmail.com` on Render (the contact address the notice uses) when the notice is published. It is not set by this change.
8. When everything is resolved: publish through a reviewed PR that removes the markers, then set `LEGAL_PRIVACY_PUBLISHED=true` and, when you want Google sign-in, `GOOGLE_CLIENT_ID`. Set the publication date to the day it is actually published.

## 6. Questions that need a lawyer or the owner's verification

- Whether the match records kept after deletion count as anonymous under the GDPR, and whether backups can re-link them.
- Whether the device login ("keep me signed in") is strictly necessary under TDDDG § 25, or needs consent. The earlier draft raised this as open question 4 (`docs/PRIVACY_NOTICE_DRAFT.md`).
- The legitimate-interest balancing test for security, moderation, diagnostics and usage statistics.
- The age self-declaration, per country.
- The competent supervisory authority, once the owner's location is confirmed.
- Breach-notification timings and the notice wording for them.
- Whether the § 5 DDG provider identification applies to a free beta.

## 7. Tests

`tests/privacy-notice.test.js` checks, without a server or database, that: the notice has no literal e-mail address and uses the contact token; each retention figure stated in the notice matches the constant in the code; the "Deleted player" name matches; the providers and locations are named; the legal bases are present; the response period is stated; the usage statistics are described as pseudonymous; the publication date is not filled in; the notice still cannot be published while markers remain; and the Google gating and deletion text in the docs match `server.js`.


<!-- /coderabbit-ai-generated:v1 -->