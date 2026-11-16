# Progress and levels

Status: implemented on `development` (not yet released to `main`; see the build steps below). Leaving and rejoining, and what counts as play time, are in `docs/LEAVING_AND_REJOINING.md`. Rules: `lib/xp.js`, `lib/gameSkill.js`, combined per player in `lib/progress.js`
(tests: `tests/xp.test.js`, `tests/progress.test.js`). Stored by migration 025, shown on own and public profiles, and counted for penalised leaves in the
admin overview. Not verified in production.

## Account level: progress in Tableverse
- Measures **time only**: 1 XP for each full minute of **active play**.
- Active play is the time a person was seated in a running game, counted across every stretch. It starts when the game starts (or when they take their seat back), and stops when they leave, when their connection drops (a reconnect resumes it), or when the game ends. A capped six hours per game, as before.
- Spectators earn nothing. A bot seat earns nothing.
- Winning, losing, drawing or leaving makes no difference to the calculation, and there is no penalty.
- It is progress, not a ranking.

## Levels
- Level n starts at `50 * n * (n-1) / 2` XP: level 2 at **50**, level 3 at 150, level 4 at 300, level 5 at 500.
- Each level needs 50 more XP than the one before.
- The overall level uses this curve. Game XP has no levels.
- The two kinds of XP never add into each other: Game XP does not change the overall level, and time does not change Game XP.

## Game XP: skill, per game (no game levels)
Each game has its own rule. Points are given per game and add up to that game's **Game XP**, a running total. Game XP
can go negative. There are no game levels: the profile shows Game XP per game, and each game opens a detail view.

There are two kinds of result:

- **Placing games**: every ranked player gets a place from their result. The best place gets **+20**, the last place gets
  **-10**, and places in between fall in a straight line. Ties share a place. With four ranked players that is
  **+20, +10, 0, -10**; with three, **+20, +5, -10**. A lone ranked player gets 0.
- **Win or lose games**: a win gets **+20**, a draw **0**, a loss **-10**.
- **Leaving while others are still playing** (a penalised leave) costs **-30** in every game. It is always worse than
  finishing last. A leave without a penalty is not ranked in that game.
- Only people still in the game are ranked; bots are never ranked.

| Game | Kind | What decides the place or result |
|---|---|---|
| Wizard | Placing | Points at the end of the game (higher is better). |
| Poker | Placing | Chips at the end of the game. |
| Property Rivals | Placing | Net worth at the end of the game. Bankrupt players are last. |
| Go Fish | Placing | Number of books collected. |
| Ludo | Placing | Finishing order. |
| Snakes & Ladders | Placing | Finishing order. |
| Twenty-nine | Win or lose | Your team wins or loses (both players on a team get the same points). |
| Line Games | Win or lose | Your side wins, draws or loses. |
| The Mind | Win or lose | Everyone plays together: cleared together is a win for all, lost together is a loss for all. |

Rules that apply to every game:
- **Penalised leave** (leaving while others are still playing, see `lib/leavePolicy.js`): **-30**. It is always worse than
  finishing last.
- **Leave without a penalty** (bots only, or an abandoned game): not in the game ranking at all.
- **Bots** are not ranked.

## Game over: what the screen shows
- The result (who won, the places) is the main line, as before.
- No progress cards. The screen shows one table for everyone at the table, with three columns:
  - **Player**: the name, with a guest or left-early mark where that applies.
  - **[Game] XP**: this game's own skill points for each person (`–` when they were not ranked, for example an unpenalised leave).
  - **Lifetime [Game] XP**: the sum of that person's Game XP in this same game across all their stored matches. It is read from the database when the game ends (`gameTotals` in `server.js`), after this game's own record is written. Guests show `–` (their games are not kept).
- Time played (Player Progress) is not shown on this screen. It still moves the overall level, and it is on the profile.
- The lifetime column may show `…` for a moment while the server answers. The client asks once per finished game; if the answer is lost, the column stays `…` for that game (the game itself is unaffected).

## History and rule changes
- Game XP and Player Progress are calculated from the stored results each time they are read. No totals are stored, so a
  rule change applies to past games as well.
- Changing a loss from **-20** to **-10** therefore changes the Game XP of past games: each loss is 10 higher, and in a
  placing game the line from first to last is redrawn, so in-between places can move too. It does not change any time
  played, Player Progress, or any overall level.
- Stored results (places, seconds played, win/lose/draw) are not rewritten. Nothing needs a migration or a backfill.

## Leaving and coming back
The rules for leaving a running game, the 2-minute window to take a seat back, spectating after it, and active play time are in [LEAVING_AND_REJOINING.md](LEAVING_AND_REJOINING.md). Active play time is counted by `lib/playTime.js`, and the window by `lib/leavePolicy.js`.

## History (past games)
- Past games count once the feature ships. Their skill points come from the stored results.
- Time for past games comes from the stored `seconds_played`. Games recorded before active play was tracked use the old rule: the start and finish times for people who stayed, and 0 for leavers.
- Leaves recorded before migration 024 have no penalty flag. Those leavers are not penalised, and they are left out of
  the game ranking because the record cannot show whether others were still playing.

## Status of the build steps
Done on `development` (not released to `main`, not verified in production):
1. Storage: `seconds_played` and `place` (migration 025), with a backfill for past games, for the people who stayed.
2. Account XP and game points are calculated from the stored records (`lib/progress.js`; no separate totals table).
3. The account level, the Game XP per game and the number of penalised leaves show on own and public profiles; the admin overview counts penalised leaves.

Done since (rejoin window and active play time, see `docs/LEAVING_AND_REJOINING.md`): a leaver keeps the time up to the moment they left; a dropped connection pauses play time; a person who took their seat back is counted for each stretch they played. Past games are not recalculated.

Still open:
- Named ranks are not planned; skill levels only.

## Storage (migration 025)
`match_participants` gets two columns: `place` (SMALLINT, NULL when the game has no place of its own, so the level is ranked by score) and `seconds_played` (INTEGER, default 0). From the active-play change on, `seconds_played` is the active play time written with the record (`secondsPlayed`), capped at 6 hours per game; bots get 0. Records without it fall back to the old rule (the match length for stayers, 0 for leavers and bots). The migration backfilled `seconds_played` for past games (stayers only) and is safe to re-run. No further migration was needed for the rejoin window. Both columns are additive and nullable or defaulted, so old application versions keep working, and they are restored together with the table. They are read by `getProgress` in `db/matches.js`, which feeds the profile pages.

## Weekly boards (opt-in)
- Each game has a **weekly board**: the last 7 days, the top 10 players by their Game XP in that game. It uses the same rules as the profile (`boardFor` in `lib/progress.js`), so the numbers agree.
- Only players who turn it on are shown (`players.leaderboard_opt_in`, migration 028). It is **off by default**; a player switches it on from a game's detail view on their own profile. The board shows the display name and that game's Game XP for the week. Nothing else about a player is shown.
- `GET /api/leaderboard?game=` is public and read-only. The switch is `POST /api/me/leaderboard` (signed in, CSRF header, `{optIn: boolean}`).
- Without a database the board is empty. The query reads one game's matches from the window; this is fine for the beta and would need an index or a cache at larger scale.
