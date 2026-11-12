'use strict';
// One row per signup day. Only numbers and dates are written, so nothing in a cell can be read as a formula.
function funnelCsv(f) {
  const lines = ['day,signups,played_first_game,returned_on_a_later_day'];
  for (const r of f.daily) lines.push(`${r.day},${r.signups},${r.played},${r.returned}`);
  return lines.join('\r\n') + '\r\n';
}

module.exports = { funnelCsv };
