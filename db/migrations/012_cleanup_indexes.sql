-- 012_cleanup_indexes.sql: indexes the periodic cleanups need (no table or column changes).
-- Without these, each batch of the unverified-account cleanup sorts every account, and the session and token expiry
-- sweeps read every row. Plain CREATE INDEX: the tables are small enough that the short lock is acceptable at deploy time.

-- The unverified-account cleanup selects by age, oldest first (db/unverifiedCleanup.js).
CREATE INDEX IF NOT EXISTS idx_players_created_at ON players (created_at);

-- Expiry sweeps (db/cleanup.js): sessions and e-mail tokens that have passed their expiry.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_expires ON auth_email_tokens (expires_at);

-- Duplicate of idx_auth_sessions_hash (same columns and predicate): every session write maintained it twice.
DROP INDEX IF EXISTS idx_auth_sessions_valid;
