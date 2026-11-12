# Admin console audit against the roadmap (2026-11-12)

Audited `main` at `542d736` (after PR #112, the Players tab). This records what exists, what is missing and what is incomplete, and proposes small, independent PRs in priority order. It changes no code.

Sources checked: `lib/adminRoutes.js` (routes), `lib/adminPolicy.js` (roles), `db/admin.js` (overview, health), `db/insights.js` (Insights), `db/playerStats.js` (Players), `db/moderation.js` and `chat_reports` (moderation), `server.js` (platform figures), `public/admin.html` and `public/admin.js` (tabs), and `docs/ADMIN.md`.

## 1. Operations

| Need | Status | What exists | Gap |
|---|---|---|---|
| Active players and tables | Partly | Health tab: rooms, players and sockets, from `server.js` `adminPlatform()` | Live numbers are per process only; there is no history |
| WebSocket health | Partly | Socket count; `ws.socket_error` and related lines in Logs | No disconnect, slow-consumer or rate-limit counters on the panel |
| Server uptime, memory, Node version | Done | Health tab (`uptimeSec`, `memoryMb`, `node`, `mode`) | none |
| Errors | Partly | Analytics `error` counter by code (stored); Logs tab (in memory, 500 lines) | No error trend chart; the counter is not on the Overview |
| Database performance | Minimal | Health tab: round-trip time (`dbMs`), migration count | No pool statistics, no slow-query view |
| Deployment status | Missing | Nothing shows the running commit | Render sets `RENDER_GIT_COMMIT`; not read or shown |
| Render history | Optional | Owner-only Render log view, off until `RENDER_` settings are set | Needs owner configuration |

## 2. Analytics

| Need | Status | What exists |
|---|---|---|
| DAU, WAU, MAU | Done | Overview tiles, from distinct hashed accounts per day (35-day retention) |
| D1 and D7 retention | Done | Insights, cohort of new players (`db/insights.js`) |
| D30 retention | Missing | Easy to add to the same query; needs no new data |
| Sessions | Partly | `session` counter (one per WebSocket connection, so reconnects count again) |
| Games played, games started | Done | `game_started` and `game_finished` counters, per game |
| Completion rate | Missing | Derivable as finished / started per game, but not shown. The counters are not tied to a player |
| Abandonment | Partly | Leave rate per game in Insights (games a player left early) |
| Game duration | Done | Average and median minutes per game, play-time buckets in Insights |

## 3. India vs Germany

| Need | Status | What exists |
|---|---|---|
| Country data | Partly | Optional, self-chosen country on the profile (migration 022, PR #111). Never derived from an address |
| Players by country | Done | Insights: players per chosen country |
| Engagement by country | Missing | No per-country games, retention, duration or leave rate |
| Reliability | Not yet | Opt-in data is biased and can be small. No minimum-sample rule, so small counts could identify a player |

## 4. Moderation

| Need | Status | What exists | Gap |
|---|---|---|---|
| Unresolved reports | Missing | Overview counts only: reports in the last 7 days and in total | No list, no open queue, no way to act on a report in the console |
| Severity | Missing | Reports carry a reason | No severity model or triage order |
| Recurring issues | Missing | Nothing | Reports per reported account are a simple query; not shown |
| Resolution status | Missing | `chat_reports` has no status or resolution columns | Needs a migration (023 is the next free number) and an audited action |
| Feedback triage | Done | Feedback tab: new, read, resolved; audited | none |
| Suspension | Done | Owner-only, audited, reason kept | none |

Moderators currently review reports with manual queries, as `docs/CHAT_MODERATION.md` describes.

## 5. Admin security

| Need | Status | What exists |
|---|---|---|
| Roles, server-side permissions | Done | `owner`, `admin`, `user`; role read from the database on every request; one owner (unique index); tested in `tests/admin.test.js` |
| CSRF and rate limits | Done | Double-submit token on every admin POST; per-address and per-account limits |
| Audit logging | Done | `admin_audit_log` in the same transaction as each change; player profile views are audited (#112) |
| Audit viewing | Done | Audit log tab (staff) |
| Two-factor readiness | Missing | No second factor for any admin; `docs/ADMIN.md` lists it as a limit |
| Re-authentication for owner actions | Missing | Owner actions use the normal session only |
| Owner transfer | By design | Operator action on the database, not in the UI |

## Prioritised plan

Each item is one small PR with tests and a doc update. Nothing here needs a new dependency unless marked.

1. **Moderation queue, read-only (no migration).** A staff list of chat reports, newest first, with the reason, the reported account's report count, and whether the account is already suspended. Covered by the existing `tests/moderation*.js`. Highest value for the daily review the beta requires.
2. **Report resolution (migration 023).** Adds `status` (open, dismissed, actioned), `resolved_at`, `resolved_by` and a short note; staff can change status, every change is audited. Owner approval needed for the migration.
3. **Deployment and operations panel.** Show the running commit (`RENDER_GIT_COMMIT`) and the process start time on the Health tab; add the WebSocket disconnect counts that the server already logs. Read-only.
4. **Retention and completion.** Add D30 to the cohort query, and a completion rate per game (finished / started) to the Insights tab. Uses existing data only.
5. **Country engagement with a minimum sample.** Per-country games per player, D1 and average minutes, with any country below 10 players hidden. The note must say that the figures cover only players who chose a country.
6. **Two-factor readiness (owner decision first).** Choose between TOTP with a new dependency and a pure-Node implementation, and decide whether it is required or optional for admins. Needs owner approval before any code.
7. **Re-authentication for owner actions.** Requires a design decision with item 6.

## Owner decisions needed

- Approve the migration for item 2 (`023`).
- Decide the 2FA approach and whether it is required for admins (item 6).
- Approve the minimum sample size for country figures (item 5; 10 is proposed).

## Notes

- PR #101 (Impressum) was merged on 2026-11-12, not kept as a Draft as the earlier instruction required. The page stays unpublished until `LEGAL_IMPRESSUM_PUBLISHED=true` and the legal review is done (`bc79130`). The owner should confirm this is intended.
- The Node pg suites could not be run in this sandbox (no installed dependencies, and no network to the package registry). The Players query change in PR #112 was checked against a real PostgreSQL 16 database with the migrations applied; the full pg suite should still run in CI.
