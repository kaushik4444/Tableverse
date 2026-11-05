# Tableverse

> **Your friends. Your games. One table.**

Live site: **https://game-fmy4.onrender.com**

Tableverse is a browser-based multiplayer game arena for quick social sessions with no install.

## Current games

- **Wizard** (3–6): plus/minus one, hidden/secret prediction, foresight, short game.
- **29** (4): team-based trick play with secret trump and 3/6/9 match length options.
- **Poker (No-Limit Texas Hold’em)** (2–8): blinds, all-ins, side pots, showdown resolution.
- **The Mind** (2–4): co-op, real-time ascending play with lives/stars and difficulty options.
- **Ludo** (2–4): race your four tokens home on the classic cross board — roll a six to get out, send opponents back, finish by exact count. Two players sit opposite each other; optional bonus rolls for captures and getting home.
- **Snakes and Ladders** (2–4): roll to race along a 10×10 path to square 100. Ladders lift you, snakes drop you. Optional exact roll to finish and roll again on a six.
- **Property Rivals** (2–6): an original world-tour board game: buy cities, ports and utilities, collect rent, build houses and hotels, trade, auction and bankrupt your rivals. Options: game length, starting cash, auctions, Rest Stop jackpot.
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
- Account menu (Profile, Settings, What's New, logout controls), a profile page (`#profile`; public pages at `#u/<username>`) and tap-a-player cards at the table.
- **Friends**: username search, requests (send, accept, decline, cancel), removal, online/offline, last seen, the game a friend is playing and a connection-quality (ping) badge.
- **Private tables** (the default for new tables) with friend invitations, and **host tools** to hand over the table or remove people.
- Real-time chat, spectators, reconnect/rejoin, activity log.
- Cookie-based auth (`HttpOnly` session cookie), CSRF double-submit protection, rate limits, one active session per account.

## What's new in v0.14 — talk at the table
- **Voice chat**: everyone at a table can talk to each other, in the lobby and during the game. Tap the microphone to join and talk (tap again to mute), tap the speaker to listen only or silence everyone. A little mic marks who is in voice and a green ring shows who is talking. Up to 8 people per table; spectators can watch but take a seat to talk.
- It is peer to peer (WebRTC): the audio goes directly between players and never through the server, which only keeps the list of who is in voice and passes the connection setup messages (`lib/voiceRelay.js`). Needs https (or localhost) and microphone permission; without a microphone you can still listen.
- Strict networks (some offices, mobile carriers) need a TURN relay: set `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` (or `ICE_SERVERS` as JSON, or `STUN_URL`). Without them only a public STUN server is used and some pairs of players will not hear each other. This is the most common reason the microphone ring lights up for the speaker while the others hear nothing: the two browsers cannot reach each other directly. Free TURN tiers (for example Metered or Cloudflare Calls) work; set the three variables on your host and redeploy.
- Privacy: peers in a WebRTC call can learn each other's network address. Voice is off until you tap the microphone or speaker.

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
- If `DATABASE_URL` is omitted and `NODE_ENV` is not `production`, the app uses in-memory storage.
- In production, startup is strict: missing/unreachable DB or failed migration aborts boot.
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

## Production readiness

The application-level safeguards and remaining launch requirements are tracked in [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md). In particular, the current in-memory room/presence model is single-instance, and the default match-result spool is not durable across replacement of an ephemeral host. Review the release checklist before opening the service to the public.

## Development

```bash
npm start            # http://localhost:3000 (in-memory store without DATABASE_URL)
npm run build        # syntax-checks server, client, libraries and tests
npm test             # all suites (PostgreSQL suites skip without TEST_DATABASE_URL)
npm run test:ui      # Playwright layout/behaviour tests (skips when Playwright is missing)
```

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
