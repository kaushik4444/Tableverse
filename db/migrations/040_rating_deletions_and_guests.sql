-- 040_rating_deletions_and_guests.sql: what the rating replay needs to know, stored instead of guessed.
--
-- deletion_applied: a deleted account's seat (player_id NULL) is already in the stored ratings once a full rebuild has replayed it.
--   Until then a live rebuild does a full replay; after it the incremental rebuild carries on. A new deletion stays FALSE.
-- is_guest: the seat was a guest when the match was recorded (a snapshot: a guest who upgrades later keeps its guest-era
--   matches unrated, so no live change is needed). Backfilled here from the players' current anonymous flag, so a guest who
--   upgraded before this migration is not flagged.
-- Matches with a guest seat were rated under the old rule: rating_processed is reset so the next full rebuild reprocesses them.
--   Run `node scripts/ratings-replay.js` once after the deploy (live mode, RATINGS_LIVE=1, does it on the next match).
--
-- Additive and idempotent. Older application versions ignore these columns.
-- Backup: take the usual Neon backup before deploying. The column adds use constant defaults (no table rewrite).
-- Rollback order: first roll the application back to a version that does not read these columns, then drop the columns.
--   Do not drop them while this version runs: its rebuilds read them.
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS deletion_applied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE match_participants mp SET is_guest = TRUE
  FROM players p
 WHERE p.id = mp.player_id AND p.is_anonymous AND NOT mp.is_bot AND NOT mp.is_guest;

UPDATE matches m SET rating_processed = FALSE
 WHERE m.rating_processed
   AND EXISTS (SELECT 1 FROM match_participants mp WHERE mp.match_id = m.id AND mp.is_guest);
