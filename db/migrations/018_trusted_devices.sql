-- 018_trusted_devices.sql: "keep me signed in on this device" (Stage 20.9).
-- The device token is random, stored only as a SHA-256 hash, and works only for one account. Each use slides its expiry.
-- A sign-out, a password reset, an owner sign-out or a suspension ends it.
CREATE TABLE IF NOT EXISTS auth_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label VARCHAR(80) NOT NULL DEFAULT 'Browser',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_devices_player ON auth_devices (player_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_devices_expires ON auth_devices (expires_at);
