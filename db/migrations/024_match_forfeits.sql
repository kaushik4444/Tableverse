-- 024_match_forfeits.sql: a player who left a game while others were still playing counts as a loss.
-- Additive only: one column with a default, so existing rows and older application versions are unaffected (an older
-- version never writes it and reads only the columns it already knows). Such a player is still left_early, so
-- insights and country stats keep their meaning; forfeit is what makes the leave count in the player's record.

ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS forfeit BOOLEAN NOT NULL DEFAULT FALSE;
