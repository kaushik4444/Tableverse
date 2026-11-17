-- 029_game_flags.sql: whether each game can be started (the owner switches games on and off from the admin console).
-- A game with no row is enabled, so existing behaviour does not change. Additive only: one new table, nothing depends on it
-- yet in older application versions.

CREATE TABLE IF NOT EXISTS game_flags (
  game_id    TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL -- the owner who made the change (no foreign key: this is configuration, kept when accounts are cleared)
);
