-- 009_open_game_ids.sql: private-table invitations no longer hard-code the list of games in the database.
-- The server validates the game id against its game registry (games/index.js), so adding a game needs no migration.
-- The constraint stays as a format check so a malformed id can never be stored.
ALTER TABLE private_table_invitations DROP CONSTRAINT IF EXISTS private_table_invitations_valid_game;
ALTER TABLE private_table_invitations
  ADD CONSTRAINT private_table_invitations_valid_game CHECK (game_id ~ '^[a-z0-9]{3,32}$');
