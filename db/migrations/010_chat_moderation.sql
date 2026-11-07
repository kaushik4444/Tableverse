-- 010_chat_moderation.sql: player blocks (hide an account's table chat from you) and chat reports.
-- Both reference players and are removed with the account (ON DELETE CASCADE), like every other personal table.

CREATE TABLE IF NOT EXISTS player_blocks (
  blocker_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_blocks_distinct_players CHECK (blocker_id <> blocked_id),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS chat_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  room_code VARCHAR(16) NOT NULL,
  message_id UUID NOT NULL,
  message_text VARCHAR(200) NOT NULL,
  reason VARCHAR(16) NOT NULL,
  details VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_reports_distinct_players CHECK (reporter_id <> reported_id),
  CONSTRAINT chat_reports_valid_reason CHECK (reason IN ('harassment', 'hate', 'threats', 'sexual', 'spam', 'other')),
  CONSTRAINT chat_reports_once_per_message UNIQUE (reporter_id, message_id)
);
-- The primary key covers blocker_id. Deleting an account must find the blocks that point at it (blocked_id) without a scan.
CREATE INDEX IF NOT EXISTS idx_player_blocks_blocked ON player_blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_chat_reports_reporter_created ON chat_reports(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_reports_reported_created ON chat_reports(reported_id, created_at DESC);
