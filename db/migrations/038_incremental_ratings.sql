-- 038_incremental_ratings.sql: lets the rating rebuild replay only the matches written since the last rebuild.
-- Additive: a flag on matches (FALSE until a rebuild has replayed the match), a partial index for the ones still waiting, and the
-- rating columns widened from NUMERIC(8,2) to NUMERIC. The widening keeps every value exactly as the replay computed it (the
-- replay keeps unrounded numbers; the display rounds them), so starting from the stored values gives the same result as a full
-- replay. Old application versions read and write these columns the same way.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rating_processed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_matches_rating_pending ON matches (finished_at, id) WHERE NOT rating_processed;
ALTER TABLE player_ratings ALTER COLUMN rating TYPE NUMERIC;
ALTER TABLE rating_events
  ALTER COLUMN delta TYPE NUMERIC,
  ALTER COLUMN rating_before TYPE NUMERIC,
  ALTER COLUMN rating_after TYPE NUMERIC;
