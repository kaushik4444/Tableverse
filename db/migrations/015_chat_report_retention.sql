-- 015_chat_report_retention.sql
-- Preserve moderation reports against deleted accounts without retaining the deleted account UUID.
-- Reports authored by a deleted reporter still cascade away.
ALTER TABLE chat_reports
  ADD COLUMN reported_display_name VARCHAR(32) NOT NULL DEFAULT 'Deleted player';

UPDATE chat_reports r
   SET reported_display_name = COALESCE(p.display_name, 'Player')
  FROM players p
 WHERE p.id = r.reported_id;

ALTER TABLE chat_reports
  ALTER COLUMN reported_id DROP NOT NULL;

ALTER TABLE chat_reports
  DROP CONSTRAINT chat_reports_reported_id_fkey;

ALTER TABLE chat_reports
  ADD CONSTRAINT chat_reports_reported_id_fkey
  FOREIGN KEY (reported_id) REFERENCES players(id) ON DELETE SET NULL;
