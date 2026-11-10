'use strict';
/**
 * Owner-only e-mail broadcasts (Stage 20.7). Pure rules and the sending worker; the SQL lives in db/admin.js and the in-memory
 * twin in tests/helpers/memoryAdminStore.js. Both stores answer the same calls, so one set of rules covers both.
 *
 * Two categories:
 *  - account: service mail (release notices about the account, important changes). Goes to any chosen audience, including
 *    unverified accounts. It carries no unsubscribe link because it is not marketing.
 *  - promo: promotions, seasonal greetings, comeback mail. Only VERIFIED accounts that have not opted out receive it, and every
 *    message carries a one-click unsubscribe link (List-Unsubscribe header too).
 */

const AUDIENCES = ['all', 'verified', 'unverified', 'admins', 'players', 'inactive'];
const CATEGORIES = ['account', 'promo'];
const INACTIVE_DAYS = 30;
const MAX_SUBJECT = 160;
const MAX_BODY = 5000;
const BATCH = 20;

class BroadcastError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'BroadcastError'; this.status = status; }
}

/** Checks and normalises what the owner typed. Throws BroadcastError with a message that can be shown as it is. */
function validateTarget({ audience, category }) {
  if (!AUDIENCES.includes(audience)) throw new BroadcastError('Choose who should receive the e-mail.');
  if (!CATEGORIES.includes(category)) throw new BroadcastError('Choose the kind of e-mail.');
  if (category === 'promo' && audience === 'unverified') {
    throw new BroadcastError('Promotional e-mail is never sent to unverified accounts. Use an account e-mail for them.');
  }
  return { audience, category };
}

/** Checks and normalises what the owner typed. Throws BroadcastError with a message that can be shown as it is. */
function validateCompose({ audience, category, subject, body }) {
  const target = validateTarget({ audience, category });
  // one line only: a subject with a line break could add headers in some mail clients
  const s = String(subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!s) throw new BroadcastError('The subject is required.');
  if (s.length > MAX_SUBJECT) throw new BroadcastError(`The subject can be at most ${MAX_SUBJECT} characters.`);
  const b = String(body || '').replace(/\r\n?/g, '\n').trim();
  if (!b) throw new BroadcastError('The message is required.');
  if (b.length > MAX_BODY) throw new BroadcastError(`The message can be at most ${MAX_BODY} characters.`);
  return { ...target, subject: s, body: b };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The message as HTML and text. The body is escaped: the owner's text can never add markup. */
function renderMessage({ category, subject, body, unsubscribeUrl = null }) {
  const paras = body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  const footer = category === 'promo'
    ? `<p style="font-size:12px;color:#666">You receive this because you have a Tableverse account. <a href="${esc(unsubscribeUrl)}">Unsubscribe from promotional e-mail</a>.</p>`
    : '<p style="font-size:12px;color:#666">You receive this service e-mail because you have a Tableverse account.</p>';
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45;color:#111">\n${paras}\n${footer}\n</div>`;
  const textFooter = category === 'promo'
    ? `\n\n—\nYou receive this because you have a Tableverse account. Unsubscribe from promotional e-mail: ${unsubscribeUrl}`
    : '\n\n—\nYou receive this service e-mail because you have a Tableverse account.';
  return { subject, html, text: `${body}${textFooter}` };
}

/**
 * Sends the queued broadcasts, a batch at a time with a pause between batches (provider rate limits). Recipients are read from
 * the store at send time, so an opt-out or a deleted account before its turn is respected. A failed recipient is recorded and the
 * run goes on; the provider idempotency key makes a retry after a crash safe for the same recipient.
 *
 * store: claimNext() (returns an owner token), renewLease(id, owner), pendingBatch(id, n), currentRecipient(id, playerId),
 *        markRecipient(id, playerId, state, owner), finishBroadcast(id, owner)
 * deliver({ broadcastId, playerId, category, subject, html, text, to, unsubscribeUrl, idempotencyKey })
 */
// Resend allows 10 requests a second per team; one send every 550 ms keeps a single run well inside that.
function createBroadcastWorker({ store, deliver, makeUnsubscribeUrl = () => null, pauseMs = 1000, gapMs = 550, retryDelays = [1000, 2000, 4000], batchSize = BATCH, logger = console }) {
  let running = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runOnce() {
    if (running) return { busy: true };
    running = true;
    try {
      const job = await store.claimNext();
      if (!job) return { idle: true };
      for (;;) {
        const batch = await store.pendingBatch(job.id, batchSize);
        if (!batch.length) break;
        for (const pending of batch) {
          // this run must still hold the broadcast before it sends anything else (its lease may have run out and been taken over)
          if (!(await store.renewLease(job.id, job.owner))) throw new LeaseLostError();
          // the recipient is read again before every attempt: an opt-out, a changed or removed address that lands mid-batch,
          // or during a rate-limit wait, must count. The attempt that finally sends is the one that matters.
          let outcome = null; // 'sent' | 'failed' | 'skipped'
          for (let attempt = 0; outcome === null; attempt++) {
            const r = await store.currentRecipient(job.id, pending.player_id);
            if (!r || r.skip) { outcome = 'skipped'; break; }
            const unsubscribeUrl = job.category === 'promo' ? makeUnsubscribeUrl(r.unsubscribe_token) : null;
            if (job.category === 'promo' && !unsubscribeUrl) {
              // no link, no promotional mail: recorded as failed rather than sent without an opt-out
              logger.error('[broadcast] promotional mail needs PUBLIC_APP_URL for the unsubscribe link');
              outcome = 'failed';
              break;
            }
            const msg = renderMessage({ category: job.category, subject: job.subject, body: job.body, unsubscribeUrl });
            try {
              await deliver({
                broadcastId: job.id, playerId: r.player_id, category: job.category, to: r.email,
                subject: msg.subject, html: msg.html, text: msg.text, unsubscribeUrl,
                idempotencyKey: `broadcast:${job.id}:${r.player_id}`,
              });
              outcome = 'sent';
            } catch (err) {
              // a rate limit is not a failed address: wait and try again, with the same idempotency key
              if (err && err.status === 429 && attempt < retryDelays.length) { await wait(retryDelays[attempt]); continue; }
              // the address itself is never logged; the failure kind is enough to debug
              logger.error(`[broadcast] delivery failed for ${job.id}: ${err && err.message ? err.message.slice(0, 120) : 'unknown error'}`);
              outcome = 'failed';
            }
          }
          // outside the catch on purpose: a database error here must stop the run, not mark a delivered mail as failed.
          // The run then stops with the recipient still pending; the same idempotency key makes the retry safe.
          await store.markRecipient(job.id, pending.player_id, outcome, job.owner);
          await wait(gapMs);
        }
        await wait(pauseMs);
      }
      await store.finishBroadcast(job.id, job.owner);
      return { id: job.id, done: true };
    } finally {
      running = false;
    }
  }
  return { runOnce, isRunning: () => running };
}

/** A run that no longer holds its broadcast (its lease ran out and another run took it). It stops; it writes nothing more. */
class LeaseLostError extends Error {
  constructor() { super('the broadcast was taken over by another run'); this.code = 'LEASE_LOST'; }
}

module.exports = { LeaseLostError, AUDIENCES, CATEGORIES, INACTIVE_DAYS, MAX_BODY, BroadcastError, validateTarget, validateCompose, renderMessage, createBroadcastWorker };
