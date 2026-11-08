'use strict';
/**
 * Announcement banners: validation, schedule status, audience targeting and what one viewer should see. Pure functions.
 * The ANNOUNCEMENT environment variable keeps working separately (server.js still sends it as `announcement`).
 */
const LEVELS = ['info', 'warning', 'success'];
const AUDIENCES = ['all', 'signed_in', 'guests', 'admins'];
const MAX_MESSAGE = 200;
const MAX_DURATION_DAYS = 90; // every announcement expires: there is no "forever"
const MAX_SCHEDULE_AHEAD_DAYS = 180;
const MAX_SHOWN = 3;
const DAY = 24 * 60 * 60 * 1000;
const LEVEL_RANK = { warning: 0, info: 1, success: 2 };

class AnnouncementError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'AnnouncementError'; this.status = status; }
}

const cleanMessage = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '');

function parseDate(value, label) {
  if (value === undefined || value === null || value === '' || value === 'now') return null;
  const d = new Date(value);
  if (typeof value !== 'string' && typeof value !== 'number') throw new AnnouncementError(`${label} is not a valid date.`);
  if (Number.isNaN(d.getTime())) throw new AnnouncementError(`${label} is not a valid date.`);
  return d;
}

/**
 * Turns an admin form into a row. `startsAt` may be omitted (start now); the end is `endsAt` or `durationHours` (24 = one day).
 * Throws AnnouncementError for anything unusable, including an end in the past, so a mistake cannot publish an expired banner.
 */
function parseInput(body, now = new Date(), { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  if (!partial || b.message !== undefined) {
    const message = cleanMessage(b.message);
    if (!message) throw new AnnouncementError('Write the announcement text.');
    if (message.length > MAX_MESSAGE) throw new AnnouncementError(`Keep the announcement to ${MAX_MESSAGE} characters.`);
    out.message = message;
  }
  if (!partial || b.level !== undefined) {
    const level = b.level === undefined ? 'info' : b.level;
    if (!LEVELS.includes(level)) throw new AnnouncementError('Choose info, warning or success.');
    out.level = level;
  }
  if (!partial || b.audience !== undefined) {
    const audience = b.audience === undefined ? 'all' : b.audience;
    if (!AUDIENCES.includes(audience)) throw new AnnouncementError('Choose who should see it: everyone, signed-in players, guests or admins.');
    out.audience = audience;
  }
  if (!partial || b.startsAt !== undefined || b.endsAt !== undefined || b.durationHours !== undefined) {
    const startsAt = parseDate(b.startsAt, 'The start time') || now;
    let endsAt = parseDate(b.endsAt, 'The end time');
    if (!endsAt) {
      const hours = Number(b.durationHours);
      if (!Number.isFinite(hours) || hours <= 0) throw new AnnouncementError('Say when it should end (an end time or a duration).');
      endsAt = new Date(startsAt.getTime() + hours * 60 * 60 * 1000);
    }
    if (endsAt <= startsAt) throw new AnnouncementError('The end must be after the start.');
    if (endsAt <= now) throw new AnnouncementError('That end time has already passed.');
    if (startsAt.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * DAY) throw new AnnouncementError(`Schedule at most ${MAX_SCHEDULE_AHEAD_DAYS} days ahead.`);
    if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_DAYS * DAY) throw new AnnouncementError(`An announcement can run for at most ${MAX_DURATION_DAYS} days.`);
    out.startsAt = startsAt;
    out.endsAt = endsAt;
  }
  return out;
}

/** 'ended' (ended early by an admin), 'expired', 'scheduled' or 'live'. */
function statusOf(a, now = new Date()) {
  if (a.ended_at && new Date(a.ended_at) <= now) return 'ended';
  if (new Date(a.ends_at) <= now) return 'expired';
  if (new Date(a.starts_at) > now) return 'scheduled';
  return 'live';
}

/** viewer: { signedIn: boolean, isAdmin: boolean } (derived on the server from the session, never from the request). */
function audienceMatches(audience, viewer) {
  const v = viewer || {};
  switch (audience) {
    case 'all': return true;
    case 'signed_in': return Boolean(v.signedIn);
    case 'guests': return !v.signedIn;
    case 'admins': return Boolean(v.isAdmin);
    default: return false;
  }
}

/** The banners one viewer sees now: live, targeted at them, not dismissed; warnings first, newest first, at most MAX_SHOWN. */
function forViewer(list, viewer, now = new Date(), dismissedIds = new Set()) {
  return list
    .filter((a) => statusOf(a, now) === 'live' && audienceMatches(a.audience, viewer) && !dismissedIds.has(a.id))
    .sort((x, y) => (LEVEL_RANK[x.level] - LEVEL_RANK[y.level]) || (new Date(y.starts_at) - new Date(x.starts_at)))
    .slice(0, MAX_SHOWN)
    .map((a) => ({ id: a.id, message: a.message, level: a.level, endsAt: new Date(a.ends_at).toISOString() }));
}

module.exports = { LEVELS, AUDIENCES, MAX_MESSAGE, MAX_DURATION_DAYS, MAX_SHOWN, AnnouncementError, cleanMessage, parseInput, statusOf, audienceMatches, forViewer };
