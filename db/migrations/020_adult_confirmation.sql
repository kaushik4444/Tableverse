-- 020_adult_confirmation.sql: when a new account confirmed it is 18 or older (no date of birth is stored).
-- NULL for accounts created before this migration, and for guests. Nullable and without a default: a metadata-only change.
ALTER TABLE players ADD COLUMN IF NOT EXISTS adult_confirmed_at TIMESTAMPTZ;
