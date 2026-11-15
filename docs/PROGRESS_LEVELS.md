# Progress and levels

Status: implemented on `development` (not yet released to `main`; see the build steps below). Rules: `lib/xp.js`, `lib/gameSkill.js`, combined per player in `lib/progress.js`
(tests: `tests/xp.test.js`, `tests/progress.test.js`). Stored by migration 025, shown on own and public profiles, and counted for penalised leaves in the
admin overview. Not verified in production.

## Account level: progress in Tableverse
- Measures **time only**: 1 XP for each full minute spent in a game.
- Winning, losing, drawing or leaving makes no difference to the calculation, and there is no penalty. Time is the actual time each person spent in their seat (see "Leaving and coming back" below). Spectator time never counts.
- It is progress, not a ranking.

## Levels
- Level n starts at `50 * n * (n-1) / 2` XP: level 2 at **50**, level 3 at 150, level 4 at 300, level 5 at 500.
- Each level needs 50 more XP than the one before.
- The account level and each game's level use the same curve.

## Game level: skill, one per game
Each game has its own rule. Points are given per game, and a game's level comes from its running total. Points can go
negative.

There are two kinds of result:

- **Placing games**: every player gets a place from their score. The best place gets **+20**, the last place gets
  **-20**, and places in between fall in a straight line. Ties share a place.
- **Win or lose games**: a win gets **+20**, a draw **0**, a loss **-20**.

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

## Leaving and coming back (rejoin grace period)
Implemented in `lib/rejoinPolicy.js`, wired into `server.js` (leave, rejoin, game start) and `db/matchRecord.js` (what is stored). Tests: `tests/rejoin-policy.test.js`.
- **Grace period:** 2 minutes (`REJOIN_GRACE_MS`), counted from a person's **first** voluntary departure in a game. Later leave and rejoin cycles never move that deadline.
- **Inside the period** the person can take their seat back from the bot. Their leave penalty is removed while the game runs, as before.
- **After the period** the bot keeps the seat, the penalty stands, and the person can only watch the game. They get a notice saying so.
- **Network drops are not departures.** A dropped connection is handled as before (the table is told, a bot may play the seat after the absence limit), and it never starts the grace period.
- **Active time:** each seated person's time is the sum of their intervals in the seat. It stops when they leave and starts again when they take the seat back. Bots and spectators have none. A single game counts at most 6 hours.
- **Stored result:** the record stores each person's active seconds in `match_participants.seconds_played`. No new column or migration was needed (migration 025 already has it). Rows from before this change keep the old rule.
- **Restart:** the grace period and active time live in memory. After a restart a running table is not resumed, so nobody can reclaim a seat; leavers' losses are still written by the shutdown record, with the active time known at that moment.
- **Abandoned games:** a second departure still abandons the game. Nobody is penalised and the players who stayed get no result, as before.

## History (past games)
- Past games count once the feature ships. Their skill points come from the stored results.
- Time for past games comes from the stored start and finish times, for people who stayed to the end. For past leavers the
  time up to their departure was never stored, so it counts as 0. Only games recorded from this change on store active time.
- Leaves recorded before migration 024 have no penalty flag. Those leavers are not penalised, and they are left out of
  the game ranking because the record cannot show whether others were still playing.

## Status of the build steps
Done on `development` (not released to `main`, not verified in production):
1. Storage: `seconds_played` and `place` (migration 025), with a backfill for past games, for the people who stayed.
2. Account XP and game points are calculated from the stored records (`lib/progress.js`; no separate totals table).
3. The account level, the game levels and the number of penalised leaves show on own and public profiles; the admin overview counts penalised leaves.

Still open:
- Time while a dropped connection is waiting to come back: the seat is still theirs, so a bot playing it while they are offline is not yet excluded from their active time (see "Leaving and coming back").
- Named ranks are not planned; skill levels only.

## Storage (migration 025)
`match_participants` gets two columns: `place` (SMALLINT, NULL when the game has no place of its own, so the level is ranked by score) and `seconds_played` (INTEGER, default 0). A stayer gets the match length (finished minus started), capped at 6 hours per game; leavers and bots get 0 because a leave time is not stored. The migration backfills `seconds_played` for past games (stayers only) and is safe to re-run. Both columns are additive and nullable or defaulted, so old application versions keep working, and they are restored together with the table. They are read by `getProgress` in `db/matches.js`, which feeds the profile pages.
