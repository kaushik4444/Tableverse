# Tableverse

> **Your friends. Your games. One table.**

Live site: **https://playtableverse.com**

Tableverse is a browser-based multiplayer game arena for quick social sessions with no install.

## Current games

Twenty-two games are open to players, Carrom included. Guests can play open games when guest play is switched on (see [Accounts and verification](#accounts-and-verification)).

- **Wizard** (3–6): plus/minus one, hidden/secret prediction, foresight, short game.
- **29** (4): team-based trick play with secret trump and 3/6/9 match length options.
- **Poker (No-Limit Texas Hold’em)** (2–8): blinds, all-ins, side pots, showdown resolution.
- **Mind** (2–4): co-op, real-time ascending play with lives/stars and difficulty options.
- **Ludo** (2–4): race your four tokens home on the classic cross board — roll a six to get out, send opponents back, finish by exact count. Two players sit opposite each other; optional bonus rolls for captures and getting home.
- **Snakes and Ladders** (2–4): roll to race along a 10×10 path to square 100. Ladders lift you, snakes drop you. Optional exact roll to finish and roll again on a six.
- **Take 5** (2–8): everyone secretly picks a card each turn; cards are played lowest first onto four rows of five. The sixth card in a row, or a card that fits nowhere, makes you take penalty points. Lowest total wins when someone reaches the target (35, 66 or 100).
- **Stage 10** (2–6): a rummy game in stages. Lay down each stage's goal (sets, runs or one colour; wild cards help), add cards to laid groups, and be first to go out. Skip cards make the next player lose a turn. Short (5 stages) or full (10 stages).
- **Property Rivals** (2–6): an original world-tour board game: buy cities, ports and utilities, collect rent, build houses and hotels, trade, auction and bankrupt your rivals. Tap a city in your holdings for its card: mortgage value, rent now and the full rent table, and house and hotel costs. Options: game length, starting cash, auctions, Rest Stop jackpot.
- **Tic-Tac-Toe** (2): a 3×3 line game. Line up three to win; a full board with no line is a draw.
- **Four in a Row** (2): drop discs into a 7×6 grid and connect four. Choose *Line length* five for a bigger 9×8 grid (Five in a Row). Choose who starts; a bot fills the second seat.
- **Chess** (2): the full game with castling, en passant and promotion, and draws by stalemate, fifty moves, threefold repetition or insufficient material.
- **Hidden Miners** (3–8): secretly a Digger or a Saboteur, build a tunnel toward the gold, break and repair tools, scout chambers and collapse pieces. Scored over 1, 3 or 5 rounds.
- **Color Clash** (2–8): match the colour or number, use Stop, Flip, Take 2 and Wild cards, and be first to empty your hand. Round points add up to a target.
- **Go Fish** (2–6): ask for a rank, collect four of a kind and make the most books. Optional “Fish your wish” (draw the card you asked for and go again).
- **Memory Match** (2–4): turn two cards over to find pairs. A match keeps your turn; the most pairs wins. Pick 4×4, 4×6 or 6×6 cards.
- **Dots and Boxes** (2–4): draw lines between the dots to close boxes. A box you close is yours and you move again. Pick a 3×3, 4×4 or 5×5 board; the most boxes wins.
- **Sea Battle** (2): hide five ships in your 10 × 10 sea and fire at the other player’s. The first to sink the whole fleet wins.
- **Falling Blocks** (2–4): everybody builds in their own well from the same blocks. Clear rows to send garbage to rivals; the last one still building wins.
- **Carrom** (2–4): flick the striker to pocket your coins and the queen. Two players, or two teams of partners when there are four.
- **Bingo** (2–8): every player has a 5×5 card and numbers are called one at a time. Mark your called numbers and shout Bingo first. Choose *Winning pattern* (any line or the full card), *Pace*, and *Mark for me*. Bots mark and call Bingo themselves.
- **Sudoku** (1–8): everybody gets the same puzzle on their own grid; the first grid filled in correctly wins. Each player has 3 lives: a wrong number shows red at once and costs one, and the third takes you out of the race (alone, it is game over). Each player has 3 undos, and each one takes back only the last move. Playing alone also gives a solo rating per difficulty, separate from race play (a solve within par moves it up; a game over moves it down). Easy, medium or hard, bots fill at a chosen speed, and you see only how many squares each player has right and their lives.

Bots can fill open seats so tables can start quickly.

## Accounts and verification

Tableverse is open to players, with all twenty-two games available.

- Playing needs an account, or a guest visit when guest play is switched on (`GUEST_PLAY_ENABLED=true`; see `docs/GUEST_PLAY.md`).
- A registered account must verify its email before it can join a table. There is no switch for this.
- A guest plays without an account, and is the only unverified player.
- Verification is never faked: `email_verified_at` stays empty until the verification link is used.
- Passwords: 8 to 200 characters. Common words such as "password", and a password that contains your username or the first part of your email, are refused. No character mix is required.

## What exists today

- Public home page, live table directory and a table-code box (public tables).
- Auth sheet that resumes the action a visitor originally tapped after login.
- Account menu (Profile, Settings, What's New, logout controls), a profile page (`#profile`; public pages at `#u/<username>`) and tap-a-player cards at the table. Signed-in players can block or report someone from the card or the public profile page.
- **Friends**: username search, requests (send, accept, decline, cancel), removal, online/offline, last seen, the game a friend is playing and a connection-quality (ping) badge.
- **Public and private tables.** New tables are public and listed in the open tables; a host can make a table private, and private tables open with friend invitations, and **host tools** to hand over the table or remove people.
- Real-time chat, spectators, reconnect/rejoin, activity log.
- **Game settings at a glance**: every game shows its current settings at the top right. Tap them for the full list with each choice explained. Settings are set by the host in the lobby and can't change during a game.
- **Home page**: open tables sit above the games (two rows that scroll sideways on a phone; a column beside the games on a wide screen). Each game has its own logo, and the games are listed in the order set in the admin console.
- **Game guides in the table**: Poker has a hand-rankings sheet, and Stage 10 has a Phases sheet explaining each stage. Stage 10 shows every player's stage at the table.
- **Levels and progress**: the profile shows an overall level from active play time (1 XP per full minute seated and connected), the minutes to the next level, and a one-time notice when you reach a new level.
- **Instagram**: the home page footer links to @playtableverse, in a new tab.
- **Keep me signed in on this device**: optional at sign-in. The browser stays signed in for 30 days after its last visit. It ends on sign-out, sign-out everywhere, a password reset, or a suspension.
- **Owner e-mail broadcasts** (owner only, admin console): mail to everyone, verified or unverified accounts, or accounts inactive for 30 days. Promotional mail needs `PUBLIC_APP_URL` for its unsubscribe link.
- **Blocking**: a block hides the other player's table chat and voice, and stops invitations between you. A block never removes anyone from a table, so you can still share one.
- Cookie-based auth (`HttpOnly` session cookie), CSRF double-submit protection, rate limits, one active session per account.

## Beta launch (on `development`, 2026-11-28)

What changes for the public beta. Code and docs are in this branch; the settings below live outside the repository and must be checked by the owner.

- **22 games** are listed in the app, Carrom included.
- **Guest play** is the owner's decision for the beta. Production stays off until the owner sets `GUEST_PLAY_ENABLED=true` in Render. This repository cannot confirm that setting, so check it in Render before posting the launch announcement.
- **Owner checklist before the announcement:**
  1. Render: `GUEST_PLAY_ENABLED=true`, then redeploy or restart.
  2. Admin console, Games tab: Carrom and every game you want open set to Enabled.
  3. Admin console, Guests tab: confirm the guest limits you want (private tables, profiles and blocking stay locked for guests).
- **What's new** gets the launch items under the date `2026-11-28`.

## Released 2026-11-25 (on `main`)

This is the release record for the day. It is wider than what players see: the in-app **What's new** and **Version history** are a separate, player-facing selection in `public/whats-new-data.js`, grouped by date with major updates first and minor updates folded under "Show minor updates". Items such as Carrom (admin testing), owner tools, database migrations and environment flags appear here only.

- **Appearance.** Settings → Appearance: Dark (the default), Light, or Follow system. The choice is kept on this device. Light changes the app's screens and the password-reset and email-verification pages; game tables keep their look, and the admin console and the impressum draft stay as they are.
- **How-to pictures.** Each game's how-to card shows its own picture.
- **Friends and profile.** Actions keep your scroll position, and an unchanged page is not redrawn. Friends show a presence dot; a profile no longer shows the old raw "Highest score".
- **Game over.** The result card appears sooner and updates in place. If the connection was down when the game ended, the ratings are asked for again once it is back, and the card says so if they stay unavailable.
- **No loading that never ends.** A home page with no games open, or a game list that failed to load, says so. A profile opened right after another shows the right person even if the first answer arrives late.

- **Carrom** is open to players (2–4 players, in teams of partners when there are four). Owner step: the admin console's Games tab must show Carrom as Enabled.
- **Guest play controls.** Guests can read and send table chat and play open games. Private tables, rejoining after leaving on purpose, player profiles and stats, blocking and reports are locked for guests until the owner or an admin opens them in the admin console (**Guests** tab). A locked control shows a lock and opens the account reminder. Friend requests stay account-only. Connecting after a dropped connection always works.
- **Owner redeploy.** The owner can ask Render to redeploy the app from the admin console's Logs tab, after typing `REDEPLOY`. It needs `RENDER_API_KEY` with deploy rights and `RENDER_SERVICE_ID`, and has a five-minute cooldown.
- **Guest play (off by default).** With `GUEST_PLAY_ENABLED=true` a visitor can play without registering. A guest is a temporary account that lasts `GUEST_SESSION_TTL_HOURS` (default 72) and can later become a full account in place, keeping its games. The owner chooses per game who may play (enabled, disabled for non-admins, disabled for guests only, or disabled for all). See [docs/GUEST_PLAY.md](docs/GUEST_PLAY.md).
- **Level-up notice and next-level minutes** on the profile, and the **Instagram footer link**, are described in What's new (date `2026-11-15`).
- **Accounts.** Sign in with Google (off until the owner sets `GOOGLE_CLIENT_ID`). Google-only accounts can delete themselves with a fresh Google sign-in. "Keep me signed in" is on the Google button and in the sign-up step; use it only on a device you own.
- **Owner clean-up.** The owner can permanently delete a stale ordinary account from the Users tab (type the username to confirm). A filter shows accounts not seen for 30 to 180 days.
- **Leaving a game.** Each leave counts: a first or second leave can be undone by taking your seat back in time, while the third leave in a game is final. Leaving a game that other people are still playing asks first. A bot takes the seat, and the others keep playing. If the game then finishes, the leaver's result is a loss. If a second player also leaves, the game is abandoned: no first or second leave is penalised, and the people who stayed get no result for it (not played, a draw or a loss). A third leave is still a final penalty, even when it is the one that abandons the game. Leaving a game played only against bots does not count. A game closed before it finished still records the losses of the people who left, unless it was abandoned. This applies to every game. You can take your own seat back within two minutes of your first departure (`REJOIN_GRACE_SECONDS`, default 120): the penalty for a first or second leave then goes. A third leave's penalty stays, even if you rejoin. After that the bot keeps the seat and you can only watch. A lost connection is different: it does not start that window. See `docs/LEAVING_AND_REJOINING.md`.
- **Reactions.** There are 21 reactions (from 8). A spectator can react too: their reaction shows their name and a 👁 mark, so the table knows it came from a spectator.
- **Database.** One additive migration (`024_match_forfeits.sql`) adds `forfeit` to match participants. Older rows read as before.
- **29 and Wizard options.** The 29 rule options and Wizard's Shuffle seats now start switched on in a new table. The host can still change them in the lobby.
- **29 double and redouble.** The whole answering side may double, redouble or accept, and one answer decides for both players. A new answer deadline starts when a double or redouble changes who answers.
- **Blocking.** Block and unblock answer one request at a time, an unblock that changes nothing is answered, and a refusal shows an error that names the action.
- **⋯ menu.** The same labels in the same order in every game.
- **Progress and levels.** Your profile (and other players' profiles) shows one overall level from time played (1 XP per full minute of active play), skill ratings per game (tap a game for its details and its rankings, all time or this month) and the number of penalised early leaves (a leave that was not penalised is not counted); the admin overview counts penalised leaves. Time counts only while you are seated and connected: a leaver earns for the time up to leaving, a dropped connection pauses the time and a reconnect resumes it, and spectators earn nothing. The overall level also shows beside your avatar on the home page. Game XP per game: win +20, loss -10, draw 0, placing games +20 for first and -10 for last, and -30 for leaving while others play. The game-over screen is one table: each person's skill-rating change in that game, and their rating in that game this month and all time (no progress cards, no Game XP). Rules: `docs/PROGRESS_LEVELS.md`. One additive migration (`025_match_progress.sql`) stores `place` and `seconds_played`; past games are backfilled for the people who stayed.
- **Ludo, six players.** The outer yard of the seat to play blinks, not the inner home.
- **Version history.** The home page's **What's new** button opens the newest date's section, with its major updates and a "Show minor updates" disclosure. The welcome dialog on first login shows up to three major updates. The account menu's **Version history** lists every date, newest first, with its major updates and a "Show minor updates" disclosure. Release notes are written for players and are in `public/whats-new-data.js`; add a new date at the top when a change ships.

## Released 2026-11-14 (release PR #165): blocking and reports, the ⋯ menu, 29 rules, seat shuffle

- **Block and report on the card and the profile.** A signed-in player can block (or unblock) and report someone from their table card, or from their profile page (`#u/<name>`). A report has a reason (harassment, hate, threats, sexual content, spam or other) and is stored once per reporter and player. Reports count toward the same daily limit as chat reports. Guests can’t report; a deleted account’s reports stay on record with its last name.
- **Friend profiles open in the app.** Tapping a friend’s profile while seated in a game asks first, because it leaves the table. A dropped connection never moves you.
- **⋯ menu.** How to play, the game log and game settings are in the ⋯ menu at the top right. The bottom bar keeps only the table controls, so it fits on phones.
- **Profile loading.** The profile shows a loading state, then the name and the statistics together.
- **Shuffle seats.** Wizard and 29 offer a host-controlled Shuffle seats option. When it is on, seats are shuffled when the game starts, and results are recorded against the seat each player actually had.
- **29 rules in Game settings.** The options are explained in the settings, and the rules text matches the engine: with the *All 29 doubles the win* option on, taking all 29 points is worth +2 game points (instead of +1); with *Double loss below half* on, a bidding team that misses its bid with 14 or fewer points loses 2 (instead of 1); a K–Q marriage changes the bid when the *Marriage changes the bid* option is on (the bid rises by 4 when the other team declares it, and drops by 4 when the bidding team declares it, never below 15). *Double and redouble* is an optional challenge that doubles, then redoubles, the hand’s game points.
- **Fixes.** The 29 trump indicator fits on phones (checked at phone sizes in the browser tests); the 29 score label is correct after a marriage or a double; the guest top bar fits a 360 px screen; a friend’s profile opened from a game no longer appears after a dropped connection.

## Released earlier (Property Rivals cards, game settings, blocking)

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

- **Floating messages**: new public log lines (a bid, a raise, a capture, a mistake, a rent payment) float over the table for a few seconds in Wizard, 29, Poker, Ludo, Mind and Property Rivals. One shared module (`public/feed.js`) reads each game's log; a game picks which kinds float. Snakes and Ladders keeps its move banner, and Go Fish has no log (it would show what others asked for).
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

Take 5, Stage 10 and Mind are Tableverse's own games with their own cards, wording and artwork. They are not affiliated with, endorsed by or licensed by the publisher of any similar game. Their internal ids (`penaltyrows`, `stagerummy`, `themind`) are unchanged, so saved matches, stats and links keep working. See `docs/GAME_NAMES.md`.

## Roadmap (planned, not shipped yet)

- Place Animal Thing (rules still to be defined, see `docs/PLANNED_GAMES.md`)

Hidden Miners (the Saboteur game) and Color Clash (the UNO-style game) are shipped. Ludo shipped in v0.8 and is playable now (2–4 players).

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
- Registered accounts always need a verified email before lobby entry. There is no setting for this.
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
- Verification is always required for registered accounts (the old `REQUIRE_EMAIL_VERIFICATION` switch is ignored).

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
