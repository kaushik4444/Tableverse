'use strict';
/**
 * The "welcome back" summary shown when a player returns after a break. Pure functions, so the rules are tested without a
 * database. The streak counts days with at least one finished game (any game), in UTC: today counts, and so does yesterday
 * if nothing was played yet today, so a streak does not break at the start of the day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_AWAY_DAYS = 1; // a return within the same day is not a "welcome back"

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/** dayKeys: 'YYYY-MM-DD' strings of days with a finished game. Returns how many days in a row end today (or yesterday). */
function streakDays(dayKeys, now) {
  const days = new Set(dayKeys);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(new Date(now).getTime() - DAY_MS));
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (!cursor) return 0;
  let count = 0;
  while (cursor && days.has(cursor)) {
    count += 1;
    cursor = dayKey(new Date(new Date(cursor).getTime() - DAY_MS));
  }
  return count;
}

/**
 * previousSeenAt: the last visit before this one (null for a new player). Returns null when there is nothing to welcome
 * back to, so the client shows no card. `since` is the previous visit, so a dismissed card stays dismissed for that visit.
 */
function summarize({ previousSeenAt, dayKeys, now }) {
  if (!previousSeenAt) return null;
  const awayMs = new Date(now).getTime() - new Date(previousSeenAt).getTime();
  const awayDays = Math.floor(awayMs / DAY_MS);
  if (awayDays < MIN_AWAY_DAYS) return null;
  return { awayDays, streak: streakDays(dayKeys, now), since: new Date(previousSeenAt).toISOString() };
}

module.exports = { summarize, streakDays, dayKey, MIN_AWAY_DAYS };
