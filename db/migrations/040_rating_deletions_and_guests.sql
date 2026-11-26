-- 040_rating_deletions_and_guests.sql: the rating replay needs to know two things it used to guess.
-- deletion_applied: a deleted account's seat (player_id NULL) is already part of the stored ratings once a full rebuild has
-- replayed it. Until then the live rebuild must do a full replay; after it, the incremental rebuild can carry on. New
-- deletions leave the flag FALSE, so they are picked up again. Additive and idempotent: an older version ignores it.
-- Backup: only ADD COLUMN with a constant default (no table rewrite). Rollback: drop the column; the replay then does a full
-- rebuild on each live update (slower, but correct).
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS deletion_applied BOOLEAN NOT NULL DEFAULT FALSE;
