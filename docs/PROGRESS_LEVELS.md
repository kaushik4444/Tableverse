# Progress and levels

Status: the rules below are agreed and the pure calculations are in `lib/xp.js` (tested in `tests/xp.test.js`). Nothing
is stored or shown yet: the account level and the per-game levels are not on the profile or anywhere else in the app.

## Two separate systems

### Account level: progress in Tableverse
- Measures **time only**. You earn 1 XP for each full minute you spend in a game.
- Winning, losing, drawing or leaving makes no difference, and there is no penalty.
- It is progress, not a ranking. It does not compare you with other players.

### Game level: skill, one per game
- Based on how you finished a game. Every game scores higher as better, so the finishing position comes from the score.
- A finished game gives 10 points, plus up to 20 for the position (1st gets 20, last gets 0; ties share a position).
- Leaving with others still playing (a penalised leave, see `lib/leavePolicy.js`) costs 15 points for that game.
- A player's total for a game never goes below zero.
- Each game has its own level, so skill in Wizard does not change your level in Ludo.

### Levels (both systems)
- Level n starts at `100 * n * (n-1) / 2` XP: level 2 at 100, level 3 at 300, level 4 at 600, level 5 at 1000.
- Each level needs 100 more XP than the one before.
- The numbers are a starting point and can be tuned in `lib/xp.js` without changing the rules above.

## Not built yet (next steps)
1. Store time spent per player in each game record (a migration adding `seconds_played`; a leaver's time runs to the
   moment they left). Until then, account XP cannot be calculated correctly for leavers.
2. Calculate account XP and per-game points from the stored records (no new totals table needed at first).
3. Show the account level and the per-game levels on the profile.
4. Update README and What's new when each part ships.
