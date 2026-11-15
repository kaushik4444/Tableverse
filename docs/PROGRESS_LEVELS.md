# Progress and levels

Status: the rules below are agreed and implemented as pure calculations (`lib/xp.js`, `lib/gameSkill.js`, tested in
`tests/xp.test.js`). Nothing is stored or shown yet.

## Account level: progress in Tableverse
- Measures **time only**: 1 XP for each full minute spent in a game.
- Winning, losing, drawing or leaving makes no difference, and there is no penalty.
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

## History (past games)
- Past games count once the feature ships. Their skill points come from the stored results.
- Time for past games comes from the stored start and finish times. A leaver's time up to the moment they left is not
  stored, so for past leavers that time counts as 0.
- Leaves recorded before migration 024 have no penalty flag. Those leavers are not penalised, and they are left out of
  the game ranking because the record cannot show whether others were still playing.

## Not built yet (next steps)
1. Migration: store time spent per player in each game record (`seconds_played`), with a backfill from past start and
   finish times for players who stayed. A leaver's time runs to the moment they left, so new games record it exactly.
2. Calculate account XP and game points from the stored records (no separate totals table at first).
3. Show the account level and the per-game levels on the profile. Named ranks are not planned yet; skill levels only.
4. Update README and What's new when each part ships.
