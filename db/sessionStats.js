'use strict';
/**
 * When people open the site and how long a visit lasts (read-only, Insights tab).
 *
 * Both come from aggregate counters written by the game server (`session_hour`, `session_len` in analytics_daily): a count per
 * UTC hour of the day and a count per visit-length bucket. No account, address or device is attached to either counter.
 * A visit is one WebSocket connection, so a reconnect starts a new visit; connections shorter than 3 seconds (health checks,
 * flapping reconnects) are not counted.
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

/** 24 UTC-hour counts shifted into a zone. Half-hour zones (India) put each UTC hour half in two hours: the count is split evenly. */
function shiftHours(utc, offsetMinutes) {
  const out = Array(24).fill(0);
  utc.forEach((v, h) => {
    const start = h * 60 + offsetMinutes; // minutes since local midnight of the first half-hour edge
    const first = Math.floor(start / 60); const frac = ((start % 60) + 60) % 60 / 60;
    const a = ((first % 24) + 24) % 24; const b = (a + 1) % 24;
    out[a] += v * (1 - frac); out[b] += v * frac;
  });
  return out.map((v) => Math.round(v));
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
