-- 030_game_access.sql: the four access modes per game (enable, disable for non-admins, disable for guests only, disable for
-- all except the owner). The existing enabled column stays and is kept in step: enabled = (access = 'on'). An older
-- application version that still reads enabled therefore treats every restricted game as off, never as open.
-- A switch that was off becomes 'owner' (the owner may still test it; nobody else can start it). Additive and idempotent.

ALTER TABLE game_flags ADD COLUMN IF NOT EXISTS access TEXT NOT NULL DEFAULT 'on';
ALTER TABLE game_flags DROP CONSTRAINT IF EXISTS game_flags_access_check;
ALTER TABLE game_flags ADD CONSTRAINT game_flags_access_check CHECK (access IN ('on', 'admins', 'guests', 'owner'));
UPDATE game_flags SET access = 'owner' WHERE enabled = FALSE AND access = 'on';
