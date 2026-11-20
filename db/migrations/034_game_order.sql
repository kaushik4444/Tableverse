-- 034_game_order.sql: the order of games in the home menu, set by staff in the admin console (Games tab).
-- sort_order is the position (0 = first). NULL means no position was chosen, so the game keeps its default place.
-- Additive and nullable: an older application version ignores the column and keeps working.
ALTER TABLE game_flags ADD COLUMN IF NOT EXISTS sort_order INTEGER;
