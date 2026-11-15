-- 028_leaderboard_opt_in.sql: whether a player is shown on the weekly game boards. Off unless the player turns it on.
-- Additive only: one column with a default, so existing rows and older application versions are unaffected.

ALTER TABLE players ADD COLUMN IF NOT EXISTS leaderboard_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
