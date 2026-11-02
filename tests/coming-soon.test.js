'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../public/home-ui.js'), 'utf8'), { window, Set, Date });
const ui = window.TVHomeUI({
  S: { guest: true, friends: [], friendRequests: { incoming: [], outgoing: [] }, invitations: { incoming: [] }, bellOpen: false },
  esc: (value) => String(value),
  gameMeta: () => null,
  pingBadge: () => '',
  pendingSocial: () => 0,
});
const html = ui.comingSoonHTML();
const requested = ['Go Fish', 'Snakes and Ladders', 'Monopoly', 'Saboteur', '6 nimmt!', 'UNO', 'Sea Battle', 'CATAN — 4 players', 'CATAN — 5–6 players'];
const extras = ['Hearts', 'Spades', 'Crazy Eights', 'Checkers', 'Chess', 'Connect Four', 'Carcassonne', 'Ticket to Ride', 'Codenames', 'Coup', 'Love Letter', 'The Resistance / Avalon', 'Yahtzee', 'Old Maid', 'Rummy', 'Euchre'];
assert.equal((html.match(/class="soon-card"/g) || []).length, requested.length + extras.length);
let previous = -1;
for (const name of [...requested, ...extras]) {
  const index = html.indexOf(name);
  assert.ok(index > previous, `roadmap order is wrong or missing: ${name}`);
  previous = index;
}
assert.match(html, /Your requested build order/);
assert.match(html, /More games we'd love to bring to the table/);
assert.match(html, /aria-label="Coming soon games"/);
assert.match(html, /class="soon-tag">Planned/);
console.log('Coming Soon roadmap tests passed (25 games, requested order preserved).');
