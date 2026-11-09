-- 015_chat_report_retention.sql
-- Preserve moderation reports ABOUT an account when that account is deleted.
-- Reports made BY a deleted reporter still cascade away with the reporter's personal data.

ALTER TABLE chat_reports
  ADD COLUMN IF NOT EXISTS reported_display_name VARCHAR(32) NOT NULL DEFAULT 'Deleted player';

-- Capture the existing account name before changing the reported-account foreign key.
UPDATE chat_reports r
   SET reported_display_name = p.display_name
  FROM players p
 WHERE p.id = r.reported_id;

ALTER TABLE chat_reports
  ALTER COLUMN reported_id DROP NOT NULL;

ALTER TABLE chat_reports
  DROP CONSTRAINT IF EXISTS chat_reports_reported_id_fkey;

ALTER TABLE chat_reports
  ADD CONSTRAINT chat_reports_reported_id_fkey
  FOREIGN KEY (reported_id) REFERENCES players(id) ON DELETE SET NULL;
