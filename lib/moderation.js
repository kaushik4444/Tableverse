'use strict';
/**
 * Chat moderation rules: what a report may contain, who may be blocked, and which chat a viewer may see.
 * Pure functions only, so the rules can be tested without a database or a socket. The server and db/moderation.js
 * call these before anything is stored or delivered.
 */

const REPORT_REASONS = Object.freeze(['harassment', 'hate', 'threats', 'sexual', 'spam', 'other']);
const MAX_DETAILS = 300;
const MAX_BLOCKS = 500; // per account; a block list longer than this is almost certainly abuse of the feature
const MAX_REPORTS_PER_DAY = 20; // per reporter, so the report queue cannot be flooded by one account
const REPORT_COOLDOWN_MS = 3000; // per socket
const BLOCK_COOLDOWN_MS = 1000; // per account
const UNBLOCK_COOLDOWN_MS = 1000; // per account

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Message ids are random UUIDs issued by the server, so anything else is refused before it reaches the database. */
const isUuid = (s) => typeof s === 'string' && UUID.test(s);

/** Removes control characters and surrounding space, then caps the length. Non-strings become empty. */
function cleanDetails(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAILS);
}

/**
 * Validates a report from the client. The reported text and author are NOT taken from the client: the server looks
 * the message up by id, so a report cannot carry invented content.
 * @returns {{ok: true, messageId: string, reason: string, details: string} | {ok: false, error: string}}
 */
function validateReport(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Invalid report.' };
  if (!isUuid(msg.messageId)) return { ok: false, error: 'That message can no longer be reported.' };
  if (!REPORT_REASONS.includes(msg.reason)) return { ok: false, error: 'Choose a reason for the report.' };
  return { ok: true, messageId: msg.messageId, reason: msg.reason, details: cleanDetails(msg.details) };
}

/** A block target must be a real account id, and never the account itself. */
function validateBlockTarget(selfId, targetId) {
  if (!isUuid(targetId)) return { ok: false, error: 'That player could not be found.' };
  if (targetId === selfId) return { ok: false, error: 'You cannot block yourself.' };
  return { ok: true, targetId };
}

/** True when a chat message from `m.id` must not be delivered to a viewer who has blocked that author. System lines always show. */
function shouldDeliver(m, blockedIds) {
  if (!m || m.sys) return true;
  return !(blockedIds && blockedIds.has(m.id));
}

/** The chat history a viewer may see: messages from authors they have blocked are removed. */
function visibleChat(messages, blockedIds) {
  return (messages || []).filter((m) => shouldDeliver(m, blockedIds));
}

module.exports = {
  REPORT_REASONS, MAX_DETAILS, MAX_BLOCKS, MAX_REPORTS_PER_DAY, REPORT_COOLDOWN_MS, BLOCK_COOLDOWN_MS, UNBLOCK_COOLDOWN_MS,
  isUuid, cleanDetails, validateReport, validateBlockTarget, shouldDeliver, visibleChat,
};
