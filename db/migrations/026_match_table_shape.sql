-- 026_match_table_shape.sql: store how a table was filled, and whether the record is a finished game.
-- Additive only: three columns on matches. Old application versions never write them, and their reads are unaffected.
--   completed     FALSE for a table that closed mid-game, where only the people who left are written (their losses). Table
--                 analytics count completed games only; each leaver's own loss still counts in their statistics.
--   table_humans  people seated when the game started (a leaver still counts); NULL on rows from before this migration
--   table_bots    bot seats at the start; NULL on rows from before this migration
-- Backfill: a row with no stayer and no bot participant can only be a closed-mid-game record of leavers, so it is marked
-- incomplete. Rows are not otherwise changed. Backup/restore: these columns are part of matches and are restored with it.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS table_humans INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS table_bots INTEGER;

UPDATE matches m
   SET completed = FALSE
 WHERE m.completed
   AND EXISTS (SELECT 1 FROM match_participants p WHERE p.match_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM match_participants p WHERE p.match_id = m.id AND (p.is_bot OR NOT p.forfeit));
