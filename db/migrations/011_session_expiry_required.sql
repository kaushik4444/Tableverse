-- 011_session_expiry_required.sql: every session now has an expiry. Earlier versions created legacy sessions with no
-- expires_at, which never expired. They are REVOKED here, never deleted (the rows keep their history); a player with one
-- signs in again. Idempotent: running it again changes nothing. Reverse: nothing (revoked stays revoked).
UPDATE auth_sessions
   SET revoked_at = NOW()
 WHERE revoked_at IS NULL
   AND expires_at IS NULL;
