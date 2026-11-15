# Progress and levels

Status: the rules below are agreed and implemented as pure calculations (`lib/xp.js`, `lib/gameSkill.js`, tested in
`tests/xp.test.js`). Nothing is stored or shown yet.

## Account level: progress in Tableverse
- Measures **time only**: 1 XP for each full minute spent in a game.
- Winning, losing, drawing or leaving makes no difference, and there is no penalty.
- It is progress, not a ranking.

## Game level: skill, one per game
Each game has its own rule, because the games are scored differently.

| Game | How a finished game counts |
|---|---|
| Wizard | Placings by score: 1st +20, last -20, in a straight line between. Ties share a place. |
| Poker | Placings by chips (same ladder). |
| Property Rivals | Placings by net worth; bankrupt players rank last (same ladder). |
| Go Fish | Placings by books (same ladder). |
| Ludo | Placings by finishing order (same ladder). |
| Snakes & Ladders | Placings by finishing order (same ladder). |
| Twenty-nine | Win +20, draw 0, loss -20 for everyone on that team. |
| Line Games | Win +20, draw 0, loss -20. |
| The Mind | Cooperative: cleared together +20 each, lost together -20 each. |

- **Penalised leave** (leaving while others are still playing, see `lib/leavePolicy.js`): **-30** in every game. It is always
  worse than finishing last.
- **Leave without a penalty** (bots only, or an abandoned game): not in the game ranking at all.
- **Bots** are not ranked.
- Points can go **negative**. A game's level comes from its running total, which is not floored.

## Levels (both systems)
- Level n starts at `100 * n * (n-1) / 2` XP: **level 2 starts at 100**, level 3 at 300, level 4 at 600, level 5 at 1000.
- Each level needs 100 more XP than the one before.
- The numbers are starting values and can be tuned in `lib/xp.js` and `lib/gameSkill.js`.

## Not built yet (next steps)
1. Store time spent per player in each game record (a migration adding `seconds_played`; a leaver's time runs to the
   moment they left). Until then, account XP cannot be calculated correctly for leavers.
2. Calculate account XP and per-game points from the stored records (no separate totals table at first).
3. Show the account level and the per-game levels on the profile.
4. Update README and What's new when each part ships.
