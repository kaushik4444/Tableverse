-- 022_player_country.sql: an optional country on the player's profile, chosen by the player (ISO 3166-1 alpha-2, e.g. 'DE', 'IN').
-- NULL means "not set". It is never guessed from an address. Existing rows stay NULL.
ALTER TABLE players ADD COLUMN IF NOT EXISTS country CHAR(2);
DO $$ BEGIN
  ALTER TABLE players ADD CONSTRAINT players_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
