# Guest play

Status: **merged into `development` (PR #235), off by default.** Guest play is approved by the owner (2026-11-18), and the owner has decided to turn it on for the beta launch (2026-11-28). It is **off in production until the owner sets `GUEST_PLAY_ENABLED=true` in Render**. This repository cannot confirm that setting, so check it in Render. Nothing in this document changes production settings.

## What a guest is

A guest is a visitor who plays without registering. The app makes a temporary account for them: a player row with `is_anonymous = TRUE`, a display name, an avatar, and a session cookie. A guest has no e-mail, no password and no username, so no friends, no reports and no profile page of their own.

## Switches

| Setting | Where | Default | Effect |
|---|---|---|---|
| `GUEST_PLAY_ENABLED` | Render environment (never in a file) | unset = off | Only the exact value `true` allows new guest sessions (lowercase, no spaces; `TRUE` or ` true ` do not count). Any other value, or unset, refuses `POST /api/auth/guest` with 403. To stop new guests, set `false` or unset it. |
| `GUEST_SESSION_TTL_HOURS` | Render environment | 72 | How long a guest session lasts. Clamped to 1–168. Bad values use 72. |
| `RL_GUEST_IP_LIMIT` | Render environment | built-in default | Guest sessions per IP address per hour. |
| `RL_GUEST_ALL_LIMIT` | Render environment | built-in default | Guest sessions in total per hour (a cap on the whole service). |

Which **games** a guest may play is not an environment setting. It is the owner's access mode for each game, in the admin console (Games tab). See below.

## Game access modes (admin console)

Each game has one of four modes. "Enabled" is the default for every game.

| Mode (label in the console) | Owner | Admins | Registered players | Guests |
|---|---|---|---|---|
| Enabled for everyone (`on`) | yes | yes | yes | yes |
| Disabled for non-admins (`admins`) | yes | yes | no | no |
| Disabled for guests only (`guests`) | yes | yes | yes | no |
| Disabled for all (not owner) (`owner`) | yes | no | no | no |

The server checks the role when a table is created, joined, started or rematched. A guest refused a game that registered players may play is shown the account prompt ("Create a free account to play…"). Anyone else is told the game is not available right now. A change applies within about 15 seconds, and each change is written to the audit log. Games already in progress are not ended.

Code: `public/game-access.js` (rule, shared by server and page), `lib/gameFlags.js`, `lib/adminRoutes.js`, `db/admin.js`, migration `db/migrations/030_game_access.sql`.

## What guests may do (switches in the admin console)

Guests can always **read and send table chat**, and play the games their access mode allows. Everything else below is **locked for guests by default**. Staff (admin or owner) open or lock each area in the admin console, **Guests** tab. A switch is stored in the database (migration `032_guest_features`, table `guest_features`), not in an environment variable, and it takes effect on the server at once.

| Area (switch key) | Default | What a locked guest sees |
|---|---|---|
| Create private tables (`private_tables`) | locked | The host's visibility control shows a note. Tapping "Private" opens the account reminder and sends nothing. The server also refuses the change (`guest_locked`). |
| Rejoin a table they left (`rejoin`) | locked | A guest who leaves a table on purpose cannot get back in. A dropped connection still reconnects, whatever the switch says. |
| Open player profiles and stats (`profiles`) | locked | Tapping a player opens the account reminder. The profile route answers 403 `guest_locked`. |
| Block players (`blocking`) | locked | The Block buttons are marked with a lock and open the account reminder. The server refuses the block. |
| Report chat messages (`reports`) | locked | The Report buttons on chat messages are marked with a lock and open the account reminder. Reporting a player always needs an account, whatever this switch says. |

- **Friend requests are always account-only.** They are not a switch. A guest gets 403 `guest_locked` (feature `friends`) on every friends route.
- **Chat stays open** to guests. A locked switch never stops chat.
- A guest's browser learns the locked areas when it connects (the welcome message, `guestLocked`). A change made while a guest is connected is seen after that guest reconnects. The admin console says so when a switch is saved.
- The account reminder uses the same wording for each area (`GUEST_LOCK_TEXT` in `public/app.js`). Changing a switch does not change the wording.
- Each change is written to the audit log (action `guest.feature`), and only a real change is recorded.
- The switches are fail-closed: until the server has read them for the first time, every area is locked. The memory mode (no database) has no stored switches, so every area stays locked there.

Code: `lib/guestFeatures.js` (the snapshot the server reads), `lib/adminRoutes.js` (`GET` and `POST /api/admin/guest-features`), `server.js` (`guestLocked`), `lib/accountRoutes.js`, `lib/friendRoutes.js`, `public/app.js`.

## Plays per game (guest trials)

In the admin console's Games tab (owner only), tick "Limit guests" to limit how many games a guest device may start in one
game, then pick 1 to 9 plays (3 when first ticked). Untick it to remove the limit. Each change is audited as `game.trial_limit`.
The limit is saved now and shown in the console; it is enforced when the next release adds the start check (see the trials
PRs). A limit counts only guest seats; registered players are never counted. A device's count is kept by a hash of its
trial cookie, so clearing cookies starts a new count: the limit is a deterrent, not a lock.

## Making a guest

`POST /api/auth/guest` with a CSRF token. The display name is optional. It is trimmed, cleaned of control characters, and capped at 20 characters; an empty name becomes "Guest". If the name is already used by someone active in the last 7 days, a random 4-digit number is added (a longer one after several tries). The response sets an HttpOnly session cookie that lasts `GUEST_SESSION_TTL_HOURS`.

## What is stored for a guest

- The player row: display name, avatar, a creation time, and the last-seen time. No e-mail, no password, no username.
- The session: a hash of the session token (never the token), its expiry and whether it was revoked.
- Match records the guest plays: one row per seat with the name shown at the table, the seat, the score and whether the seat won (the same rows as for registered players).
- Chat messages are not stored (as for everybody). Table chat is in memory while the table is open.

## How long it is kept

1. **While the session is live**, the guest row and its games are kept.
2. **When the session ends** (after `GUEST_SESSION_TTL_HOURS`, or when it is revoked), the guest row is deleted by the housekeeping job (every six hours) once it is more than one day old and no live session is left.
3. **Match records** are kept. When the guest row is deleted, the match rows stay with `player_id` cleared, so they no longer point at anyone, but they keep the name shown at the table and the scores. **This is an open owner decision** (see "Open decisions").

A guest who upgrades (below) keeps the same row, so nothing is lost and nothing expires.

## Upgrading a guest to an account

Guests use the same register sheet. It is a two-step process, so nothing about the guest changes until the owner of the e-mail address has proven it:

1. `POST /api/auth/upgrade-guest` with a username, an e-mail, a password and the 18+ confirmation (`db/auth.js` `requestGuestUpgrade`). The details are stored as a **pending request** in `guest_upgrades` (the password is stored only as a hash), and a one-time link is e-mailed (`confirm_upgrade` template, same page as e-mail verification). The guest stays a guest, in the same game, with the same locks.
   - The same password and username rules apply as for a new account. A taken **username** gives 400 (usernames are public).
   - A taken **e-mail** is not reported. The response is the same as for a new address (`pending: true`), and the owner of the address gets the "account already exists" e-mail instead of a link. Registration does the same.
   - A new request replaces the earlier pending one, so only the latest link works.
2. The link is used (`POST /api/auth/verify-email`, `completeGuestUpgrade`). Then the **same player row** becomes the account (`is_anonymous` becomes false, the username is set, the e-mail identity is created **already verified**, the password hash is stored). The player id, the match history and the stats stay as they are. Nothing is copied. The guest's session continues as the account, with the normal session length. Live sockets of that player stop counting as guests at once (`onGuestUpgraded`).
   - The link is single-use and expires with its time limit. An expired link, a name or address taken in the meantime, or a guest that has already ended gives 400 and changes nothing.
   - Pending requests are removed a day after their link ends (`purgeExpired`).
3. A registered player gets 403 on this route.

## Reminders (on the page)

A reminder is a small box that says a guest can keep their progress with an account. It is shown on the home page, on creating a table (for the host), on the profile and friends pages, and on the game-over card (a stronger version). Rules (`public/guest.js`):

- Never over a game in progress. Only the game-over card appears during or after a game.
- At most one reminder every six hours on different pages.
- "Not now" hides a reminder for three days (30 minutes for the game-over card).
- The frequency is kept in the browser's local storage. Losing it only shows the reminders again.

## Tests

- `tests/guest-policy.test.js`, `tests/guest-names.test.js`, `tests/guest-nudge.test.js`, `tests/game-access.test.js`, `tests/game-flags.test.js`: pure, run locally with `node tests/<file>.js`.
- `tests/guest-play.test.js`: HTTP and WebSocket tests in memory mode (switch off, switch on, CSRF, access modes, the account prompt, the plain refusal, every locked area, welcome `guestLocked`). Needs the server's npm dependencies (run in CI).
- `tests/guest-features.test.js`: the switch snapshot (locked by default, fail-closed before the first read, unknown keys ignored).
- `tests/admin-guest-redeploy.test.js`: the admin routes for switches (staff only) and the owner-only redeploy (typed word, audit row, cooldown, not set up).
- `tests/render-deploy.test.js`: the Render client with a fake fetch (not configured makes no call, path, header and body, status-only errors, cooldown).
- `tests/ui/admin-ui.js`: the Guests tab and the redeploy control in a browser.
- `tests/guest-play.pg.test.js`: PostgreSQL tests (creation, name suffix, upgrade in place, refused upgrades, expiry, match rows). Needs `TEST_DATABASE_URL` and a throwaway database, never production.
- `tests/ui/guest-ui.js`: browser tests (Playwright, mocked server and socket) for the home-page guest button, the name sheet, the locked tile and its account prompt, the reminder and its dismissal, the upgrade form (confirmation request, guest stays a guest) and the live update when an account is confirmed.
- `tests/guest-play.pg.test.js`: also checks the stored switches and the redeploy audit row (needs PostgreSQL; run in CI).

## Rolling out and rolling back

1. Test on a local or staging database with `GUEST_PLAY_ENABLED=true` (see `docs/LOCAL_DEVELOPMENT.md`).
2. Owner sets the variable in Render only after the owner decisions below are recorded.
3. To stop new guests: set `GUEST_PLAY_ENABLED` to `false` or unset it. Existing guest sessions keep working until they expire.
4. To stop one game for guests, set its access mode to "Disabled for guests only" in the Games tab.

## Open decisions (owner)

- **Guest match names.** Decided by the owner: a finished match keeps the name shown at the table when a guest is removed. Nothing is replaced with "Deleted player".
- **Privacy notice.** `lib/legal/privacy.md` is the privacy notice the app publishes. It must accurately describe guest records and be approved with every `[OWNER]` and `[LEGAL]` marker resolved before guest play is turned on. It is not published.
- **Beta decision D-1.** Recorded as superseded in `docs/STAGE_20_6_BETA_READINESS.md`.
- **What's New.** The entry "Play as a guest" (`public/whats-new-data.js`) ships with the release to `main`, while the switch stays off. Players will see the entry before guest play is on; the owner turns the switch on when ready.
- **Retention decision.** The default guest session lasts 72 hours. The purge rule is fixed in code: a guest row becomes eligible for deletion once it is more than one day old and has no live session; housekeeping runs every six hours. This is not one day after session expiry. Keep these defaults or change the purge code and privacy notice together before enabling guest play.

## Manual steps for the owner (after the release reaches `main`)

Nothing below is done by the code. Each step is in the owner's hands.

1. **Database.** Migrations 030 to 032 (game access, guest upgrades, guest features) apply on the next deploy. Check the deploy log shows them applied. No data is deleted.
2. **Decisions first.** Keep guest play off until the owner has approved `lib/legal/privacy.md`, the notice the app publishes, with every `[OWNER]` and `[LEGAL]` marker resolved, and has recorded approval of the current retention behaviour: a 72-hour session by default, with deletion eligibility once the guest row is more than one day old and no live session remains (housekeeping runs every six hours). This is not one day after session expiry. If changing the purge period, update `purgeExpired` in `db/auth.js` and the privacy notice together before enabling guest play. The notice is not published yet.
3. **Email.** The guest-to-account upgrade sends a confirmation link through the e-mail provider. Check that Resend sends mail from production before turning guest play on. If the mail fails, the player sees an error, but the request still replaces any earlier confirmation link, so the player can ask again.
4. **Choose who may play** in the admin console. Games default to "Enabled" for everyone, so set any game you want kept for registered players in the Games tab. Guest features (private tables, rejoining, profiles, blocking and reports) are locked for guests until you open them in the Guests tab. Table chat stays open to guests.
5. **To turn on:** Render, environment, set `GUEST_PLAY_ENABLED` to `true`, save, wait for the redeploy. Check that `GET /api/games` shows `"guestPlay": true`.
6. **Optional:** `GUEST_SESSION_TTL_HOURS` (default 72) if you want a different guest session length. The privacy text says 3 days, so change the text too if you change this.
7. **To stop new guests:** set `GUEST_PLAY_ENABLED` to `false` or unset it.
