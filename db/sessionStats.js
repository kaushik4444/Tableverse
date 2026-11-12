'use strict';
/**
 * When people open the site and how long a visit lasts (read-only, Insights tab).
 *
 * Both come from aggregate counters written by the game server (`session_hour`, `session_len` in analytics_daily): a count per
 * UTC hour of the day and a count per visit-length bucket. No account, address or device is attached to either counter.
 * A visit is one WebSocket connection, so a reconnect starts a new visit; connections shorter than 3 seconds (health checks,
 * flapping reconnects) are in neither counter. A visit is counted when it ends, under the UTC hour it opened in.
 */
const db = require('./pool');
const { lengthBucket } = require('../lib/analytics');

const WINDOWS = [7, 30, 90];
const clampDays = (d) => { const n = Math.floor(Number(d)); return WINDOWS.includes(n) ? n : 30; };
const ZONES = ['UTC', 'Europe/Berlin', 'Asia/Kolkata'];
const clampZone = (z) => (ZONES.includes(z) ? z : 'UTC');
// the visit-length buckets, in order: the counter dimension and what the console calls it
const LENGTHS = [['lt1m', 'under 1 min'], ['1_5m', '1–5 min'], ['5_15m', '5–15 min'], ['15_60m', '15–60 min'], ['gt60m', 'over 1 h']];

/** Minutes east of UTC that `zone` is at `at` ("GMT+5:30" -> 330). */
function zoneOffsetMinutes(zone, at = new Date()) {
  if (zone === 'UTC') return 0;
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part ? part.value : '');
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

/** 24 UTC-hour counts shifted into a zone. Half-hour zones (India) split each UTC hour across two local hours; whole counts are
 *  handed out by largest remainder, so the total never changes (one visit stays one visit). */
function shiftHours(utc, offsetMinutes) {
  const exact = Array(24).fill(0);
  utc.forEach((v, h) => {
    const start = h * 60 + offsetMinutes;
    const first = Math.floor(start / 60); const frac = (((start % 60) + 60) % 60) / 60;
    const a = ((first % 24) + 24) % 24; const b = (a + 1) % 24;
    exact[a] += v * (1 - frac); exact[b] += v * frac;
  });
  const out = exact.map(Math.floor);
  let left = Math.round(utc.reduce((x, y) => x + y, 0)) - out.reduce((x, y) => x + y, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((p, q) => (q[0] - p[0]) || (p[1] - q[1]));
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

async function sessionStats({ days = 30, tz = 'UTC', now = new Date() } = {}) {
  const n = clampDays(days); const zone = clampZone(tz);
  const r = await db.query(
    `SELECT metric, dim, SUM(total)::int AS total FROM analytics_daily
      WHERE day > (NOW() AT TIME ZONE 'UTC')::date - $1::int AND metric IN ('session_hour', 'session_len') GROUP BY metric, dim`, [n]);
  const utc = Array(24).fill(0); const len = new Map();
  for (const x of r.rows) {
    if (x.metric === 'session_hour') { const h = Number(x.dim); if (Number.isInteger(h) && h >= 0 && h < 24) utc[h] += x.total; } else len.set(x.dim, x.total);
  }
  return {
    zone,
    byHour: shiftHours(utc, zoneOffsetMinutes(zone, now)),
    length: LENGTHS.map(([key, name]) => ({ name, total: len.get(key) || 0 })),
  };
}

module.exports = { sessionStats, lengthBucket, shiftHours, zoneOffsetMinutes, LENGTHS };
