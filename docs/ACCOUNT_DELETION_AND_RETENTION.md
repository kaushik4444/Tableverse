# Account deletion and data retention (as implemented, 2026-11-10)

Status: **describes current behaviour, verified against the code on `main`**. Not a legal document; see the legal-review list at the end.

Each statement below names the code that does it. Where a number is a default that the owner can change by environment variable, the variable is given.

## How a user deletes their account (self-service, implemented)

1. Signed in, open the profile page and choose **Delete account** (`public/app.js`).
2. Enter the account password. The server checks it (`db/account.js` `deleteAccount`). A wrong password changes nothing.
3. `POST /api/me/delete-account` runs. It is rate limited to 5 attempts an hour per account (`RL_ME_DELETE_LIMIT`).
4. The account is removed in one transaction. The player's open game socket is closed.

Limits:
- The **owner account cannot be deleted** this way. Ownership must be handed over by the operator first (`docs/ADMIN.md`).
- A deletion is final. There is no undo and no grace period.
- A user cannot delete someone else's account. Only the owner can suspend an ordinary registered account, and no one can delete an account from the console.

## What is removed when an account is deleted

Removed by the deletion itself or by foreign-key cascade (`ON DELETE CASCADE` in the migrations):

| Data | Result |
|---|---|
| Account row: username, display name, avatar, join date, last-seen time, role | removed |
| Sign-in e-mail address and password hash (`auth_identities`) | removed |
| Every login session, device login ("keep me signed in") and password-reset or verification token | removed |
| Friendships and friend requests, invitations | removed |
| Blocks made by or against the account | removed |
| Recent-table list | removed |
| Chat reports the account **filed** | removed |
| Chat reports made **against** the account | kept, with the account link cleared and the name at the time kept (migration 015) |
| Feedback text the account sent | kept, with the account link cleared (`ON DELETE SET NULL`). Feedback is not meant to hold personal data (the form says so) |
| Admin audit entries the account made | kept, with the actor link cleared, for the audit period |
| Finished matches the account played | **kept**: the seat's name becomes `Deleted player` and the link to the account is cleared, so other players' results and histories stay correct |
| Live table chat the account sent (message text) | **not removed by deletion.** The author is shown as `Deleted player`, but the message text stays with its table in server memory while the table is open, and is shown to people who join that table later. Live chat is not written to the database and is gone when the table closes or the server restarts. A message someone reported is also kept as a report (above). Players must not put identifying information in chat, because deleting the account does not remove it |

Not yet verified: whether an e-mail-broadcast recipient row is removed with the account (it is declared `ON DELETE CASCADE` in migration 016, but this was not tested end to end).

## Retention periods (automatic, as implemented)

Housekeeping (`server.js`, `db/auth.js` `purgeExpired`, `db/admin.js` `purge`) runs once at startup and then every six hours. Its failures are logged and retried at the next run. The periods below are **purge-eligibility thresholds, not exact deletion deadlines**: a row may be kept longer if housekeeping has not run, and for sessions the rule is "expired more than 7 days ago, **or** revoked more than 30 days ago" (`db/auth.js`), so a revoked row can be removed less than 30 days after revocation. Do not rely on these as exact dates in a request or an incident.

| Data | How long it is kept | Where set |
|---|---|---|
| Login sessions | 30 days from sign-in (`AUTH_SESSION_TTL_DAYS`); removed once expired for 7 days, or revoked (the OR rule above, so possibly sooner than 30 days after revocation) | `docs/SESSION_POLICY.md` |
| Device logins ("keep me signed in") | deleted 30 days after expiry or revocation | `db/auth.js` |
| Verification tokens | valid 24 hours (`AUTH_VERIFY_TTL_MIN`); deleted 7 days after expiry or use | `db/auth.js` |
| Password-reset tokens | valid 30 minutes (`AUTH_RESET_TTL_MIN`); deleted 7 days after expiry or use | `db/auth.js` |
| Rate-limit counters (including the **raw IP address** of the request) | deleted after 1 day | `db/auth.js`, `db/migrations/004` |
| Usage counters: active players (keyed hash, never the account id) | 35 days | `db/admin.js` `RETENTION.activeDays` |
| Usage counters: daily totals | 400 days | `RETENTION.dailyDays` |
| Analytics write batches | 3 days | `db/admin.js` |
| Feedback text | 180 days | `RETENTION.feedbackDays` |
| Admin audit log | 365 days | `RETENTION.auditDays` |
| Announcements (ended) | 90 days after they end | `RETENTION.announcementDays` |
| Unverified e-mail accounts (older than 30 days) | **not removed yet**: the cleanup exists but `CLEANUP_EXECUTE=false`; a dry run reports the count only | `docs/DATA_CLEANUP.md`, `db/unverifiedCleanup.js` |

## Data with no automatic deletion (gaps to resolve before public beta)

These are kept until the account is deleted or someone deletes them by hand. No code path removes them on a schedule.

1. **Guest accounts (`players.is_anonymous = TRUE`).** No route in the current code creates them: guests cannot play, because the game socket requires a signed-in session. Rows that exist can only come from earlier code. Check with a read-only count, `SELECT count(*) FROM players WHERE is_anonymous;`. If the count is above zero, decide a retention rule before inviting anyone. The unverified cleanup excludes guests by design.
2. **Chat reports.** The reported message text (up to 200 characters), the reason and the reporter link are kept indefinitely (`chat_reports`). No retention period is set.
3. **Finished match records.** Kept indefinitely, by design, so results stay correct. Players are told they are kept with the name `Deleted player`.
4. **Recorded broadcasts** (subject and message history, `email_broadcasts`). No retention period found in the code.

## Access and export

- A user can see their own profile, match history and recent tables in the app.
- **There is no self-service data export.** A request for a copy of the data would be handled by hand by the owner. This is not implemented in the product and must not be described as available.

## Third parties that hold or process data (from current configuration)

- **Render**: hosts the application server and its logs (`render.yaml`). Log retention on the current plan is not verified.
- **Neon (PostgreSQL)**: holds every table above. Backup and restore facts are recorded as unverified in `docs/OPERATIONS_RUNBOOK.md`.
- **Resend**: sends verification, password-reset and (owner-approved) broadcast e-mail. Receives the address and the message.
- **Metered**: TURN relay for voice. Players' network addresses and relayed voice traffic pass through it when a relay is used. Voice media is encrypted between the peers; the relay still carries it.
- **Google and Cloudflare STUN servers** (`lib/voiceRelay.js`): receive the player's network address during voice setup.
- **GitHub**: holds the source code and runs the scheduled cleanup workflow (`.github/workflows/cleanup-unverified.yml`). That workflow holds two database credentials as repository secrets: a read-only one for the daily dry run (counts only), and one for the deletion job, which runs only when started by hand with `CLEANUP_EXECUTE=true` and an approval in the `production-cleanup` environment. Job summaries keep counts. The workflow is not meant to print individual player records, but a player's data is reachable by anyone with those secrets, so their boundary is part of this disclosure.

## Open items for the owner

- Decide retention periods for chat reports and broadcast history, and for any legacy guest rows (check the count first, runbook M-7 in `docs/STAGE_20_6_BETA_READINESS.md`). No code changes are made by this document.
- Decide whether a self-service data export is needed for the beta, or whether a manual request process is acceptable.
- Confirm the provider list against the live configuration before publishing it.
