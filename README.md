# Tableverse

> **Your friends. Your games. One table.**

Live site: **https://playtableverse.com**

Tableverse is a browser-based multiplayer game arena for quick social sessions with no install.

## Current games

- **Wizard** (3–6): plus/minus one, hidden/secret prediction, foresight, short game.
- **29** (4): team-based trick play with secret trump and 3/6/9 match length options.
- **Poker (No-Limit Texas Hold’em)** (2–8): blinds, all-ins, side pots, showdown resolution.
- **The Mind** (2–4): co-op, real-time ascending play with lives/stars and difficulty options.
- **Ludo** (2–4): race your four tokens home on the classic cross board — roll a six to get out, send opponents back, finish by exact count. Two players sit opposite each other; optional bonus rolls for captures and getting home.
- **Snakes and Ladders** (2–4): roll to race along a 10×10 path to square 100. Ladders lift you, snakes drop you. Optional exact roll to finish and roll again on a six.
- **Property Rivals** (2–6): an original world-tour board game: buy cities, ports and utilities, collect rent, build houses and hotels, trade, auction and bankrupt your rivals. Tap a city in your holdings for its card: mortgage value, rent now and the full rent table, and house and hotel costs. Options: game length, starting cash, auctions, Rest Stop jackpot.
- **Tic-Tac-Toe** and **Four in a Row** (2): two quick line games on one engine. Line up three on a 3×3 grid, or drop discs into a 7×6 grid and connect four. Four in a Row has a *Line length* option: choose five for a bigger 9×8 grid. Choose who starts; a bot fills the second seat.
- **Go Fish** (2–6): ask for a rank, collect four of a kind and make the most books. Optional “Fish your wish” (draw the card you asked for and go again).

Bots can fill open seats so tables can start quickly.

## Friend-testing status (current)

Tableverse is currently open for friend testing.

- Account login is required for play actions.
- **Email verification is currently optional** in this environment.
- This is controlled by `REQUIRE_EMAIL_VERIFICATION`.
  - `REQUIRE_EMAIL_VERIFICATION=false` → immediate play allowed after signup/login.
  - `REQUIRE_EMAIL_VERIFICATION=true` → verified email required before lobby access.
  - Missing or invalid values default to secure mode (`true`).
- Optional mode does **not** fake verification: `email_verified_at` remains null until real verification.

## What exists today

- Public home page, live table directory and a table-code box (public tables).
- Auth sheet that resumes the action a visitor originally tapped after login.
- Account menu (Profile, Settings, What's New, logout controls), a profile page (`#profile`; public pages at `#u/<username>`) and tap-a-player cards at the table. Signed-in players can block or report someone from the card or the public profile page.
- **Friends**: username search, requests (send, accept, decline, cancel), removal, online/offline, last seen, the game a friend is playing and a connection-quality (ping) badge.
- **Public and private tables.** New tables are public and listed in the open tables; a host can make a table private, and private tables open with friend invitations, and **host tools** to hand over the table or remove people.
- Real-time chat, spectators, reconnect/rejoin, activity log.
- **Game settings at a glance**: every game shows its current settings at the top right. Tap them for the full list with each choice explained. Settings are set by the host in the lobby and can't change during a game.
- **Keep me signed in on this device**: optional at sign-in. The browser stays signed in for 30 days after its last visit. It ends on sign-out, sign-out everywhere, a password reset, or a suspension.
- **Owner e-mail broadcasts** (owner only, admin console): mail to everyone, verified or unverified accounts, or accounts inactive for 30 days. Promotional mail needs `PUBLIC_APP_URL` for its unsubscribe link.
- **Blocking**: a block hides the other player's table chat and voice, and stops invitations between you. A block never removes anyone from a table, so you can still share one.
- Cookie-based auth (`HttpOnly` session cookie), CSRF double-submit protection, rate limits, one active session per account.

## What's new — unreleased (blocking and reports, the ⋯ menu, 29 rules, seat shuffle)

- **Block and report on the card and the profile.** A signed-in player can block (or unblock) and report someone from their table card, or from their profile page (`#u/<name>`). A report has a reason (harassment, hate, threats, sexual content, spam or other) and is stored once per reporter and player. Reports count toward the same daily limit as chat reports. Guests can’t report; a deleted account’s reports stay on record with its last name.
- **Friend profiles open in the app.** Tapping a friend’s profile while seated in a game asks first, because it leaves the table. A dropped connection never moves you.
- **⋯ menu.** How to play, the game log and game settings are in the ⋯ menu at the top right. The bottom bar keeps only the table controls, so it fits on phones.
- **Profile loading.** The profile shows a loading state, then the name and the statistics together.
- **Shuffle seats.** Wizard and 29 offer a host-controlled Shuffle seats option. When it is on, seats are shuffled when the game starts, and results are recorded against the seat each player actually had.
- **29 rules in Game settings.** The options are explained in the settings, and the rules text matches the engine: with the *All 29 doubles the win* option on, taking all 29 points is worth +2 game points (instead of +1); with *Double loss below half* on, a bidding team that misses its bid with 14 or fewer points loses 2 (instead of 1); a K–Q marriage changes the bid when the *Marriage changes the bid* option is on (the bid rises by 4 when the other team declares it, and drops by 4 when the bidding team declares it, never below 15). *Double and redouble* is an optional challenge that doubles, then redoubles, the hand’s game points.
- **Fixes.** The 29 trump indicator fits on phones (checked at phone sizes in the browser tests); the 29 score label is correct after a marriage or a double; the guest top bar fits a 360 px screen; a friend’s profile opened from a game no longer appears after a dropped connection.

## Earlier unreleased work (Property Rivals cards, game settings, blocking)

- **Public tables by default.** A new table is public and appears in the open tables. While the table is still in its lobby, the host can make it private with **Make private** on the table screen; the server refuses the change once a game has started. Tables that already exist keep their current setting.
- **City cards.** In Property Rivals, tap a city in a player's holdings to see its owner, buildings, mortgage value, unmortgage cost, house or hotel cost, the rent right now and the full rent table.
- **Cash and net worth.** Each rival in the player list shows cash (coins in hand) and net worth (cash plus properties) as separate figures. The crown marks the player with the highest net worth, not the most cash.
- **Settings at the top right.** Every game shows its current settings in the title row. Tap them for the full list. Keyboard users can open them with Enter or Space; focus returns to the same control when the dialog closes.
- **Blocking.** A block hides the blocked player's table chat and voice, and stops friend requests and table invitations between you. Table chat is one way: the blocker stops seeing the other player's messages, while the other player still sees yours. A blocked pair can now share a table, including one hosted by someone else.

## What's new in v0.14 — voice chat

- **Talk at the table.** Turn on your microphone to speak with other people at the same table, in the lobby or during a game. Turn it off to mute yourself; use the speaker control to listen without speaking or silence table audio.
- **See who's talking.** A microphone indicator shows who has joined voice, and a green ring highlights the person currently speaking.
- **Up to 8 people.** Voice supports up to eight people in a table. Spectators can watch; take a seat to join the conversation.
- **No installation.** Voice runs in your browser. Open Tableverse over HTTPS, allow microphone access when asked, and use a headset where possible to reduce echo.
- **How it works.** Audio is peer-to-peer using WebRTC. Tableverse's server helps browsers establish the connection but does not carry the audio itself. Some networks require a relay to connect; connection quality depends on the networks and devices involved.
- **Your choice.** Voice is off until you choose to join. As with other peer-to-peer calls, the other participants' browsers may learn network connection information such as IP addresses.

## What's new in v0.13 — shared feed and crowns

- **Floating messages**: new public log lines (a bid, a raise, a capture, a mistake, a rent payment) float over the table for a few seconds in Wizard, 29, Poker, Ludo, The Mind and Property Rivals. One shared module (`public/feed.js`) reads each game's log; a game picks which kinds float. Snakes and Ladders keeps its move banner, and Go Fish has no log (it would show what others asked for).
- **Crown for who is ahead** is now in every scoring game: Wizard (score), Poker (chips, three or more players) and 29 (team score) join Go Fish, Snakes and Ladders, Ludo and Property Rivals.
- The phone-fit and audit checks now cover Property Rivals, Tic-Tac-Toe and Four in a Row.

## What's new in v0.12 — Tic-Tac-Toe and Four in a Row

- Two quick two-player games are playable: **Tic-Tac-Toe** (3×3) and **Four in a Row** (drop discs into a 7×6 grid). Set *Line length* to five for **Five in a Row**: connect five on a bigger 9×8 grid. A winning line is highlighted; a full board is a draw. Option: who starts (random, first or second seat). Bots fill an empty seat: perfect in Tic-Tac-Toe, a five-move look-ahead in Four/Five in a Row.
- The Coming soon list now shows a status per game: **Hidden Miners is in development**, the others are planned (7 remain; Four in a Row and Tic-Tac-Toe left the list).

## What's new in v0.11 — Property Rivals

- **Property Rivals** is playable (2–6 players, bots fill empty seats). 40-square original board with 22 cities in 8 colour groups, 4 ports and 2 utilities; rent doubles on a full colour set, even building up to a hotel, mortgages, auctions when you pass on a purchase, player-to-player trades, a lockup, and Surprise / Community Fund cards. Options: short game (30 or 60 rounds, richest wins), starting cash, auctions on/off, Rest Stop jackpot.
- Tokens walk square by square and what happens (roll, landing, rent, cards) floats over the board as it happens.
- Simplified on purpose: the bank has unlimited houses, and building and trading happen on your own turn.
- Removed from the Coming soon list (9 planned games remain).

## What's new in v0.10 — Snakes and Ladders

- **Snakes and Ladders** is playable (2–4 players, bots fill empty seats). One tap to roll, the token slides along the path, ladders lift and snakes drop. Options: exact roll to finish (on by default) and roll again on a six (three in a row ends the turn). The board is the same every game and carries original artwork. Everyone sees the same board; there is no hidden information.
- Removed from the Coming soon list (10 planned games remain).

## What's new in v0.9 — Go Fish

- **Go Fish** is playable (2–6 players, bots fill empty seats, 2 players get 7 cards, otherwise 5). Ask for a rank you hold, pick a player (or tap them at the table), press Ask. Books are laid down at once; most books wins, equal books share the win. Only your own hand is ever sent to you.
- Removed from the Coming soon list (11 planned games remain).

## What's new in v0.8 — a simpler home

- **Home page.** Greeting and table-code join, then the games straight away. Friends are a compact card (who is online); the full friends list, search, requests and sent invitations are on their own page at `#friends` (account menu → Friends). A **notification bell** in the top bar shows a count of friend requests and table invitations and lets you accept or decline them in place (refreshed every minute and when opened). Recent and public tables sit below the games.
- **Coming soon.** Upcoming games are listed as non-playable cards ahead of their release. Ludo (v0.8), Go Fish (v0.9), Snakes and Ladders (v0.10), Property Rivals (v0.11), Tic-Tac-Toe and Four in a Row (v0.12) have shipped and are playable now.
- **What's new** is also linked from the home footer. No server, database or API changes. Home/social markup now lives in `public/home-ui.js` (loaded before `app.js`).

## What's new in v0.7 — friends, private tables, host tools

- **Friends.** Search players by username (`[a-z0-9_]`), send/accept/decline/cancel requests, remove friends. Duplicate requests, requesting yourself and acting on someone else's request are refused; a request in answer to one you received becomes a friendship. Pending requests and invitations show on the home screen, with a live notice when a new one arrives.
- **Presence.** Friends see online, last seen, and *which game* someone is playing (never a table code) plus a ping badge. Presence is held per server instance, so with several instances a friend connected to another one looks offline.
- **Private tables.** A new table is private: it is hidden from the public directory and its code is not an access grant. The host invites a friend from the lobby; the friend accepts, then joins. Make a table public to share its code and link. The rule lives in `lib/roomAccess.js` and is applied on join, sit, reconnect, when a friendship ends and when a finished game is restarted: a previous host may return only while still friends with the current host; a seat in a game under way is kept; without a database only the host gets in.
- **Host tools.** In the lobby the host can make another seated player the host (also mid-game) and remove a player, spectator or bot. A removed person cannot rejoin that table (join, spectate, sit and reconnect are refused) until it closes. The old host keeps their seat.
- **Player cards, avatars, ping.** Tap anyone at a table for their handle, ping, record and friend/mute actions. Your picture (the fixed emoji set) is saved to your account (`POST /api/me/avatar`).
- **Sessions and spectators.** One active session per account (migration 006, partial unique index): a new login signs the other device out (WebSocket close code 4002). Repeat spectate/join requests are idempotent and never produce duplicate announcements; rematch keeps spectators as spectators.
- **Phones.** Fixed real horizontal overflow instead of hiding it (Wizard/table header, lobby code and seat list at 320 px).

New endpoints: `GET /api/me/friends`, `GET /api/me/friends/search?username=`, `GET|POST /api/me/friend-requests` (+ `/accept`, `/decline`, `/cancel`), `POST /api/me/friends/remove`, `GET|POST /api/me/table-invitations` (+ `/accept`, `/decline`, `/revoke`), `POST /api/me/avatar`. New WebSocket messages: `makeHost`, `kick` (client to server); `socialNotice`, `socialPresence`, `latency` (server to client). Migrations 006 (single session), 007 (friends, requests, invitations), 008 (presence/invitation indexes).

### Earlier: v0.6 — profiles, history, account deletion

- **Profiles and history.** Own profile (stats, paginated finished-match history, account tab) and a public page per username with only public fields. Statistics are aggregated in SQL; only human, finished, non-early-leave games are counted, each match once.
- **Delete Account.** Password re-authentication, then one transaction removes sessions, credentials, tokens and recent tables; match rows are kept as `Deleted player`. A game in progress anonymises the seat everywhere (state, log, chat, saved match).
- **Recent tables** are per account (migration 005) and sync across devices.
- **Game logs** show who acted in every game.

## Roadmap (planned, not shipped yet)

- Saboteur
- 6 nimmt! (Take 5)
- UNO

Ludo shipped in v0.8 and is playable now (2–4 players).

## Database & architecture

Tableverse uses PostgreSQL (Neon, Supabase, or self-hosted) for accounts, sessions, and match history.

- `DATABASE_URL` configures persistent storage.
- If `DATABASE_URL` is omitted and `NODE_ENV` is not `production`, the app uses in-memory storage. That supports **guest play only**: e-mail registration and login answer 503 without PostgreSQL. For local accounts see [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).
- In production, startup is strict: missing/unreachable DB or failed migration aborts boot. A slow first connection (for example Neon waking from scale-to-zero) is retried for up to 45 s, connection errors only; `DB_STARTUP_WAIT_MS` changes that limit (`0` = one attempt). See the operations runbook.
- Migrations live in `db/migrations/` and run transactionally under an advisory lock.
- `/healthz` = process liveness; `/readyz` includes database readiness.

### Auth and security notes

- Session is stored only in an HttpOnly `ct_session` cookie (`Secure` in production).
- JavaScript never receives the session token in production responses.
- CSRF uses the `ct_csrf` cookie + `X-CSRF-Token` header check on auth POST routes.
- `REQUIRE_EMAIL_VERIFICATION` controls whether verified email is required for lobby entry.
- Resend/forgot-password flows are non-enumerating and return the same outward response.

### Production email requirements

Production requires:

- `EMAIL_PROVIDER=resend`
- `EMAIL_FROM`
- `PUBLIC_APP_URL`
- `RESEND_API_KEY`

If provider delivery fails after signup, the account is still created and the response reports the delivery failure explicitly.

## Render deployment

`render.yaml` includes baseline production settings:

- `NODE_ENV=production`
- `TRUST_PROXY=1`
- `REQUIRE_EMAIL_VERIFICATION=true` (secure default)

Set `DATABASE_URL` and email variables in Render env settings before deploying.

## Domains

Email links (verification, password reset, and the unsubscribe link in owner broadcasts) are built from `PUBLIC_APP_URL`, so it must always be the one address players actually use, with `https://` and no trailing slash.

`playtableverse.com` is registered (Cloudflare Registrar, DNS-only/grey-clouded records), added as a Render custom domain for both the apex and `www` with the certificate issued, and is the live site: `PUBLIC_APP_URL` is set to `https://playtableverse.com`, `playtableverse.com` is verified as a Resend sending domain, and a signup/reset email was confirmed to link back to the new domain.

To change it again later, or to add another domain:
1. Render → service → Settings → Custom Domains → add the domain, create the DNS records Render shows, wait for the certificate.
2. Render → service → Environment → set `PUBLIC_APP_URL` to the new address → redeploy.
3. In Resend, verify the new sending domain (SPF/DKIM records) and set `EMAIL_FROM` to an address on it.
4. Send a signup/reset email and confirm the link opens the new domain.

## Production readiness

The application-level safeguards and remaining launch requirements are tracked in [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md). In particular, the current in-memory room/presence model is single-instance, and the default match-result spool is not durable across replacement of an ephemeral host. Review the release checklist before opening the service to the public.

## Development

Full local setup for Windows and macOS/Linux, with the database container, test accounts, resets and troubleshooting:
[docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

```bash
npm ci                # install exact dependencies (Node.js 22 recommended)
cp .env.local.example .env.local      # Windows: copy .env.local.example .env.local
npm run dev:migrate   # apply migrations to the local database named in .env.local
npm run dev:seed -- --email me@local.test --username localme --owner   # create a local test account (+ admin)
npm run dev           # local development server on http://localhost:3000 (loads .env.local, local database only)
npm run build         # syntax-checks server, client, libraries and tests
npm test              # unit suites; PostgreSQL suites print SKIPPED without TEST_DATABASE_URL
npm run test:ui       # Playwright layout/behaviour tests; print SKIPPED when Playwright is not installed
```

Without `DATABASE_URL`, only guest play works. Accounts, sessions, friends, history and the admin console need PostgreSQL.

## PostgreSQL tests

The `tests/*.pg.test.js` suites (database, production, cleanup, account, matches, session, friends, private tables) require a disposable local PostgreSQL instance:

```bash
TEST_DATABASE_URL=postgres://postgres:secret@127.0.0.1:5432/postgres npm run test:pg
```

The test helper refuses managed/production-like hosts and does not use `DATABASE_URL`. A skipped PostgreSQL suite is not a pass: `npm run test:pg` fails instead of skipping.

## Data cleanup tooling

For safe user-data cleanup runbook and script details:

- `scripts/cleanup-user-data.js`
- `docs/DATA_CLEANUP.md`
