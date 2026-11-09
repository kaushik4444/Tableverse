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

/** null for "not given" or "now"; a Date otherwise. Anything that is not a date string or number is refused. */
function parseDate(value, label) {
  if (value === undefined || value === null || value === '' || value === 'now') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new AnnouncementError(`${label} is not a valid date.`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AnnouncementError(`${label} is not a valid date.`);
  return d;
}

function durationOf(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new AnnouncementError('Say when it should end (an end time or a duration).');
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) throw new AnnouncementError('Say when it should end (an end time or a duration).');
  return hours;
}

const endAfter = (startsAt, hours) => new Date(startsAt.getTime() + hours * 60 * 60 * 1000);

/**
 * The one rule for a window, used for new banners AND for every edit (the store calls it with the merged values, so an edit of
 * only one date is checked against the stored other date). Every banner has an end, and the end is never in the past.
 */
function checkWindow(startsAt, endsAt, now = new Date()) {
  if (!(endsAt > startsAt)) throw new AnnouncementError('The end must be after the start.');
  if (endsAt <= now) throw new AnnouncementError('That end time has already passed.');
  if (startsAt.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * DAY) throw new AnnouncementError(`Schedule at most ${MAX_SCHEDULE_AHEAD_DAYS} days ahead.`);
  if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_DAYS * DAY) throw new AnnouncementError(`An announcement can run for at most ${MAX_DURATION_DAYS} days.`);
}

/**
 * Turns an admin form into a row. A new banner may omit `startsAt` (it starts now); its end is `endsAt` or `durationHours`
 * (24 = one day). An EDIT (`partial`) returns only the fields that were sent: a missing date is never filled in, because the
 * store merges the stored row first. Anything unusable throws AnnouncementError.
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
  if (!partial) {
    const startsAt = parseDate(b.startsAt, 'The start time') || now;
    const endsAt = parseDate(b.endsAt, 'The end time') || endAfter(startsAt, durationOf(b.durationHours));
    checkWindow(startsAt, endsAt, now);
    out.startsAt = startsAt;
    out.endsAt = endsAt;
  } else {
    if (b.startsAt !== undefined) out.startsAt = parseDate(b.startsAt, 'The start time') || now;
    if (b.endsAt !== undefined) {
      const endsAt = parseDate(b.endsAt, 'The end time');
      if (!endsAt) throw new AnnouncementError('The end time is not valid.');
      out.endsAt = endsAt;
    } else if (b.durationHours !== undefined) {
      out.durationHours = durationOf(b.durationHours); // the store applies it to the merged start
    }
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

/**
 * A dismissal of revision N hides revision N and any older revision: the list may come from a cache on another instance that
 * still holds an older copy of the same announcement. A newer revision (N+1 and up) is shown.
 */
function isDismissed(a, dismissed) {
  const rev = dismissed.get(a.id);
  return rev !== undefined && rev >= (a.revision ?? 1);
}

/**
 * The banners one viewer sees now: live, targeted at them, and not dismissed at THIS revision (a dismissed banner comes
 * back once it has been edited). `dismissed` maps announcement id -> the revision the viewer dismissed.
 * Warnings first, newest first, at most MAX_SHOWN.
 */
function forViewer(list, viewer, now = new Date(), dismissed = new Map()) {
  return list
    .filter((a) => statusOf(a, now) === 'live' && audienceMatches(a.audience, viewer) && !isDismissed(a, dismissed))
    .sort((x, y) => (LEVEL_RANK[x.level] - LEVEL_RANK[y.level]) || (new Date(y.starts_at) - new Date(x.starts_at)))
    .slice(0, MAX_SHOWN)
    .map((a) => ({ id: a.id, revision: a.revision ?? 1, message: a.message, level: a.level, endsAt: new Date(a.ends_at).toISOString() }));
}

module.exports = { LEVELS, AUDIENCES, MAX_MESSAGE, MAX_DURATION_DAYS, MAX_SHOWN, AnnouncementError, cleanMessage, parseInput, checkWindow, endAfter, statusOf, audienceMatches, forViewer };
