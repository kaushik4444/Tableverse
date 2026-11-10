-- 016_email_broadcasts.sql: owner-only e-mail broadcasts.
-- players.marketing_opt_out_at: when the account opted out of PROMOTIONAL mail (account mail is never affected).
-- players.unsubscribe_token: random per account; the one-click unsubscribe link carries it, so no secret is needed.
-- A broadcast stores WHO was chosen (player ids), never copies of addresses: the address is read when the mail is sent.
ALTER TABLE players ADD COLUMN IF NOT EXISTS marketing_opt_out_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_unsubscribe_token ON players (unsubscribe_token);

CREATE TABLE IF NOT EXISTS email_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES players(id) ON DELETE SET NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'verified', 'unverified', 'admins', 'players', 'inactive')),
  category TEXT NOT NULL CHECK (category IN ('account', 'promo')),
  subject VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent')),
  -- a worker holds a run while this lease is in the future; it renews it per batch. An expired lease means the run was abandoned.
  lease_until TIMESTAMPTZ,
  -- the run that holds the broadcast: every write it makes checks this token, so a run whose lease ran out cannot write after a takeover
  lease_owner UUID,
  -- when the holding run last renewed (or claimed) it. The provider keeps idempotency keys for 24 hours: a run that has been silent longer is closed, never resumed
  renewed_at TIMESTAMPTZ,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_broadcasts_status ON email_broadcasts (status, created_at);

CREATE TABLE IF NOT EXISTS email_broadcast_recipients (
  broadcast_id UUID NOT NULL REFERENCES email_broadcasts(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed', 'skipped')),
  -- when the first send attempt for this recipient was made. Written before the provider is called; never moves after that
  attempted_at TIMESTAMPTZ,
  PRIMARY KEY (broadcast_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_email_broadcast_recipients_pending ON email_broadcast_recipients (broadcast_id) WHERE state = 'pending';
