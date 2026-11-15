-- 025_match_progress.sql: store what the progress system (account XP, game levels) needs, per participant.
-- Additive only: two columns, one nullable and one with a default, so old rows and older application versions are
-- unaffected (an older version never writes them and reads only the columns it already knows).
--   place          the finishing place when the game itself knows it (Property Rivals, Poker); NULL means "rank by score"
--   seconds_played whole seconds the player was in the game; people who left (and bots) get 0, as their leave time is not stored
-- Backup/restore: both columns are part of match_participants and are restored with it; nothing else references them.

ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS place SMALLINT;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS seconds_played INTEGER NOT NULL DEFAULT 0;

-- Past games count. People who stayed to the end played from the match start to its finish; a single game is capped at
-- 6 hours so a table that was left open cannot inflate the total. Re-running is harmless: only rows still at 0 change.
UPDATE match_participants mp
   SET seconds_played = LEAST(21600, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (m.finished_at - m.started_at)))::INTEGER))
  FROM matches m
 WHERE mp.match_id = m.id AND mp.seconds_played = 0 AND NOT mp.left_early AND NOT mp.is_bot;
