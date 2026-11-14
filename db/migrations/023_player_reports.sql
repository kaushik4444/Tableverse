-- 023_player_reports.sql: a report about a player's conduct, made from their card or profile (not one chat message).
-- Additive only: a new table, nothing existing changes.
-- Follows the chat report rules (015): a report an account made is removed with that account, and a report about a
-- deleted account is kept with the account link cleared and the name at the time kept.
-- One report per reporter and player: a repeat is ignored, so a player cannot be reported over and over.

CREATE TABLE IF NOT EXISTS player_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reported_id UUID REFERENCES players(id) ON DELETE SET NULL,
  reported_display_name VARCHAR(32) NOT NULL DEFAULT 'Deleted player',
  reason VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_reports_distinct_players CHECK (reported_id IS NULL OR reporter_id <> reported_id),
  CONSTRAINT player_reports_valid_reason CHECK (reason IN ('harassment', 'hate', 'threats', 'sexual', 'spam', 'other')),
  CONSTRAINT player_reports_once_per_player UNIQUE (reporter_id, reported_id)
);
-- The unique key covers reporter_id. Deleting an account must find the reports that point at it (reported_id) without a scan.
CREATE INDEX IF NOT EXISTS idx_player_reports_reported ON player_reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_player_reports_reporter_created ON player_reports(reporter_id, created_at DESC);
