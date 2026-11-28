-- 041_game_beta.sql: a Beta mark per game. The owner ticks Beta in the Games tab for an experimental game (one still being
-- fixed); the home menu then shows a Beta tag on it. It changes nothing about who may play. Additive and idempotent: an older
-- application version ignores the column.

ALTER TABLE game_flags ADD COLUMN IF NOT EXISTS beta BOOLEAN NOT NULL DEFAULT FALSE;
