-- 019_session_device_link.sql: a session remembers the trusted device it was started from (Stage 20.9).
-- Ending that device (sign-out, a racing restore, a password reset, a suspension) ends the sessions it started, so no
-- session can outlive the browser trust it came from. Existing sessions have no device and keep their behaviour.
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES auth_devices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_device ON auth_sessions (device_id) WHERE device_id IS NOT NULL;
