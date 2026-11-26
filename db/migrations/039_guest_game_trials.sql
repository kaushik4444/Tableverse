-- 039_guest_game_trials.sql: limited game trials for guests. The owner can limit how many games each guest device may
-- start, per game (Games tab). A game with a NULL limit has no limit, which is every game until the owner sets one.
-- players.guest_trial_key is a hash of the device's trial cookie, stored when the guest is made. guest_game_trials counts
-- the games each device has started per game. Additive and idempotent: an older application version ignores all of it.

ALTER TABLE game_flags ADD COLUMN IF NOT EXISTS guest_trial_limit INTEGER NULL;
ALTER TABLE game_flags DROP CONSTRAINT IF EXISTS game_flags_guest_trial_limit_check;
ALTER TABLE game_flags ADD CONSTRAINT game_flags_guest_trial_limit_check CHECK (guest_trial_limit IS NULL OR guest_trial_limit BETWEEN 1 AND 9);

ALTER TABLE players ADD COLUMN IF NOT EXISTS guest_trial_key TEXT NULL;

CREATE TABLE IF NOT EXISTS guest_game_trials (
  trial_key TEXT NOT NULL,
  game_id TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0 CHECK (plays >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trial_key, game_id)
);
