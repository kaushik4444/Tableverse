-- 013_admin_console.sql: Stage 20.5 (roles, privacy-light analytics, feedback, announcements, audit log). Additive only.
-- Numbered after 012_cleanup_indexes.sql (Stage 20.3). If another branch also claims 013, the file names differ and both run in
-- sorted order; nothing here touches a table or column that the 20.3 migrations create.

-- ---------------------------------------------------------------- roles (checked on the server for every admin request)
ALTER TABLE players ADD COLUMN IF NOT EXISTS role VARCHAR(8) NOT NULL DEFAULT 'user';
DO $$ BEGIN
  ALTER TABLE players ADD CONSTRAINT players_role_check CHECK (role IN ('user', 'admin', 'owner'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- The database itself allows at most one owner, so no code path can create a second one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_single_owner ON players ((role)) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_players_staff ON players (role) WHERE role <> 'user';

-- ---------------------------------------------------------------- analytics: aggregate counters only, no per-event log
-- One row per day, metric and dimension (for example a game id). No account id, address or user agent is stored here.
CREATE TABLE IF NOT EXISTS analytics_daily (
  day DATE NOT NULL,
  metric VARCHAR(32) NOT NULL,
  dim VARCHAR(48) NOT NULL DEFAULT '',
  total BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, dim)
);
-- Distinct active accounts per day, stored as a keyed hash (HMAC with a server-side salt), never as an account id.
CREATE TABLE IF NOT EXISTS analytics_active (
  day DATE NOT NULL,
  actor CHAR(32) NOT NULL,
  PRIMARY KEY (day, actor)
);
CREATE INDEX IF NOT EXISTS idx_analytics_active_actor ON analytics_active (actor);
-- Keys of analytics writes that were applied (a random batch id plus ':c' or ':a'). A retried write with a known key is
-- ignored, so a write that landed after a timeout is never counted twice. Holds no personal data; purged after 3 days.
CREATE TABLE IF NOT EXISTS analytics_batches (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Server-side settings for analytics (the hashing salt). Deleting the salt row makes every stored hash unlinkable.
CREATE TABLE IF NOT EXISTS analytics_meta (
  key VARCHAR(32) PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------- feedback
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  category VARCHAR(8) NOT NULL DEFAULT 'other' CHECK (category IN ('bug', 'idea', 'other')),
  message VARCHAR(1000) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status, created_at DESC);

-- ---------------------------------------------------------------- announcements (banners)
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message VARCHAR(200) NOT NULL,
  level VARCHAR(8) NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'success')),
  audience VARCHAR(10) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'signed_in', 'guests', 'admins')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ, -- set when an admin ends it early
  created_by UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_announcements_window ON announcements (ends_at, starts_at);
-- A signed-in player's dismissal follows the account to every device.
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, announcement_id)
);

-- ---------------------------------------------------------------- audit log (append only: the application never updates or deletes rows except retention)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID REFERENCES players(id) ON DELETE SET NULL,
  action VARCHAR(48) NOT NULL,
  target_type VARCHAR(16),
  target_id VARCHAR(64),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit_log (at DESC);
