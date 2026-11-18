-- A guest asks to become an account, and the account is created only when the e-mail link is used (db/auth.js
-- requestGuestUpgrade / completeGuestUpgrade). This table holds that pending request: the chosen username and e-mail, the
-- password hash (never the password) and a hash of the one-time link. A request expires with its link and is removed after.
CREATE TABLE IF NOT EXISTS guest_upgrades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  username VARCHAR(32) NOT NULL,
  password_hash TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_upgrades_player ON guest_upgrades(player_id);
