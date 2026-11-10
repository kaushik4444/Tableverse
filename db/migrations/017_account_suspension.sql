-- 017_account_suspension.sql: owner-set account suspension (admin console, Stage 20.8).
-- A suspended account cannot sign in or use an existing session; its sessions are revoked when it is suspended.
-- Both columns are additive and nullable.
ALTER TABLE players ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(200);
