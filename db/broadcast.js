'use strict';
/**
 * PostgreSQL store for the owner's e-mail broadcasts (Stage 20.7). Rules: lib/broadcast.js; role and audit: db/admin.js.
 * Recipients are chosen when the owner queues the send (a snapshot of player ids). Addresses are never copied: the worker reads
 * the current verified address when it sends, and skips promotional mail for an account that has opted out since.
 */
const db = require('./pool');
const policy = require('../lib/adminPolicy');
const { INACTIVE_DAYS, BroadcastError } = require('../lib/broadcast');
const { audit } = require('./admin');

const PAGE = 25;
const WHERE = {
  all: 'TRUE',
  verified: 'a.email_verified_at IS NOT NULL',
  unverified: 'a.email_verified_at IS NULL',
  admins: "p.role IN ('admin', 'owner')",
  players: "p.role = 'user'",
  inactive: `p.last_seen_at < NOW() - INTERVAL '${Number(INACTIVE_DAYS)} days'`,
};

/** The accounts a broadcast reaches. Promotional mail: verified and not opted out, whatever the audience. */
function recipientsFrom(audience, category) {
  const promo = category === 'promo' ? ' AND a.email_verified_at IS NOT NULL AND p.marketing_opt_out_at IS NULL' : '';
  return `FROM players p
            JOIN auth_identities a ON a.player_id = p.id AND a.provider = 'email'
           WHERE p.is_anonymous = FALSE AND ${WHERE[audience]}${promo}`;
}

/** How many accounts a broadcast would reach now. Used for the preview and to confirm the send. */
async function broadcastCount({ audience, category }) {
  return (await db.query(`SELECT COUNT(DISTINCT p.id)::int AS n ${recipientsFrom(audience, category)}`)).rows[0].n;
}

/**
 * Queues one broadcast for the owner. The role is re-read inside the transaction, and the recipient count the owner saw must still
 * be the count at send time (otherwise the list changed under them and nothing is queued).
 */
async function queueBroadcast({ actorId, audience, category, subject, body, expectedCount }) {
  return db.withTransaction(async (c) => {
    const actor = (await c.query('SELECT id, role FROM players WHERE id = $1 FOR UPDATE', [actorId])).rows[0];
    policy.checkBroadcast({ actor });
    const from = recipientsFrom(audience, category);
    const n = (await c.query(`SELECT COUNT(DISTINCT p.id)::int AS n ${from}`)).rows[0].n;
    if (n !== Number(expectedCount)) throw new BroadcastError(`The list now has ${n} recipients, not ${expectedCount}. Check the count again before sending.`, 409);
    if (n === 0) throw new BroadcastError('No one matches this audience yet.', 409);
    const id = (await c.query(
      `INSERT INTO email_broadcasts (created_by, audience, category, subject, body, recipient_count)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [actorId, audience, category, subject, body, n]
    )).rows[0].id;
    await c.query(`INSERT INTO email_broadcast_recipients (broadcast_id, player_id) SELECT DISTINCT $1::uuid, p.id ${from}`, [id]);
    // the audit row records what was sent to whom, never the message text
    await audit(c, { actorId, action: 'broadcast.queue', targetType: 'broadcast', targetId: id, detail: { audience, category, recipients: n } });
    return { id, recipientCount: n };
  });
}

async function listBroadcasts({ page: p = 1 } = {}) {
  const offset = (Math.max(1, Math.floor(Number(p)) || 1) - 1) * PAGE;
  const total = (await db.query('SELECT COUNT(*)::int AS n FROM email_broadcasts')).rows[0].n;
  const r = await db.query(
    `SELECT b.id, b.created_at, b.audience, b.category, b.subject, b.status, b.recipient_count, b.sent_count, b.failed_count, b.finished_at,
            pl.username AS created_by
       FROM email_broadcasts b LEFT JOIN players pl ON pl.id = b.created_by
      ORDER BY b.created_at DESC, b.id LIMIT ${PAGE} OFFSET $1`,
    [offset]
  );
  return { total, pageSize: PAGE, items: r.rows };
}

/** The next broadcast to send (also one that a crashed run left half sent). FOR UPDATE SKIP LOCKED: two runs never take the same one. */
async function claimNext() {
  const r = await db.query(
    `UPDATE email_broadcasts SET status = 'sending'
      WHERE id = (SELECT id FROM email_broadcasts WHERE status IN ('queued', 'sending')
                   ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, category, subject, body`
  );
  return r.rows[0] || null;
}

/** Next pending recipients. `skip` is true when the mail must not go out now (no address, or promo after an opt-out). */
async function pendingBatch(broadcastId, n) {
  const r = await db.query(
    `SELECT r.player_id, a.provider_user_id AS email, p.unsubscribe_token,
            (a.provider_user_id IS NULL OR (b.category = 'promo' AND (a.email_verified_at IS NULL OR p.marketing_opt_out_at IS NOT NULL))) AS skip
       FROM email_broadcast_recipients r
       JOIN email_broadcasts b ON b.id = r.broadcast_id
       JOIN players p ON p.id = r.player_id
       LEFT JOIN auth_identities a ON a.player_id = p.id AND a.provider = 'email'
      WHERE r.broadcast_id = $1 AND r.state = 'pending'
      LIMIT $2`,
    [broadcastId, n]
  );
  return r.rows;
}

async function markRecipient(broadcastId, playerId, state) {
  await db.query('UPDATE email_broadcast_recipients SET state = $3 WHERE broadcast_id = $1 AND player_id = $2', [broadcastId, playerId, state]);
}

async function finishBroadcast(broadcastId) {
  await db.query(
    `UPDATE email_broadcasts b SET status = 'sent', finished_at = NOW(),
            recipient_count = (SELECT COUNT(*)::int FROM email_broadcast_recipients WHERE broadcast_id = b.id),
            sent_count = (SELECT COUNT(*)::int FROM email_broadcast_recipients WHERE broadcast_id = b.id AND state = 'sent'),
            failed_count = (SELECT COUNT(*)::int FROM email_broadcast_recipients WHERE broadcast_id = b.id AND state = 'failed')
      WHERE b.id = $1`,
    [broadcastId]
  );
}

/** One-click opt-out from promotional mail. The token is random per account and is the only thing the link carries. */
async function unsubscribe(token) {
  const r = await db.query(
    'UPDATE players SET marketing_opt_out_at = COALESCE(marketing_opt_out_at, NOW()) WHERE unsubscribe_token = $1 RETURNING id',
    [token]
  );
  return r.rowCount > 0;
}

module.exports = { broadcastCount, queueBroadcast, listBroadcasts, claimNext, pendingBatch, markRecipient, finishBroadcast, unsubscribe };
