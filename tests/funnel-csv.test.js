'use strict';
// The signup funnel CSV: one header line, one row per signup day, numbers and dates only.
const assert = require('node:assert/strict');
const { funnelCsv } = require('../lib/funnelCsv');

const csv = funnelCsv({ days: 30, totals: {}, daily: [{ day: '2026-11-07', signups: 4, played: 3, returned: 1 }, { day: '2026-11-08', signups: 0, played: 0, returned: 0 }] });
assert.equal(csv, 'day,signups,played_first_game,returned_on_a_later_day\r\n2026-11-07,4,3,1\r\n2026-11-08,0,0,0\r\n');
const empty = funnelCsv({ days: 7, totals: {}, daily: [] });
assert.equal(empty, 'day,signups,played_first_game,returned_on_a_later_day\r\n', 'a range with no signups gives only the header');
console.log('  ok  funnel CSV: header, one row per day, empty range');
console.log('funnel-csv: 1 passed');
