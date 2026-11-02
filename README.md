# Tableverse

> **Your friends. Your games. One table.**

Live site: **https://game-fmy4.onrender.com**

Tableverse is a browser-based multiplayer game arena for quick social sessions with no install.

## Current games

- **Wizard** (3–6): plus/minus one, hidden/secret prediction, foresight, short game.
- **29** (4): team-based trick play with secret trump and 3/6/9 match length options.
- **Poker (No-Limit Texas Hold’em)** (2–8): blinds, all-ins, side pots, showdown resolution.
- **The Mind** (2–4): co-op, real-time ascending play with lives/stars and difficulty options.

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

## What's new in v0.8 — a simpler home

- **Home page.** Greeting and table-code join, then the games straight away. Friends are a compact card (who is online, anything waiting for you, accept/decline invitations in place); the full friends list, search, requests and sent invitations are on their own page at `#friends` (account menu → Friends, with a badge for pending items). Recent and public tables sit below the games.
- **Coming soon.** Monopoly, Snakes and Ladders and Ludo are listed as non-playable cards ahead of their release.
- **What's new** is also linked from the home footer. No server, database or API changes.

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
