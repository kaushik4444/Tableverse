-- 036_boards_on_by_default.sql: the game boards (weekly and skill ratings) show every player by default. A player can turn
-- it off on their profile, and the boards then leave them out.
--
-- Caution: the database does not record which players turned the switch off on purpose, so this also switches on the
-- players who had it off. This was an explicit owner decision for the friends beta.
ALTER TABLE players ALTER COLUMN leaderboard_opt_in SET DEFAULT TRUE;
UPDATE players SET leaderboard_opt_in = TRUE WHERE leaderboard_opt_in = FALSE;
