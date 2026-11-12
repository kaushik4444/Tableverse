'use strict';
/**
 * Chat report queue for the admin console (read-only, staff only).
 *
 * Shows each chat report with what a moderator needs to triage it: the reason, the message copy kept with the report (up to
 * 200 characters), the room, when it was made, the reporter's and the reported account's usernames, whether the reported
 * account is suspended, and how often that account has been reported (all time and in the last 30 days).
 * No e-mail address, network address, token or display-name history is selected. Opening the queue is written to the audit
 * log ("reports.view") in the same transaction as the read; the audit row holds no report content.
 *
 * Severity is a fixed mapping from the reason, so the queue can be sorted by urgency without reading the message text.
 */
const db = require('./pool');

const PAGE = 25;
const RECENT_DAYS = 30;
// Fixed by reason. Threats and sexual content come first; spam and other reasons last.
const SEVERITY = { threats: 'high', sexual: 'high', harassment: 'medium', hate: 'medium', spam: 'low', other: 'low' };
const page = (p) => { const n = Math.floor(Number(p)); return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, 10000) - 1 : 0; };
const num = (v) => Number(v) || 0;

async function listReports({ page: pg = 1, actorId = null } = {}) {
  return db.withTransaction(async (c) => {
    const total = (await c.query('SELECT COUNT(*)::int AS n FROM chat_reports')).rows[0].n;
    const r = await c.query(
      `SELECT r.id, r.reason, r.details, r.message_text, r.room_code, r.created_at,
              r.reported_display_name, rep.username AS reporter_username, rep.is_anonymous AS reporter_guest,
              rd.username AS reported_username, (rd.suspended_at IS NOT NULL) AS reported_suspended,
              -- a deleted reported account leaves reported_id NULL (migration 015): its counts are unknown, not zero
              CASE WHEN r.reported_id IS NULL THEN NULL ELSE
                (SELECT COUNT(*) FROM chat_reports x WHERE x.reported_id = r.reported_id)::int END AS reported_total,
              CASE WHEN r.reported_id IS NULL THEN NULL ELSE
                (SELECT COUNT(*) FROM chat_reports x WHERE x.reported_id = r.reported_id
                   AND x.created_at > NOW() - ($1::int * INTERVAL '1 day'))::int END AS reported_recent
         FROM chat_reports r
         LEFT JOIN players rep ON rep.id = r.reporter_id
         LEFT JOIN players rd ON rd.id = r.reported_id
        ORDER BY r.created_at DESC, r.id
        LIMIT ${PAGE} OFFSET $2`,
      [RECENT_DAYS, page(pg) * PAGE]
    );
    if (actorId) {
      await c.query('INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [actorId, 'reports.view', 'chat_reports', null, '{}']);
    }
    return {
      total, pageSize: PAGE, recentDays: RECENT_DAYS,
      items: r.rows.map((x) => ({
        id: x.id, reason: x.reason, severity: SEVERITY[x.reason] || 'low', details: x.details || '', message: x.message_text,
        room: x.room_code, createdAt: x.created_at,
        // guests have no username; a reporter with no row left is not shown as a guest
        reporter: x.reporter_username || (x.reporter_guest ? 'a guest' : null),
        reported: x.reported_username || x.reported_display_name || 'Deleted player', reportedSuspended: Boolean(x.reported_suspended),
        reportedTotal: x.reported_total == null ? null : num(x.reported_total),
        reportedRecent: x.reported_recent == null ? null : num(x.reported_recent),
      })),
    };
  });
}

module.exports = { listReports, SEVERITY, PAGE };
