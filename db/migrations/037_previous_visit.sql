-- The time of the player's previous visit, so the home screen can welcome them back. It only moves when someone returns after
-- a gap (see db/players.js), so it is the last visit before the current one. Additive: old app versions ignore the column.
ALTER TABLE players ADD COLUMN IF NOT EXISTS previous_seen_at TIMESTAMPTZ;
-- When the current visit began (set on the return that starts it), so the days away do not grow while the player stays active.
ALTER TABLE players ADD COLUMN IF NOT EXISTS visit_started_at TIMESTAMPTZ;
-- When the current visit began (set on the return that starts it), so the days away do not grow while the player stays active.
ALTER TABLE players ADD COLUMN IF NOT EXISTS visit_started_at TIMESTAMPTZ;
