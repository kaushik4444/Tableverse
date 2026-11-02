# Tableverse progress notes (latest work: branch `feature/stage-8-ux-refactor`)

Never merge this branch into `main` from an agent session. Work in small stages: test, commit, push after each.

## How to run the tests
- No database needed: `node tests/<name>.test.js` for engine, twentynine, poker, themind, results, scrub, stats, matchqueue, isolation, email, cleanup, db, production, smoke.
- PostgreSQL suites (`npm run test:pg`) need `TEST_DATABASE_URL` pointing at a THROW-AWAY local database. Never use the Neon production URL.
- A skipped PostgreSQL suite is not a pass. The prior A1–A5 sandbox could not execute PostgreSQL tests; refer to the CI run or run them locally with a dedicated disposable database.

## Completed before Stage 6
- Profiles/history (Stage 5), account deletion anonymisation, revoked-WebSocket and repeat-spectator fixes by the owner (commits dbcb73e, 3a91c6e).
- **A1 Single active session** (migration 006): `createSession` locks the player row, revokes older sessions, inserts; partial unique index `ux_auth_sessions_one_active`; login runs in one transaction; a new login closes the older device's sockets (code 4002, client shows a sign-in sheet); logout/reset close sockets by session token (4001).
- **A2 Spectator reliability**: duplicate joins detect existing seat/watching state before capacity checks, repair stale room state, and avoid duplicate announcements.
- **A3 Wizard/table mobile layout**: mobile overflow and seat/status/trump placement fixed; browser UI suite covered 288 viewport/setup checks.
- **A4 Match history and restart**: unique match key, shutdown-safe spool and periodic replay.
- **A5 Regression review**: recorded in earlier project progress and merged to main.

## Stage 6 progress

### S6.1 — Database & Backend Foundation (verified)
- Branch created from latest fetched `origin/main` at `aafd049` as `feature/stage-6-friends-private-tables`.
- Added migration `007_friends_private_tables.sql` defining canonical friendships, constrained friend-request lifecycle, and private-table invitation metadata with FK cascades, uniqueness and lookup indexes.
- Added `db/friends.js` persistence operations and authenticated endpoints under `/api/me/friends*`, `/api/me/friend-requests*`, and `/api/me/table-invitations*`; routing reuses cookie session auth, CSRF, error handling and rate limiting.
- Updated cleanup classification, delete order and test fixtures for the three new tables.
- Added `tests/friends.pg.test.js`; included it in package scripts/build syntax checks.
- The opposite-direction request policy is auto-accept: a new request in response to an existing reverse pending request atomically accepts it and creates the friendship.
- Known boundary: invitation APIs persist table metadata and invitation lifecycle only. They do not authorize room joins, generate shareable secret codes, create private rooms, send notifications, or provide presence/UI; those behaviors remain for S6.3–S6.5.
- Review fixes: SQL search retains the `[a-z0-9_]` input policy and uses parameterized SQL with LIKE escaping; tests reject `%` and backslash prefixes. Friend-request transitions acquire the canonical pair advisory lock before row locking. Invitation acceptance now shares that lock with friend removal and revalidates friendship before accepting. Added migration-007 concurrent application coverage and invitation/removal race coverage. Cleanup schema inventory now includes both participant FKs for each social table.
- Verification: `node tests/production.test.js` (13 pass), `node tests/smoke.test.js` (pass), `npm run build` (pass), and `git diff --check` (pass). Full `npm run test:pg` passed against the disposable local PostgreSQL test databases with no skips: database/migration 30, PostgreSQL production 17, cleanup 13, account 10, match lifecycle 4, session 7, and friends/invitations 7 tests. The three-instance migration test confirms migrations 001–007 apply once and subsequent migration run is a no-op.
- Test database: local endpoint `127.0.0.1:5432/postgres`; helper creates/drops random `tv_test_*` databases. User provided this as TEST_DATABASE_URL and it passed helper safety checks.
- Commit `bf1c387571fb6a2f2c0c4fd5e2267da5bf46bb61` (`Fix Stage 6.1 friendship invitation races`) pushed to `origin/feature/stage-6-friends-private-tables`; not merged into `main`.

### S6.2–S6.5 — continued by the agent after the owner's `incomplete stage 6` commit (d2f1a23)
Already in place from the owner's commit: private tables (default) need an accepted invitation, enforced on `join`, `sit` and reconnect (`canEnterRoom`); invitation APIs validate the room; live `socialNotice` / `socialPresence` messages; friends panel, invitations and the in-lobby invite form in `public/app.js`; migration 008.
Fixed / added in this session:
- **Per-socket message order**: handlers became async (`join` awaits the DB) but were fired without waiting, so a following `act`/`chat`/`leave` could overtake a join. Messages of one socket now run through a promise queue (`ws.queue`).
- **Host change no longer locks guests out**: authorization accepted only invitations from the *current* host, so after a host handover a guest who reconnected was removed from the table. `room.hosts` records everyone who hosted; `canJoinPrivateRoom` takes a list of inviter ids.
- **Presence shows the game being played** (`playing: 'wizard'`, never the table code); debounced live push (`schedulePresence`) after create/join/sit/leave/start/rematch, game end and table close; no presence DB work in memory mode (it was logging an error per connection).
- **UI**: private lobbies no longer show Copy link / WhatsApp / Share (they are not access grants); fixed real horizontal overflow at 320px (`.page` and `.seats` grid columns were sized by their content; the table code font now scales). Friends panel checked at 320/375/414/768/1280 (no overflow, buttons >= 34px).
- **Tests**: spectators test uses public tables (private ones need an invitation); `cleanup.test.js` expects migration 008 as the newest; `private-tables.test.js` expects 401 (memory-mode players have no cookie session) and lost a duplicated tail; `private-tables.pg.test.js` friend-removal check was vacuous (an earlier refusal already satisfied it) - now compares error counts and checks the table; new host-change and presence scenarios; both private-tables suites are registered in `npm test` / `test:pg` / `build`.

### Verification state (honest)
- Run and passing in the agent sandbox: engine, twentynine, poker, themind, results, scrub, spectators, stats, matchqueue, isolation, email, cleanup, db, production, smoke, private-tables (all DB-free), `npm run build`, `git diff --check`; Playwright layout checks of the lobby/friends UI with mocked API/WebSocket.
- **NOT run (no PostgreSQL server in the sandbox): every `*.pg.test.js`**, including the new host-change and presence scenarios in `tests/private-tables.pg.test.js`. Run `npm run test:pg` against a disposable database before trusting them.
- Known gaps: (fixed in 7.5: unfriending now also removes people who no longer qualify, see below); presence is per server instance; an unfinished mobile Wizard-header experiment is kept in `git stash` (A3 is already on main, so it is probably obsolete).

## Stage 7 (owner-requested follow-ups on this branch)

Each stage is one commit; resume from the first stage that is not marked done.

- **7.0 / 7.1 (done, commit a41cdf2)**: friend-removal and notification fixes; per-connection ping (`latency` WebSocket message, `tests/ping.test.js`); ping badge on your own profile, on a friend's profile and in the friends list (`pingBadge` in `public/app.js`).
- **7.2 (done, commit 3f3b716)**: player card - tap any seat at a table (or press Enter/Space on it) to open a card with the handle, ping and record, plus Add friend / Remove friend / profile / mute; guests and bots offer no friend actions (`openPlayerCard`).
- **7.3 (done, this commit)**: profile picture update.
  - `POST /api/me/avatar` (`lib/accountRoutes.js`): signed-in only, CSRF, rate limit `RL_ME_AVATAR_LIMIT` (60/h), body `{ avatar }` must be one of the server's fixed `AVATARS`; stored by `db/account.js` `updateAvatar`. The live table (seat, spectator list) updates through `onProfileChanged({ playerId, avatar })` in `server.js`.
  - Client: one `changeAvatar()` shared by the lobby picker and the Edit-profile dialog; signed-in players save through the API (the old picture comes back with the server's reason if it refuses), guests keep the socket-only path; the profile page header refreshes without a reload.
  - Decision for the owner: pictures are still the fixed emoji set. Uploading real photos needs image validation, size limits, storage and serving, and moderation; it is deliberately not started. Say if you want it as its own stage.
  - Tests: new case in `tests/account.pg.test.js` (validation, CSRF, 401 when signed out, DB row, own and public profile, new socket's welcome); two cases in `tests/ui/social-ui.js` (saves and updates header; refused change reverts and shows the reason).
  - Verified here: `npm run build`; `tests/ui/social-ui.js` 9/9 (Playwright, mocked API); `db/account.updateAvatar` run against a real local PostgreSQL 16 with all 8 migrations applied (bad values -> 400, unknown account -> 404, success persisted); engine, twentynine, poker, themind, results, scrub, cleanup unit suites.
  - NOT run here: `tests/account.pg.test.js` (needs the `ws` and argon2 packages, which this sandbox cannot install: the npm registry is blocked), so the new route-level case is only syntax-checked. Run `npm run test:pg` before merging.
- **7.4a (done)**: refactor with identical behavior: one `avatar(m, cls)` helper replaces five hand-written avatar spans; one `adoptPlayer()` replaces three copies of the sign-in state block (session restore, login, register). `app.js` 1824 -> 1816 lines. Checked: `node --check`, `social-ui.js` 9/9, `wizard-layout.js` all viewports ok (one earlier run reported "1 viewport(s) failed" once and was clean on the immediate re-run; not reproduced, cause not captured - watch for it).
- **7.4b (done)**: friends panel polish (checked with real screenshots at 390px): "Friend requests" and "Table invitations" render only when there is something in them (no more empty "No pending ..." blocks), and a row with one button keeps it beside the name instead of a full-width button (`:has(.btn ~ .btn)` wraps only Accept/Decline rows). Home friends block is roughly 40% shorter on a phone. Checked: `social-ui.js` 9/9.
- **7.5 (done, 5d0dbaa)**: private-table authorization review.
  - **Policy**: superseded by the integrated policy below (this first version let a seated player reconnect and had no creator/admitted rules).
  - **Findings/fixes**: (1) previous hosts re-entered through `room.hosts` without a friendship check; (2) unfriending only ejected from the *current host's lobby*; now every private room containing either player (members and spectators, any status) is re-checked; (3) an earlier "already present keeps access" shortcut was too broad (spectators/lobby members kept access), replaced by the seat-in-game rule; (4) **spectator bug**: rematch seated spectators in free seats; removed, spectators stay spectators, and access is re-checked after rematch.
  - **Presence review**: `socialPresence` carries only online, lastSeen, playing (game id) and ping; no room codes, host or table info. Presence is per server instance (in-memory `players`); with several instances friends on another instance look offline. Intentionally no distributed presence.
  - **Tests actually run here**: `npm run build` ok; `tests/room-access.test.js` 14/14; engine, twentynine, poker, themind, results, scrub, matchqueue, cleanup, email, isolation, db suites pass. `npm run test:ui`: wizard-layout all viewports ok (0 failures), social-ui 9/9.
  - **NOT run here**: `npm run test:pg` and every `*.pg.test.js`, plus spectators/ping/stats/private-tables/production/smoke suites that need the `ws`/`pg`/argon2 packages: this sandbox cannot install them (npm registry blocked). They must be run on a machine with a disposable test database. No server-level regression test for the spectator-rematch fix was run.
- **7.4+ (next)**: more UX/UI polish (see "Next step").

- **Host tools (done)**: `makeHost` (host only, any status, target must be a seated human) and `kick` (host only, lobby only; seated player, spectator or bot; cannot kick yourself). Removed people go into `room.removed` and are refused by `join`, `sit` and reconnect (`canEnterRoom`) for the life of that table only. UI: 👑 / ✕ on other people's seats and ✕ next to spectators, each behind a confirm. Tests: `tests/host-tools.test.js` (DB-free, 6 cases), `tests/ui/host-tools-ui.js` (9 cases incl. 320-1280px overflow). Not covered by a database test: private-table interplay (a handed-over private table follows `lib/roomAccess.js`: the previous host stays only while friends with the new host).

## Current review status

Stage 6 social features and the Stage 7 follow-ups documented above are implemented on this branch. The historical “Remaining Stage 6 work” checklist has been retired because it no longer reflects the code.

- The latest migration is `008_friend_presence.sql`; the migration concurrency test must assert migrations 001–008.
- A full PostgreSQL run is still required on a machine with a disposable `TEST_DATABASE_URL`. Do not treat skipped PostgreSQL suites as passing.
- Presence is process-local; friends connected to another server instance may appear offline.
- Keep this branch separate. Review and merge decisions belong to the repository owner.

## Docs and UX copy pass (branch `claude/tableverse-docs-whats-new`, after Stage 6/7 was merged to main in PR #11)
- README: "What exists today", new v0.7 section (friends, presence, private-table policy, host tools, player cards, sessions, phones), endpoint and WebSocket message list, migrations 006-008, test commands (`npm run build`, `npm test`, `npm run test:ui`, PostgreSQL note). `package.json`/lockfile version 0.7.0.
- In-app: What's new (version key `2026-11-friends`, 7 entries, checked at 320 and 390 px), home hero text and a hint under the table-code box explaining that private tables need an invitation.
- Checked: `npm run build`, `tests/ui/social-ui.js` 9/9, smoke. PostgreSQL suites not run here (no server in the sandbox).


## Stage 8 — UX/UI refactor (branch `feature/stage-8-ux-refactor`, from main 525c7e4; do not merge from an agent session)
- 8.1/8.2 (92a9030): home = hero + join, friends card, games, Coming soon (Monopoly, Snakes and Ladders, Ludo), recent tables, public tables. Full friends panel moved to `#friends` page (`renderFriendsPage`, route in `routeFromHash/applyRoute/openPage`, menu item with pending badge). Panel id is now `friends-panel`.
- Tests: `node tests/ui/social-ui.js` 10 passed, 0 failed (new test for the card, coming-soon cards and `#friends` navigation; friends-list test now loads `#friends`).
- 8.4: What's new entry added, `WHATS_NEW_VERSION` bumped to `2026-11-simpler-home`, README v0.8 section.
- `node tests/ui/wizard-layout.js`: 288 ok, "all viewports ok".
- Width check (320, 375, 414, 768, 1280; home and #friends, with friends, a request and an invitation): no horizontal overflow; 375px screenshot reviewed by eye.
- Bell + split: notification bell in the top bar (requests and invitations, accept/decline in place, Escape/outside click closes, fixed-position panel fits 320-1280 px); home strip no longer lists invitations; account-menu badge removed. Social/home markup moved from `public/app.js` (1859 -> 1808 lines) into `public/home-ui.js` (`window.TVHomeUI`, loaded before app.js; added to `npm run build`).
- Results: `node tests/ui/social-ui.js` 11 passed 0 failed (new bell test); `wizard-layout.js` 288 ok; `host-tools-ui.js` 9 passed 0 failed; `npm run build` passes.
- Not run: full `npm test` / `test:pg` (no server or database changes in this branch).
- Known: (resolved in 7.6 below) the private-table security fixes and the spectator-rematch fix were not in main.

## 7.6 — private-table policy integration (branch `claude/integrate-private-table-policy`, from main 538fc11)
- Checked all remote branches: only `origin/wip/private-table-access-policy` (c8e1a17) had unmerged work; main already had my first policy (5d0dbaa: `lib/roomAccess.js`, spectator-rematch fix) but not the wip refinements.
- Integrated by hand (a plain merge conflicts in server.js and 4 PG test files, where main already carries its own equivalent fixes): kept main's PG tests; took from wip `db/friends.js` (`allowExpired`), `docs/PRIVATE_TABLES.md` (plus a "Removed by the host" section for main's `room.removed`), and `tests/private-table-access.pg.test.js` (registered in `test:pg` and `build`).
- Merged policy (`lib/roomAccess.js` now implements `docs/PRIVATE_TABLES.md`): creator and current host always; guests present when a public table turned private stay (`admitted`); otherwise an accepted invitation from creator/any host AND an intact friendship; expiry only stops NEW entries; **being seated is no pass**. Server: `revokeAccess` lets a seated player finish a RUNNING game but marks them (`room.denied`: no reconnect, no Rejoin offer, removed at rematch); everyone else leaves at once. Spectators never become players on rematch.
- Behavior changes vs 7.5: a removed seated player can no longer reconnect to the running game (a bot takes the seat); the creator can no longer be locked out by a later host.
- Run here: `npm run build` ok; `tests/room-access.test.js` 14/14 (rewritten for this policy); engine, twentynine, poker, themind, results, scrub, matchqueue, cleanup, email, isolation, db pass.
- NOT run here: `npm run test:pg` including the new `private-table-access.pg.test.js`, `host-tools.test.js` and the other `ws`/`pg`-dependent suites (packages cannot be installed in this sandbox). Run them against a disposable database before merging.


## Stage 11 — Ludo polish (branch `feature/stage-11-ludo-polish`, from main e94d9fa; not merged)
- Engine (`games/ludo`): board geometry now matches a real board: a token walks 51 ring squares (positions 0..50), then a 5-square home column (51..55), home = 56 (was 52 + 6, which skipped a diagonal into the lane). Two players sit opposite (seats 0 and 2); colours follow the board clockwise (red, green, yellow, blue); `seatLabel(i, seats)`. Smarter bot (finish > capture > bring out > safety/danger > furthest). New option `bonusRolls` (sixes only | sixes, captures and home). `view.players[i].seat`, `view.lastMove`.
- Client (`public/games/ludo.js`, `ludo.css`): board is one SVG (cells, yards, centre triangles), glossy tokens glide between squares, stacked tokens fan out, one turn bar (die with pips, status + last event, single Roll / I'm ready button), compact player list with home pips, result card. Removed the separate status, feedback, players heading and ready panels. Old Ludo rules removed from `public/game-ux.css`.
- Tests: `node tests/ludo.test.js` 23 passed (new: geometry, seats, bonus rolls, bot); `UI_GAME=ludo UI_SEATS=4 node tests/ui/wizard-layout.js` all viewports ok. Not run: PG suites (no server/DB changes).
