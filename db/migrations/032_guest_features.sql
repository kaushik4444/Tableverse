-- 032_guest_features.sql: what guests may do (the owner switches each one on or off in the admin console, Guests tab).
-- A feature with no row, or enabled = false, is locked for guests. Registered players are never affected. Configuration
-- only: no foreign key, so it is kept when player data is cleared (see db/cleanup.js PRESERVE).
CREATE TABLE IF NOT EXISTS guest_features (
  feature    TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL
);
