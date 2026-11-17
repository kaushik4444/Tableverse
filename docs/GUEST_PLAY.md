# Guest play

Status: **implemented on `feat/guest-play`, off by default.** Guest play is approved by the owner (2026-11-18) and stays off in production until the owner sets `GUEST_PLAY_ENABLED=true` in Render. Nothing in this document changes production settings.

## What a guest is

A guest is a visitor who plays without registering. The app makes a temporary account for them: a player row with `is_anonymous = TRUE`, a display name, an avatar, and a session cookie. A guest has no e-mail, no password and no username, so no friends, no reports and no profile page of their own.

## Switches

| Setting | Where | Default | Effect |
|---|---|---|---|
| `GUEST_PLAY_ENABLED` | Render environment (never in a file) | unset = off | Only the exact value `true` allows new guest sessions. Anything else refuses `POST /api/auth/guest` with 403. |
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

Guests use the same register sheet. `POST /api/auth/upgrade-guest` with a username, an e-mail, a password and the 18+ confirmation:

- The **same player row** becomes the account (`is_anonymous` becomes false). The player id, the match history and the stats stay as they are. Nothing is copied, so nothing is duplicated.
- The same password, username and e-mail rules apply as for a new account. A taken username gives 400; a taken e-mail gives 409 (the same answer as registration, so it does not reveal accounts).
- The e-mail verification rule applies from then on, exactly as for a new account. The page reconnects as the account.
- A registered player gets 403 on this route.

## Reminders (on the page)

A reminder is a small box that says a guest can keep their progress with an account. It is shown on the home page, on creating a table (for the host), on the profile and friends pages, and on the game-over card (a stronger version). Rules (`public/guest.js`):

- Never over a game in progress. Only the game-over card appears during or after a game.
- At most one reminder every six hours on different pages.
- "Not now" hides a reminder for three days (30 minutes for the game-over card).
- The frequency is kept in the browser's local storage. Losing it only shows the reminders again.

## Tests

- `tests/guest-policy.test.js`, `tests/guest-names.test.js`, `tests/guest-nudge.test.js`, `tests/game-access.test.js`, `tests/game-flags.test.js`: pure, run locally with `node tests/<file>.js`.
- `tests/guest-play.test.js`: HTTP and WebSocket tests in memory mode (switch off, switch on, CSRF, access modes, the account prompt, the plain refusal). Needs the server's npm dependencies (run in CI).
- `tests/guest-play.pg.test.js`: PostgreSQL tests (creation, name suffix, upgrade in place, refused upgrades, expiry, match rows). Needs `TEST_DATABASE_URL` and a throwaway database, never production.
- Not yet covered by automated browser tests: the home-page guest button, the locked tiles and the reminders.

## Rolling out and rolling back

1. Test on a local or staging database with `GUEST_PLAY_ENABLED=true` (see `docs/LOCAL_DEVELOPMENT.md`).
2. Owner sets the variable in Render only after the owner decisions below are recorded.
3. To stop new guests: set `GUEST_PLAY_ENABLED` to anything but `true`. Existing guest sessions keep working until they expire.
4. To stop one game for guests, set its access mode to "Disabled for guests only" in the Games tab.

## Open decisions (owner)

- **Guest match names.** Should the name shown on a match record of a deleted guest be replaced with "Deleted player", as for deleted accounts? Currently it is kept.
- **Privacy notice.** `docs/PRIVACY_NOTICE_DRAFT.md` still says there are no guest records. It must be updated and approved before guest play is turned on. It is not published.
- **Beta decision D-1.** Recorded as superseded in `docs/STAGE_20_6_BETA_READINESS.md`.
- **What's New.** Not added while the feature is off. Add the entry when the owner turns it on.
- **Retention period** for the guest session (default 72 hours) and the purge (one day after creation).
