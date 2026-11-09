-- 014_announcement_revisions.sql: an announcement has a revision that changes whenever what players see changes (text,
-- level, audience or schedule). A signed-in dismissal records the revision the player dismissed, so a banner comes back
-- only when it has changed since. Additive: no rows are removed.
--
-- Existing data: every announcement starts at revision 1. Every existing dismissal is recorded against the revision its
-- announcement has after this migration (1), so a dismissal made before this change keeps hiding its banner. The earlier
-- code had already removed dismissals when a text changed, so no dismissal of an old text survives.

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE announcements ADD CONSTRAINT announcements_revision_positive CHECK (revision >= 1);

ALTER TABLE announcement_dismissals ADD COLUMN IF NOT EXISTS dismissed_revision INTEGER;
UPDATE announcement_dismissals d
   SET dismissed_revision = a.revision
  FROM announcements a
 WHERE a.id = d.announcement_id AND d.dismissed_revision IS NULL;
ALTER TABLE announcement_dismissals ALTER COLUMN dismissed_revision SET NOT NULL;
ALTER TABLE announcement_dismissals ADD CONSTRAINT announcement_dismissals_revision_positive CHECK (dismissed_revision >= 1);
