-- 035_skill_ratings.sql: Elo skill ratings per game (design/scoring-skill-ratings.md). Additive only: two new tables and two
-- nullable or defaulted columns on matches. Nothing existing is removed or changed, so older application versions keep
-- working. Every match starts unrated (rated = FALSE) until scripts/ratings-replay.js has been run with --apply.
--
-- Scopes: 'lifetime' (one continuous rating per player per game) and 'YYYY-MM' (a rating per UTC calendar month).
-- rating_events is the ledger: one row per player, per rated match and per scope. Its unique key makes a replay idempotent.
-- Deleting an account removes its ratings and ledger rows (the cascade); the match rows stay, as today.

CREATE TABLE IF NOT EXISTS player_ratings (
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id     VARCHAR(32) NOT NULL,
  scope       VARCHAR(16) NOT NULL,
  rating      NUMERIC(8, 2) NOT NULL DEFAULT 1000,
  rated_games INTEGER NOT NULL DEFAULT 0 CHECK (rated_games >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, game_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_player_ratings_board ON player_ratings (game_id, scope, rating DESC);

CREATE TABLE IF NOT EXISTS rating_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id       VARCHAR(32) NOT NULL,
  scope         VARCHAR(16) NOT NULL,
  delta         NUMERIC(8, 2) NOT NULL,
  rating_before NUMERIC(8, 2) NOT NULL,
  rating_after  NUMERIC(8, 2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, player_id, game_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_rating_events_player ON rating_events (player_id, game_id, scope);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS rated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS unrated_reason TEXT;
