-- 021_match_draws.sql: a drawn line game (Tic-Tac-Toe, Four or Five in a Row with a full board) is neither a win nor a loss.
-- Before this, a draw was stored as "not a winner", so it counted as a loss. The new column is false for every existing row.
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS is_draw BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: a finished line-game match in which nobody is a winner was a draw (only a draw leaves no winner).
UPDATE match_participants mp
   SET is_draw = TRUE
  FROM matches m
 WHERE m.id = mp.match_id
   AND m.game_id IN ('tictactoe', 'fourinarow')
   AND m.match_key IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM match_participants w WHERE w.match_id = mp.match_id AND w.is_winner = TRUE);
