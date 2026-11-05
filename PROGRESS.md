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

## Stage 12 — Go Fish (branch `feature/stage-12-go-fish`, from main e94d9fa)
- 12.1 (4a790f3) `games/gofish/engine.js` + `index.js`, registered in `games/index.js` (game ids need no migration since 009).
- 12.2 (a5b1a82) `tests/gofish.test.js`: 12 tests (dealing 7/5, take and go again, Go Fish + wish option, empty stock, books incl. opening hand, ask validation, empty hands/skip/forced draw, endgame and ties, hidden information, 150 bot games for 2-6 players, plugin + match record + name scrub).
- 12.3 (ab8296a) `public/games/gofish.js` + `gofish.css` on the shared table (`pt.tableHTML`, `pt.seatHTML`, `.wz-top`, `.wz-status`, shared log/rules panel): two-step ask (rank, player; or tap a card / a seat), auto-pick when only one choice, Draw button, event text, results overlay.
- 12.4 (8416b04) `tests/ui/gofish-ui.js` (9 browser tests) + Go Fish in the `wizard-layout.js` viewport matrix (2, 4, 6 players). Found and fixed: a card `<div>` inside a `<p>` dropped the drawn card.
- 12.5 Go Fish removed from Coming soon (11 planned; count now computed), What's new highlight, README v0.9.
- Policy notes: Go Fish uses the standard rules (7 cards for two players, otherwise 5; a player with no cards draws on their turn; the game ends when all 13 books are down). Bots only use public information (who asked for what).

## Stage 13 — Snakes and Ladders (branch `feature/snakes-and-ladders`, from main 9da10bb)
Resume from the first stage not marked done. Each stage is one commit, pushed at once.
- 13.1 (a857efc, done) `games/snakesladders/engine.js` + `index.js`, registered in `games/index.js` (no migration needed since 009). 2-4 players, 10x10 path board numbered 1-100, own ladder/snake layout (8 ladders, 9 snakes, see `LADDERS`/`SNAKES`), one `roll` action, options `exactFinish` (default on), `sixAgain` (default on; third six in a row forfeits), time limit. Winner = first to 100; others placed by distance. `stats` kind 'none' like Ludo.
- 13.2 (6d9454b, done) `tests/snakesladders.test.js`: 21 tests (board invariants, ladders, snakes, exact finish, sixes, turn order, views, placings, bot games for 2-4 players, plugin, scrub, match record). In `npm test` and `build`.
- 13.3 (ebc4f2a, done) `public/games/snakesladders.js` + `.css` (+ links in `index.html`): board with square numbers, SVG ladders and snakes drawn from the view, tokens that slide between squares (CSS transition; none with reduced motion), dice panel with tumble animation, roll button, player list, feedback line from the log, results overlay. Uses the shared `.wz`, `.wz-top`, `.wz-status` so the log, rules, timer and announcer work as in other games.
- 13.4 (done) Snakes and Ladders leaves Coming soon (10 planned), What's new highlight (Ludo's dropped: only 3 are shown), README v0.10, tests updated (`coming-soon.test.js`, `ui/social-ui.js`).
- 13.5 (9fdac40, 69fa417, done) `tests/ui/snakesladders-ui.js` (9 browser tests), Snakes and Ladders in the `wizard-layout.js` matrix (2 and 4 seats), `test:ui` and `build`; smoke test through the server socket.
- 13.6 (done) PR #26 opened; CI green on both Node versions (build, tests with PostgreSQL, browser checks, Docker image, audit). Not merged: the owner merges.
- Verified here: engine tests 21/21, `coming-soon.test.js`, screenshots at 390 and 1280 px (no horizontal overflow). NOT run here: anything needing `ws`/`pg` (npm registry blocked in this sandbox): the server smoke test and all `*.pg.test.js`; CI covers them.
- (Done in stage 15: tokens now walk square by square.)

## Stage 11 — Ludo polish (branch `feature/stage-11-ludo-polish`, from main e94d9fa; not merged)
- Engine (`games/ludo`): board geometry now matches a real board: a token walks 51 ring squares (positions 0..50), then a 5-square home column (51..55), home = 56 (was 52 + 6, which skipped a diagonal into the lane). Two players sit opposite (seats 0 and 2); colours follow the board clockwise (red, green, yellow, blue); `seatLabel(i, seats)`. Smarter bot (finish > capture > bring out > safety/danger > furthest). New option `bonusRolls` (sixes only | sixes, captures and home). `view.players[i].seat`, `view.lastMove`.
- Client (`public/games/ludo.js`, `ludo.css`): board is one SVG (cells, yards, centre triangles), glossy tokens glide between squares, stacked tokens fan out, one turn bar (die with pips, status + last event, single Roll / I'm ready button), compact player list with home pips, result card. Removed the separate status, feedback, players heading and ready panels. Old Ludo rules removed from `public/game-ux.css`.
- Tests: `node tests/ui/ludo-ui.js` 3 passed (ready bar, legal-token tap sends the move, roll enabled only on your turn; part of `npm run test:ui`). `node tests/ludo.test.js` 23 passed (new: geometry, seats, bonus rolls, bot); `UI_GAME=ludo UI_SEATS=4 node tests/ui/wizard-layout.js` all viewports ok. Not run: PG suites (no server/DB changes).


## Stage 12 — consistent, uncluttered games on phones (branch `feature/stage-12-mobile-fit`, from stage 11; not merged)
- 12.1 Shared toolbar: every game now shows chat, reactions, a "more" menu (sound, log, scores/chips/stats) and leave in ONE row (`unifyToolbar()` in `public/app.js`, styles at the end of `public/game-ux.css`). Previously each game had up to six buttons on two rows.
- 12.2 Fit: on short phones (<= 700px tall) the table gives up height (`--pt-min`), Wizard keeps room for the trump corner, Ludo's turn bar and player list are one row each. At 360x640 the main play area (toolbar, table, hand, main buttons) now ends above the fold for Wizard, 29, Poker, The Mind and Ludo.
- Tests: `node tests/ui/mobile-fit.js` 5 passed (new, in `npm run test:ui`: main area fits 360x640, toolbar order, menu opens/closes with Escape); `wizard-layout.js` all viewports ok (Wizard 4/6, 29 re-run after the final CSS); `ludo-ui.js` 3 passed; `host-tools-ui.js` 9 passed; `social-ui.js` 12 passed. Not run: PG suites and `production.test.js` (no `ws` in this sandbox).
- 12.3 Lobby declutter: table-code card drops the repeated help sentences (kept as tooltips), the invite form is hidden when there is nobody to invite, your profile editor and the game options fold into one-line summaries (`optionsSummary`, `details.fold`). Phone lobby went from ~2000px to ~1200px tall. `mobile-fit.js` now also checks the lobby (compact, folds closed).
- 12.4 Home declutter: the 12-game roadmap is a closed fold (still complete in the DOM, tests unchanged), game cards are compact on phones (2-line taglines), the empty "Open tables" block no longer renders. Phone home page ~3150px -> ~1700px. `mobile-fit.js` also checks the home page.
- 12.5 Your-turn fit: on short phones (<= 700px tall) the bid/bet panels drop their duplicate status line and the bet-size chips, cards are smaller (Wizard/29 54px, Poker hand 60px), 29's team boxes and bid grid are tighter, tables shrink only where nothing needs the room. At 360x640 your cards and actions stay on screen on your turn in Wizard, 29 and Poker (`mobile-fit.js` your-turn check).
- Results (all run in this sandbox): `wizard-layout.js` all viewports ok, `mobile-fit.js` 10 passed, `ludo-ui.js` 3 passed, `host-tools-ui.js` 9 passed, `social-ui.js` 12 passed, `scorecard-layout.js` no failures printed, `ludo.test.js` 23 passed, `coming-soon.test.js` passed. Not run: PG suites and `production.test.js` (no `ws`/real PostgreSQL here) — run `npm test` in CI before merging.
- 12.6 Soft feel: one easing for every game control, gentle press feedback, reduced-motion respected (CSS only, no re-render animation so nothing flickers on updates).
## Stage 14 — performance and bug fixes (branch `refactor/performance-and-bugfixes`, from main 9da10bb, PR #27)
Each item is one commit. Resume by reading `git log` on the branch.
- 14.1 Table directory: coalesced (120 ms), sent only to people outside a table, skipped when unchanged per person, rejoin offers built in one pass (`rejoinIndex`). Was: every move at every table sent the whole directory to every player, O(players x rooms).
- 14.2 State broadcast serialises the shared room info once (`sendBoundedRaw` in `lib/wsLimits.js`).
- 14.3 Client `render()` keeps typed text, dropdown choice, focus and cursor (`KEEP_FIELDS`); identical `state` and `tables` messages no longer rebuild the screen. `tests/ui/redraw-ui.js` (fails without the fix).
- 14.4 Game renderers (wizard, 29, poker, The Mind) redraw once a resize settles (120 ms) instead of on every resize event.
- 14.5 `lib/staticFiles.js`: files cached in memory (revalidated by mtime), gzip for text, ETag and 304; `tests/static.test.js` (6).
- Bug: accepting a table invitation failed with "no table code" because `transitionInvitation` returned only id and status. It now returns `game_id` and `room_code`, and the client falls back to what it knew. `tests/ui/invitations-ui.js`, plus a PostgreSQL assertion in `tests/friends.pg.test.js`.
- Accessibility: friend names and online chips are buttons (keyboard opens the profile).
- Verified here: `npm run build`, `static`, `coming-soon`, engine suites, browser suites (`redraw-ui`, `invitations-ui`, `social-ui`, `host-tools-ui`, `wizard-layout`). CI on PR #27 was green after 14.5; the later commits are checked by the next run. NOT run here: `ws`/`pg` suites (npm registry blocked); CI covers them.
- Ideas not done (measure first): per-viewer `view()` for big tables is computed per player; the chat log is resent in full on join; `app.js` still rebuilds a whole screen on every changed state (a keyed diff would help on slow phones).


## Stage 15 — Property Rivals (branch `feature/stage-14-property-rivals`, from main)
Resume from the first stage not marked done. Each stage is one commit, pushed at once.
- 15.1-15.4 (done) `games/propertyrivals/{board,engine,actions,index}.js`, registered in `games/index.js` (no migration needed). Original board, decks, rent/building/mortgage/auction/trade/debt rules, bots, view with static board data.
- 15.5 (c9832a5, done) `tests/propertyrivals.test.js`: 20 tests incl. bot playouts for 2-6 players and even-building invariants.
- 15.6 (done) `public/games/propertyrivals.js` + `.css`: 11x11 board ring, tokens, dice, buy/auction/debt/trade panels, property manager.
- 15.7 (done) `tests/ui/propertyrivals-ui.js` (8 browser tests), wizard-layout matrix (2/4/6 seats), smoke test, `test:ui`/`build`; leaves Coming soon (9 planned), What's new, README v0.11.
- 15.8 (todo) PR + CI. Verified locally: engine tests, coming-soon test, browser tests. NOT run locally: `smoke.test.js` and PostgreSQL suites (need `ws`/`pg`, CI only).
- Known: no bank house limit; trades only on your own turn; tokens jump (no square-by-square walk).
## Stage 15 — your bug list, consistency across games (branch `feature/stage-15-consistency`, from main 92dcc65)
- 15.1 Friends header on home is one tappable button (opens #friends), not only "Manage". The waiting lobby no longer has the profile/avatar editor (edit it from the account menu).
- 15.2 Toolbar everywhere: chat, reactions, ⋯ (sound, log, rules, scores…), leave. Go Fish and Snakes were not matched by `unifyToolbar` (their leave button uses `data-gf`/`data-sl`); it now finds leave by any data attribute equal to `leave`.
- 15.3 Go Fish: no game log (it would show what others asked for): not in the ⋯ menu, not under the table, and `viewFor` no longer sends `log`. The centre action line is 15px/bold (was 12px).
- 15.4 Snakes and Ladders: the token walks square by square (340 ms each), a ladder or snake is one long slide, the Roll button waits ("Moving…"), the result overlay waits, and bots pause 3.4–4 s so turns do not run together. Reduced motion skips the walk.
- 15.5 Ludo: when only one move is possible (tokens on the same square that land on the same square count as one) the server plays it (`forcedPlay`, 700 ms) and the status says "Only one move: playing it".
- 15.6 Phones (360x640): Go Fish and Snakes fit with the shared toolbar (mobile-fit now covers 7 games). Go Fish drops the stock pile picture on short phones (count only) and hides the rank/player labels visually.
- 15.7 Consistency: a crown marks who is ahead in Go Fish (most books), Snakes (furthest) and Ludo (most progress), like "Leading"/"Winner" in Wizard and 29 (which already had them). Merged the audit branch: Go Fish no longer crashes when a game ends (the closing event names no player) and `tests/ui/game-audit.js` (plays every engine to 4 moments at 6 screen sizes; not in `npm test`).
- Audit left over (known): poker with 8 players on a 320px-wide phone overlaps seat plates; 29 shows a played card slightly behind the top seat plate at 320x568 and 1280x800.
- 15.8 Property Rivals (merged from main): the same toolbar already applied; it now fits 360x640 (square board sized to the screen height, Roll and Trade in one row, players in two columns) and a crown marks who has the most cash. mobile-fit covers 8 games.

## Stage 15 — Layout audit of every game except Ludo (branch `audit/game-ui-layout`, from main)
- Tool: `tests/ui/game-audit.js` plays each game's real engine to four moments and checks six screen sizes for cut-off, overlapping and tiny controls (`UI_GAME=poker UI_SEATS=6 UI_SHOTS=dir node tests/ui/game-audit.js`; not part of `npm test`).
- Fixes: Go Fish crash when a game ended (results never drew; regression test added); shorter table on short phones; Poker board sized to fit between side seats at 4+ players; 29 trump label bounded; played cards nudged off seat plates; Go Fish event line moved below the table; Wizard trump corner/strip clear of seats at 320x568.
- Checked: `npm run build`; `wizard-layout.js` all viewports ok (one Ludo tap flake on a first run, clean on rerun); `gofish-ui.js` 10/10; `social-ui.js` 12/12; `host-tools-ui.js` 9/9.
- Known remaining (audit): Poker 6p/8p seats overlap at 320x568 (8p also at 360x640); some below-the-fold hands and small tap targets (e.g. the "What's new" link) on the smallest phones.
- Not done (perf ideas): per-viewer `view()` at big tables, chat log resent in full on join, keyed diff instead of whole-screen rebuild.
- Not run: server/PG suites (no `ws`/`pg` here); CI covers them.

## Stage 16 — Audit of merged changes (branch `cleanup/css-and-build`)
- Audited main after the parallel branches merged: build, all runnable suites, layout audit across all 7 games (0 overlaps), duplicate functions / debug logging (none).
- `public/style.css`: removed the declarations of 9 duplicated home/roadmap rules that a later rule already overrides (join-form, section, game-grid, home-hero, home-intro p, soon-grid/card/ico/tag). Computed styles of 13 home selectors at 360/768/1280 px compared before and after: identical.
- `npm run build` now runs `scripts/check-syntax.js`, which syntax-checks every .js file (110) instead of a hand-kept list (several engines were missing). New `npm run test:audit` runs `tests/ui/game-audit.js` (not in CI: slow).
- Poker 8p on a 320px phone: fixed (narrower plates and action chip, taller table at 7-8 players); audit now 0 errors and 0 warnings. Known: below-the-fold warnings on the smallest phones.

## Stage 17 — status labels and the line games (branch `feature/stage-16-simple-games` (PR #31), from main f9b5cb5)
Resume from the first stage not marked done. Each stage is one commit, pushed at once.
- 17.1 (done) Coming soon shows a status per card: Hidden Miners "In development", the rest "Planned" (`home-ui.js`, `style.css`, `coming-soon.test.js`).
- 17.2 (done) `games/linegames/{engine,index}.js`: Tic-Tac-Toe and Four in a Row (option Line length 4 or 5; 5 plays on a 9x8 grid) on one engine, registered in `games/index.js` (no migration). `tests/linegames.test.js` (12 tests).
- 17.3 (done) `public/games/linegames.js` + `.css` (one renderer, three ids), `tests/ui/linegames-ui.js` (6 browser tests), wizard-layout matrix, `build`/`test`/`test:ui`.
- 17.4 (done) Launch: Four in a Row and Tic-Tac-Toe leave Coming soon (7 planned), What's new, README v0.12, smoke test for all three.
- 17.5 (todo) PR + CI. Verified locally: engine tests, coming-soon, browser tests, layout matrix. NOT run locally: smoke test, PostgreSQL suites (CI only).
- 17.6 (done) Four and Five in a Row merged into one game with a Line length option (was a separate 15x15 game); Go Fish end-of-game crash fixed (the closing `over` event names no player and the renderer threw), empty-hand rules clarified, endgame tests.
- Known: no undo or draw offer; stats are not tracked for these games (kind none).
- 17.7 (done) Property Rivals: tokens walk square by square (back 3 walks back, lockup jumps), action buttons wait for arrival, and new log lines float over the board as messages (log entries are numbered; rolls and landings are now logged).

## Stage 18 — shared feed and consistency for the new games (branch `feature/stage-18-shared-feed`, on top of PR #31)
- 18.1 (done) `public/feed.js`: shared floating log feed, hooked in `renderGame()` (`CardTable.feed.sync`), configs for Wizard, 29, Poker, Ludo, The Mind; Property Rivals registers its own (landing line waits for the walking token). New lines are found by entry number when a game numbers its log, else by the overlap of the log tails (no engine changes). `tests/ui/feed-ui.js`.
- 18.2 (done) Crown for the leader in Wizard, Poker (3+ players) and 29 (team), `tests/ui/lead-ui.js`. 29 already had Wizard's trick "Leading" and "Winner" tags (checked with a real engine mid-trick).
- 18.3 (done) `mobile-fit.js` and `game-audit.js` cover Property Rivals, Tic-Tac-Toe and Four in a Row (the check found a broken CSS block in my own feed refactor; fixed).
- Considered and left out: floating feed for Snakes and Ladders (it already prints every move in a banner) and Go Fish (no public log by design).
## Stage 17 — table voice chat (branch `feature/stage-17-voice`, from main 4ae6777)
- 17.1 Server: `lib/voiceRelay.js` (pure: who is in voice per table, cap 8, only seated humans, clean/limit setup messages, ICE server config from env) wired into `server.js`: `voice` {on, muted} and `rtc` {to, data} messages, a `voice` list sent to the table on every change and on join, voice ends on leave or disconnect, `ice` in `welcome`, `rtc` has its own flood allowance (200/s) so ICE bursts do not trip the 30/s limit, Permissions-Policy allows the microphone for the site.
- 17.2 Client: `public/voice.js` (`TVVoice`): one RTCPeerConnection per pair (smaller id calls), mic can be added later without renegotiation (`replaceTrack`), listen-only join needs no permission, level meter for speaking rings, blocked-autoplay recovery on the next tap. `app.js`: mic and speaker buttons in the lobby header and in every game's toolbar (after reactions, before ⋯), `data-vid` marks on lobby seats and Ludo/Snakes/Property chips, `data-voice`/`.speaking` marks on seats; spectators get no buttons; reset on leave and on disconnect.
- Tests: `tests/voice.test.js` (6, pure), `tests/voice-server.test.js` (7 on the real server: NOT run in this sandbox, no `ws`: CI runs it), `tests/ui/voice-ui.js` (7 in Chromium with a fake microphone, including two real pages exchanging audio both ways, a listener who starts talking later, spectators). `mobile-fit` toolbar order is now chat, reactions, mic, speaker, ⋯, leave.
- Known / not done: no automatic voice rejoin after a dropped connection (tap the mic again); mesh topology means 8 people is the sensible limit (an SFU would be needed for more); TURN is configuration only, no TURN server is bundled; no push-to-talk or per-person volume.

## Stage 19 — game endings, loading blocker, Property Rivals pace (branch `feature/stage-19-endgame-pace`, from main 2ca9c5c)
- End of a game (all games): server stores `room.outcome` (winners from `results()`) and `room.votes`, exposed in `roomInfo`; new non-host `rematchVote` message. Client `endFlow()` keeps the final table ~3.5 s, shows a "<name> won" pop-up ~2.8 s, then each game's result sheet with shared Leave / Play again (host) or Vote to play again with a count (others). Cleared on rematch or when someone leaves.
- Loading blocker: join, create, start, rematch, sit, leave and accepting an invitation show a spinner overlay and make the page `inert` until the server answers (20 s safety timeout).
- Property Rivals: tokens walk one tile per 420 ms with a 700 ms rest on landing, bots think 2.6–3.8 s, deeper edge tiles and bigger city bands, centre shows whose turn it is with bigger dice, glossy bigger tokens. Ludo: larger tokens with a coloured ring, slower slide, movable tokens bob.
- Tests: `tests/ui/endflow-ui.js` (new, in `npm run test:ui`), PR/Ludo/mobile-fit UI suites re-run locally and pass; server tests (`rematchVote`) run in CI only (no `ws` locally).
