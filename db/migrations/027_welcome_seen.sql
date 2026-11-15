-- 027_welcome_seen.sql: when a player saw the first-login welcome dialog. NULL means not seen yet.
-- Additive only: one nullable column. Accounts that already exist are marked as welcomed, so only accounts created
-- from now on see the dialog. Older application versions never read the column.

ALTER TABLE players ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ;
UPDATE players SET welcomed_at = NOW() WHERE welcomed_at IS NULL AND is_anonymous = FALSE;
