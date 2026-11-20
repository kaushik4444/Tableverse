'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate the calendar fields without Date, which would discard PostgreSQL microseconds.
function validHistoryCursor(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('|');
  if (parts.length !== 2 || !UUID.test(parts[1])) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.exec(parts[0]);
  if (!m) return false;
  const [, year, month, day, hour, minute, second] = m.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60;
}

module.exports = { UUID, validHistoryCursor };
